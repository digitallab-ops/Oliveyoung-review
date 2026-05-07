import type { Insights } from '@/lib/types'

interface InsightCardsProps {
  insights: Insights
}

export default function InsightCards({ insights }: InsightCardsProps) {
  const skinTotal = insights.skin_dist.reduce((s, r) => s + r.cnt, 0)

  return (
    <section className="space-y-3">
      <h2 className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider">
        소비자가 말하는 것들
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 긍정 키워드 */}
        <div className="bg-surface border border-border rounded-lg p-4 md:p-5">
          <p className="text-xs font-semibold text-emerald-700 mb-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            자주 언급되는 장점
          </p>
          {insights.positive_keywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {insights.positive_keywords.map((kw, i) => (
                <span
                  key={kw}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium
                             bg-emerald-50 text-emerald-800 border border-emerald-100"
                  style={{ opacity: 1 - i * 0.08 }}
                >
                  #{kw}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-tertiary">데이터 없음</p>
          )}
        </div>

        {/* 부정 키워드 */}
        <div className="bg-surface border border-border rounded-lg p-4 md:p-5">
          <p className="text-xs font-semibold text-text-secondary mb-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-stone-400 inline-block" />
            아쉬운 점으로 언급
          </p>
          {insights.negative_keywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {insights.negative_keywords.map((kw, i) => (
                <span
                  key={kw}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium
                             bg-stone-50 text-stone-600 border border-stone-200"
                  style={{ opacity: 1 - i * 0.1 }}
                >
                  #{kw}
                </span>
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
                  <span className="text-xs text-text-secondary w-16 flex-none">{s.skin_type}</span>
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
        <div className="bg-accent-bg border border-accent-border rounded-lg p-4 md:p-5">
          <p className="text-xs font-semibold text-accent-fg mb-2 flex items-center gap-1.5">
            <span>🏆</span> 가장 반응 좋은 상품
          </p>
          <p className="text-sm font-semibold text-text-primary mb-1">
            {insights.top_product.goods_name.length > 45
              ? insights.top_product.goods_name.slice(0, 45) + '…'
              : insights.top_product.goods_name}
          </p>
          <p className="text-xs text-text-tertiary mb-2">
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
