'use client'

import { useState, useCallback } from 'react'
import type {
  Insights, TimeSeriesPoint, ProductNegativeData, ScoreDist,
  ProductStats, ProductSummary, CompetitorSummary, InsightsSnapshot, ProductRankingData,
  MarketCategoryData, NewProductData, NegativeAlertData,
  OurRankingTimelineEntry, PromoStatusData, ProductKeywordData, ProductTopicData,
  CompetitorInsight,
} from '@/lib/types'

import InsightCards from '@/components/InsightCards'
import NegativeInsights from '@/components/NegativeInsights'
import StatsAccordion from '@/components/StatsAccordion'
import TimeSeriesChart from '@/components/TimeSeriesChart'
import ProductSummarySection from '@/components/ProductSummarySection'
import CompetitorSection from '@/components/CompetitorSection'
import InsightsHistory from '@/components/InsightsHistory'
import RankingSection from '@/components/RankingSection'
import MarketRankingSection from '@/components/MarketRankingSection'
import NewProductInsights from '@/components/NewProductInsights'
import TodayRankingTimeline from '@/components/TodayRankingTimeline'
import PromoSection from '@/components/PromoSection'
import ProductKeywordsSection from '@/components/ProductKeywordsSection'
import SectionDivider from '@/components/SectionDivider'
import OlivepickTab from '@/components/OlivepickTab'
import TodayDealTab from '@/components/TodayDealTab'
import ActionLogWidget from '@/components/ActionLogWidget'
import BrandTimeline from '@/components/BrandTimeline'

interface Props {
  insights: Insights
  timeSeries: TimeSeriesPoint[]
  negativeData: ProductNegativeData[]
  scoreDist: ScoreDist[]
  productStats: ProductStats[]
  summaries: ProductSummary[]
  competitorSummaries: CompetitorSummary[]
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
  competitorInsights: CompetitorInsight[]
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  if (parts.length === 1) return text
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="font-semibold text-accent-fg">{p.slice(2, -2)}</strong>
      : p
  )
}

const TABS = [
  { id: 'today',       label: '오늘 현황' },
  { id: 'reviews',     label: '리뷰 분석' },
  { id: 'market',      label: '시장 랭킹' },
  { id: 'competitor',  label: '경쟁사 분석' },
  { id: 'olivepick',   label: '올영픽' },
  { id: 'today_deal',  label: '오특' },
  { id: 'history',     label: '이력' },
] as const

type TabId = typeof TABS[number]['id']

export default function DashboardTabs({
  insights, timeSeries, negativeData, scoreDist, productStats,
  summaries, competitorSummaries, insightsHistory, rankingsByMode, rankingsLastCollected,
  marketRankings, aiInsight, reviewInsight, dailyBrief,
  newProducts, negativeAlerts, todayTimeline, promoStatus, productKeywords, productTopics,
  competitorInsights,
}: Props) {
  const [active, setActive] = useState<TabId>('today')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshed, setRefreshed] = useState(false)

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await fetch('/api/revalidate', { method: 'POST' })
      setRefreshed(true)
      setTimeout(() => { setRefreshed(false); window.location.reload() }, 800)
    } finally {
      setRefreshing(false)
    }
  }, [refreshing])

  return (
    <div className="space-y-8">
      {/* 탭 바 */}
      <div className="border-b border-border sticky top-14 z-30 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center justify-between -mb-px">
          <nav className="flex gap-0">
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
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="캐시 초기화 후 새로고침"
            className={`mr-2 flex items-center gap-1 px-2.5 py-1 rounded text-xs border transition-colors ${
              refreshed
                ? 'text-green-600 border-green-200 bg-green-50'
                : 'text-text-tertiary border-border hover:text-text-secondary hover:border-text-tertiary'
            } disabled:opacity-40`}
          >
            <span className={`text-sm leading-none ${refreshing ? 'animate-spin' : ''}`}>↺</span>
            {refreshed ? '완료' : '새로고침'}
          </button>
        </div>
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
                      .map(l => l.replace(/^\[.*?\]\s*/, '').replace(/^#+\s*/, '').replace(/^[\s\-·•\d.]+/, '').trim())
                      .filter(l => l.length > 10)
                      .map((msg, i) => (
                        <li key={i} className="text-sm text-accent-fg flex items-start gap-2">
                          <span className="text-accent shrink-0 mt-0.5 font-bold text-base leading-none">·</span>
                          <span className="leading-snug">{renderBold(msg)}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            )}

            {/* ⚠️ 부정 리뷰 급증 — 컴팩트 알림 (상세는 리뷰 분석 탭) */}
            {negativeAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => setActive('reviews')}
                className="w-full flex items-center gap-3 bg-red-50 border-2 border-red-300 rounded-lg px-4 py-3 hover:bg-red-100 transition-colors text-left"
              >
                <span className="text-red-600 font-black text-lg shrink-0 leading-none">!</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-red-700">
                    부정 리뷰 급증 {negativeAlerts.length}개 상품 감지
                  </p>
                  <p className="text-xs text-red-600 mt-0.5 truncate">
                    {negativeAlerts.map(a => a.goods_name).join(' · ')}
                  </p>
                </div>
                <span className="text-xs text-red-500 font-medium shrink-0 whitespace-nowrap">리뷰 분석에서 보기 →</span>
              </button>
            )}

            {/* 프로모션 입점 현황 */}
            {promoStatus.length > 0 && (
              <PromoSection data={promoStatus} onNavigate={id => setActive(id as TabId)} />
            )}

            {/* 오늘 시간별 순위 타임라인 */}
            <TodayRankingTimeline data={todayTimeline} />

            {/* 셀퓨전씨 자사 순위 */}
            <RankingSection dataByMode={rankingsByMode} lastCollected={rankingsLastCollected} />

            {rankingsByMode.best.length === 0 && !dailyBrief && (
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
                    .map(l => l.replace(/^\[.*?\]\s*/, '').replace(/^#+\s*/, '').replace(/^[\s\-·•\d.]+/, '').trim())
                    .filter(l => l.length > 10)
                    .map((msg, i) => (
                      <li key={i} className="text-sm text-accent-fg flex items-start gap-1.5">
                        <span className="text-accent shrink-0 mt-0.5 font-bold">·</span>
                        <span className="leading-snug">{renderBold(msg)}</span>
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

        {/* 경쟁사 분석 */}
        {active === 'competitor' && (
          <div className="space-y-10">
            <CompetitorSection summaries={competitorSummaries} insights={competitorInsights} />
            <div>
              <SectionDivider tag="브랜드 타임라인" />
              <div className="mb-3">
                <h2 className="text-xl font-semibold text-text-primary">브랜드 이벤트 타임라인</h2>
                <p className="text-sm text-text-tertiary mt-0.5">올영픽 입점·이탈, 순위 급등, 리뷰 급증 등 자동 감지</p>
              </div>
              <BrandTimeline />
            </div>
          </div>
        )}

        {/* 이력 */}
        {active === 'history' && (
          <InsightsHistory history={insightsHistory} />
        )}

        {/* 올영픽 */}
        {active === 'olivepick' && <OlivepickTab />}

        {/* 오특 */}
        {active === 'today_deal' && <TodayDealTab />}
      </div>

      {/* 실행 기록 플로팅 버튼 */}
      <ActionLogWidget />
    </div>
  )
}
