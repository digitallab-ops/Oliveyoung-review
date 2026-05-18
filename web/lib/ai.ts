import Anthropic from '@anthropic-ai/sdk'
import type { MarketCategoryData, Insights, ProductNegativeData } from './types'
import { pool } from './db'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const NO_MARKDOWN_SYSTEM = '당신은 마케팅 인사이트 작성 도우미입니다. 반드시 일반 텍스트만 사용하세요. #, ##, ###, **, __, >, `, ~ 등 마크다운 서식 기호와 이모지를 절대 사용하지 마세요. 각 항목은 줄바꿈으로 구분하고 - 로 시작하세요.'

// 6시 수집 → 'am', 16시 수집 → 'pm'
function getSlot(): 'am' | 'pm' {
  return new Date().getHours() < 13 ? 'am' : 'pm'
}

// ──────────────────────────────────────────
// 1. 오늘의 통합 브리핑 (랭킹 + 리뷰 합산)
// ──────────────────────────────────────────

function buildDailyBriefPrompt(
  marketData: MarketCategoryData[],
  insights: Insights,
  negativeData: ProductNegativeData[]
): string {
  const ours = marketData.flatMap(c =>
    c.entries.filter(e => e.is_ours)
      .map(e => `${c.category_name} ${e.rank_position}위${e.delta != null ? `(${e.delta > 0 ? '+' : ''}${e.delta})` : ''}`)
  )

  const topRisers = marketData
    .flatMap(c => c.entries
      .filter(e => e.delta != null && e.delta >= 5)
      .map(e => ({ ...e, cat: c.category_name })))
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    .slice(0, 4)
    .map(e => `[${e.cat}] ${e.goods_name} +${e.delta}위 → ${e.rank_position}위`)

  const newTop10 = marketData
    .flatMap(c => c.entries
      .filter(e => e.prev_rank == null && e.rank_position <= 10)
      .map(e => `[${c.category_name}] ${e.goods_name} ${e.rank_position}위 신규진입`))
    .slice(0, 4)

  const topNeg = negativeData
    .sort((a, b) => b.neg_count - a.neg_count)
    .slice(0, 4)
    .map(p => {
      const kw = p.keywords.slice(0, 3).map(k => k.word).join(', ')
      return `${p.goods_name}: 불만 ${p.neg_count}건 (${kw})`
    })

  const posKw = insights.positive_keywords.slice(0, 8).map(k => `${k.word}(${k.cnt})`).join(', ')

  return `[셀퓨전씨 올리브영 오늘 현황 요약]

셀퓨전씨 현재 랭킹:
${ours.length ? ours.join(', ') : 'TOP100 없음'}

오늘 시장 급상승 (경쟁사):
${topRisers.length ? topRisers.join('\n') : '없음'}

오늘 TOP10 신규진입 (경쟁사):
${newTop10.length ? newTop10.join('\n') : '없음'}

자사 리뷰 불만 집중 상품:
${topNeg.length ? topNeg.join('\n') : '없음'}

자사 긍정 키워드: ${posKw}

위 랭킹과 리뷰 데이터를 종합해 셀퓨전씨 담당자가 오늘 가장 주목해야 할 핵심 사항을 4~5개로 작성하라.
시장 위협, 자사 순위, 리뷰 이슈를 균형있게 반영하고 구체적 수치를 포함하라.`
}

export async function generateDailyBrief(
  marketData: MarketCategoryData[],
  insights: Insights,
  negativeData: ProductNegativeData[]
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return ''

  const todayStr = new Date().toLocaleDateString('sv-SE')

  try {
    const cached = await pool.query(
      'SELECT brief_text FROM daily_briefs WHERE brief_date = $1',
      [todayStr]
    )
    if (cached.rows[0]?.brief_text) return cached.rows[0].brief_text
  } catch { /* 테이블 없으면 skip */ }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: NO_MARKDOWN_SYSTEM,
      messages: [{ role: 'user', content: buildDailyBriefPrompt(marketData, insights, negativeData) }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    if (!text) return ''

    await pool.query(`
      INSERT INTO daily_briefs (brief_date, brief_text)
      VALUES ($1, $2)
      ON CONFLICT (brief_date) DO UPDATE
      SET brief_text = EXCLUDED.brief_text, generated_at = NOW()
    `, [todayStr, text])

    return text
  } catch (e) {
    console.error('Daily brief generation failed:', e)
    return ''
  }
}

// ──────────────────────────────────────────
// 2. 시장 인사이트 (랭킹 기반, 시장 랭킹 탭용)
// ──────────────────────────────────────────

