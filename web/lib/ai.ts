import Anthropic from '@anthropic-ai/sdk'
import type { MarketCategoryData, Insights, ProductNegativeData } from './types'
import { pool } from './db'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const NO_MARKDOWN_SYSTEM = '당신은 올리브영 뷰티 시장 전문 분석가입니다. 출력 규칙: 1) 모든 줄은 반드시 "- "로 시작하세요. 2) 마크다운 서식 금지(#, ##, **, __, >, `, ~, 이모지 등). 3) 데이터 재나열 금지 — 해석과 판단만 써라. 4) 각 bullet은 마케터가 즉시 행동할 수 있는 하나의 전략적 결론을 담아야 한다. 5) bullet 사이 빈 줄 없이 연속 작성.'

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

오늘 이 대시보드를 처음 여는 마케터가 10초 안에 파악해야 할 것 4~5가지를 써라.
- 단순 현황 나열 금지. '무엇이 변했고, 왜 중요하고, 오늘 무엇을 할지'가 한 문장에 담겨야 한다.
- 긴급도 순으로 정렬하라. 지금 당장 행동이 필요한 것이 먼저.
- 수치는 변화 맥락(대비, 증감)이 있을 때만 인용하라.
- 제목줄 작성 금지, 바로 - 로 시작`
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
      max_tokens: 1000,
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

셀퓨전씨 마케터를 위한 시장 분석 인사이트 4~5개를 써라.
- 수치를 재나열하지 마라. 수치는 근거일 뿐, 핵심은 '왜'와 '그래서 어떻게'다.
- 경쟁사 움직임의 의미, 시장 패턴의 기회/위협, 셀퓨전씨가 취해야 할 전략적 판단을 담아라.
- 누구나 데이터만 봐도 알 수 있는 내용(예: 'A가 상승했으니 주목하라')은 쓰지 마라.
- 왜 이 시점인지, 계절/트렌드/마케팅 신호가 무엇인지, 위협인지 기회인지를 해석하라.
- 제목줄 작성 금지, 바로 - 로 시작`
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
      max_tokens: 1000,
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

셀퓨전씨 제품팀이 다음 분기 액션을 결정하기 위해 이 리뷰 데이터를 본다. 인사이트 5~6개를 써라.
- 반복 불만 패턴에서 실제 제품/포장/마케팅의 구체적 문제를 특정하라.
- 긍정 키워드에서 '아직 마케팅에 활용하지 못한 강점'을 찾아라.
- 숫자를 그대로 인용하지 말고, 그 숫자가 의미하는 소비자 심리와 행동 패턴을 해석하라.
- 각 2문장 이내, 제목줄 작성 금지, 바로 - 로 시작`
}

// ──────────────────────────────────────────
// 4. 제품별 주제 분석 (구매동기 / 사용시점 / 같이언급제품)
// ──────────────────────────────────────────

export async function generateProductTopicInsights(
  goodsNo: string,
  goodsName: string,
  reviews: string[]
): Promise<{ purchase_motivation: string[]; usage_timing: string[]; co_mentioned: string[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY || reviews.length === 0) return null

  const sample = reviews.slice(0, 80).join('\n---\n')

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: '당신은 리뷰 분석 AI입니다. JSON만 출력하고 마크다운이나 설명 텍스트는 절대 포함하지 마세요.',
      messages: [{
        role: 'user',
        content: `다음은 "${goodsName}" 제품의 실구매 리뷰입니다.\n\n${sample}\n\n위 리뷰에서 다음 3가지를 각 최대 5개 한국어 키워드로 추출하세요:\n- purchase_motivation: 소비자가 이 제품을 구매한 이유/동기\n- usage_timing: 제품을 사용하는 시점/상황\n- co_mentioned: 함께 언급된 다른 제품명/브랜드명\n\n반드시 다음 JSON 형식으로만 출력:\n{"purchase_motivation":["..."],"usage_timing":["..."],"co_mentioned":["..."]}`,
      }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    if (!text) return null
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0])
  } catch (e) {
    console.error(`Topic insights failed for ${goodsNo}:`, e)
    return null
  }
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
      max_tokens: 1500,
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
