'use client'

import type { Insights, KeywordItem } from '@/lib/types'
import { SKIN_TYPE_MAP } from '@/lib/utils'
import SectionDivider from '@/components/SectionDivider'

interface InsightCardsProps {
  insights: Insights
  onKeywordClick?: (word: string) => void
  activeKeywords?: string[]
}

function KeywordTag({
  kw,
  total,
  maxCnt,
  minCnt,
  variant,
  isActive,
  onClick,
}: {
  kw: KeywordItem
  total: number
  maxCnt: number
  minCnt: number
  variant: 'positive' | 'negative'
  isActive: boolean
  onClick?: (word: string) => void
}) {
  const range = maxCnt - minCnt || 1
  const ratio = (kw.cnt - minCnt) / range
  const fontSize = Math.round(11 + ratio * 4)
  const opacity = isActive ? 1 : 0.5 + ratio * 0.5
  const pct = total > 0 ? (kw.cnt / total * 100).toFixed(1) : '0.0'

  const activeClass = isActive
    ? variant === 'positive'
      ? 'bg-emerald-200 text-emerald-900 border-emerald-400 ring-2 ring-emerald-400'
      : 'bg-orange-200 text-orange-900 border-orange-400 ring-2 ring-orange-400'
    : variant === 'positive'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
      : 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-red-50 hover:text-red-800 hover:border-red-200'

  return (
    <span className="relative group/tag">
      <button
        onClick={() => onClick?.(kw.word)}
        className={`inline-flex items-center gap-0.5 px-2.5 py-1 rounded-full font-medium border transition-all duration-150 ${onClick ? 'cursor-pointer' : 'cursor-default'} ${activeClass}`}
        style={{ fontSize: `${fontSize}px`, opacity }}
      >
        {isActive && <span className="text-[10px]">✓</span>}
        #{kw.word}
      </button>
      <span
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                   px-2.5 py-1.5 rounded-md bg-gray-900 text-white text-xs whitespace-nowrap
                   opacity-0 group-hover/tag:opacity-100 pointer-events-none
                   transition-opacity duration-150 z-20 shadow-lg"
      >
        {kw.word} · {kw.cnt.toLocaleString()}회 언급 · 전체 리뷰의 {pct}%
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
      </span>
    </span>
  )
}

export default function InsightCards({ insights, onKeywordClick, activeKeywords = [] }: InsightCardsProps) {
  const skinTotal = insights.skin_dist.reduce((s, r) => s + r.cnt, 0)

  const posMax = insights.positive_keywords[0]?.cnt ?? 0
  const posMin = insights.positive_keywords[insights.positive_keywords.length - 1]?.cnt ?? 0
  const negMax = insights.negative_keywords[0]?.cnt ?? 0
  const negMin = insights.negative_keywords[insights.negative_keywords.length - 1]?.cnt ?? 0

  return (
    <section className="space-y-3">
      <div className="mb-5">
        <SectionDivider tag="인사이트" />
        <h2 className="text-xl font-semibold text-text-primary">소비자가 말하는 것들</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 긍정 키워드 */}
        <div className="bg-surface border border-border border-t-2 border-t-emerald-200 rounded-lg p-4 md:p-5">
          <p className="text-xs font-semibold text-emerald-700 mb-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            자주 언급되는 장점
          </p>
          <p className="text-[10px] text-text-tertiary/60 mb-2">전체 상품 종합 기준</p>
          {insights.positive_keywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {insights.positive_keywords.map((kw) => (
                <KeywordTag
                  key={kw.word}
                  kw={kw}
                  total={insights.total_reviews}
                  maxCnt={posMax}
                  minCnt={posMin}
                  variant="positive"
                  isActive={activeKeywords.includes(kw.word)}
                  onClick={onKeywordClick}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-tertiary">데이터 없음</p>
          )}
        </div>

        {/* 부정 키워드 */}
        <div className="bg-surface border border-border border-t-2 border-t-orange-200 rounded-lg p-4 md:p-5">
          <p className="text-xs font-semibold text-orange-700 mb-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />
            아쉬운 점으로 언급
          </p>
          <p className="text-[10px] text-text-tertiary/60 mb-2">전체 상품 종합 기준</p>
          {insights.negative_keywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {insights.negative_keywords.map((kw) => (
                <KeywordTag
                  key={kw.word}
                  kw={kw}
                  total={insights.total_reviews}
                  maxCnt={negMax}
                  minCnt={negMin}
                  variant="negative"
                  isActive={activeKeywords.includes(kw.word)}
                  onClick={onKeywordClick}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-tertiary">
              부정 리뷰가 거의 없습니다 👍
            </p>
          )}
        </div>
      </div>

      {/* 피부타입 분포 */}
      {insights.skin_dist.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4 md:p-5">
          <p className="text-xs font-semibold text-text-secondary mb-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
            피부 타입별 리뷰어
          </p>
          <div className="space-y-2">
            {insights.skin_dist.map(s => {
              const pct = skinTotal > 0 ? Math.round(s.cnt / skinTotal * 100) : 0
              return (
                <div key={s.skin_type} className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary w-16 flex-none">{SKIN_TYPE_MAP[s.skin_type] ?? s.skin_type}</span>
                  <div className="flex-1 h-1.5 bg-border-subtle rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-300 rounded-full transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-text-tertiary w-8 text-right">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 상위 상품 인사이트 */}
      {insights.top_product && (
        <div className="bg-accent-bg border border-accent-border border-t-2 border-t-accent/40 rounded-lg p-4 md:p-5">
          <p className="font-label text-[10px] tracking-[0.14em] uppercase text-accent-fg/70 mb-2">
            Top Product
          </p>
          <p className="text-sm font-semibold text-text-primary mb-1">
            {insights.top_product.goods_name.length > 45
              ? insights.top_product.goods_name.slice(0, 45) + '…'
              : insights.top_product.goods_name}
          </p>
          <p className="text-xs text-text-tertiary mb-2.5">
            ★ {insights.top_product.avg_score} · 리뷰 {insights.top_product.cnt.toLocaleString()}개
          </p>
          {insights.top_product.sample_review && (
            <p className="text-sm text-text-secondary italic leading-relaxed">
              &ldquo;{insights.top_product.sample_review}&rdquo;
            </p>
          )}
        </div>
      )}
    </section>
  )
}
