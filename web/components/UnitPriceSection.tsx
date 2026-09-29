'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { UnitPriceGroup } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  groups: UnitPriceGroup[]
}

function shortName(name: string): string {
  return name.replace(/\[.*?\]\s*/g, '').replace(/^셀퓨전씨\s*/, '').trim()
}

function fmtUnitPrice(v: number, unit: string): string {
  return `${v.toLocaleString()}원/${unit}`
}

function PositionBadge({ position, diffPct }: { position: UnitPriceGroup['position']; diffPct: number }) {
  const style =
    position === 'pricier' ? 'bg-red-50 text-red-600 border-red-200'
    : position === 'cheaper' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-muted text-text-secondary border-border'
  const label =
    position === 'pricier' ? `+${diffPct}% 비쌈`
    : position === 'cheaper' ? `${diffPct}% 저렴`
    : '비슷'
  return (
    <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${style}`}>
      {label}
    </span>
  )
}

function GroupCard({ g }: { g: UnitPriceGroup }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-border rounded-lg bg-surface overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-border-subtle/40 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-text-tertiary bg-muted border border-border px-1.5 py-0.5 rounded shrink-0">
              {g.category_name}
            </span>
            <p className="text-sm font-medium text-text-primary truncate">
              {shortName(g.ours.goods_name)}
            </p>
            {/* 비싼데 랭킹 밖이면 가격 저항을 의심할 신호 */}
            {g.ours.rank_position != null ? (
              <span className="shrink-0 text-[10px] font-semibold text-accent">
                {g.ours.rank_position}위
              </span>
            ) : (
              <span className="shrink-0 text-[10px] text-text-tertiary/70">랭킹밖</span>
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-base font-semibold text-accent-fg">
              {fmtUnitPrice(g.ours.unit_price, g.unit)}
            </span>
            <span className="text-xs text-text-tertiary">
              {g.ours.volume_value}{g.unit} · {g.ours.price.toLocaleString()}원
            </span>
            {g.rival_median != null && (
              <span className="text-xs text-text-secondary">
                경쟁 중앙값 {fmtUnitPrice(g.rival_median, g.unit)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <PositionBadge position={g.position} diffPct={g.diff_pct} />
          <ChevronDown
            size={14}
            className={`text-text-tertiary transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-2 border-t border-border space-y-1">
              <p className="text-[10px] text-text-tertiary mb-1.5">
                같은 카테고리 · 용량 {Math.round(g.ours.volume_value * 0.5)}~{Math.round(g.ours.volume_value * 2)}{g.unit} 범위 경쟁사
              </p>
              {g.rivals.map(r => (
                <div key={r.goods_no} className="flex items-baseline gap-2 text-xs py-0.5">
                  <span className="w-20 shrink-0 text-right font-medium text-text-primary">
                    {fmtUnitPrice(r.unit_price, g.unit)}
                  </span>
                  <span className="w-16 shrink-0 text-text-tertiary">
                    {r.volume_value}{g.unit}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-text-secondary">
                    {shortName(r.goods_name)}
                  </span>
                  {r.rank_position != null && (
                    <span className="shrink-0 text-[10px] text-text-tertiary/70">{r.rank_position}위</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function UnitPriceSection({ groups }: Props) {
  if (groups.length === 0) return null

  const pricier = groups.filter(g => g.position === 'pricier')
  // 경쟁사보다 비싼데 랭킹에도 없으면 가격 저항을 가장 먼저 의심해야 한다
  const atRisk = pricier.filter(g => g.ours.rank_position == null)

  return (
    <div>
      <div className="mb-4">
        <SectionDivider tag="가격 경쟁력" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">용량당 단가 비교</h2>
          <span className="text-sm text-text-tertiary">{groups.length}개 제품</span>
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          같은 카테고리에서 용량대가 비슷한 경쟁사와 비교합니다
          {pricier.length > 0 && ` · 경쟁사보다 비싼 제품 ${pricier.length}개`}
        </p>
      </div>

      {atRisk.length > 0 && (
        <div className="mb-3 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <span className="text-amber-600 font-bold text-base shrink-0 leading-none mt-0.5">!</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              비싼데 순위권 밖인 제품 {atRisk.length}개
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {atRisk.slice(0, 3).map(g => shortName(g.ours.goods_name)).join(' · ')}
              {atRisk.length > 3 && ` 외 ${atRisk.length - 3}개`}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {groups.map(g => (
          <GroupCard key={g.ours.goods_no} g={g} />
        ))}
      </div>
    </div>
  )
}
