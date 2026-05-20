import { Info } from 'lucide-react'
import type { Stats } from '@/lib/types'

interface KPIStripProps {
  stats: Stats
}

export default function KPIStrip({ stats }: KPIStripProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 md:gap-4">

      {/* 핵심 지표: 평균 평점 — 2열 차지 */}
      <div
        className="relative group/kpi sm:col-span-2 rounded-xl px-5 py-6 border overflow-hidden
                   transition-all duration-200 hover:shadow-card-hover"
        style={{
          background: 'rgba(22,163,74,0.06)',
          borderColor: 'rgba(22,163,74,0.25)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.04), 0 2px 10px rgba(22,163,74,0.1)',
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: '#16A34A', opacity: 0.5 }} />
        <InfoTooltip text="전체 리뷰의 가중 평균 평점입니다." />
        <p className="text-xs text-text-secondary mb-2 font-medium">평균 평점</p>
        <p className="text-[3rem] md:text-[3.4rem] font-bold leading-none mb-2" style={{ color: '#16A34A' }}>
          {stats.avg_score.toFixed(1)}
        </p>
        <p className="text-xs text-text-secondary/70">총 {stats.total_reviews.toLocaleString()}개 리뷰</p>
      </div>

      {/* 재구매 의향 */}
      <KPICard
        label="재구매 의향"
        value={`${stats.repurchase_pct}%`}
        sub={`${stats.repurchase_count.toLocaleString()}건 언급`}
        color="#2563EB"
        accentColor="rgba(37,99,235,0.12)"
        tooltip="리뷰 텍스트에서 '재구매', '또 살게요' 등의 표현이 포함된 비율입니다. 실제 재구매율과 다릅니다."
      />

      {/* 5점 만족 */}
      <KPICard
        label="5점 만족"
        value={`${stats.five_star_pct}%`}
        sub={`${stats.five_star_count.toLocaleString()}개 리뷰`}
        color="#B8860B"
        accentColor="rgba(184,134,11,0.12)"
        tooltip="별점 5점을 준 리뷰 비율입니다."
      />
    </div>
  )
}

function KPICard({
  label, value, sub, color, accentColor, tooltip,
}: {
  label: string; value: string; sub: string
  color: string; accentColor: string; tooltip: string
}) {
  return (
    <div
      className="relative group/kpi bg-surface rounded-xl px-4 py-5 md:px-5 md:py-6
                 border border-border text-center overflow-hidden
                 transition-all duration-200 hover:shadow-card-hover"
      style={{ boxShadow: `0 0 0 1px rgba(0,0,0,0.04), 0 2px 8px ${accentColor}` }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color, opacity: 0.35 }} />
      <InfoTooltip text={tooltip} />
      <p className="text-xs text-text-secondary mb-3">{label}</p>
      <p className="text-[2rem] md:text-[2.4rem] font-bold leading-none mb-2" style={{ color }}>
        {value}
      </p>
      <p className="text-xs text-text-secondary/70">{sub}</p>
    </div>
  )
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="absolute top-3 right-3">
      <Info size={11} className="text-text-tertiary/40 hover:text-text-tertiary/80 transition-colors cursor-default" />
      <div
        className="absolute bottom-full right-0 mb-2 w-52 px-2.5 py-1.5
                   rounded-md bg-gray-900 text-white text-xs leading-relaxed
                   opacity-0 group-hover/kpi:opacity-100 pointer-events-none
                   transition-opacity duration-150 z-20 shadow-lg text-left"
      >
        {text}
        <span className="absolute top-full right-2 border-4 border-transparent border-t-gray-900" />
      </div>
    </div>
  )
}
