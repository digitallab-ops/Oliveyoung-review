'use client'

import { useState } from 'react'
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

const COLORS = ['#2563EB', '#16A34A', '#DC2626', '#9333EA', '#EA580C', '#0891B2', '#CA8A04']

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

function CategoryChart({ items }: { items: ProductRankingData[] }) {
  const allDates = [...new Set(items.flatMap(d => d.history.map(h => h.date)))].sort()

  const chartData = allDates.map(date => {
    const point: Record<string, any> = { date: date.slice(5) }
    for (const item of items) {
      const h = item.history.find(h => h.date === date)
      if (h) point[item.goods_no] = h.rank
    }
    return point
  })

  const currentRanks = items.map(item => ({
    ...item,
    current: item.history.at(-1)?.rank ?? null,
    prev:    item.history.at(-2)?.rank ?? null,
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {currentRanks.map((item, i) => {
          const color = COLORS[i % COLORS.length]
          const delta = item.prev != null && item.current != null ? item.prev - item.current : null
          return (
            <div key={item.goods_no}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface"
            >
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

      {allDates.length >= 2 && (
        <ResponsiveContainer width="100%" height={items.length > 3 ? 220 : 180}>
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
            {items.map((item, i) => {
              const color = COLORS[i % COLORS.length]
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
                  <LabelList dataKey={item.goods_no} content={(props) => <RankLabel {...props} color={color} />} />
                </Line>
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      )}

      {allDates.length < 2 && (
        <p className="text-xs text-text-tertiary py-4 text-center">
          내일부터 추이 그래프가 표시됩니다
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
