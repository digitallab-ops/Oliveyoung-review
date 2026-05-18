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
      accentColor: 'rgba(22,163,74,0.15)',
      tooltip: '전체 리뷰의 가중 평균 평점입니다.',
    },
    {
      label: '재구매 의향',
      value: `${stats.repurchase_pct}%`,
      sub: '리뷰 텍스트 내 재구매 언급',
      color: '#2563EB',
      accentColor: 'rgba(37,99,235,0.12)',
      tooltip: "리뷰 텍스트에서 '재구매', '또 살게요' 등의 표현이 포함된 비율입니다. 실제 재구매율과 다를 수 있어요.",
    },
    {
      label: '5점 만족',
      value: `${stats.five_star_pct}%`,
      sub: `${stats.five_star_count.toLocaleString()}개 리뷰`,
      color: '#B8860B',
      accentColor: 'rgba(184,134,11,0.12)',
      tooltip: '별점 5점을 준 리뷰 비율입니다.',
    },
  ]

  return (
    <div className="grid grid-cols-3 gap-3 md:gap-4">
      {items.map(item => (
        <div
          key={item.label}
          className="relative group/kpi bg-surface rounded-xl px-4 py-5 md:px-5 md:py-6
                     border border-border text-center overflow-hidden
                     transition-all duration-200 hover:border-border hover:shadow-card-hover"
          style={{ boxShadow: `0 0 0 1px rgba(0,0,0,0.04), 0 2px 8px ${item.accentColor}` }}
        >
          {/* 상단 컬러 라인 */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: item.color, opacity: 0.35 }} />

          <div className="absolute top-3 right-3">
            <Info size={11} className="text-text-tertiary/40 hover:text-text-tertiary/80 transition-colors cursor-default" />
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

          <p className="text-xs text-text-secondary mb-3">{item.label}</p>
          <p
            className="text-[2rem] md:text-[2.4rem] font-bold leading-none mb-2"
            style={{ color: item.color }}
          >
            {item.value}
          </p>
          <p className="text-xs text-text-secondary/70">{item.sub}</p>
        </div>
      ))}
    </div>
  )
}
