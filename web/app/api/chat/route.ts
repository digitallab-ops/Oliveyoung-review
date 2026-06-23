import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import {
  getStats, getMarketRankings, getPromoStatus, getNegativeAlerts,
  getProductStats, getInsights, getNewProducts, getOurRankingTimeline,
  getCoupangStats, getCoupangProductStats, getCoupangRankings, getCoupangRecentReviews,
  getNaverTrends, getNaverSearchRanks, getNaverMarket, getNaverLatestInsight,
  getReviewsByDate, getReviewContent, getWeeklyDelta, getProductSummaryFull,
} from '@/lib/db'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MODEL = 'gpt-5.4-mini'

let _client: OpenAI | null = null
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _client
}

// ── In-memory TTL cache ──
const _cache = new Map<string, { data: unknown; exp: number }>()
function fromCache<T>(key: string): T | null {
  const hit = _cache.get(key)
  if (!hit || Date.now() > hit.exp) return null
  return hit.data as T
}
function toCache(key: string, data: unknown, ttlMs: number) {
  _cache.set(key, { data, exp: Date.now() + ttlMs })
}
const TOOL_TTL: Record<string, number> = {
  get_stats:                 5 * 60_000,
  get_market_rankings:       5 * 60_000,
  get_promo_status:         10 * 60_000,
  get_negative_alerts:       5 * 60_000,
  get_product_stats:         5 * 60_000,
  get_insights:              5 * 60_000,
  get_new_products:          5 * 60_000,
  get_today_ranking:         2 * 60_000,
  get_coupang_stats:         5 * 60_000,
  get_coupang_product_stats: 5 * 60_000,
  get_coupang_rankings:      5 * 60_000,
  get_coupang_reviews:       5 * 60_000,
  get_naver_trends:         10 * 60_000,
  get_naver_search_ranks:    5 * 60_000,
  get_naver_market:          5 * 60_000,
  get_naver_insight:        10 * 60_000,
  get_reviews_by_date:       2 * 60_000,
  get_review_content:        2 * 60_000,
  get_weekly_delta:          5 * 60_000,
  get_product_summary:       5 * 60_000,
}

