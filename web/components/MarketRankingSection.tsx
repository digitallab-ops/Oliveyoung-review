'use client'

import type { MarketCategoryData, MarketRankingEntry } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'
import { useState } from 'react'

interface Props {
  data: MarketCategoryData[]
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="w-8" />
  if (delta === 0) return <span className="text-xs text-text-tertiary w-8 text-right">-</span>
  const up = delta > 0
  return (
    <span className={`text-xs font-semibold w-8 text-right ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? `▲${delta}` : `▼${Math.abs(delta)}`}
    </span>
  )
}

function RankEntry({ entry, index }: { entry: MarketRankingEntry; index: number }) {
  const isTop3 = entry.rank_position <= 3
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm
        ${entry.is_ours
          ? 'bg-accent-bg border border-accent-border'
          : 'hover:bg-surface-hover'
        }`}
    >
      {/* 순위 */}
      <span
        className={`font-serif text-base w-7 shrink-0 text-right leading-none
          ${isTop3 ? 'text-accent font-semibold' : 'text-text-tertiary font-normal'}`}
      >
        {entry.rank_position}
      </span>

      {/* 상품명 */}
      <span
        className={`flex-1 truncate text-xs leading-tight
          ${entry.is_ours ? 'text-accent-fg font-medium' : 'text-text-primary'}`}
        title={entry.goods_name}
      >
        {entry.is_ours && (
          <span className="inline-block mr-1 text-accent text-[10px]">★</span>
        )}
        {entry.goods_name || entry.goods_no}
      </span>

      {/* 델타 */}
      <DeltaBadge delta={entry.delta} />
    </div>
  )
}

function CategoryPanel({ cat }: { cat: MarketCategoryData }) {
  const [showAll, setShowAll] = useState(false)

  const hasDeltas = cat.entries.some(e => e.delta != null)
  const risers = hasDeltas
    ? [...cat.entries]
        .filter(e => e.delta != null && e.delta > 0)
        .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
        .slice(0, 5)
    : []

  const newEntries = hasDeltas
    ? cat.entries.filter(e => e.delta == null).slice(0, 3)
    : []

  const displayEntries = showAll ? cat.entries : cat.entries.slice(0, 20)

  return (
    <div className="border border-border rounded-lg bg-surface p-4 md:p-5 space-y-4">
      <p className="font-label text-[10px] tracking-[0.14em] uppercase text-accent/70">
        {cat.category_name}
      </p>

      {/* 급상승 섹션 */}
      {(risers.length > 0 || newEntries.length > 0) && (
        <div className="space-y-1.5">
          <p className="font-label text-[9px] tracking-[0.12em] uppercase text-text-tertiary/60">
            Risers
          </p>
          <div className="space-y-0.5">
            {risers.map(entry => (
              <RankEntry key={entry.goods_no + entry.rank_position} entry={entry} index={0} />
            ))}
            {newEntries.map(entry => (
              <div key={entry.goods_no} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-surface-hover">
                <span className="font-serif text-base w-7 shrink-0 text-right text-text-tertiary">{entry.rank_position}</span>
                <span className="flex-1 truncate text-xs text-text-primary">{entry.goods_name || entry.goods_no}</span>
                <span className="text-[10px] text-emerald-600 font-semibold w-8 text-right">NEW</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TOP 순위 리스트 */}
      <div className="space-y-1.5">
        <p className="font-label text-[9px] tracking-[0.12em] uppercase text-text-tertiary/60">
          Top {showAll ? cat.entries.length : Math.min(20, cat.entries.length)}
        </p>
        <div className="space-y-0.5">
          {displayEntries.map((entry, i) => (
            <RankEntry key={entry.goods_no + entry.rank_position} entry={entry} index={i} />
          ))}
        </div>
        {cat.entries.length > 20 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="w-full text-xs text-text-tertiary hover:text-text-secondary py-1.5 border-t border-border-subtle mt-1"
          >
            {showAll ? '접기 ▲' : `${cat.entries.length - 20}개 더 보기 ▼`}
          </button>
        )}
      </div>
    </div>
  )
}

export default function MarketRankingSection({ data }: Props) {
  if (data.length === 0) return null

  return (
    <div className="space-y-6">
      <div>
        <SectionDivider tag="Market Pulse" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">올리브영 시장 전체 순위</h2>
          <span className="text-sm text-text-tertiary">카테고리 Top 100</span>
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          ★ 셀퓨전씨 상품 강조 · ▲▼ 전일 대비 순위 변동
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.map(cat => (
          <CategoryPanel key={cat.category_name} cat={cat} />
        ))}
      </div>
    </div>
  )
}
