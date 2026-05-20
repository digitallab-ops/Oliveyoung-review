'use client'

import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { ProductRankingData } from '@/lib/types'
import { extractShortName } from '@/lib/utils'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  data: ProductRankingData[]
}

const COLORS = ['#B8860B', '#16A34A', '#2563EB', '#9333EA', '#EA580C']

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl space-y-1">
      <p className="text-gray-400">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name} · <strong>{p.value}위</strong>
        </p>
      ))}
    </div>
  )
}

function CategoryChart({ items }: { items: ProductRankingData[] }) {
  // 날짜 전체 축 구성
  const allDates = [...new Set(items.flatMap(d => d.history.map(h => h.date)))].sort()

  const chartData = allDates.map(date => {
    const point: Record<string, any> = { date: date.slice(5) } // MM-DD
    for (const item of items) {
      const h = item.history.find(h => h.date === date)
      if (h) point[item.goods_no] = h.rank
    }
    return point
  })

  const currentRanks = items.map(item => ({
    ...item,
    current: item.history.at(-1)?.rank ?? null,
    prev: item.history.at(-2)?.rank ?? null,
  }))

  return (
    <div className="space-y-4">
      {/* 현재 순위 배지 */}
      <div className="flex flex-wrap gap-2">
        {currentRanks.map((item, i) => {
          const delta = item.prev != null && item.current != null ? item.prev - item.current : null
          return (
            <div key={item.goods_no}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface"
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="text-xs text-text-primary font-medium">{extractShortName(item.goods_name)}</span>
              <span className="text-base font-semibold" style={{ color: COLORS[i % COLORS.length] }}>
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

      {/* 추이 차트 — 데이터 2일 이상 있을 때만 */}
      {allDates.length >= 2 && (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis
              reversed
              domain={['dataMin - 3', 'dataMax + 3']}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              width={30}
              tickFormatter={(v) => `${v}위`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(0,0,0,0.06)' }} />
            <ReferenceLine y={10} stroke="rgba(184,134,11,0.15)" strokeDasharray="3 3" label={{ value: 'TOP 10', fontSize: 9, fill: '#B8860B' }} />
            {items.map((item, i) => (
              <Line
                key={item.goods_no}
                dataKey={item.goods_no}
                name={extractShortName(item.goods_name)}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3, fill: COLORS[i % COLORS.length] }}
                connectNulls={false}
              />
            ))}
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

export default function RankingSection({ data }: Props) {
  if (data.length === 0) return null

  // 카테고리별 그룹핑
  const byCategory = new Map<string, ProductRankingData[]>()
  for (const item of data) {
    if (!byCategory.has(item.category_name)) byCategory.set(item.category_name, [])
    byCategory.get(item.category_name)!.push(item)
  }

  return (
    <div className="space-y-6">
      <div>
        <SectionDivider tag="자사 순위" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">올리브영 카테고리 순위</h2>
          <span className="text-sm text-text-tertiary">Top 100 기준</span>
        </div>
      </div>

      <div className="space-y-6">
        {Array.from(byCategory.entries()).map(([cat, items]) => (
          <div key={cat} className="border border-border rounded-lg bg-surface p-4 md:p-5">
            <p className="text-sm font-semibold text-text-primary mb-3">
              {cat}
            </p>
            <CategoryChart items={items} />
          </div>
        ))}
      </div>
    </div>
  )
}
