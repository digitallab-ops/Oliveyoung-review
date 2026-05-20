'use client'

import { useState } from 'react'
import type {
  Insights, TimeSeriesPoint, ProductNegativeData, ScoreDist,
  ProductStats, ProductSummary, InsightsSnapshot, ProductRankingData,
  MarketCategoryData, NewProductData, NegativeAlertData,
  OurRankingTimelineEntry, PromoStatusData, ProductKeywordData, ProductTopicData
} from '@/lib/types'
import InsightCards from '@/components/InsightCards'
import NegativeInsights from '@/components/NegativeInsights'
import StatsAccordion from '@/components/StatsAccordion'
import TimeSeriesChart from '@/components/TimeSeriesChart'
import ProductSummarySection from '@/components/ProductSummarySection'
import InsightsHistory from '@/components/InsightsHistory'
import RankingSection from '@/components/RankingSection'
import MarketRankingSection from '@/components/MarketRankingSection'
import NewProductInsights from '@/components/NewProductInsights'
import TodayRankingTimeline from '@/components/TodayRankingTimeline'
import PromoSection from '@/components/PromoSection'
import ProductKeywordsSection from '@/components/ProductKeywordsSection'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  insights: Insights
  timeSeries: TimeSeriesPoint[]
  negativeData: ProductNegativeData[]
  scoreDist: ScoreDist[]
  productStats: ProductStats[]
  summaries: ProductSummary[]
  insightsHistory: InsightsSnapshot[]
  rankings: ProductRankingData[]
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

const TABS = [
  { id: 'today',   label: '오늘 현황' },
  { id: 'reviews', label: '리뷰 분석' },
  { id: 'market',  label: '시장 랭킹' },
  { id: 'history', label: '이력' },
] as const

type TabId = typeof TABS[number]['id']

export default function DashboardTabs({
  insights, timeSeries, negativeData, scoreDist, productStats,
  summaries, insightsHistory, rankings, marketRankings, aiInsight, reviewInsight, dailyBrief,
  newProducts, negativeAlerts, todayTimeline, promoStatus, productKeywords, productTopics
}: Props) {
  const [active, setActive] = useState<TabId>('today')

  return (
    <div className="space-y-8">
      {/* 탭 바 */}
      <div className="border-b border-border sticky top-14 z-30 bg-background/95 backdrop-blur-sm">
        <nav className="flex gap-0 -mb-px">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                active === tab.id
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* 탭 콘텐츠 */}
      <div>
        {/* 오늘 현황 */}
        {active === 'today' && (
          <div className="space-y-10">
            {/* 오늘의 통합 브리핑 */}
            {dailyBrief && (
              <div>
                <SectionDivider tag="오늘 브리핑" />
                <div className="bg-accent-bg border border-accent-border rounded-lg px-4 py-4">
                  <p className="text-xs font-semibold text-accent mb-3">오늘의 핵심 브리핑 — 랭킹 + 리뷰 종합</p>
                  <ul className="space-y-2">
                    {dailyBrief
                      .split('\n')
                      .map(l => l.replace(/^\[.*?\]\s*/, '').replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/^[\s\-·•*\d.]+/, '').trim())
                      .filter(l => l.length > 10)
                      .map((msg, i) => (
                        <li key={i} className="text-sm text-accent-fg flex items-start gap-2">
                          <span className="text-accent shrink-0 mt-0.5 font-bold text-base leading-none">·</span>
                          <span className="leading-snug">{msg}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            )}

            {/* 프로모션 입점 현황 */}
            {promoStatus.length > 0 && (
              <PromoSection data={promoStatus} />
            )}

            {/* 오늘 시간별 순위 타임라인 */}
            {todayTimeline.length > 0 && (
              <TodayRankingTimeline data={todayTimeline} />
            )}

            {/* 셀퓨전씨 자사 순위 */}
            {rankings.length > 0 && (
              <RankingSection data={rankings} />
            )}

            {rankings.length === 0 && !dailyBrief && (
              <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
                <p className="text-sm text-text-secondary">오늘 수집 데이터가 없어요</p>
                <p className="text-xs text-text-tertiary mt-1">매일 오전 6시 자동 수집됩니다</p>
              </div>
            )}
          </div>
        )}

        {/* 리뷰 분석 */}
        {active === 'reviews' && (
          <div className="space-y-10">
            {/* 신제품 리뷰 현황 */}
            <NewProductInsights products={newProducts} />

            {/* 부정 이슈 급증 알림 */}
            {negativeAlerts.length > 0 && (
              <div>
                <SectionDivider tag="알림" />
                <div className="space-y-2">
                  {negativeAlerts.map(a => (
                    <div key={a.goods_no} className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                      <span className="text-red-500 font-bold text-base shrink-0 mt-0.5">!</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-red-700">{a.goods_name}</p>
                        <p className="text-xs text-red-600 mt-0.5">
                          최근 7일 부정 리뷰 {a.recent_neg}건
                          {a.prev_neg > 0 && ` (전주 대비 +${a.increase_pct}%)`}
                          {a.top_keywords.length > 0 && ` · ${a.top_keywords.map(k => k.word).join(', ')}`}
                        </p>
                        {a.sample && (
                          <p className="text-xs text-red-500/80 mt-1 truncate">"{a.sample}"</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI 리뷰 인사이트 배너 */}
            {reviewInsight && (
              <div className="bg-accent-bg border border-accent-border rounded-lg px-4 py-3.5">
                <p className="text-xs font-semibold text-accent mb-2.5">AI 리뷰 분석 인사이트</p>
                <ul className="space-y-1.5">
                  {reviewInsight
                    .split('\n')
                    .map(l => l.replace(/^\[.*?\]\s*/, '').replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/^[\s\-·•*\d.]+/, '').trim())
                    .filter(l => l.length > 10)
                    .map((msg, i) => (
                      <li key={i} className="text-sm text-accent-fg flex items-start gap-1.5">
                        <span className="text-accent shrink-0 mt-0.5 font-bold">·</span>
                        <span className="leading-snug">{msg}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {timeSeries.length > 1 && (
              <section>
                <div className="mb-5">
                  <SectionDivider tag="트렌드" />
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
            {productKeywords.length > 0 && (
              <ProductKeywordsSection keywords={productKeywords} topics={productTopics} />
            )}
            <InsightCards insights={insights} />
            {negativeData.length > 0 && <NegativeInsights data={negativeData} />}
            <StatsAccordion scoreDist={scoreDist} productStats={productStats} />
            <ProductSummarySection summaries={summaries} />
          </div>
        )}

        {/* 시장 랭킹 */}
        {active === 'market' && (
          <div>
            {marketRankings.length > 0
              ? <MarketRankingSection data={marketRankings} aiInsight={aiInsight} />
              : (
                <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
                  <p className="text-sm text-text-secondary">시장 랭킹 데이터가 없어요</p>
                  <p className="text-xs text-text-tertiary mt-1">매일 오전 6시 자동 수집됩니다</p>
                </div>
              )
            }
          </div>
        )}

        {/* 이력 */}
        {active === 'history' && (
          <InsightsHistory history={insightsHistory} />
        )}
      </div>
    </div>
  )
}
