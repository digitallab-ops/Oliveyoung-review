/**
 * CellFusionC Multi-Platform MCP Server — Vercel Next.js 배포
 * 플랫폼: 올리브영 · 쿠팡 · 네이버 쇼핑
 *
 * Claude Desktop 연결:
 * claude_desktop_config.json → mcpServers → { "url": "https://oliveyoungreview.vercel.app/api/mcp" }
 *
 * 인증: MCP_API_KEY 환경변수 설정 시 Authorization: Bearer <key> 헤더 필요
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import {
  getStats, getMarketRankings, getPromoStatus, getNegativeAlerts,
  getProductStats, getInsights, getNewProducts, getOurRankingTimeline,
  getCoupangStats, getCoupangProductStats, getCoupangRankings, getCoupangRecentReviews,
  getNaverTrends, getNaverSearchRanks, getNaverMarket, getNaverLatestInsight,
  getReviewsByDate, getReviewContent, getWeeklyDelta, getProductSummaryFull,
  getRankingChanges, getTopMovers, getCompetitiveSummary, getDailyBrief,
} from '@/lib/db'

export const maxDuration = 60

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: 'CellFusionC Insight — 올리브영·쿠팡·네이버',
    version: '2.0.0',
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

  // ── 쿠팡 ──────────────────────────────────────────────────────────────────

  server.tool(
    'get_coupang_stats',
    '[쿠팡] 셀퓨전씨 쿠팡 전체 현황. 수집 상품 수, 총 리뷰 수, 평균 평점, 마지막 수집 시각.',
    {},
    async () => {
      const data = await getCoupangStats()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_coupang_product_stats',
    '[쿠팡] 셀퓨전씨 상품별 리뷰 수, 평균 평점. 어떤 상품이 잘 팔리는지 확인.',
    {},
    async () => {
      const data = await getCoupangProductStats()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_coupang_rankings',
    '[쿠팡] 검색순위와 카테고리 베스트셀러 순위. 자사 상품 노출 현황 포함.',
    {},
    async () => {
      const data = await getCoupangRankings()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_coupang_reviews',
    '[쿠팡] 실구매 리뷰 내용. 소비자 반응과 불만 파악. 특정 상품 ID 지정 가능.',
    { product_id: z.string().optional().describe('특정 상품 ID. 전체 브랜드면 생략.') },
    async ({ product_id }) => {
      const data = await getCoupangRecentReviews(product_id)
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  // ── 네이버 ────────────────────────────────────────────────────────────────

  server.tool(
    'get_naver_trends',
    '[네이버] DataLab 검색 트렌드. 최근 8주 주간 검색지수(0~100). 키워드별 관심도 추이.',
    {},
    async () => {
      const data = await getNaverTrends()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_naver_search_ranks',
    '[네이버] 쇼핑 검색 결과 순위. 키워드별 자사 셀퓨전씨 상품 노출 위치(is_ours=true).',
    {},
    async () => {
      const data = await getNaverSearchRanks()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_naver_market',
    '[네이버] 선케어 카테고리별 경쟁사 상품 현황. 브랜드별 가격 분포. 자사 상품은 is_ours=true.',
    {},
    async () => {
      const data = await getNaverMarket()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_naver_insight',
    '[네이버] 가장 최근에 자동 생성된 AI 네이버 쇼핑 시장 분석 인사이트.',
    {},
    async () => {
      const data = await getNaverLatestInsight()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  // ── 고도화 툴 ─────────────────────────────────────────────────────────────────

  server.tool(
    'get_reviews_by_date',
    '특정 날짜에 등록된 올리브영 리뷰 목록. 날짜별 소비자 반응 파악에 사용.',
    {
      date:     z.string().describe('조회할 날짜 (YYYY-MM-DD 형식, 예: 2026-06-05)'),
      goods_no: z.string().optional().describe('특정 상품 번호. 생략 시 전체 상품.'),
    },
    async ({ date, goods_no }) => {
      const data = await getReviewsByDate(date, goods_no ?? '')
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_review_content',
    '실제 리뷰 텍스트 조회. AI가 리뷰 내용을 직접 읽고 분석할 때 사용. 날짜·상품·긍부정 필터 지원.',
    {
      goods_no: z.string().optional().describe('특정 상품 번호. 생략 시 전체.'),
      date:     z.string().optional().describe('특정 날짜 필터 (YYYY-MM-DD).'),
      filter:   z.enum(['all', 'positive', 'negative']).optional().describe('all(기본)/positive(4~5점)/negative(1~2점)'),
      limit:    z.number().optional().describe('최대 반환 건수 (기본 50, 최대 200)'),
    },
    async ({ goods_no, date, filter, limit }) => {
      const data = await getReviewContent({ goodsNo: goods_no, date, filter, limit: Math.min(limit ?? 50, 200) })
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_weekly_delta',
    '이번 주 vs 지난 주 비교. 리뷰 수·평균 별점·긍정비율·부정비율 변화량(delta) 포함.',
    {},
    async () => {
      const data = await getWeeklyDelta()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_product_summary',
    '상품 하나에 대한 종합 분석: 기본 통계 + 긍/부정 키워드 Top 10 + 최근 리뷰 5건 + 순위 이력.',
    {
      goods_no: z.string().describe('상품 번호 (get_product_stats에서 확인 가능)'),
    },
    async ({ goods_no }) => {
      const data = await getProductSummaryFull(goods_no)
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  // ── 분석 툴 ────────────────────────────────────────────────────────────────

  server.tool(
    'get_ranking_changes',
    '전일 대비 순위 변화 분석. 어제 대비 순위가 오른 상품(improved), 내린 상품(dropped), 신규 진입(new_entry)으로 구분. 셀퓨전씨 상품은 is_ours=true.',
    {},
    async () => {
      const data = await getRankingChanges()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_top_movers',
    '최근 7일간 순위 변동이 가장 큰 상품 Top 20. total_change 양수=상승, 음수=하락. 시장 흐름 파악에 사용.',
    {},
    async () => {
      const data = await getTopMovers()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_competitive_summary',
    '카테고리별 Top 5 경쟁 현황 종합. 각 카테고리에서 셀퓨전씨 최고 순위(our_best_rank)와 경쟁사 수 포함. 시장 내 포지션 파악에 사용.',
    {},
    async () => {
      const data = await getCompetitiveSummary()
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'get_daily_brief',
    '오늘 아침 자동 생성된 종합 인사이트 브리핑. 순위·리뷰·시장 동향을 하나로 요약. "오늘 어때?", "인사이트 줘", "현황 알려줘" 같은 포괄적 질문에 사용.',
    {},
    async () => {
      const data = await getDailyBrief()
      if (!data) return { content: [{ type: 'text' as const, text: '오늘 브리핑이 아직 생성되지 않았습니다. get_ranking_changes, get_competitive_summary를 대신 사용하세요.' }] }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  return server
}

async function handle(req: NextRequest): Promise<Response> {
  const server = buildMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })

  await server.connect(transport)
  return transport.handleRequest(req)
}

export const GET = handle
export const POST = handle
export const DELETE = handle
