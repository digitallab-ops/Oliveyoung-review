import { getStats, getInsights, getScoreDist, getProductStats, getTimeSeries, getProductNegatives, getProductSummaries, getInsightsHistory, getProductRankingsByMode, getMarketRankings, getNewProducts, getNegativeAlerts, getOurRankingTimeline, getPromoStatus, getProductKeywords, getProductTopicInsights } from '@/lib/db'
import { generateMarketInsight, generateReviewInsight, generateDailyBrief } from '@/lib/ai'
import PlatformShell from '@/components/PlatformShell'

export const revalidate = 300
export const maxDuration = 60

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ])
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch { return fallback }
}

function formatLastUpdated(ts: string | null): string {
  if (!ts) return '-'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '-'
  const now = Date.now()
  const diffMs = now - d.getTime()
  if (diffMs < 0) return '방금 전'
  const diffH = Math.floor(diffMs / 3600000)
  // KST = UTC + 9h
  const kstH = (d.getUTCHours() + 9) % 24
  const kstM = d.getUTCMinutes()
  const hhmm = `${String(kstH).padStart(2, '0')}:${String(kstM).padStart(2, '0')}`
  if (diffMs < 3600000) return '방금 전'
  if (diffH < 24) return `${diffH}시간 전 (${hhmm})`
  if (diffH < 48) return `어제 ${hhmm}`
  return `${Math.floor(diffH / 24)}일 전 (${hhmm})`
}

export default async function Page() {
  const statsDefault = { total_reviews: 0, total_products: 0, avg_score: 0, five_star_pct: 0, repurchase_pct: 0, repurchase_count: 0, five_star_count: 0, last_updated: null, rank_last_updated: null, promo_last_updated: null }
  const insightsDefault = { positive_keywords: [], negative_keywords: [], total_reviews: 0, skin_dist: [], top_product: null }
  const rankingsDefault = { best: [], avg: [], weekly: [], lastCollected: {} }

  const [stats, insights, scoreDist, productStats, timeSeries, negativeData, summaries, insightsHistory, rankingsData, marketRankings, newProducts, negativeAlerts, todayTimeline, promoStatus, productKeywords] = await Promise.all([
    safe(getStats, statsDefault),
    safe(getInsights, insightsDefault),
    safe(getScoreDist, []),
    safe(getProductStats, []),
    safe(getTimeSeries, []),
    safe(getProductNegatives, []),
    safe(getProductSummaries, []),
    safe(getInsightsHistory, []),
    safe(getProductRankingsByMode, rankingsDefault),
    safe(getMarketRankings, []),
    safe(getNewProducts, []),
    safe(getNegativeAlerts, []),
    safe(getOurRankingTimeline, []),
    safe(getPromoStatus, []),
    safe(getProductKeywords, []),
  ])

  const productTopics = await safe(getProductTopicInsights, [])

  const [marketInsight, reviewInsight, dailyBrief] = await Promise.all([
    withTimeout(marketRankings.length > 0 ? generateMarketInsight(marketRankings) : Promise.resolve(''), 25000, ''),
    withTimeout(generateReviewInsight(insights, negativeData), 25000, ''),
    withTimeout(marketRankings.length > 0 ? generateDailyBrief(marketRankings, insights, negativeData) : Promise.resolve(''), 25000, ''),
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
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0">
              {([
                { label: '리뷰',   ts: stats.last_updated },
                { label: '랭킹',   ts: stats.rank_last_updated },
                { label: '프로모', ts: stats.promo_last_updated },
              ] as const).map(({ label, ts }) =>
                ts ? (
                  <span key={label} className="text-xs text-text-tertiary whitespace-nowrap">
                    {label} <span className="text-text-secondary">{formatLastUpdated(ts)}</span>
                  </span>
                ) : null
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 md:px-6 py-10 md:py-16">

        <PlatformShell
          stats={stats}
          insights={insights}
          timeSeries={timeSeries}
          negativeData={negativeData}
          scoreDist={scoreDist}
          productStats={productStats}
          summaries={summaries}
          insightsHistory={insightsHistory}
          rankingsByMode={{ best: rankingsData.best, avg: rankingsData.avg, weekly: rankingsData.weekly }}
          rankingsLastCollected={rankingsData.lastCollected}
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
