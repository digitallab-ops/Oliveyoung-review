import type { Stats } from '@/lib/types'

interface KPIStripProps {
  stats: Stats
}

export default function KPIStrip({ stats }: KPIStripProps) {
  const items = [
    {
      label: '평균 평점',
      value: stats.avg_score.toFixed(1),
      sub: `총 ${stats.total_reviews.toLocaleString()}개 리뷰`,
      color: '#16A34A',
    },
    {
      label: '재구매 의향',
      value: `${stats.repurchase_pct}%`,
      sub: `${stats.repurchase_count.toLocaleString()}명 표현`,
      color: '#2563EB',
    },
    {
      label: '5점 만족',
      value: `${stats.five_star_pct}%`,
      sub: `${stats.five_star_count.toLocaleString()}개 리뷰`,
      color: '#C9956C',
    },
  ]

  return (
    <div className="grid grid-cols-3 gap-3 md:gap-4">
      {items.map(item => (
        <div
          key={item.label}
          className="bg-surface rounded-lg md:rounded-xl px-4 py-4 md:px-5 md:py-5
                     border border-border shadow-kpi text-center"
        >
          <p className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
            {item.label}
          </p>
          <p
            className="text-3xl md:text-4xl font-bold tracking-tight leading-none mb-1.5"
            style={{ color: item.color }}
          >
            {item.value}
          </p>
          <p className="text-xs text-text-tertiary">{item.sub}</p>
        </div>
      ))}
    </div>
  )
}
