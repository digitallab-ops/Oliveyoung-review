'use client'

import { useState, useMemo } from 'react'
import type { CompetitorInsight } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  insights: CompetitorInsight[]
}

function KeywordChips({
  keywords,
  variant,
  max = 5,
}: {
  keywords: { word: string; cnt: number }[]
  variant: 'pos' | 'neg'
  max?: number
}) {
  if (keywords.length === 0) return <p className="text-[10px] text-text-tertiary/60">데이터 없음</p>
  return (
    <div className="flex flex-wrap gap-1">
      {keywords.slice(0, max).map(kw => (
        <span
          key={kw.word}
          className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
            variant === 'pos'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-red-50 text-red-600 border-red-200'
          }`}
        >
          {kw.word}
        </span>
      ))}
    </div>
  )
}

function InsightCard({
  insight,
  isOurs,
}: {
  insight: CompetitorInsight
  isOurs?: boolean
}) {
  const shortName = insight.goods_name.replace(/\[.*?\]\s*/g, '').trim()

  return (
    <div
      className={`rounded-lg border p-3 h-full ${
        isOurs
          ? 'border-accent/40 bg-accent-bg ring-1 ring-accent/20'
          : 'border-border bg-surface'
      }`}
    >
      {/* 헤더 */}
      <div className="flex items-center gap-1.5 mb-2.5">
        {isOurs ? (
          <span className="shrink-0 text-[10px] font-semibold bg-accent text-white px-1.5 py-0.5 rounded">
            자사
          </span>
        ) : insight.rank_position != null ? (
          <span className="shrink-0 text-[11px] font-semibold text-red-500">
            {insight.rank_position}위
          </span>
        ) : null}
        <p className="text-xs font-medium text-text-primary truncate">{shortName}</p>
      </div>

      {/* 긍정 키워드 */}
      <div className="mb-2">
        <p className="text-[10px] font-semibold text-emerald-600 mb-1">긍정 키워드</p>
        <KeywordChips keywords={insight.positive_keywords} variant="pos" />
      </div>

      {/* 부정 키워드 */}
      <div className="mb-2.5">
        <p className="text-[10px] font-semibold text-red-500 mb-1">부정 키워드</p>
        <KeywordChips keywords={insight.negative_keywords} variant="neg" max={4} />
      </div>

      {/* 메타 */}
      <div className="flex items-center gap-2 text-[10px] text-text-tertiary/70">
        {insight.review_count > 0 && (
          <span>리뷰 {insight.review_count.toLocaleString()}개</span>
        )}
        {insight.avg_score != null && (
          <span>★ {insight.avg_score.toFixed(1)}</span>
        )}
      </div>
    </div>
  )
}

export default function CompetitorKeywords({ insights }: Props) {
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const ins of insights) set.add(ins.category_name)
    return Array.from(set).sort()
  }, [insights])

  const [activeCategory, setActiveCategory] = useState<string>(() => categories[0] ?? '')

  const catInsights = useMemo(
    () => insights.filter(i => i.category_name === activeCategory),
    [insights, activeCategory]
  )

  const ourProducts = catInsights.filter(i => i.is_ours)
  const competitors = catInsights.filter(i => !i.is_ours).slice(0, 3)

  const weekStart = insights[0]?.week_start ?? null

  if (insights.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center space-y-1.5">
        <p className="text-sm text-text-secondary">경쟁사 키워드 분석 데이터가 없어요</p>
        <p className="text-xs text-text-tertiary font-mono">
          python -m collector.competitor_analysis_generator
        </p>
        <p className="text-xs text-text-tertiary/60">매주 월요일 자동 실행됩니다</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="mb-1">
        <SectionDivider tag="키워드 비교" />
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-semibold text-text-primary">경쟁사 키워드 비교 분석</h2>
          {weekStart && (
            <span className="text-xs text-text-tertiary">
              {weekStart.slice(0, 10)} 주간
            </span>
          )}
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          카테고리별 실구매 리뷰 긍정·부정 키워드를 경쟁사와 나란히 비교합니다
        </p>
      </div>

      {/* 카테고리 탭 */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-accent text-white'
                  : 'bg-surface border border-border text-text-secondary hover:border-accent/50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* 비교 그리드 */}
      {catInsights.length === 0 ? (
        <p className="text-sm text-text-tertiary text-center py-8">
          해당 카테고리 분석 데이터가 없어요
        </p>
      ) : (
        <div>
          {ourProducts.length === 0 && (
            <p className="text-xs text-text-tertiary/70 mb-2">
              해당 카테고리에 셀퓨전씨 순위권 상품 없음 — 경쟁사 상위 상품만 표시
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 자사 상품 */}
            {ourProducts.map(ins => (
              <InsightCard key={ins.goods_no} insight={ins} isOurs />
            ))}

            {/* 경쟁사 상품 */}
            {competitors.map(ins => (
              <InsightCard key={ins.goods_no} insight={ins} isOurs={false} />
            ))}
          </div>

          {/* 안내 */}
          <p className="text-[10px] text-text-tertiary/60 mt-3 text-right">
            순위권 상위 8개 상품 기준 · 리뷰 3개 미만 상품 제외
          </p>
        </div>
      )}
    </div>
  )
}
