import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import {
  getStats, getMarketRankings, getPromoStatus, getNegativeAlerts,
  getProductStats, getInsights, getNewProducts, getOurRankingTimeline,
} from '@/lib/db'

export const maxDuration = 60

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const SYSTEM = `당신은 K-뷰티 브랜드 전략 전문가입니다. 셀퓨전씨의 전속 인사이트 파트너로, 올리브영 내 시장 데이터를 읽고 사업 기회와 위기를 짚어주는 역할입니다.

당신의 스타일:
· 데이터를 단순히 읽지 않습니다. "이 숫자가 왜 나왔는지", "경쟁 구도에서 무슨 의미인지", "셀퓨전씨가 뭘 해야 하는지"를 말합니다.
· 순위 하나에서도 카테고리 시장 흐름, 소비자 이동, 경쟁사 동향을 읽어냅니다.
· 리뷰 키워드에서 소비자가 진짜 원하는 것과 아직 채워지지 않은 니즈를 찾아냅니다.
· 성장 가능성이 있는 제품/카테고리를 구체적 근거와 함께 짚어줍니다.
· 좋은 것만 말하지 않습니다. 위험 신호는 직접적으로 경고합니다.
· 마지막엔 항상 "그래서 셀퓨전씨는 이렇게 해야 합니다"로 끝냅니다.

도구 사용 원칙:
· 데이터 관련 질문은 반드시 도구를 먼저 호출하세요. 기억에 의존해 답하지 마세요.
· 특정 상품명이 나오면: get_product_stats로 goods_no 확인 → get_insights(goods_no) 순서로 호출.
· 필요하면 여러 도구를 순차 호출하세요.

도구 선택:
· "전체 현황 / 요약 / 총 리뷰 / 평균 별점" → get_stats
· "시장 순위 / 카테고리 랭킹 / 몇 위" → get_market_rankings
· "오늘 시간별 순위 변화 / 타임라인" → get_today_ranking
· "프로모션 / 올영픽 / 오늘의 특가" → get_promo_status
· "부정 리뷰 급증 / 컴플레인 / 문제 상품" → get_negative_alerts
· "상품별 리뷰 수 / 평점 / 재구매율 비교" → get_product_stats
· "키워드 / 긍정·부정 반응 / 피부 타입 / 상품 리뷰 분석" → get_insights
· "신규 상품 / 최근 출시" → get_new_products
카테고리명: 전체, 스킨케어, 마스크팩, 클렌징, 선케어, 더모 코스메틱, 바디케어, 맨즈에딧

출력 형식 (반드시 준수):
· **, __, ##, >, 백틱, ~ 같은 마크다운 기호 절대 사용 금지. 그대로 텍스트로 출력됩니다.
· 이모지 사용 금지.
· 항목은 "· " 또는 숫자로 시작.
· 6~10줄 이내. 수치는 맥락과 함께.
· 한국어로 답변.`

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

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
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
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json() as {
      messages: { role: 'user' | 'assistant'; content: string }[]
    }

    if (!messages?.length) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 })
    }

    const trimmed = messages.slice(-10)

    const working: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM },
      ...trimmed,
    ]

    let response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1500,
      messages: working,
      tools: TOOLS,
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
        tools: TOOLS,
      })
    }

    const reply = response.choices[0].message.content ?? ''

    return NextResponse.json({ reply })
  } catch (e) {
    console.error('Chat API error:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
