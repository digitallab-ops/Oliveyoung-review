import OpenAI from 'openai'
import type { MarketCategoryData, Insights, ProductNegativeData } from './types'
import { pool } from './db'

let _client: OpenAI | null = null
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _client
}

const MODEL = 'gpt-5.4-mini'

const NO_MARKDOWN_SYSTEM = '당신은 올리브영 뷰티 시장 전문 분석가입니다. 출력 규칙: 1) 모든 줄은 반드시 "- "로 시작하세요. 2) 마크다운 서식 금지(#, ##, **, __, >, `, ~, 이모지 등). 3) 데이터 재나열 금지 — 해석과 판단만 써라. 4) 각 bullet은 마케터가 즉시 행동할 수 있는 하나의 전략적 결론을 담아야 한다. 5) bullet 사이 빈 줄 없이 연속 작성.'

function getKSTDateStr(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function getSlot(): 'am' | 'pm' {
  const kstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours()
  return kstHour < 13 ? 'am' : 'pm'
}

async function chat(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
  })
  return res.choices[0].message.content?.trim() ?? ''
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
  if (!process.env.OPENAI_API_KEY) return ''

  const todayStr = getKSTDateStr()

  try {
    const cached = await pool.query(
      'SELECT brief_text FROM daily_briefs WHERE brief_date = $1',
      [todayStr]
    )
    if (cached.rows[0]?.brief_text) return cached.rows[0].brief_text
  } catch { /* 테이블 없으면 skip */ }

  try {
    const text = await chat(NO_MARKDOWN_SYSTEM, buildDailyBriefPrompt(marketData, insights, negativeData), 1000)
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

카테고리 1위 (시장 지배자):
${leaders.join('\n')}

급상승 상품 (전일 대비 3위↑):
${risers.length ? risers.join('\n') : '없음 — 시장 변화가 잠잠한 상태'}

신규 TOP20 진입:
${newEntries.length ? newEntries.join('\n') : '없음'}

급하락 상품:
${fallers.length ? fallers.join('\n') : '없음'}

셀퓨전씨 현재 포지션:
${ours.length ? ours.join(', ') : 'TOP100 없음'}

---
셀퓨전씨 마케터를 위한 전략 인사이트 4~5개를 써라.

[핵심 원칙]
- 변화가 없는 날도 인사이트는 있다: "왜 이 브랜드가 1위를 유지하는지", "셀퓨전씨가 이 카테고리에서 왜 상위/하위에 있는지", "지금이 공략 타이밍인지 아닌지"를 해석하라.
- 순위 숫자를 그대로 읽지 마라. 그 숫자가 의미하는 소비자 선택, 마케팅 효과, 시장 구조를 해석하라.
- 셀퓨전씨 포지션이 좋으면 → 어떻게 더 올릴지. 나쁘면 → 왜 밀리고 있고 어떤 카테고리로 집중해야 하는지.
- 경쟁사 1위 브랜드의 전략(번들, 콜라보, 올영픽 등)에서 셀퓨전씨가 배울 것 or 대응할 것을 짚어라.
- 계절/시점 맥락을 반드시 반영하라 (지금은 초여름 — 선케어 피크, 쿨링 수요 상승 등).
- 제목줄 작성 금지, 바로 - 로 시작`
}

export async function generateMarketInsight(data: MarketCategoryData[]): Promise<string> {
  if (!process.env.OPENAI_API_KEY || data.length === 0) return ''

  const todayStr = getKSTDateStr()
  const slot = getSlot()

  try {
    const cached = await pool.query(
      'SELECT insight_text FROM market_insights WHERE insight_date = $1 AND slot = $2',
      [todayStr, slot]
    )
    if (cached.rows[0]?.insight_text) return cached.rows[0].insight_text
  } catch { /* 테이블 없으면 skip */ }

  try {
    const text = await chat(NO_MARKDOWN_SYSTEM, buildMarketPrompt(data), 1000)
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

export async function generateReviewInsight(
  insights: Insights,
  negativeData: ProductNegativeData[]
): Promise<string> {
  if (!process.env.OPENAI_API_KEY || insights.total_reviews === 0) return ''

  const todayStr = getKSTDateStr()

  try {
    const cached = await pool.query(
      'SELECT insight_text FROM review_insights WHERE insight_date = $1',
      [todayStr]
    )
    if (cached.rows[0]?.insight_text) return cached.rows[0].insight_text
  } catch { /* 테이블 없으면 skip */ }

  try {
    const text = await chat(NO_MARKDOWN_SYSTEM, buildReviewPrompt(insights, negativeData), 1500)
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

// ──────────────────────────────────────────
// 4. 제품별 주제 분석 (구매동기 / 사용시점 / 같이언급제품)
// ──────────────────────────────────────────

export async function generateProductTopicInsights(
  goodsNo: string,
  goodsName: string,
  reviews: string[]
): Promise<{ purchase_motivation: string[]; usage_timing: string[]; co_mentioned: string[] } | null> {
  if (!process.env.OPENAI_API_KEY || reviews.length === 0) return null

  const sample = reviews.slice(0, 80).join('\n---\n')

  try {
    const res = await getClient().chat.completions.create({
      model: MODEL,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '당신은 리뷰 분석 AI입니다. JSON만 출력하세요.' },
        { role: 'user', content: `다음은 "${goodsName}" 제품의 실구매 리뷰입니다.\n\n${sample}\n\n위 리뷰에서 다음 3가지를 각 최대 5개 한국어 키워드로 추출하세요:\n- purchase_motivation: 소비자가 이 제품을 구매한 이유/동기\n- usage_timing: 제품을 사용하는 시점/상황\n- co_mentioned: 함께 언급된 다른 제품명/브랜드명\n\n반드시 다음 JSON 형식으로만 출력:\n{"purchase_motivation":["..."],"usage_timing":["..."],"co_mentioned":["..."]}` },
      ],
    })
    const text = res.choices[0].message.content?.trim() ?? ''
    if (!text) return null
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0])
  } catch (e) {
    console.error(`Topic insights failed for ${goodsNo}:`, e)
    return null
  }
}

// ──────────────────────────────────────────
// 5. 올영픽 월별 컨셉 분석
// ──────────────────────────────────────────

export async function generateOlivepickInsight(
  month: string,
  products: { name: string; category?: string | null }[]
): Promise<{ concept_tags: string[]; summary: string; action_points: string[] } | null> {
  if (!process.env.OPENAI_API_KEY || products.length === 0) return null

  const nameList = products
    .slice(0, 100)
    .map(p => p.category ? `${p.name} (${p.category})` : p.name)
    .join('\n')

  try {
    const res = await getClient().chat.completions.create({
      model: MODEL,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '당신은 올리브영 입점 브랜드의 전략 담당자입니다. JSON만 출력하세요.' },
        { role: 'user', content: `다음은 ${month} 올영픽 큐레이션 상품 목록입니다 (상품명 (카테고리) 형식):\n\n${nameList}\n\n위 상품 목록을 분석하여 다음 세 가지를 제공하세요:\n\n1. concept_tags: 이달 올영픽의 핵심 기획 컨셉 태그 최대 7개 (짧고 명확하게, 예: "포켓몬 콜라보", "1+1 기획", "선케어 강화", "굿즈 증정", "건강식품 확대")\n\n2. summary: 이달 올영픽의 기획 방향을 2~3문장으로 요약. 어떤 카테고리/테마가 중심이고, 어떤 프로모션 방식(1+1·콜라보·굿즈 등)이 사용됐는지 서술.\n\n3. action_points: 우리 브랜드(셀퓨전씨)가 이 기획에서 얻어야 할 대응 인사이트 3~5개. 각 항목은 "무엇을 해야 한다"는 실행 가능한 형태로 작성.\n\n반드시 다음 JSON 형식으로만 출력:\n{"concept_tags":["..."],"summary":"...","action_points":["...","..."]}` },
      ],
    })
    const text = res.choices[0].message.content?.trim() ?? ''
    if (!text) return null
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    return {
      concept_tags: parsed.concept_tags ?? [],
      summary: parsed.summary ?? '',
      action_points: parsed.action_points ?? [],
    }
  } catch (e) {
    console.error(`Olivepick insight failed for ${month}:`, e)
    return null
  }
}
