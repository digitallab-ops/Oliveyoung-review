import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import {
  getStats, getMarketRankings, getPromoStatus, getNegativeAlerts,
  getProductStats, getInsights, getNewProducts, getOurRankingTimeline,
  getCoupangStats, getCoupangProductStats, getCoupangRankings, getCoupangRecentReviews,
  getNaverTrends, getNaverSearchRanks, getNaverMarket, getNaverLatestInsight,
} from '@/lib/db'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

let _client: OpenAI | null = null
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _client
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
· 마지막엔 항상 "그래서 셀퓨전씨는 이렇게 해야 합니다"로 끝냅니다.

도구 사용 원칙:
· 데이터 관련 질문은 반드시 도구를 먼저 호출하세요. 기억에 의존해 답하지 마세요.
· 특정 상품명이 나오면: get_product_stats로 goods_no 확인 → get_insights(goods_no) 순서로 호출.
· 필요하면 여러 도구를 순차 호출하세요.

도구 선택 (올리브영):
· "전체 현황 / 총 리뷰 / 평균 별점" → get_stats
· "시장 순위 / 카테고리 랭킹 / 몇 위" → get_market_rankings  (카테고리: 전체·스킨케어·마스크팩·클렌징·선케어·더모 코스메틱·바디케어·맨즈에딧)
· "오늘 시간별 순위 변화 / 타임라인" → get_today_ranking
· "프로모션 / 올영픽 / 오늘의 특가" → get_promo_status
· "부정 리뷰 급증 / 컴플레인 / 문제 상품" → get_negative_alerts
· "상품별 리뷰 수 / 평점 / 재구매율" → get_product_stats
· "키워드 / 긍정·부정 반응 / 피부 타입" → get_insights
· "신규 상품 / 최근 출시" → get_new_products

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

const NAVER_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_naver_trends',
      description: '네이버 DataLab 검색 트렌드. 최근 8주 주간 검색지수(0~100). "트렌드", "검색량", "인기", "얼마나 많이 찾아" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_naver_search_ranks',
      description: '네이버 쇼핑 키워드 검색 결과 순위. 자사 상품 노출 위치(is_ours=true). "검색 노출", "몇 위", "상위 노출" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_naver_market',
      description: '네이버 쇼핑 카테고리별 경쟁사 상품 목록. 브랜드별 가격 분포. "경쟁사", "가격", "시장 현황", "어떤 브랜드" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_naver_insight',
      description: '가장 최근에 자동 생성된 AI 네이버 시장 분석 인사이트. "분석해줘", "인사이트", "요약" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_stats',
      description: '셀퓨전씨 브랜드 전체 현황. 총 리뷰 수, 평균 별점, 5점 비율, 재구매율, 상품 수, 마지막 수집 시각. "전체 요약", "현황 알려줘", "리뷰 총 몇 개야" 같은 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_rankings',
      description: '올리브영 카테고리별 베스트 순위 Top 20. 셀퓨전씨 상품은 is_ours=true로 표시됨. "순위", "랭킹", "몇 위", "시장 현황" 질문에 사용. 카테고리명: 전체, 스킨케어, 마스크팩, 클렌징, 선케어, 더모 코스메틱, 바디케어, 맨즈에딧.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: '카테고리명. 예: "선케어", "스킨케어". 전체 보려면 빈 문자열.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_promo_status',
      description: '오늘 기준 올영픽·오늘의 특가 입점 현황과 셀퓨전씨 상품 포함 여부/순위. "프로모션", "올영픽", "특가", "기획전" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_negative_alerts',
      description: '최근 7일간 부정 리뷰(별점 1~2점)가 전주 대비 50% 이상 급증한 상품 목록과 주요 키워드. "부정 리뷰", "컴플레인", "문제", "이슈", "안 좋은 반응" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_stats',
      description: '셀퓨전씨 전 상품의 리뷰 수, 평균 별점, 재구매율, 5점 리뷰 수. 상품 이름으로 goods_no를 찾을 때도 이 도구를 먼저 호출해 목록에서 해당 상품을 찾으세요.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_insights',
      description: '긍정/부정 키워드 Top 8과 피부 타입 분포. goods_no를 지정하면 해당 상품 기준, 미지정 시 전체 브랜드 기준. 특정 상품 분석 시 반드시 get_product_stats로 goods_no를 먼저 확인 후 호출.',
      parameters: {
        type: 'object',
        properties: {
          goods_no: { type: 'string', description: '특정 상품 번호 (get_product_stats에서 조회). 전체 브랜드 기준이면 빈 문자열.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_new_products',
      description: '최근 30일 내 처음 리뷰가 등록된 신규/신상 상품. 일평균 리뷰 속도와 긍정·부정 비율. "신상", "새로 나온", "신규 출시" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_today_ranking',
      description: '오늘 시간대별 셀퓨전씨 자사 상품의 순위 타임라인. 카테고리별로 몇 시에 몇 위였는지 확인. "오늘 순위 변화", "몇 시에 몇 위", "타임라인" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

const COUPANG_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_coupang_stats',
      description: '쿠팡 전체 현황. 수집 상품 수, 총 리뷰 수, 평균 평점, 마지막 수집 시각. "전체 요약", "현황", "총 리뷰" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_coupang_product_stats',
      description: '셀퓨전씨 쿠팡 전 상품의 리뷰 수, 평균 평점. 어떤 상품이 잘 팔리는지, 평점이 높은지 확인. "상품별", "어떤 상품", "리뷰 많은" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_coupang_rankings',
      description: '쿠팡 검색순위와 카테고리 베스트셀러 순위. "검색순위", "카테고리 순위", "몇 위" 질문에 사용.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_coupang_reviews',
      description: '쿠팡 실구매 리뷰 내용. 소비자 반응, 불만, 칭찬 키워드 파악. 특정 상품 지정 가능. "리뷰 어때", "소비자 반응", "불만" 질문에 사용.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: '특정 상품 ID (get_coupang_product_stats에서 확인). 전체 브랜드면 빈 문자열.' },
        },
        required: [],
      },
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
    default:
      return { error: `Unknown tool: ${name}` }
  }
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

    const activeSystem = platform === 'coupang' ? SYSTEM_COUPANG
                       : platform === 'naver'   ? SYSTEM_NAVER
                       : SYSTEM
    const activeTools  = [...TOOLS, ...COUPANG_TOOLS, ...NAVER_TOOLS]

    const trimmed = messages.slice(-10)

    const working: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: activeSystem },
      ...trimmed,
    ]

    const client = getClient()

    let response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1500,
      messages: working,
      tools: activeTools,
    })

    // Tool-use 루프 (최대 3 라운드)
    let rounds = 0

    while (response.choices[0].finish_reason === 'tool_calls' && rounds < 3) {
      rounds++

      const assistantMessage = response.choices[0].message
      working.push(assistantMessage)

      for (const call of assistantMessage.tool_calls!) {
        if (call.type !== 'function') continue
        const input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
        const result = await executeTool(call.function.name, input)
        working.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        })
      }

      response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1500,
        messages: working,
        tools: activeTools,
      })
    }

    const reply = response.choices[0].message.content ?? ''

    return NextResponse.json({ reply })
  } catch (e) {
    console.error('Chat API error:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
