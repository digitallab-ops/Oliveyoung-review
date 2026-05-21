'use client'

import { useState, useEffect, useMemo } from 'react'
import type { TodayDealItem, TodayDealHistoryResponse } from '@/lib/types'
import SectionDivider from './SectionDivider'
import { extractShortName } from '@/lib/utils'

function toDateStr(d: Date) {
  return d.toLocaleDateString('sv-SE')
}

function defaultFrom() {
  const d = new Date()
  d.setDate(1)
  return toDateStr(d)
}

function defaultTo() {
  return toDateStr(new Date())
}

export default function TodayDealTab() {
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo]     = useState(defaultTo)
  const [search, setSearch] = useState('')
  const [data, setData] = useState<TodayDealHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [openDates, setOpenDates] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    fetch(`/api/promo-history?type=today_deal&from=${from}&to=${to}`)
      .then(r => r.json())
      .then((d: TodayDealHistoryResponse) => {
        setData(d)
        // Auto-open the 3 most recent dates
        const dates = [...new Set(d.items.map(i => i.collected_at))].sort().reverse().slice(0, 3)
        setOpenDates(new Set(dates))
      })
      .catch(() => setData({ items: [], total: 0 }))
      .finally(() => setLoading(false))
  }, [from, to])

  const filteredItems = useMemo(() => {
    if (!data) return []
    if (!search.trim()) return data.items
    const q = search.trim().toLowerCase()
    return data.items.filter(i => i.goods_name.toLowerCase().includes(q))
  }, [data, search])

  const freqTable = useMemo(() => {
    if (!data) return []
    const map = new Map<string, { goods_name: string; count: number; is_ours: boolean }>()
    for (const item of data.items) {
      if (!map.has(item.goods_no)) {
        map.set(item.goods_no, { goods_name: item.goods_name, count: 0, is_ours: item.is_ours })
      }
      map.get(item.goods_no)!.count++
    }
    return Array.from(map.entries())
      .map(([goods_no, v]) => ({ goods_no, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)
  }, [data])

  const groupedByDate = useMemo(() => {
    const map = new Map<string, TodayDealItem[]>()
    for (const item of filteredItems) {
      if (!map.has(item.collected_at)) map.set(item.collected_at, [])
      map.get(item.collected_at)!.push(item)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filteredItems])

  function toggleDate(date: string) {
    setOpenDates(prev => {
      const next = new Set(prev)
      next.has(date) ? next.delete(date) : next.add(date)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <SectionDivider tag="오특" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">오늘의 특가 이력</h2>
          <span className="text-sm text-text-tertiary">날짜별 입점 현황 및 패턴</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">시작일</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="text-sm border border-border rounded px-2 py-1.5 bg-surface text-text-primary focus:outline-none focus:border-accent" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">종료일</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="text-sm border border-border rounded px-2 py-1.5 bg-surface text-text-primary focus:outline-none focus:border-accent" />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">상품명 검색</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="상품명으로 검색..."
            className="text-sm border border-border rounded px-2 py-1.5 bg-surface text-text-primary focus:outline-none focus:border-accent" />
        </div>
        {data && (
          <span className="text-xs text-text-tertiary pb-1.5">
            {filteredItems.length}건 / 총 {data.total}건
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-10 rounded bg-border/40 animate-shimmer" />)}
        </div>
      )}

      {!loading && data && (
        <div className="grid md:grid-cols-[280px_1fr] gap-6">

          {/* Frequency table */}
          <div className="border border-border rounded-lg bg-surface p-4">
            <p className="text-xs font-semibold text-text-primary mb-3">
              자주 등장한 상품 <span className="text-text-tertiary font-normal">(상위 15개)</span>
            </p>
            {freqTable.length === 0 ? (
              <p className="text-xs text-text-tertiary">데이터 없음</p>
            ) : (
              <ul className="space-y-1">
                {freqTable.map((f, i) => (
                  <li key={f.goods_no} className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${
                    f.is_ours ? 'bg-emerald-50 text-emerald-800' : 'text-text-secondary'
                  }`}>
                    <span className="w-4 text-right shrink-0 text-text-tertiary font-mono">{i + 1}</span>
                    <span className="flex-1 truncate">{extractShortName(f.goods_name)}</span>
                    <span className="shrink-0 font-semibold">{f.count}일</span>
                    {f.is_ours && <span className="shrink-0 text-[10px] font-semibold text-emerald-600">자사</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Date grouped list */}
          <div className="space-y-2">
            {groupedByDate.length === 0 && (
              <div className="border border-dashed border-border rounded-lg px-6 py-10 text-center">
                <p className="text-sm text-text-secondary">해당 기간에 데이터가 없습니다</p>
              </div>
            )}
            {groupedByDate.map(([date, items]) => (
              <div key={date} className="border border-border rounded-lg bg-surface overflow-hidden">
                <button
                  onClick={() => toggleDate(date)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-background transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-text-primary">{date}</span>
                    <span className="text-xs text-text-tertiary">{items.length}개</span>
                    {items.some(i => i.is_ours) && (
                      <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        자사 {items.filter(i => i.is_ours).length}개
                      </span>
                    )}
                  </div>
                  <span className="text-text-tertiary text-xs">{openDates.has(date) ? '▲' : '▼'}</span>
                </button>

                {openDates.has(date) && (
                  <ul className="border-t border-border divide-y divide-border/50 max-h-72 overflow-y-auto">
                    {items.map((item, idx) => (
                      <li key={item.id} className={`flex items-center gap-2 px-4 py-1.5 text-xs ${
                        item.is_ours ? 'bg-emerald-50 text-emerald-800' : 'text-text-secondary'
                      }`}>
                        <span className="w-6 text-right shrink-0 text-text-tertiary font-mono">
                          {item.rank_position ?? idx + 1}
                        </span>
                        <span className="flex-1 truncate" title={item.goods_name}>{item.goods_name}</span>
                        {item.is_ours && <span className="shrink-0 text-[10px] font-semibold text-emerald-600">자사</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

        </div>
      )}
    </div>
  )
}
