import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import {
  getStats, getMarketRankings, getPromoStatus, getNegativeAlerts,
  getProductStats, getInsights, getNewProducts, getOurRankingTimeline,
} from '@/lib/db'

export const maxDuration = 60

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `당신은 셀퓨전씨 올리브영 인사이트 어시스턴트입니다.

출력 규칙 (반드시 준수):
1. 마크다운 서식 완전 금지 — **, __, ##, >, \`, ~ 등 절대 사용하지 마세요.
2. 이모지 금지.
3. 항목은 "· " 또는 숫자로 시작하세요.
4. 답변은 5~8줄 이내로 핵심만.
5. 수치 나열보다 "왜 중요한지, 뭘 해야 하는지" 중심으로.
6. 데이터가 필요하면 반드시 도구를 먼저 호출하고 답변하세요.
7. 한국어로 답변.`

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_stats',
    description: '셀퓨전씨 올리브영 전체 현황: 총 리뷰 수, 평균 별점, 재구매율, 상품 수, 마지막 수집 시각',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_market_rankings',
    description: '올리브영 카테고리별 베스트 순위 (오늘 최신 기준 Top 20). 셀퓨전씨 상품은 is_ours=true. category 미입력 시 전체.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: '카테고리명 (예: 스킨케어, 선케어). 전체 보려면 빈 문자열.' },
      },
      required: [],
    },
  },
  {
    name: 'get_promo_status',
    description: '오늘 기준 올영픽 / 오늘의 특가 입점 현황. 셀퓨전씨 상품 포함 여부 및 순위.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_negative_alerts',
    description: '최근 7일 부정 리뷰(별점 1~2) 급증 상품. 전주 대비 50%+ 증가한 상품 목록.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_product_stats',
    description: '상품별 리뷰 수, 평균 별점, 재구매율, 5점 리뷰 수',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_insights',
    description: '긍정/부정 키워드 Top 8, 피부 타입 분포. goods_no 미입력 시 전체 브랜드 기준.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goods_no: { type: 'string', description: '특정 상품 번호. 전체 브랜드 기준이면 빈 문자열.' },
      },
      required: [],
    },
  },
  {
    name: 'get_new_products',
    description: '최근 30일 내 처음 리뷰가 등록된 신규 상품. 리뷰 속도(일 평균)와 긍정/부정 비율.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_today_ranking',
    description: '오늘 시간별 셀퓨전씨 자사 상품 순위 타임라인. 카테고리별로 몇 시에 몇 위였는지.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
]

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_stats':
      return await getStats()
    case 'get_market_rankings': {
      const data = await getMarketRankings()
      // Top 20으로 trim (토큰 절약)
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

    // 대화 이력 최대 10턴 유지
    const trimmed = messages.slice(-10)

    let response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: SYSTEM,
      messages: trimmed,
      tools: TOOLS,
    })

    // Tool-use 루프 (최대 3 라운드)
    const working: Anthropic.MessageParam[] = [...trimmed]
    let rounds = 0

    while (response.stop_reason === 'tool_use' && rounds < 3) {
      rounds++

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const result = await executeTool(block.name, block.input as Record<string, unknown>)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
      }

      working.push({ role: 'assistant', content: response.content })
      working.push({ role: 'user', content: toolResults })

      response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: SYSTEM,
        messages: working,
        tools: TOOLS,
      })
    }

    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    return NextResponse.json({ reply })
  } catch (e) {
    console.error('Chat API error:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
