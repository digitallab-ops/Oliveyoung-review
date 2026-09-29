'use client'

import { useState, useMemo } from 'react'
import type { PriceChangeEntry } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  changes: PriceChangeEntry[]
}

function shortName(name: string): string {
  return name.replace(/\[.*?\]\s*/g, '').trim()
}

function ChangeRow({ c }: { c: PriceChangeEntry }) {
  const dropped = c.change_pct < 0
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-md border ${
        c.is_ours ? 'bg-accent-bg border-accent-border' : 'bg-surface border-border'
      }`}
    >
      <span
        className={`shrink-0 w-16 text-right text-sm font-semibold ${
          dropped ? 'text-red-500' : 'text-emerald-600'
        }`}
      >
        {dropped ? '▼' : '▲'}{Math.abs(c.change_pct)}%
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {c.is_ours && (
            <span className="shrink-0 text-[10px] font-semibold bg-accent text-white px-1.5 py-0.5 rounded">
              자사
            </span>
          )}
          <p className="text-xs text-text-primary truncate">{shortName(c.goods_name)}</p>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-tertiary">
          <span>
            {c.price_before.toLocaleString()}원 → <span className="text-text-secondary font-medium">{c.price_after.toLocaleString()}원</span>
          </span>
          {c.category_name && <span>· {c.category_name}</span>}
          {c.rank_position != null && <span>· {c.rank_position}위</span>}
        </div>
      </div>

      <span className="shrink-0 text-[10px] text-text-tertiary/70">{c.changed_on.slice(5)}</span>
    </div>
  )
}

export default function PriceChangeSection({ changes }: Props) {
  const [showAll, setShowAll] = useState(false)

  const { drops, hikes } = useMemo(() => ({
    drops: changes.filter(c => c.change_pct < 0),
    hikes: changes.filter(c => c.change_pct > 0),
  }), [changes])

  if (changes.length === 0) return null

  const shown = showAll ? changes : changes.slice(0, 8)

  return (
    <div>
      <div className="mb-4">
        <SectionDivider tag="가격 변동" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">최근 가격 변동</h2>
          <span className="text-sm text-text-tertiary">14일 · 5% 이상</span>
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          인하 {drops.length}건 · 인상 {hikes.length}건 — 경쟁사 인하는 프로모션 대응 타이밍 신호입니다
        </p>
      </div>

      <div className="space-y-1.5">
        {shown.map(c => (
          <ChangeRow key={`${c.goods_no}-${c.changed_on}`} c={c} />
        ))}
        {changes.length > 8 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="w-full text-xs text-text-tertiary hover:text-text-secondary py-2 border-t border-border-subtle mt-1"
          >
            {showAll ? '접기 ▲' : `${changes.length - 8}개 더 보기 ▼`}
          </button>
        )}
      </div>
    </div>
  )
}