const SYSTEM_BASE = `당신은 셀퓨전씨 전속 멀티플랫폼 인사이트 파트너입니다. 올리브영·쿠팡·네이버 세 플랫폼의 실시간 데이터를 모두 활용해 브랜드 전략을 조언합니다.

연결된 데이터:
· 올리브영: 카테고리 베스트 순위, 올영픽·특가 프로모션, 리뷰 키워드·별점·재구매율, 신상품 동향
· 쿠팡: 리뷰 평점·내용, 검색순위, 카테고리 베스트셀러, 상품별 소비자 반응
· 네이버: DataLab 검색 트렌드, 쇼핑 검색 노출 순위, 경쟁사 가격 현황, AI 시장 분석

당신의 스타일:
· 데이터를 단순히 읽지 않습니다. "이 숫자가 왜 나왔는지", "플랫폼 간 온도 차가 무엇인지", "셀퓨전씨가 뭘 해야 하는지"를 말합니다.
· 크로스 플랫폼 질문(예: "쿠팡이랑 올리브영 비교해줘")엔 두 플랫폼 툴을 모두 호출해 비교 분석합니다.
· 좋은 것만 말하지 않습니다. 위험 신호는 직접 경고합니다.

도구 사용 원칙:
· "어떤 플랫폼이야?", "뭐 할 수 있어?", "연결된 거 알려줘" 같은 시스템 구조 질문은 도구를 호출하지 말고 이 프롬프트 정보만으로 답하세요.
· 실제 수치·순위·리뷰가 필요한 질문에만 도구를 호출하세요.
· 특정 상품명이 나오면: get_product_stats로 goods_no 확인 → get_insights(goods_no) 순서로 호출.
· 한 번에 필요한 도구만 호출하세요. 과도한 다중 호출은 금지.

도구 선택 (올리브영):
· "전체 현황 / 총 리뷰 / 평균 별점" → get_stats
· "시장 순위 / 카테고리 랭킹 / 몇 위" → get_market_rankings  (카테고리: 전체·스킨케어·마스크팩·클렌징·선케어·더모 코스메틱·바디케어·맨즈에딧)
· "오늘 시간별 순위 변화 / 타임라인" → get_today_ranking
· "프로모션 / 올영픽 / 오늘의 특가" → get_promo_status
· "부정 리뷰 급증 / 컴플레인 / 문제 상품" → get_negative_alerts
· "상품별 리뷰 수 / 평점 / 재구매율 / goods_no / 첫 수집일" → get_product_stats (goods_no·first_seen 포함)
· "키워드 / 긍정·부정 반응 / 피부 타입" → get_insights
· "신규 상품 / 최근 출시" → get_new_products
· "특정 날짜 리뷰 / 날짜별 반응" → get_reviews_by_date
· "리뷰 텍스트 읽기 / 실제 리뷰 내용 분석" → get_review_content
· "이번 주 vs 지난 주 / 주간 변화" → get_weekly_delta
· "상품 종합 분석 / 상품 전체 요약" → get_product_summary

도구 선택 (쿠팡):
· "쿠팡 전체 현황 / 평점" → get_coupang_stats
· "쿠팡 상품별 리뷰 / 평점 비교" → get_coupang_product_stats
· "쿠팡 검색순위 / 카테고리 순위" → get_coupang_rankings
· "쿠팡 리뷰 내용 / 소비자 반응" → get_coupang_reviews

도구 선택 (네이버):
· "검색 트렌드 / 검색량" → get_naver_trends
· "네이버 검색 노출 / 순위" → get_naver_search_ranks
· "경쟁사 가격 / 시장 현황" → get_naver_market
· "네이버 AI 인사이트 / 분석 요약" → get_naver_insight

출력 형식 (반드시 준수):
· **, __, ##, >, 백틱, ~ 같은 마크다운 기호 절대 사용 금지.
· 이모지 사용 금지.
· 항목은 "· " 또는 숫자로 시작.
· 6~10줄 이내. 수치는 맥락과 함께.
· 한국어로 답변.`

const SYSTEM         = SYSTEM_BASE + '\n\n현재 보고 있는 탭: 올리브영'
const SYSTEM_COUPANG = SYSTEM_BASE + '\n\n현재 보고 있는 탭: 쿠팡'
const SYSTEM_NAVER   = SYSTEM_BASE + '\n\n현재 보고 있는 탭: 네이버'

