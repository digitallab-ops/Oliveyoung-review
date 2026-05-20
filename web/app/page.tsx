import { getStats, getInsights, getScoreDist, getProductStats, getTimeSeries, getProductNegatives, getProductSummaries, getInsightsHistory, getProductRankings, getMarketRankings, getNewProducts, getNegativeAlerts, getOurRankingTimeline, getPromoStatus, getProductKeywords, getProductTopicInsights } from '@/lib/db'
import { generateMarketInsight, generateReviewInsight, generateDailyBrief } from '@/lib/ai'
import KPIStrip from '@/components/KPIStrip'
import DashboardTabs from '@/components/DashboardTabs'

export const revalidate = 300

function formatLastUpdated(ts: string | null): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default async function Page() {
  const [stats, insights, scoreDist, productStats, timeSeries, negativeData, summaries, insightsHistory, rankings, marketRankings, newProducts, negativeAlerts, todayTimeline, promoStatus, productKeywords] = await Promise.all([
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
    getNewProducts(),
    getNegativeAlerts(),
    getOurRankingTimeline(),
    getPromoStatus(),
    getProductKeywords(),
  ])

  const productTopics = await getProductTopicInsights()

  const [marketInsight, reviewInsight, dailyBrief] = await Promise.all([
    marketRankings.length > 0 ? generateMarketInsight(marketRankings) : Promise.resolve(''),
    generateReviewInsight(insights, negativeData),
    marketRankings.length > 0 ? generateDailyBrief(marketRankings, insights, negativeData) : Promise.resolve(''),
  ])

  return (
    <div className="min-h-screen bg-background">
      {/* 헤더 */}
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border-subtle">
        <div className="mx-auto max-w-[1280px] px-4 md:px-6 h-14 flex items-center justify-between">
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

      <main className="mx-auto max-w-[1280px] px-4 md:px-6 py-10 md:py-16 space-y-14">

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

        <DashboardTabs
          insights={insights}
          timeSeries={timeSeries}
          negativeData={negativeData}
          scoreDist={scoreDist}
          productStats={productStats}
          summaries={summaries}
          insightsHistory={insightsHistory}
          rankings={rankings}
          marketRankings={marketRankings}
          aiInsight={marketInsight}
          reviewInsight={reviewInsight}
          dailyBrief={dailyBrief}
          newProducts={newProducts}
          negativeAlerts={negativeAlerts}
          todayTimeline={todayTimeline}
          promoStatus={promoStatus}
          productKeywords={productKeywords}
          productTopics={productTopics}
        />

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