function buildMarketPrompt(data: MarketCategoryData[]): string {
  const leaders = data
    .filter(c => c.category_name !== '전체')
    .map(c => `${c.category_name} 1위: ${c.entries[0]?.goods_name ?? '-'}`)

  const risers = data
    .flatMap(c => c.entries
      .filter(e => e.delta != null && e.delta >= 3)
      .map(e => ({ ...e, cat: c.category_name })))
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    .map(e => `[${e.cat}] ${e.rank_position}위 ${e.goods_name}(+${e.delta})`)

  const newEntries = data
    .flatMap(c => c.entries
      .filter(e => e.prev_rank == null && e.rank_position <= 20)
      .map(e => ({ ...e, cat: c.category_name })))
    .map(e => `[${e.cat}] ${e.rank_position}위 ${e.goods_name}(신규)`)

  const fallers = data
    .flatMap(c => c.entries
      .filter(e => e.delta != null && e.delta <= -5)
      .map(e => ({ ...e, cat: c.category_name })))
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))
    .slice(0, 5)
    .map(e => `[${e.cat}] ${e.rank_position}위 ${e.goods_name}(${e.delta})`)

  const ours = data.flatMap(c =>
    c.entries.filter(e => e.is_ours)
      .map(e => `${c.category_name} ${e.rank_position}위${e.delta != null ? `(${e.delta > 0 ? '+' : ''}${e.delta})` : ''}`))

  return `[올리브영 베스트100 랭킹 현황 - 셀퓨전씨 마케터용]

카테고리 1위:
${leaders.join('\n')}

급상승 상품 (전일 대비 3위↑):
${risers.length ? risers.join('\n') : '없음'}

신규 TOP20 진입:
${newEntries.length ? newEntries.join('\n') : '없음'}

급하락 상품:
${fallers.length ? fallers.join('\n') : '없음'}

셀퓨전씨 포지션:
${ours.length ? ours.join(', ') : 'TOP100 없음'}

위 데이터를 바탕으로 셀퓨전씨 마케터에게 필요한 시장 인사이트를 5~7개로 작성하라.
주목할 시장 트렌드, 셀퓨전씨 포지션 평가, 단기 대응 제안을 수치와 함께 포함하라.`
}

export async function generateMarketInsight(data: MarketCategoryData[]): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || data.length === 0) return ''

  const todayStr = new Date().toLocaleDateString('sv-SE')
  const slot = getSlot()

  try {
    const cached = await pool.query(
      'SELECT insight_text FROM market_insights WHERE insight_date = $1 AND slot = $2',
      [todayStr, slot]
    )
    if (cached.rows[0]?.insight_text) return cached.rows[0].insight_text
  } catch { /* 테이블 없으면 skip */ }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: NO_MARKDOWN_SYSTEM,
      messages: [{ role: 'user', content: buildMarketPrompt(data) }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    if (!text) return ''

    await pool.query(`
      INSERT INTO market_insights (insight_date, slot, insight_text)
      VALUES ($1, $2, $3)
      ON CONFLICT (insight_date, slot) DO UPDATE
      SET insight_text = EXCLUDED.insight_text, generated_at = NOW()
    `, [todayStr, slot, text])

    return text
  } catch (e) {
    console.error('Market insight generation failed:', e)
    return ''
  }
}

// ──────────────────────────────────────────
// 3. 리뷰 인사이트 (자사 상품 개선 분석, 리뷰 분석 탭용)
// ──────────────────────────────────────────

function buildReviewPrompt(insights: Insights, negativeData: ProductNegativeData[]): string {
  const posKw = insights.positive_keywords.slice(0, 15).map(k => `${k.word}(${k.cnt})`).join(', ')
  const negKw = insights.negative_keywords.slice(0, 10).map(k => `${k.word}(${k.cnt})`).join(', ')

  const productIssues = negativeData
    .sort((a, b) => b.neg_count - a.neg_count)
    .slice(0, 8)
    .map(p => {
      const kw = p.keywords.slice(0, 5).map(k => k.word).join(', ')
      const sample = p.samples[0]?.content?.slice(0, 80) ?? ''
      return `- ${p.goods_name}: 불만 ${p.neg_count}건 [키워드: ${kw}] "${sample}"`
    })

  return `[셀퓨전씨 올리브영 실구매 리뷰 분석 데이터]

전체 긍정 키워드 (리뷰 빈도순):
${posKw}

전체 부정 키워드:
${negKw}

상품별 불만 상세:
${productIssues.join('\n')}

위 실구매 리뷰 데이터를 바탕으로 셀퓨전씨 제품 담당자에게 필요한 인사이트를 5~7개로 작성하라.
고객이 반복적으로 언급하는 개선 요구사항, 불만이 집중된 상품과 원인, 강점 유지 전략, 신제품/리뉴얼 방향을 수치와 키워드를 인용하여 작성하라.`
}

export async function generateReviewInsight(
  insights: Insights,
  negativeData: ProductNegativeData[]
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || insights.total_reviews === 0) return ''

  const todayStr = new Date().toLocaleDateString('sv-SE')

  try {
    const cached = await pool.query(
      'SELECT insight_text FROM review_insights WHERE insight_date = $1',
      [todayStr]
    )
    if (cached.rows[0]?.insight_text) return cached.rows[0].insight_text
  } catch { /* 테이블 없으면 skip */ }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: NO_MARKDOWN_SYSTEM,
      messages: [{ role: 'user', content: buildReviewPrompt(insights, negativeData) }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    if (!text) return ''

    await pool.query(`
      INSERT INTO review_insights (insight_date, insight_text)
      VALUES ($1, $2)
      ON CONFLICT (insight_date) DO UPDATE
      SET insight_text = EXCLUDED.insight_text, generated_at = NOW()
    `, [todayStr, text])

    return text
  } catch (e) {
    console.error('Review insight generation failed:', e)
    return ''
  }
}
