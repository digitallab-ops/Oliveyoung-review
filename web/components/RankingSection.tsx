'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, LabelList,
} from 'recharts'
import type { ProductRankingData } from '@/lib/types'
import { extractShortName } from '@/lib/utils'
import SectionDivider from '@/components/SectionDivider'

type Mode = 'best' | 'avg' | 'weekly'

interface Props {
  dataByMode: {
    best: ProductRankingData[]
    avg: ProductRankingData[]
    weekly: ProductRankingData[]
  }
  lastCollected: Record<string, string>
}

const MODE_LABELS: { id: Mode; label: string }[] = [
  { id: 'best',   label: '일자별 최고' },
  { id: 'avg',    label: '일평균' },
  { id: 'weekly', label: '주간' },
]

const COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
  '#0891B2', '#EA580C', '#16A34A', '#9333EA', '#CA8A04',
  '#DB2777', '#65A30D', '#0D9488', '#7C3AED', '#B45309', '#6366F1',
]

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl space-y-1 min-w-[140px]">
      <p className="text-gray-400 font-medium border-b border-gray-700 pb-1 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="flex-1 truncate">{p.name}</span>
          <strong>{p.value}위</strong>
        </p>
      ))}
    </div>
  )
}

function RankLabel({ x, y, value, color }: any) {
  if (value == null) return null
  return (
    <text x={x} y={y - 7} textAnchor="middle" fontSize={10} fontWeight="600" fill={color}>
      {value}위
    </text>
  )
}

