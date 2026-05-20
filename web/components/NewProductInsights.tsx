import type { NewProductData } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  products: NewProductData[]
}

export default function NewProductInsights({ products }: Props) {
  if (products.length === 0) return null

  return (
    <section>
      <SectionDivider tag="신제품 현황" />
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-xl font-semibold text-text-primary">신제품 리뷰 현황</h2>
        <span className="text-sm text-text-tertiary">최근 30일 출시</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {products.map(p => (
          <div key={p.goods_no} className="border border-border rounded-lg bg-surface p-4 space-y-3">
            {/* 헤더 */}
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-text-primary leading-snug">{p.goods_name}</p>
              <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-accent-bg text-accent border border-accent-border">
                D+{p.days_since_launch}
              </span>
            </div>

            {/* 리뷰 속도 */}
            <div className="flex items-center gap-3 text-sm">
              <div className="text-center">
                <p className="text-xl font-bold text-text-primary">{p.total_reviews}</p>
                <p className="text-xs text-text-tertiary">누적 리뷰</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-text-primary">{p.daily_avg}</p>
                <p className="text-xs text-text-tertiary">일 평균</p>
              </div>
              <div className="flex-1" />
            </div>

            {/* 긍/부정 비율 바 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-text-secondary">
                <span>긍정 {p.pos_pct}%</span>
                <span>부정 {p.neg_pct}%</span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden bg-red-100">
                <div
                  className="bg-emerald-400 rounded-l-full transition-all"
                  style={{ width: `${p.pos_pct}%` }}
                />
              </div>
            </div>

            {/* 키워드 */}
            {p.top_keywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.top_keywords.map(k => (
                  <span key={k.word} className="text-xs px-1.5 py-0.5 bg-surface-raised rounded text-text-secondary border border-border-subtle">
                    #{k.word}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
