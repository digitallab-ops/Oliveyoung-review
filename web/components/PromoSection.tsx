'use client'

import { useState } from 'react'
import type { PromoStatusData } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  data: PromoStatusData[]
}

const PROMO_LABELS: Record<string, string> = {
  olivepick:     '올영픽',
  today_deal:    '오늘의 특가',
  daily_special: '하루특가',
}

const DEFAULT_SHOW = 10

export default function PromoSection({ data }: Props) {
  if (data.length === 0) return null

  return (
    <section>
      <SectionDivider tag="프로모션" />
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-xl font-semibold text-text-primary">프로모션 입점 현황</h2>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {data.map(d => (
          <PromoCard key={d.promo_type} data={d} />
        ))}
      </div>
    </section>
  )
}

function PromoCard({ data: d }: { data: PromoStatusData }) {
  const [expanded, setExpanded] = useState(false)
  const label = PROMO_LABELS[d.promo_type] ?? d.promo_type
  const hasOurs = d.our_items.length > 0
  const visibleItems = expanded ? d.top_items : d.top_items.slice(0, DEFAULT_SHOW)

  return (
    <div className={`rounded-lg border overflow-hidden ${
      hasOurs ? 'bg-emerald-50 border-emerald-200' : 'bg-surface border-border'
    }`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{label}</span>
          <span className="text-xs text-text-tertiary">{d.total_count}개</span>
        </div>
        {hasOurs ? (
          <span className="text-xs font-semibold text-emerald-600 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
            입점 ✓
          </span>
        ) : (
          <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-full">
            미입점
          </span>
        )}
      </div>

      {/* 상품 목록 */}
      <ul className="divide-y divide-black/5">
        {visibleItems.map(item => (
          <li
            key={item.goods_no}
            className={`flex items-start gap-2 px-4 py-2 ${
              item.is_ours ? 'bg-emerald-100/60' : ''
            }`}
          >
            <span className={`text-xs leading-snug flex-1 ${
              item.is_ours ? 'font-semibold text-emerald-800' : 'text-text-secondary'
            }`}>
              {item.goods_name}
            </span>
            {item.is_ours && (
              <span className="text-[10px] font-semibold text-emerald-600 shrink-0 mt-0.5">자사</span>
            )}
          </li>
        ))}
      </ul>

      {/* 더 보기 / 접기 */}
      {d.top_items.length > DEFAULT_SHOW && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full px-4 py-2 text-xs text-text-tertiary hover:text-text-secondary transition-colors text-right border-t border-black/5"
        >
          {expanded ? '접기 ∧' : `${d.top_items.length - DEFAULT_SHOW}개 더 보기 ∨`}
        </button>
      )}
      {d.top_items.length === 0 && (
        <p className="px-4 py-3 text-xs text-text-tertiary">상품 정보 없음</p>
      )}
    </div>
  )
}