function ProductCheckDropdown<T extends string>({
  items, selected, onChange, labelFn, colorFn,
}: {
  items: { id: T; label: string }[]
  selected: Set<T>
  onChange: (s: Set<T>) => void
  labelFn?: (label: string) => string
  colorFn?: (idx: number) => string
}) {
  const [open, setOpen] = useState(false)
  const label = labelFn ?? (x => x)
  const color = colorFn ?? ((i: number) => COLORS[i % COLORS.length])

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface
                   text-xs text-text-secondary hover:border-accent hover:text-accent transition-colors"
      >
        <span>{selected.size}/{items.length} 선택</span>
        <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-30 bg-surface border border-border rounded-lg
                          shadow-lg w-56 max-h-64 overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-surface">
              <span className="text-[11px] text-text-tertiary font-medium">상품 선택</span>
              <div className="flex gap-2.5">
                <button
                  onClick={() => onChange(new Set(items.map(i => i.id)))}
                  className="text-[11px] text-accent hover:underline"
                >전체</button>
                <button
                  onClick={() => onChange(new Set())}
                  className="text-[11px] text-text-tertiary hover:underline"
                >해제</button>
              </div>
            </div>
            {items.map((item, i) => (
              <label key={item.id}
                     className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => {
                    const next = new Set(selected)
                    if (next.has(item.id)) next.delete(item.id)
                    else next.add(item.id)
                    onChange(next)
                  }}
                  className="w-3.5 h-3.5 rounded"
                  style={{ accentColor: color(i) }}
                />
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color(i) }} />
                <span className="text-xs text-text-primary truncate">{label(item.label)}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function CategoryChart({ items }: { items: ProductRankingData[] }) {
  // 안정적 색상: 전체 items 배열 기준 인덱스로 고정 (선택/해제해도 색 안 밀림)
  const colorOf = (goods_no: string) => {
    const idx = items.findIndex(i => i.goods_no === goods_no)
    return COLORS[idx % COLORS.length]
  }

  // 평균 순위 기준 정렬 (낮을수록 좋음) → 상단에 자주 있는 상품 기본 선택
  const defaultSelected = [...items]
    .filter(i => i.history.length > 0)
    .sort((a, b) => {
      const avg = (h: { rank: number }[]) => h.reduce((s, r) => s + r.rank, 0) / h.length
      return avg(a.history) - avg(b.history)
    })
    .slice(0, 5)
    .map(i => i.goods_no)

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultSelected)
  )

  const filteredItems = items.filter(i => selected.has(i.goods_no))
  const allDates = [...new Set(filteredItems.flatMap(d => d.history.map(h => h.date)))].sort()

  const chartData = allDates.map(date => {
    const point: Record<string, any> = { date: date.slice(5) }
    for (const item of filteredItems) {
      const h = item.history.find(h => h.date === date)
      if (h) point[item.goods_no] = h.rank
    }
    return point
  })

  const currentRanks = filteredItems.map(item => ({
    ...item,
    current: item.history.at(-1)?.rank ?? null,
    prev:    item.history.at(-2)?.rank ?? null,
  }))

  const dropItems = items.map(i => ({ id: i.goods_no, label: i.goods_name }))

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2 flex-1">
          {currentRanks.map((item) => {
            const color = colorOf(item.goods_no)
            const delta = item.prev != null && item.current != null ? item.prev - item.current : null
            return (
              <div key={item.goods_no}
                   className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs text-text-primary font-medium">{extractShortName(item.goods_name)}</span>
                <span className="text-base font-bold" style={{ color }}>
                  {item.current != null ? `${item.current}위` : '-'}
                </span>
                {delta !== null && delta !== 0 && (
                  <span className={`text-xs font-semibold ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <ProductCheckDropdown
          items={dropItems}
          selected={selected}
          onChange={setSelected}
          labelFn={extractShortName}
          colorFn={(i) => colorOf(dropItems[i].id)}
        />
      </div>

      {allDates.length >= 2 ? (
        <ResponsiveContainer width="100%" height={filteredItems.length > 3 ? 220 : 180}>
          <LineChart data={chartData} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#57534E', fontWeight: 500 }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              reversed
              domain={['dataMin - 5', 'dataMax + 5']}
              tick={{ fontSize: 10, fill: '#78716C' }}
              axisLine={false} tickLine={false}
              width={32}
              tickFormatter={(v) => `${v}위`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(0,0,0,0.06)', strokeWidth: 1 }} />
            {filteredItems.map((item) => {
              const color = colorOf(item.goods_no)
              return (
                <Line
                  key={item.goods_no}
                  dataKey={item.goods_no}
                  name={extractShortName(item.goods_name)}
                  stroke={color}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: color, strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: color, strokeWidth: 2, stroke: '#fff' }}
                  connectNulls={false}
                >
                  <LabelList dataKey={item.goods_no} content={(props: any) => <RankLabel {...props} color={color} />} />
                </Line>
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-xs text-text-tertiary py-4 text-center">
          {selected.size === 0 ? '상품을 선택하세요' : '내일부터 추이 그래프가 표시됩니다'}
        </p>
      )}
    </div>
  )
}

export default function RankingSection({ dataByMode, lastCollected }: Props) {
  const [mode, setMode] = useState<Mode>('best')

  const data = dataByMode[mode]
  const hasAny = Object.values(dataByMode).some(d => d.length > 0)
  if (!hasAny) return null

  const byCategory = new Map<string, ProductRankingData[]>()
  for (const item of data) {
    if (!byCategory.has(item.category_name)) byCategory.set(item.category_name, [])
    byCategory.get(item.category_name)!.push(item)
  }

  return (
    <div className="space-y-6">
      <div>
        <SectionDivider tag="자사 순위" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-text-primary">올리브영 카테고리 순위</h2>
            <span className="text-sm text-text-tertiary">Top 100 기준</span>
          </div>
          <div className="flex gap-0.5 p-0.5 bg-muted rounded-lg border border-border">
            {MODE_LABELS.map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  mode === m.id
                    ? 'bg-background text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {Array.from(byCategory.entries()).map(([cat, items]) => (
          <div key={cat} className="border border-border rounded-lg bg-surface p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-text-primary">{cat}</p>
              {lastCollected[cat] && (
                <p className="text-xs text-text-tertiary">수집 {lastCollected[cat]}</p>
              )}
            </div>
            <CategoryChart items={items} />
          </div>
        ))}
        {data.length === 0 && (
          <p className="text-sm text-text-tertiary text-center py-6">해당 기간 데이터가 없습니다</p>
        )}
      </div>
    </div>
  )
}