const TOOLS: OpenAI.ChatCompletionTool[] = [
  // ── 올리브영 ──
  {
    type: 'function',
    function: {
      name: 'get_stats',
      description: '셀퓨전씨 올리브영 전체 현황. 총 리뷰 수, 평균 별점, 5점 비율, 재구매율, 상품 수.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_rankings',
      description: '올리브영 카테고리별 베스트 순위 Top 20. 셀퓨전씨 상품은 is_ours=true. 카테고리: 전체·스킨케어·마스크팩·클렌징·선케어·더모 코스메틱·바디케어·맨즈에딧.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: '카테고리명. 전체 보려면 빈 문자열.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_promo_status',
      description: '오늘 기준 올영픽·오늘의 특가 입점 현황과 셀퓨전씨 포함 여부/순위.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_negative_alerts',
      description: '최근 7일 부정 리뷰(별점 1~2점) 전주 대비 50%+ 급증 상품과 주요 키워드.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_stats',
      description: '셀퓨전씨 전 상품의 goods_no·first_seen·리뷰 수·평균 별점·재구매율. 상품명으로 goods_no 또는 first_seen 찾을 때 먼저 호출.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_insights',
      description: '긍정/부정 키워드 Top 8과 피부 타입 분포. goods_no 지정 시 해당 상품 기준, 미지정 시 전체 브랜드.',
      parameters: {
        type: 'object',
        properties: {
          goods_no: { type: 'string', description: '상품 번호. 전체 브랜드면 빈 문자열.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_new_products',
      description: '최근 30일 내 첫 리뷰 등록된 신규 상품. 일평균 리뷰 속도와 긍정·부정 비율.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_today_ranking',
      description: '오늘 시간대별 셀퓨전씨 자사 상품 순위 타임라인.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // ── 고도화 툴 ──
  {
    type: 'function',
    function: {
      name: 'get_reviews_by_date',
      description: '특정 날짜에 등록된 리뷰 목록. 날짜별 소비자 반응 확인.',
      parameters: {
        type: 'object',
        properties: {
          date:     { type: 'string', description: '날짜 (YYYY-MM-DD)' },
          goods_no: { type: 'string', description: '특정 상품 번호. 생략 시 전체.' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_review_content',
      description: '실제 리뷰 텍스트 조회. 리뷰 내용을 직접 읽고 분석할 때 사용.',
      parameters: {
        type: 'object',
        properties: {
          goods_no: { type: 'string', description: '상품 번호. 생략 시 전체.' },
          date:     { type: 'string', description: '특정 날짜 필터 (YYYY-MM-DD).' },
          filter:   { type: 'string', enum: ['all', 'positive', 'negative'], description: 'all/positive/negative' },
          limit:    { type: 'number', description: '최대 건수 (기본 50)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weekly_delta',
      description: '이번 주 vs 지난 주 비교. 리뷰 수·평균 별점·긍부정 비율 변화량.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_summary',
      description: '상품 하나의 종합 분석: 기본 통계 + 긍/부정 키워드 + 최근 리뷰 5건 + 순위 이력.',
      parameters: {
        type: 'object',
        properties: {
          goods_no: { type: 'string', description: '상품 번호' },
        },
        required: ['goods_no'],
      },
    },
  },
  // ── 쿠팡 ──
  {
    type: 'function',
    function: {
      name: 'get_coupang_stats',
      description: '[쿠팡] 수집 상품 수, 총 리뷰 수, 평균 평점, 마지막 수집 시각.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_coupang_product_stats',
      description: '[쿠팡] 셀퓨전씨 상품별 리뷰 수, 평균 평점.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_coupang_rankings',
      description: '[쿠팡] 검색순위와 카테고리 베스트셀러 순위. 자사 노출 현황 포함.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_coupang_reviews',
      description: '[쿠팡] 실구매 리뷰 내용. 소비자 반응, 불만, 칭찬 파악. 특정 상품 지정 가능.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: '특정 상품 ID. 전체 브랜드면 빈 문자열.' },
        },
        required: [],
      },
    },
  },
  // ── 네이버 ──
  {
    type: 'function',
    function: {
      name: 'get_naver_trends',
      description: '[네이버] DataLab 검색 트렌드. 최근 8주 주간 검색지수(0~100).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_naver_search_ranks',
      description: '[네이버] 쇼핑 키워드 검색 순위. 자사 상품 노출 위치(is_ours=true).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_naver_market',
      description: '[네이버] 카테고리별 경쟁사 상품 목록. 브랜드별 가격 분포.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_naver_insight',
      description: '[네이버] 가장 최근 자동 생성된 AI 네이버 시장 분석 인사이트.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_coupang_stats':
      return await getCoupangStats()
    case 'get_coupang_product_stats':
      return await getCoupangProductStats()
    case 'get_coupang_rankings':
      return await getCoupangRankings()
    case 'get_coupang_reviews':
      return await getCoupangRecentReviews((input.product_id as string) || undefined)
    case 'get_stats':
      return await getStats()
    case 'get_market_rankings': {
      const data = await getMarketRankings()
      return data.map(cat => ({ ...cat, entries: cat.entries.slice(0, 20) }))
    }
    case 'get_promo_status':
      return await getPromoStatus()
    case 'get_negative_alerts':
      return await getNegativeAlerts()
    case 'get_product_stats':
      return await getProductStats()
    case 'get_insights':
      return await getInsights((input.goods_no as string) || undefined)
    case 'get_new_products':
      return await getNewProducts()
    case 'get_today_ranking':
      return await getOurRankingTimeline()
    case 'get_naver_trends':
      return await getNaverTrends()
    case 'get_naver_search_ranks':
      return await getNaverSearchRanks()
    case 'get_naver_market':
      return await getNaverMarket()
    case 'get_naver_insight':
      return await getNaverLatestInsight()
    case 'get_reviews_by_date':
      return await getReviewsByDate(input.date as string, (input.goods_no as string) || '')
    case 'get_review_content':
      return await getReviewContent({
        goodsNo: (input.goods_no as string) || '',
        date:    (input.date as string) || '',
        filter:  (input.filter as 'all' | 'positive' | 'negative') || 'all',
        limit:   Math.min((input.limit as number) || 50, 200),
      })
    case 'get_weekly_delta':
      return await getWeeklyDelta()
    case 'get_product_summary':
      return await getProductSummaryFull(input.goods_no as string)
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

async function executeToolCached(name: string, input: Record<string, unknown>): Promise<unknown> {
  const key = `${name}:${JSON.stringify(input)}`
  const cached = fromCache(key)
  if (cached !== null) return cached
  const result = await executeTool(name, input)
  const ttl = TOOL_TTL[name]
  if (ttl) toCache(key, result, ttl)
  return result
}

export async function POST(req: Request) {
  try {
    const { messages, platform } = await req.json() as {
      messages: { role: 'user' | 'assistant'; content: string }[]
      platform?: string
    }

    if (!messages?.length) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 })
    }

    const activeSystemText = platform === 'coupang' ? SYSTEM_COUPANG
                           : platform === 'naver'   ? SYSTEM_NAVER
                           : SYSTEM

    const client = getClient()

    const msgs: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: activeSystemText },
      ...messages.slice(-10).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ]

    const encoder = new TextEncoder()

    const readable = new ReadableStream({
      async start(controller) {
        try {
          let rounds = 0

          while (rounds <= 3) {
            const stream = await client.chat.completions.create({
              model: MODEL,
              max_completion_tokens: 1500,
              messages: msgs,
              tools: TOOLS,
              stream: true,
            })

            let finishReason: string | null = null
            const toolCallAccum: Record<number, { id: string; name: string; arguments: string }> = {}

            for await (const chunk of stream) {
              const choice = chunk.choices[0]
              if (!choice) continue
              if (choice.finish_reason) finishReason = choice.finish_reason

              const delta = choice.delta
              if (delta.content) {
                controller.enqueue(encoder.encode(delta.content))
              }
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index
                  if (!toolCallAccum[idx]) toolCallAccum[idx] = { id: '', name: '', arguments: '' }
                  if (tc.id) toolCallAccum[idx].id = tc.id
                  if (tc.function?.name) toolCallAccum[idx].name += tc.function.name
                  if (tc.function?.arguments) toolCallAccum[idx].arguments += tc.function.arguments
                }
              }
            }

            if (finishReason !== 'tool_calls' || rounds >= 3) break

            rounds++

            const toolCalls = Object.values(toolCallAccum)

            msgs.push({
              role: 'assistant',
              content: null,
              tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            })

            const toolResults = await Promise.all(
              toolCalls.map(async tc => {
                const input = JSON.parse(tc.arguments || '{}')
                const result = await executeToolCached(tc.name, input)
                return { tool_call_id: tc.id, content: JSON.stringify(result) }
              })
            )

            for (const r of toolResults) {
              msgs.push({ role: 'tool', tool_call_id: r.tool_call_id, content: r.content })
            }
          }
        } catch (e) {
          console.error('Stream error:', e)
          controller.enqueue(encoder.encode('\n[오류가 발생했습니다]'))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (e) {
    console.error('Chat API error:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
