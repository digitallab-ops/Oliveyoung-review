'use client'

import type { MarketCategoryData, MarketRankingEntry } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'
import { useState, useMemo } from 'react'

interface Props {
  data: MarketCategoryData[]
  aiInsight?: string
}

function generateInsights(data: MarketCategoryData[]): string[] {
  const messages: string[] = []

  const risers = data
    .flatMap(cat => cat.entries
      .filter(e => e.delta != null && e.delta >= 5)
      .map(e => ({ ...e, category: cat.category_name }))
    )
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    .slice(0, 3)

  for (const r of risers) {
    messages.push(`${r.category} · ${r.goods_name || r.goods_no} +${r.delta}위 급상승 (현재 ${r.rank_position}위)`)
  }

  const newTop10 = data.flatMap(cat =>
    cat.entries
      .filter(e => e.prev_rank == null && e.rank_position <= 10)
      .map(e => ({ ...e, category: cat.category_name }))
  )
  if (newTop10.length > 0) {
    messages.push(`신규 TOP 10 진입 ${newTop10.length}개 상품 감지`)
  }

  const ours = data.flatMap(cat =>
    cat.entries.filter(e => e.is_ours).map(e => ({ ...e, category: cat.category_name }))
  )
  for (const e of ours) {
    const d = e.delta != null && e.delta !== 0
      ? (e.delta > 0 ? ` ▲${e.delta}` : ` ▼${Math.abs(e.delta)}`)
      : ''
    messages.push(`셀퓨전씨 ${e.category} ${e.rank_position}위${d}`)
  }

  return messages.length > 0 ? messages : ['오늘 랭킹 데이터가 수집되었습니다']
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="w-9 shrink-0" />
  if (delta === 0) return <span className="text-[11px] text-text-tertiary w-9 shrink-0 text-right">-</span>
  const up = delta > 0
  return (
    <span className={`text-[11px] font-semibold w-9 shrink-0 text-right ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? `▲${delta}` : `▼${Math.abs(delta)}`}
    </span>
  )
}

function RankEntry({ entry }: { entry: MarketRankingEntry }) {
  const isTop3 = entry.rank_position <= 3
  return (
    <div
      className={`flex items-start gap-2 px-3 py-1.5 rounded-md
        ${entry.is_ours
          ? 'bg-accent-bg border border-accent-border'
          : 'hover:bg-gray-50'
        }`}
    >
      <span
        className={`text-sm w-7 shrink-0 text-right leading-tight mt-0.5
          ${isTop3 ? 'text-accent font-semibold' : 'text-text-secondary font-normal'}`}
      >
        {entry.rank_position}
      </span>

      <span
        className={`flex-1 min-w-0 text-xs leading-snug break-keep
          ${entry.is_ours ? 'text-accent-fg font-medium' : 'text-text-primary'}`}
      >
        {entry.is_ours && <span className="text-accent mr-1">★</span>}
        {entry.goods_name || entry.goods_no}
      </span>

      <DeltaBadge delta={entry.delta} />
    </div>
  )
}

function CategoryPanel({ cat }: { cat: MarketCategoryData }) {
  const [showAll, setShowAll] = useState(false)

  const hasDeltas = cat.entries.some(e => e.delta != null)

  const risers = hasDeltas
    ? [...cat.entries]
        .filter(e => e.delta != null && e.delta >= 3)
        .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
        .slice(0, 5)
    : []

  const newTop20 = hasDeltas
    ? cat.entries.filter(e => e.prev_rank == null && e.rank_position <= 20).slice(0, 3)
    : []

  const displayEntries = showAll ? cat.entries : cat.entries.slice(0, 10)

  return (
    <div className="border border-border rounded-lg bg-surface p-4 space-y-4">
      <p className="text-sm font-semibold text-text-primary">
        {cat.category_name}
      </p>

      {(risers.length > 0 || newTop20.length > 0) && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-text-secondary mb-1">
            급상승
          </p>
          {risers.map(entry => (
            <RankEntry key={`r-${entry.goods_no}`} entry={entry} />
          ))}
          {newTop20.map(entry => (
            <div key={`n-${entry.goods_no}`} className="flex items-start gap-2 px-3 py-1.5 rounded-md hover:bg-gray-50">
              <span className="text-sm w-7 shrink-0 text-right text-text-tertiary leading-tight mt-0.5">
                {entry.rank_position}
              </span>
              <span className="flex-1 min-w-0 text-xs leading-snug break-keep text-text-primary">
                {entry.goods_name || entry.goods_no}
              </span>
              <span className="text-[11px] text-emerald-600 font-semibold w-9 shrink-0 text-right">NEW</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-0.5">
        <p className="text-[11px] font-medium text-text-secondary mb-1">
          Top {showAll ? cat.entries.length : Math.min(10, cat.entries.length)}
        </p>
        {displayEntries.map(entry => (
          <RankEntry key={entry.goods_no} entry={entry} />
        ))}
        {cat.entries.length > 10 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="w-full text-xs text-text-tertiary hover:text-text-secondary py-2 border-t border-border-subtle mt-1"
          >
            {showAll ? '접기 ▲' : `${cat.entries.length - 10}개 더 보기 ▼`}
          </button>
        )}
      </div>
    </div>
  )
}

export default function MarketRankingSection({ data, aiInsight }: Props) {
  const [showOursOnly, setShowOursOnly] = useState(false)

  const displayData = useMemo(() => {
    if (!showOursOnly) return data
    return data
      .map(cat => ({ ...cat, entries: cat.entries.filter(e => e.is_ours) }))
      .filter(cat => cat.entries.length > 0)
  }, [data, showOursOnly])

  if (data.length === 0) return null

  const fallbackInsights = generateInsights(data)

  return (
    <div className="space-y-6">
      <div>
        <SectionDivider tag="시장 랭킹" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">올리브영 시장 전체 순위</h2>
          <span className="text-sm text-text-tertiary">카테고리 Top 100</span>
          <button
            onClick={() => setShowOursOnly(v => !v)}
            className={`ml-auto text-xs font-semibold px-3 py-1.5 rounded border transition-colors ${
              showOursOnly
                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                : 'bg-surface border-border text-text-secondary hover:border-accent hover:text-accent'
            }`}
          >
            자사만 보기
          </button>
        </div>
      </div>

      {/* 오늘의 시장 현황 배너 */}
      <div className="bg-accent-bg border border-accent-border rounded-lg px-4 py-3.5">
        <p className="text-xs font-semibold text-accent mb-2.5">
          오늘의 시장 현황
        </p>
        {aiInsight ? (
          <ul className="space-y-1.5">
            {aiInsight
              .split('\n')
              .map(l => l.replace(/^\[.*?\]\s*/, '').replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/^[\s\-·•*\d.]+/, '').trim())
              .filter(l => l.length > 10)
              .map((msg, i) => (
                <li key={i} className="text-sm text-accent-fg flex items-start gap-1.5">
                  <span className="text-accent shrink-0 mt-0.5 font-bold">·</span>
                  <span className="leading-snug">{msg}</span>
                </li>
              ))
            }
          </ul>
        ) : (
          <ul className="space-y-1">
            {fallbackInsights.map((msg, i) => (
              <li key={i} className="text-sm text-accent-fg flex items-start gap-1.5">
                <span className="text-accent shrink-0 mt-0.5">·</span>
                <span>{msg}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 카테고리별 3열 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {displayData.map(cat => (
          <CategoryPanel key={cat.category_name} cat={cat} />
        ))}
      </div>
    </div>
  )
}
