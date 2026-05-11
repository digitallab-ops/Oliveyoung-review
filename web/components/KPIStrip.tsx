import { Info } from 'lucide-react'
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
      tooltip: '전체 리뷰의 가중 평균 평점입니다.',
    },
    {
      label: '재구매 의향',
      value: `${stats.repurchase_pct}%`,
      sub: '리뷰 텍스트 내 재구매 언급 비율',
      color: '#2563EB',
      tooltip: "리뷰 텍스트에서 '재구매', '또 살게요' 등의 표현이 포함된 비율입니다. 실제 재구매율과 다를 수 있어요.",
    },
    {
      label: '5점 만족',
      value: `${stats.five_star_pct}%`,
      sub: `${stats.five_star_count.toLocaleString()}개 리뷰`,
      color: '#C9956C',
      tooltip: '별점 5점을 준 리뷰 비율입니다.',
    },
  ]

  return (
    <div className="grid grid-cols-3 gap-3 md:gap-4">
      {items.map(item => (
        <div
          key={item.label}
          className="relative group/kpi bg-surface rounded-lg md:rounded-xl px-4 py-4 md:px-5 md:py-5
                     border border-border shadow-kpi text-center"
        >
          <div className="absolute top-2.5 right-2.5">
            <Info size={12} className="text-text-tertiary/60 hover:text-text-tertiary transition-colors cursor-default" />
            <div
              className="absolute bottom-full right-0 mb-2 w-52 px-2.5 py-1.5
                         rounded-md bg-gray-900 text-white text-xs leading-relaxed
                         opacity-0 group-hover/kpi:opacity-100 pointer-events-none
                         transition-opacity duration-150 z-20 shadow-lg text-left"
            >
              {item.tooltip}
              <span className="absolute top-full right-2 border-4 border-transparent border-t-gray-900" />
            </div>
          </div>

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
