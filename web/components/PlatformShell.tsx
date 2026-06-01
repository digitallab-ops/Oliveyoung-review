'use client'

import { useState } from 'react'
import PlatformSelector, { type Platform } from '@/components/PlatformSelector'
import KPIStrip from '@/components/KPIStrip'
import DashboardTabs from '@/components/DashboardTabs'
import CoupangDashboard from '@/components/CoupangDashboard'
import type {
  Stats, Insights, TimeSeriesPoint, ProductNegativeData, ScoreDist,
  ProductStats, ProductSummary, InsightsSnapshot, ProductRankingData,
  MarketCategoryData, NewProductData, NegativeAlertData,
  OurRankingTimelineEntry, PromoStatusData, ProductKeywordData, ProductTopicData
} from '@/lib/types'

interface Props {
  stats: Stats
  insights: Insights
  timeSeries: TimeSeriesPoint[]
  negativeData: ProductNegativeData[]
  scoreDist: ScoreDist[]
  productStats: ProductStats[]
  summaries: ProductSummary[]
  insightsHistory: InsightsSnapshot[]
  rankingsByMode: { best: ProductRankingData[]; avg: ProductRankingData[]; weekly: ProductRankingData[] }
  rankingsLastCollected: Record<string, string>
  marketRankings: MarketCategoryData[]
  aiInsight: string
  reviewInsight: string
  dailyBrief: string
  newProducts: NewProductData[]
  negativeAlerts: NegativeAlertData[]
  todayTimeline: OurRankingTimelineEntry[]
  promoStatus: PromoStatusData[]
  productKeywords: ProductKeywordData[]
  productTopics: ProductTopicData[]
}

export default function PlatformShell({
  stats, insights, timeSeries, negativeData, scoreDist, productStats,
  summaries, insightsHistory, rankingsByMode, rankingsLastCollected,
  marketRankings, aiInsight, reviewInsight, dailyBrief,
  newProducts, negativeAlerts, todayTimeline, promoStatus,
  productKeywords, productTopics,
}: Props) {
  const [platform, setPlatform] = useState<Platform>('oliveyoung')

  return (
    <div className="space-y-14">
      {/* 플랫폼 선택 */}
      <div className="flex items-center justify-between">
        <div>
          {platform === 'oliveyoung' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-2xs font-semibold
                           bg-accent-bg text-accent-fg border border-accent-border">
              올리브영 공식 브랜드관
            </span>
          )}
          {platform === 'coupang' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-2xs font-semibold
                           bg-orange-50 text-orange-700 border border-orange-200">
              쿠팡 브랜드 스토어
            </span>
          )}
          {platform === 'amazon' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-2xs font-semibold
                           bg-blue-50 text-blue-700 border border-blue-200">
              Amazon.com · US Market
            </span>
          )}
        </div>
        <PlatformSelector value={platform} onChange={setPlatform} />
      </div>

      {/* 올리브영 */}
      {platform === 'oliveyoung' && (
        <>
          <section className="space-y-6 animate-fade-up">
            <div>
              <div className="flex items-center gap-2 mb-4">
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
            rankingsByMode={rankingsByMode}
            rankingsLastCollected={rankingsLastCollected}
            marketRankings={marketRankings}
            aiInsight={aiInsight}
            reviewInsight={reviewInsight}
            dailyBrief={dailyBrief}
            newProducts={newProducts}
            negativeAlerts={negativeAlerts}
            todayTimeline={todayTimeline}
            promoStatus={promoStatus}
            productKeywords={productKeywords}
            productTopics={productTopics}
          />
        </>
      )}

      {/* 쿠팡 */}
      {platform === 'coupang' && (
        <>
          <section className="space-y-4 animate-fade-up">
            <div className="flex items-center gap-3">
              <h1 className="text-4xl font-bold text-text-primary tracking-tight leading-tight">
                쿠팡 인사이트<br className="sm:hidden" />
                <span className="text-text-tertiary font-normal"> 리뷰 · 순위</span>
              </h1>
              <span className="self-start mt-1.5 px-2 py-0.5 text-xs font-bold rounded-full bg-orange-100 text-orange-600 border border-orange-200">
                Beta
              </span>
            </div>
            <p className="text-base text-text-secondary leading-relaxed">
              쿠팡 실구매 리뷰와 카테고리 베스트셀러 순위를 자동으로 수집합니다.
            </p>
          </section>
          <CoupangDashboard />
        </>
      )}

      {/* 아마존 (준비 중) */}
      {platform === 'amazon' && (
        <section className="space-y-6 animate-fade-up">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-bold text-text-primary tracking-tight leading-tight">
              Amazon 인사이트<br className="sm:hidden" />
              <span className="text-text-tertiary font-normal"> US Market</span>
            </h1>
            <span className="self-start mt-1.5 px-2 py-0.5 text-xs font-bold rounded-full bg-orange-100 text-orange-600 border border-orange-200">
              Beta
            </span>
          </div>
          <div className="border border-dashed border-border rounded-xl px-8 py-16 text-center space-y-4">
            <p className="text-2xl">🇺🇸</p>
            <p className="text-base font-medium text-text-primary">데이터 수집 중</p>
            <p className="text-sm text-text-secondary max-w-sm mx-auto leading-relaxed">
              Amazon.com 리뷰 · 카테고리 순위 · 경쟁사 분석 · 지역별 관심도
              수집이 시작되면 여기서 확인할 수 있어요.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {['COSRX', 'Anua', 'Beauty of Joseon', 'TIRTIR', 'isntree'].map(b => (
                <span key={b} className="px-2.5 py-1 text-xs rounded-full border border-border text-text-tertiary">
                  vs {b}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
