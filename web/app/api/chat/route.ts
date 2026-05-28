import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import {
  getStats, getMarketRankings, getPromoStatus, getNegativeAlerts,
  getProductStats, getInsights, getNewProducts, getOurRankingTimeline,
} from '@/lib/db'

export const maxDuration = 60

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const SYSTEM = `당신은 셀퓨전씨 올리브영 인사이트 어시스턴트입니다.

[도구 사용 원칙]
· 데이터 관련 질문은 반드시 도구를 먼저 호출한 뒤 답변하세요. 절대 추측하지 마세요.
· 특정 상품명이 언급되면: 먼저 get_product_stats를 호출해 전체 목록에서 상품명으로 goods_no를 찾고, 그 다음 get_insights(goods_no=...)를 호출하세요.
· 여러 도구가 필요하면 순차 호출하세요.

[도구 선택 가이드]
· "전체 현황 / 요약 / 총 리뷰 / 평균 별점" → get_stats
· "시장 순위 / 카테고리 랭킹 / 몇 위" → get_market_rankings
· "오늘 시간별 순위 변화 / 타임라인" → get_today_ranking
· "프로모션 / 올영픽 / 오늘의 특가" → get_promo_status
· "부정 리뷰 급증 / 컴플레인 / 문제 상품" → get_negative_alerts
· "상품별 리뷰 수 / 평점 / 재구매율 비교" → get_product_stats
· "키워드 / 긍정·부정 반응 / 피부 타입 / 특정 상품 리뷰 분석" → get_insights (goods_no 지정 시 상품별, 미지정 시 전체)
· "신규 상품 / 최근 출시" → get_new_products

[올리브영 카테고리명]: 전체, 스킨케어, 마스크팩, 클렌징, 선케어, 더모 코스메틱, 바디케어, 맨즈에딧

[출력 규칙]
1. 마크다운 서식 완전 금지 — **, __, ##, >, \`, ~ 등 절대 사용하지 마세요.
2. 이모지 금지.
3. 항목은 "· " 또는 숫자로 시작하세요.
4. 답변은 5~8줄 이내로 핵심만.
5. 수치 나열보다 "왜 중요한지, 뭘 해야 하는지" 중심으로.
6. 한국어로 답변.`

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
