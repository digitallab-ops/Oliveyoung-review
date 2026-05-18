import { getStats, getInsights, getScoreDist, getProductStats, getTimeSeries, getProductNegatives, getProductSummaries, getInsightsHistory, getProductRankings, getMarketRankings } from '@/lib/db'
import KPIStrip from '@/components/KPIStrip'
import InsightCards from '@/components/InsightCards'
import StatsAccordion from '@/components/StatsAccordion'
import TimeSeriesChart from '@/components/TimeSeriesChart'
import NegativeInsights from '@/components/NegativeInsights'
import ProductSummarySection from '@/components/ProductSummarySection'
import InsightsHistory from '@/components/InsightsHistory'
import RankingSection from '@/components/RankingSection'
import MarketRankingSection from '@/components/MarketRankingSection'
import SectionDivider from '@/components/SectionDivider'

export const revalidate = 3600

function formatLastUpdated(ts: string | null): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default async function Page() {
  const [stats, insights, scoreDist, productStats, timeSeries, negativeData, summaries, insightsHistory, rankings, marketRankings] = await Promise.all([
    getStats(),
    getInsights(),
    getScoreDist(),
    getProductStats(),
    getTimeSeries(),
    getProductNegatives(),
    getProductSummaries(),
    getInsightsHistory(),
    getProductRankings(),
    getMarketRankings(),
  ])

  return (
    <div className="min-h-screen bg-background">
      {/* 헤더 */}
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border-subtle">
        <div className="mx-auto max-w-content px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="font-label text-xs tracking-[0.12em] uppercase text-text-primary font-medium">
              CellFusionC
            </span>
            <span className="text-border">·</span>
            <span className="text-xs text-text-tertiary hidden sm:block">
              리뷰 인사이트
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-text-tertiary">
              {formatLastUpdated(stats.last_updated)} 업데이트
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-content px-4 md:px-6 py-10 md:py-16 space-y-14">

        {/* HERO */}
        <section className="space-y-6 animate-fade-up">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-2xs font-semibold
                             bg-accent-bg text-accent-fg border border-accent-border">
                올리브영 공식 브랜드관
              </span>
              <span className="text-2xs text-text-tertiary">
                {stats.total_products}개 상품
              </span>
            </div>
            <h1 className="text-4xl font-bold text-text-primary tracking-tight leading-tight">
              소비자 반응<br className="sm:hidden" />
              <span className="text-text-tertiary font-normal"> 지금 어때요?</span>
            </h1>
            <p className="mt-3 text-base text-text-secondary leading-relaxed">
              실구매 고객 {stats.total_reviews.toLocaleString()}명의 솔직한 리뷰를
              매일 자동으로 수집합니다.
            </p>
          </div>

          <KPIStrip stats={stats} />
        </section>

        {/* 시계열 트렌드 */}
        {timeSeries.length > 1 && (
          <section className="animate-fade-up" style={{ animationDelay: '60ms' }}>
            <div className="mb-5">
              <SectionDivider tag="Trend" />
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-text-primary">리뷰 트렌드</h2>
                <span className="text-sm text-text-tertiary">{timeSeries.length}개월</span>
              </div>
            </div>
            <div className="border border-border rounded-lg bg-surface px-5 py-4">
              <TimeSeriesChart data={timeSeries} />
            </div>
          </section>
        )}

        {/* 인사이트 */}
        <div className="animate-fade-up" style={{ animationDelay: '80ms' }}>
          <InsightCards insights={insights} />
        </div>

        {/* 불만 포인트 */}
        {negativeData.length > 0 && (
          <div className="animate-fade-up" style={{ animationDelay: '120ms' }}>
            <NegativeInsights data={negativeData} />
          </div>
        )}

        {/* 카테고리 순위 (자사) */}
        {rankings.length > 0 && (
          <div className="animate-fade-up" style={{ animationDelay: '140ms' }}>
            <RankingSection data={rankings} />
          </div>
        )}

        {/* 시장 전체 순위 */}
        {marketRankings.length > 0 && (
          <div className="animate-fade-up" style={{ animationDelay: '160ms' }}>
            <MarketRankingSection data={marketRankings} />
          </div>
        )}

        {/* 구분선 */}
        <div className="flex items-center gap-4">
          <span className="h-px flex-1 bg-border-subtle" />
          <span className="font-label text-[9px] tracking-[0.2em] uppercase text-text-tertiary/50">Data</span>
          <span className="h-px flex-1 bg-border-subtle" />
        </div>

        {/* 상세 통계 */}
        <div className="animate-fade-up" style={{ animationDelay: '160ms' }}>
          <StatsAccordion scoreDist={scoreDist} productStats={productStats} />
        </div>

        {/* AI 상품 분석 */}
        <div className="animate-fade-up" style={{ animationDelay: '200ms' }}>
          <ProductSummarySection summaries={summaries} />
        </div>

        {/* 수집 이력 */}
        <div className="animate-fade-up" style={{ animationDelay: '240ms' }}>
          <InsightsHistory history={insightsHistory} />
        </div>

        {/* 푸터 */}
        <footer className="pt-4 pb-8 text-center space-y-1.5">
          <p className="font-label text-[10px] tracking-[0.15em] uppercase text-text-tertiary">
            CellFusionC Review Intelligence
          </p>
          <p className="text-2xs text-text-tertiary/50">
            올리브영 공식 브랜드관 실구매 리뷰 기준 · 매일 오전 6시 자동 수집
          </p>
        </footer>
      </main>
    </div>
  )
}
