/**
 * OliveYoung Insight MCP Server — Vercel Next.js 배포
 *
 * Claude Desktop 연결:
 * claude_desktop_config.json → mcpServers → { "url": "https://oliveyoungreview.vercel.app/api/mcp" }
 *
 * 인증: MCP_API_KEY 환경변수 설정 시 Authorization: Bearer <key> 헤더 필요
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import {
  getStats, getMarketRankings, getPromoStatus, getNegativeAlerts,
  getProductStats, getInsights, getNewProducts, getOurRankingTimeline,
} from '@/lib/db'

export const maxDuration = 60

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: 'OliveYoung Insight',
    version: '1.0.0',
  })

  server.tool(
    'get_stats',
    '셀퓨전씨 올리브영 전체 현황: 총 리뷰 수, 평균 별점, 재구매율, 상품 수, 마지막 수집 시각',
    {},
    async () => {
      const data = await getStats()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_market_rankings',
    '올리브영 카테고리별 베스트 순위 (오늘 최신 기준 Top 20). 셀퓨전씨 상품은 is_ours=true.',
    { category: z.string().optional().describe('카테고리명 (예: 스킨케어, 선케어). 생략 시 전체.') },
    async () => {
      const data = await getMarketRankings()
      const trimmed = data.map(c => ({ ...c, entries: c.entries.slice(0, 20) }))
      return { content: [{ type: 'text' as const, text: JSON.stringify(trimmed, null, 2) }] }
    }
  )

  server.tool(
    'get_promo_status',
    '오늘 기준 올영픽 / 오늘의 특가 입점 현황. 셀퓨전씨 상품 포함 여부 및 순위.',
    {},
    async () => {
      const data = await getPromoStatus()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_negative_alerts',
    '최근 7일 부정 리뷰(별점 1~2) 급증 상품. 전주 대비 50%+ 증가한 상품과 주요 키워드.',
    {},
    async () => {
      const data = await getNegativeAlerts()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_product_stats',
    '상품별 리뷰 수, 평균 별점, 재구매율, 5점 리뷰 수',
    {},
    async () => {
      const data = await getProductStats()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_insights',
    '긍정/부정 키워드 Top 8, 피부 타입 분포. goods_no 생략 시 전체 브랜드 기준.',
    { goods_no: z.string().optional().describe('특정 상품 번호. 생략 시 전체 브랜드.') },
    async ({ goods_no }) => {
      const data = await getInsights(goods_no)
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_new_products',
    '최근 30일 내 처음 리뷰가 등록된 신규 상품. 리뷰 속도(일 평균)와 긍정/부정 비율.',
    {},
    async () => {
      const data = await getNewProducts()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_today_ranking',
    '오늘 시간별 셀퓨전씨 자사 상품 순위 타임라인. 카테고리별로 몇 시에 몇 위였는지.',
    {},
    async () => {
      const data = await getOurRankingTimeline()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  return server
}

function checkAuth(req: NextRequest): boolean {
  const apiKey = process.env.MCP_API_KEY || ''
  if (!apiKey) return true
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${apiKey}`
}

async function handle(req: NextRequest): Promise<Response> {
  if (!checkAuth(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const server = buildMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — 서버리스 환경 최적
  })

  await server.connect(transport)
  return transport.handleRequest(req)
}

export const GET = handle
export const POST = handle
export const DELETE = handle
