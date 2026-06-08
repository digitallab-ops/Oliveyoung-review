'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Loader2 } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, LabelList,
} from 'recharts'
import SectionDivider from '@/components/SectionDivider'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

interface CoupangStats {
  total_reviews: number
  total_products: number
  avg_rating: number
  last_updated: string | null
  new_reviews_7d: number
  negative_ratio: number
}

interface CoupangProduct {
  product_id: string
  product_name: string | null
  review_count: number | null
}

interface CoupangReview {
  review_id: number
  product_id: string
  product_name: string | null
  content: string | null
  rating: number | null
  helpful_count: number
  purchased_option: string | null
  created_at: string
}

interface SearchRanking {
  keyword: string
  product_id: string
  product_name: string | null
  rank_position: number
  is_ours: boolean
  prev_rank: number | null
  delta: number | null
  rank_date: string
}

interface CategoryRanking {
  category_name: string
  rank_position: number
  product_id: string
  product_name: string
  is_ours: boolean
  prev_rank: number | null
  delta: number | null
  rank_date: string
  rank_hour: number
}

// ─── 상수 ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'today',    label: '오늘 현황' },
  { id: 'reviews',  label: '리뷰 분석' },
  { id: 'search',   label: '검색순위' },
  { id: 'category', label: '카테고리 순위' },
] as const
type TabId = typeof TABS[number]['id']

type RatingFilter = 'all' | 'five' | 'four_plus' | 'negative'
const RATING_FILTERS: { value: RatingFilter; label: string }[] = [
  { value: 'all',       label: '전체' },
  { value: 'five',      label: '★5 만족' },
  { value: 'four_plus', label: '★4 이상' },
  { value: 'negative',  label: '불만족' },
]

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────────

function ratingColor(r: number | null) {
  const n = r ?? 0
  if (n >= 5) return '#16A34A'
  if (n >= 4) return '#2D9C6E'
  if (n >= 3) return '#CA8A04'
  if (n >= 2) return '#EA580C'
  return '#DC2626'
}

function ratingStars(r: number | null) {
  const n = Math.max(0, Math.min(5, r ?? 0))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

function shortProductName(name: string | null): string {
  if (!name) return ''
  return name.replace(/\[.*?\]\s*/g, '').replace(/^셀퓨전씨\s*/i, '').slice(0, 18).trim()
}

function generateCatInsights(catList: CategoryRanking[]): string[] {
  const msgs: string[] = []

  const risers = catList
    .filter(e => (e.delta ?? 0) >= 5)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    .slice(0, 3)
  for (const r of risers) {
    msgs.push(`${r.category_name} · ${r.product_name} +${r.delta}위 급상승 (현재 ${r.rank_position}위)`)
  }

  const newTop10 = catList.filter(e => e.prev_rank == null && e.rank_position <= 10)
  if (newTop10.length > 0) {
    msgs.push(`신규 Top 10 진입 ${newTop10.length}개 상품 감지`)
  }

  const ours = catList.filter(e => e.is_ours)
  for (const e of ours) {
    const d = e.delta != null && e.delta !== 0
      ? (e.delta > 0 ? ` ▲${e.delta}` : ` ▼${Math.abs(e.delta)}`)
      : ''
    msgs.push(`셀퓨전씨 ${e.category_name} ${e.rank_position}위${d}`)
  }

  return msgs.length > 0 ? msgs : ['오늘 카테고리 순위 데이터가 수집되었습니다']
}

// ─── DeltaBadge ────────────────────────────────────────────────────────────────

function DeltaBadge({ delta, prevRank }: { delta: number | null; prevRank: number | null }) {
  if (prevRank === null)
    return <span className="text-[11px] text-emerald-600 font-semibold w-9 shrink-0 text-right">NEW</span>
  if (delta == null || delta === 0)
    return <span className="text-[11px] text-text-tertiary w-9 shrink-0 text-right">-</span>
  const up = delta > 0
  return (
    <span className={`text-[11px] font-semibold w-9 shrink-0 text-right ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? `▲${delta}` : `▼${Math.abs(delta)}`}
    </span>
  )
}

// ─── RankEntry ─────────────────────────────────────────────────────────────────

interface RankItem {
  rank_position: number
  product_name: string | null
  is_ours: boolean
  delta: number | null
  prev_rank: number | null
}

function RankEntry({ item }: { item: RankItem }) {
  const isTop3 = item.rank_position <= 3
  return (
    <div className={`flex items-start gap-2 px-3 py-1.5 rounded-md
      ${item.is_ours ? 'bg-accent-bg border border-accent-border' : 'hover:bg-gray-50'}`}>
      <span className={`text-sm w-7 shrink-0 text-right leading-tight mt-0.5
        ${isTop3 ? 'text-accent font-semibold' : 'text-text-secondary font-normal'}`}>
        {item.rank_position}
      </span>
      <span className={`flex-1 min-w-0 text-xs leading-snug break-keep
        ${item.is_ours ? 'text-accent-fg font-medium' : 'text-text-primary'}`}>
        {item.is_ours && <span className="text-accent mr-1">★</span>}
        {item.product_name ?? '-'}
      </span>
      <DeltaBadge delta={item.delta} prevRank={item.prev_rank} />
    </div>
  )
}

// ─── CategoryPanel ─────────────────────────────────────────────────────────────

function CategoryPanel({ catName, items }: { catName: string; items: CategoryRanking[] }) {
  const [showAll, setShowAll] = useState(false)

  const hasDeltas = items.some(e => e.delta != null)

  const risers = hasDeltas
    ? items.filter(e => (e.delta ?? 0) >= 3).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 5)
    : []

  const newTop20 = hasDeltas
    ? items.filter(e => e.prev_rank == null && e.rank_position <= 20).slice(0, 3)
    : []

  const riserIds = new Set(risers.map(e => e.product_id))
  const alertNew = newTop20.filter(e => !riserIds.has(e.product_id))

  const displayItems = showAll ? items : items.slice(0, 10)

  return (
    <div className="border border-border rounded-lg bg-surface p-4 space-y-4">
      <p className="text-sm font-semibold text-text-primary">{catName}</p>

      {(risers.length > 0 || alertNew.length > 0) && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-text-secondary mb-1">급상승</p>
          {risers.map(e => <RankEntry key={`r-${e.product_id}`} item={e} />)}
          {alertNew.map(e => (
            <div key={`n-${e.product_id}`}
                 className="flex items-start gap-2 px-3 py-1.5 rounded-md hover:bg-gray-50">
              <span className="text-sm w-7 shrink-0 text-right text-text-tertiary leading-tight mt-0.5">
                {e.rank_position}
              </span>
              <span className="flex-1 min-w-0 text-xs leading-snug break-keep text-text-primary">
                {e.product_name}
              </span>
              <span className="text-[11px] text-emerald-600 font-semibold w-9 shrink-0 text-right">NEW</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-0.5">
        <p className="text-[11px] font-medium text-text-secondary mb-1">
          Top {showAll ? items.length : Math.min(10, items.length)}
        </p>
        {displayItems.map(item => <RankEntry key={item.rank_position} item={item} />)}
        {items.length > 10 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="w-full text-xs text-text-tertiary hover:text-text-secondary py-2 border-t border-border-subtle mt-1"
          >
            {showAll ? '접기 ▲' : `${items.length - 10}개 더 보기 ▼`}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── SearchKeywordPanel ────────────────────────────────────────────────────────

function SearchKeywordPanel({ keyword, items }: { keyword: string; items: SearchRanking[] }) {
  const [showAll, setShowAll] = useState(false)
  const ours = items.filter(r => r.is_ours)
  const displayItems = showAll ? items : items.slice(0, 10)

  return (
    <div className="border border-border rounded-lg bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">{keyword}</p>
        {ours.length > 0 && (
          <span className="text-xs font-semibold text-accent">
            자사 {ours.map(r => `${r.rank_position}위`).join(' · ')}
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        {displayItems.map(item => <RankEntry key={item.product_id} item={item} />)}
        {items.length > 10 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="w-full text-xs text-text-tertiary hover:text-text-secondary py-2 border-t border-border-subtle mt-1"
          >
            {showAll ? '접기 ▲' : `${items.length - 10}개 더 보기 ▼`}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── 순위 추이 차트 ────────────────────────────────────────────────────────────

interface RankHistoryEntry {
  product_id: string
  product_name: string
  is_ours: boolean
  category_name: string
  history: { date: string; rank: number }[]
}

const CHART_COLORS = ['#2563EB', '#16A34A', '#DC2626', '#9333EA', '#EA580C', '#0891B2', '#CA8A04', '#DB2777']

function shortName(name: string) {
  return name.replace(/\[.*?\]\s*/g, '').replace(/^셀퓨전씨\s*/i, '').slice(0, 16).trim()
}

function RankChartTooltip({ active, payload, label }: any) {
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

function RankChartLabel({ x, y, value, color }: any) {
  if (value == null) return null
  return (
    <text x={x} y={y - 7} textAnchor="middle" fontSize={10} fontWeight="600" fill={color}>
      {value}위
    </text>
  )
}

function CoupangProductCheckDropdown({
  items, selected, onChange,
}: {
  items: RankHistoryEntry[]
  selected: Set<string>
  onChange: (s: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
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
                          shadow-lg w-60 max-h-64 overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-surface">
              <span className="text-[11px] text-text-tertiary font-medium">상품 선택</span>
              <div className="flex gap-2.5">
                <button onClick={() => onChange(new Set(items.map(i => i.product_id)))}
                        className="text-[11px] text-accent hover:underline">전체</button>
                <button onClick={() => onChange(new Set())}
                        className="text-[11px] text-text-tertiary hover:underline">해제</button>
              </div>
            </div>
            {items.map((item, i) => {
              const color = CHART_COLORS[i % CHART_COLORS.length]
              return (
                <label key={item.product_id}
                       className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(item.product_id)}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(item.product_id)) next.delete(item.product_id)
                      else next.add(item.product_id)
                      onChange(next)
                    }}
                    className="w-3.5 h-3.5 rounded"
                    style={{ accentColor: color }}
                  />
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className={`text-xs truncate flex-1 ${item.is_ours ? 'text-accent font-medium' : 'text-text-primary'}`}>
                    {item.is_ours && '★ '}{shortName(item.product_name)}
                  </span>
                  <span className="text-[11px] text-text-tertiary shrink-0">
                    {item.history.at(-1)?.rank ?? '-'}위
                  </span>
                </label>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function CoupangCategoryChart({ catName, entries }: { catName: string; entries: RankHistoryEntry[] }) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(entries.filter(e => e.is_ours).map(e => e.product_id).slice(0, 5)
                         .concat(entries.filter(e => !e.is_ours).map(e => e.product_id).slice(0, 3)))
  )

  const filtered   = entries.filter(e => selected.has(e.product_id))
  const allDates   = [...new Set(filtered.flatMap(e => e.history.map(h => h.date)))].sort()

  const chartData = allDates.map(date => {
    const point: Record<string, any> = { date: date.slice(5) }
    for (const e of filtered) {
      const h = e.history.find(h => h.date === date)
      if (h) point[e.product_id] = h.rank
    }
    return point
  })

  const currentRanks = filtered.map(e => ({
    ...e,
    current: e.history.at(-1)?.rank ?? null,
    prev:    e.history.at(-2)?.rank ?? null,
  }))

  return (
    <div className="border border-border rounded-lg bg-surface p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">{catName}</p>
        <CoupangProductCheckDropdown items={entries} selected={selected} onChange={setSelected} />
      </div>

      {/* 현재 순위 칩 */}
      <div className="flex flex-wrap gap-2">
        {currentRanks.map((e, i) => {
          const color = CHART_COLORS[i % CHART_COLORS.length]
          const delta = e.prev != null && e.current != null ? e.prev - e.current : null
          return (
            <div key={e.product_id}
                 className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                   e.is_ours ? 'border-accent-border bg-accent-bg' : 'border-border bg-surface'
                 }`}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className={`text-xs font-medium ${e.is_ours ? 'text-accent' : 'text-text-primary'}`}>
                {shortName(e.product_name)}
              </span>
              <span className="text-base font-bold" style={{ color }}>
                {e.current != null ? `${e.current}위` : '-'}
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

      {allDates.length >= 2 ? (
        <ResponsiveContainer width="100%" height={filtered.length > 3 ? 220 : 180}>
          <LineChart data={chartData} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date"
                   tick={{ fontSize: 11, fill: '#57534E', fontWeight: 500 }}
                   axisLine={false} tickLine={false} />
            <YAxis reversed
                   domain={['dataMin - 3', 'dataMax + 3']}
                   tick={{ fontSize: 10, fill: '#78716C' }}
                   axisLine={false} tickLine={false}
                   width={32}
                   tickFormatter={(v) => `${v}위`} />
            <Tooltip content={<RankChartTooltip />} cursor={{ stroke: 'rgba(0,0,0,0.06)', strokeWidth: 1 }} />
            {filtered.map((e, i) => {
              const color = CHART_COLORS[i % CHART_COLORS.length]
              return (
                <Line key={e.product_id}
                      dataKey={e.product_id}
                      name={shortName(e.product_name)}
                      stroke={color}
                      strokeWidth={e.is_ours ? 3 : 1.5}
                      strokeDasharray={e.is_ours ? undefined : '4 2'}
                      dot={{ r: e.is_ours ? 4 : 3, fill: color, strokeWidth: 0 }}
                      activeDot={{ r: 6, fill: color, strokeWidth: 2, stroke: '#fff' }}
                      connectNulls={false}>
                  {e.is_ours && (
                    <LabelList dataKey={e.product_id}
                               content={(props: any) => <RankChartLabel {...props} color={color} />} />
                  )}
                </Line>
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-xs text-text-tertiary py-4 text-center">
          {selected.size === 0
            ? '상품을 선택하세요'
            : '데이터가 2일 이상 쌓이면 추이 그래프가 표시됩니다'}
        </p>
      )}
    </div>
  )
}

// ─── InsightPanel ──────────────────────────────────────────────────────────────

// ─── KeywordCloud ───────────────────────────────────────────────────────────────

interface KwItem { word: string; count: number }

function KeywordCloud({ label, keywords, color }: {
  label: string
  keywords: KwItem[]
  color: 'emerald' | 'red'
}) {
  if (keywords.length === 0) return (
    <div className={`bg-surface border border-border border-t-2 ${
      color === 'emerald' ? 'border-t-emerald-200' : 'border-t-red-200'
    } rounded-lg p-4 flex items-center justify-center min-h-[80px]`}>
      <p className="text-xs text-text-tertiary">데이터 없음</p>
    </div>
  )
  const max = keywords[0]?.count ?? 1
  const min = keywords[keywords.length - 1]?.count ?? 0
  const range = max - min || 1
  return (
    <div className={`bg-surface border border-border border-t-2 ${
      color === 'emerald' ? 'border-t-emerald-200' : 'border-t-red-200'
    } rounded-lg p-4`}>
      <p className={`text-xs font-semibold mb-3 ${
        color === 'emerald' ? 'text-emerald-700' : 'text-red-600'
      }`}>{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {keywords.slice(0, 15).map(kw => {
          const ratio = (kw.count - min) / range
          const fontSize = Math.round(11 + ratio * 5)
          const cls = color === 'emerald'
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : 'bg-red-50 text-red-700 border-red-200'
          return (
            <span
              key={kw.word}
              className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full font-medium border ${cls}`}
              style={{ fontSize: `${fontSize}px` }}
            >
              #{kw.word}
              <span className="text-[9px] opacity-50">{kw.count}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ─── InsightSections ────────────────────────────────────────────────────────────

const INSIGHT_SECTIONS: Record<string, { dot: string; header: string; topBorder: string }> = {
  '핵심 칭찬 포인트':       { dot: 'bg-emerald-500', header: 'text-emerald-700', topBorder: 'border-t-emerald-200' },
  '아쉬운 점 & 개선 기회': { dot: 'bg-orange-400',  header: 'text-orange-700',  topBorder: 'border-t-orange-200'  },
  '소비자 특성':            { dot: 'bg-blue-400',    header: 'text-blue-700',    topBorder: 'border-t-blue-200'    },
  '마케팅 인사이트':        { dot: 'bg-accent',      header: 'text-accent',      topBorder: 'border-t-accent/40'   },
}

const INSIGHT_URGENCY: Record<string, { label: string; cls: string }> = {
  '핵심 칭찬 포인트':       { label: '현황',     cls: 'bg-emerald-100 text-emerald-700' },
  '아쉬운 점 & 개선 기회': { label: '즉시 조치', cls: 'bg-red-100 text-red-700' },
  '소비자 특성':            { label: '현황',     cls: 'bg-blue-100 text-blue-700' },
  '마케팅 인사이트':        { label: '모니터링', cls: 'bg-yellow-100 text-yellow-700' },
}

function parseInsightSections(text: string): Array<{ name: string; items: string[] }> {
  const sectionRegex = /\[([^\]]+)\]/g
  const result: Array<{ name: string; items: string[] }> = []
  let match: RegExpExecArray | null
  let lastName = ''
  let lastEnd  = 0

  while ((match = sectionRegex.exec(text)) !== null) {
    if (lastName) {
      const body  = text.slice(lastEnd, match.index)
      const items = body.split('\n').map(l => l.replace(/^·\s*/, '').trim()).filter(l => l.length > 3)
      result.push({ name: lastName, items })
    }
    lastName = match[1]
    lastEnd  = match.index + match[0].length
  }
  if (lastName) {
    const body  = text.slice(lastEnd)
    const items = body.split('\n').map(l => l.replace(/^·\s*/, '').trim()).filter(l => l.length > 3)
    result.push({ name: lastName, items })
  }
  return result
}

interface InsightHistoryEntry {
  id: number
  product_id: string | null
  product_name: string | null
  review_count: number
  content: string
  created_at: string
}

function InsightSections({ text }: { text: string }) {
  const sections = parseInsightSections(text)
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {sections.map(({ name, items }) => {
        const cfg = INSIGHT_SECTIONS[name]
        return (
          <div key={name}
               className={`bg-surface border border-border border-t-2 rounded-lg p-4 ${cfg?.topBorder ?? 'border-t-border'}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg?.dot ?? 'bg-text-tertiary'}`} />
              <p className={`text-xs font-semibold ${cfg?.header ?? 'text-text-secondary'}`}>{name}</p>
              {INSIGHT_URGENCY[name] && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${INSIGHT_URGENCY[name].cls}`}>
                  {INSIGHT_URGENCY[name].label}
                </span>
              )}
            </div>
            <ul className="space-y-1.5">
              {items.map((item, i) => (
                <li key={i} className="text-xs text-text-primary leading-relaxed flex items-start gap-1.5">
                  <span className="text-text-tertiary shrink-0 mt-0.5">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function CoupangInsightPanel({ productId }: { productId: string }) {
  const [loading, setLoading]      = useState(true)
  const [latest, setLatest]        = useState<InsightHistoryEntry | null>(null)
  const [history, setHistory]      = useState<InsightHistoryEntry[]>([])
  const [expandedId, setExpanded]  = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    setLatest(null)
    setHistory([])
    setExpanded(null)
    const qs = productId ? `?productId=${productId}&limit=10` : '?limit=10'
    fetch(`/api/coupang/insights/history${qs}`)
      .then(r => r.json())
      .then((data: InsightHistoryEntry[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setLatest(data[0])
          setHistory(data.slice(1))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [productId])

  if (loading) {
    return (
      <div className="border border-border rounded-lg px-5 py-5 mb-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
        <p className="text-sm text-text-secondary">인사이트 불러오는 중...</p>
      </div>
    )
  }

  if (!latest) {
    return (
      <div className="border border-dashed border-border rounded-lg px-5 py-8 mb-6 text-center">
        <p className="text-sm text-text-secondary">아직 분석된 인사이트가 없습니다</p>
        <p className="text-xs text-text-tertiary mt-1">다음 수집 시 자동으로 분석됩니다</p>
      </div>
    )
  }

  const latestSections = parseInsightSections(latest.content)
  const actionSection = latestSections.find(s => s.name.includes('아쉬운') || s.name.includes('개선'))

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">AI 리뷰 분석</p>
        <span className="text-[11px] text-text-tertiary">
          {latest.created_at} · {latest.review_count}개 리뷰 기준
        </span>
      </div>

      {actionSection?.items[0] && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-[10px] font-bold text-red-600 mb-1">🔴 이번 주 핵심 액션</p>
          <p className="text-xs text-red-800 leading-relaxed">{actionSection.items[0]}</p>
        </div>
      )}

      <InsightSections text={latest.content} />

      {history.length > 0 && (
        <div className="pt-1 border-t border-border mt-3">
          <p className="text-xs text-text-tertiary font-medium py-2">이전 분석</p>
          <HistoryList
            entries={history}
            loading={false}
            expandedId={expandedId}
            onToggle={id => setExpanded(v => v === id ? null : id)}
          />
        </div>
      )}
    </div>
  )
}

function HistoryList({
  entries, loading, expandedId, onToggle,
}: {
  entries: InsightHistoryEntry[]
  loading: boolean
  expandedId: number | null
  onToggle: (id: number) => void
}) {
  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-text-tertiary">
        <div className="w-3 h-3 border-2 border-accent/50 border-t-transparent rounded-full animate-spin" />
        불러오는 중...
      </div>
    )
  }
  if (entries.length === 0) {
    return <p className="mt-3 text-xs text-text-tertiary">저장된 이력이 없습니다</p>
  }
  return (
    <div className="mt-3 space-y-2">
      {entries.map(e => (
        <div key={e.id} className="border border-border rounded-lg bg-surface overflow-hidden">
          <button
            onClick={() => onToggle(e.id)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs text-text-tertiary shrink-0">{e.created_at}</span>
              <span className="text-xs text-text-secondary truncate">
                {e.product_name
                  ? e.product_name.replace(/^셀퓨전씨\s*/i, '').slice(0, 30)
                  : '전체 브랜드'}
              </span>
              <span className="text-[11px] text-text-tertiary shrink-0">리뷰 {e.review_count}개</span>
            </div>
            <ChevronDown
              size={13}
              className={`text-text-tertiary shrink-0 transition-transform duration-200 ${expandedId === e.id ? 'rotate-180' : ''}`}
            />
          </button>
          {expandedId === e.id && (
            <div className="border-t border-border px-4 py-3">
              <InsightSections text={e.content} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── ReviewCard ────────────────────────────────────────────────────────────────

const PREVIEW_LEN = 120

function CoupangReviewCard({
  review, showProduct, onProductClick, index = 0,
}: {
  review: CoupangReview
  showProduct: boolean
  onProductClick: (id: string) => void
  index?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const content  = review.content ?? ''
  const isLong   = content.length > PREVIEW_LEN
  const color    = ratingColor(review.rating)
  const shortName = shortProductName(review.product_name)

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.03, ease: [0.16, 1, 0.3, 1] }}
      className="bg-surface border border-border rounded-lg overflow-hidden hover:shadow-card-hover transition-all duration-200"
    >
      <div className="px-5 py-4 md:px-6 md:py-5">
        <div className="flex items-center gap-2.5 flex-wrap mb-3">
          <span className="text-sm font-semibold tracking-wide" style={{ color }}>
            {ratingStars(review.rating)}
          </span>
          <span className="text-xs text-text-tertiary">{review.created_at}</span>
          <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
            {showProduct && shortName && (
              <button
                onClick={() => onProductClick(review.product_id)}
                className="inline-flex items-center text-2xs font-semibold px-2 py-0.5 rounded-full
                           bg-purple-50 text-purple-700 border border-purple-100
                           hover:bg-purple-100 transition-colors duration-150"
                title={review.product_name ?? ''}
              >
                {shortName}
              </button>
            )}
            {review.purchased_option && (
              <span className="inline-flex items-center text-2xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                {review.purchased_option.length > 16
                  ? review.purchased_option.slice(0, 16) + '…'
                  : review.purchased_option}
              </span>
            )}
            {review.helpful_count > 0 && (
              <span className="text-2xs text-text-tertiary">도움 {review.helpful_count}</span>
            )}
          </div>
        </div>
        <AnimatePresence initial={false}>
          <motion.div
            key={expanded ? 'exp' : 'col'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="text-base text-text-primary"
            style={{ lineHeight: '1.85' }}
          >
            {expanded || !isLong ? content : content.slice(0, PREVIEW_LEN).trimEnd() + '...'}
          </motion.div>
        </AnimatePresence>
        {isLong && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-2.5 flex items-center gap-1 text-xs font-medium text-text-tertiary hover:text-accent transition-colors duration-150"
          >
            <span>{expanded ? '접기' : '더 보기'}</span>
            <ChevronDown size={13} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
    </motion.article>
  )
}

// ─── 메인 ──────────────────────────────────────────────────────────────────────

export default function CoupangDashboard() {
  const [active, setActive]     = useState<TabId>('today')
  const [loading, setLoading]   = useState(true)
  const [stats, setStats]       = useState<CoupangStats | null>(null)
  const [rankings, setRankings] = useState<{ search: SearchRanking[]; category: CategoryRanking[] } | null>(null)
  const [products, setProducts] = useState<CoupangProduct[]>([])

  const [selectedProduct, setSelectedProduct] = useState('')
  const [ratingFilter, setRatingFilter]       = useState<RatingFilter>('all')
  const [reviews, setReviews]                 = useState<CoupangReview[]>([])
  const [reviewTotal, setReviewTotal]         = useState(0)
  const [reviewPage, setReviewPage]           = useState(0)
  const [hasMore, setHasMore]                 = useState(false)
  const [reviewLoading, setReviewLoading]     = useState(false)
  const [loadingMore, setLoadingMore]         = useState(false)
  const [showOursOnly, setShowOursOnly]         = useState(false)
  const [rankHistory, setRankHistory]           = useState<Record<string, RankHistoryEntry[]> | null>(null)
  const [rankHistoryLoading, setRHLoading]      = useState(false)
  const [latestBriefing, setLatestBriefing]     = useState<InsightHistoryEntry | null>(null)
  const [keywords, setKeywords]                 = useState<{ positive: KwItem[]; negative: KwItem[] } | null>(null)
  const [kwLoading, setKwLoading]               = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/coupang/stats').then(r => r.ok ? r.json() : null),
      fetch('/api/coupang/rankings').then(r => r.ok ? r.json() : null),
      fetch('/api/coupang/products').then(r => r.ok ? r.json() : []),
      fetch('/api/coupang/insights/history?limit=1').then(r => r.ok ? r.json() : []),
    ]).then(([s, r, p, ins]) => {
      setStats(s)
      setRankings({
        search:   Array.isArray(r?.search)   ? r.search   : [],
        category: Array.isArray(r?.category) ? r.category : [],
      })
      setProducts(Array.isArray(p) ? p : [])
      setLatestBriefing(Array.isArray(ins) && ins.length > 0 ? ins[0] : null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const fetchReviews = useCallback(async (
    productId: string, filter: RatingFilter, page: number, append = false,
  ) => {
    if (append) setLoadingMore(true)
    else setReviewLoading(true)

    const params = new URLSearchParams({ page: String(page), filter })
    if (productId) params.set('productId', productId)

    try {
      const res = await fetch(`/api/coupang/reviews?${params}`)
      const d   = res.ok ? await res.json() : { reviews: [], total: 0, has_more: false }
      setReviews(prev => append ? [...prev, ...(d.reviews ?? [])] : (d.reviews ?? []))
      setReviewTotal(d.total ?? 0)
      setHasMore(d.has_more ?? false)
      setReviewPage(page)
    } catch {
      if (!append) setReviews([])
    } finally {
      setReviewLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => { fetchReviews('', 'all', 0) }, [fetchReviews])

  useEffect(() => {
    if (active !== 'reviews') return
    setKwLoading(true)
    setKeywords(null)
    const qs = selectedProduct ? `?productId=${selectedProduct}` : ''
    fetch(`/api/coupang/keywords${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setKeywords(d) })
      .catch(() => {})
      .finally(() => setKwLoading(false))
  }, [active, selectedProduct])

  useEffect(() => {
    if (active !== 'category' || rankHistory !== null) return
    setRHLoading(true)
    fetch('/api/coupang/rank-history')
      .then(r => r.ok ? r.json() : {})
      .then(d => { setRankHistory(d); setRHLoading(false) })
      .catch(() => setRHLoading(false))
  }, [active, rankHistory])

  const handleProductChange = (id: string) => {
    setSelectedProduct(id)
    setRatingFilter('all')
    fetchReviews(id, 'all', 0)
  }
  const handleFilterChange = (f: RatingFilter) => {
    setRatingFilter(f)
    fetchReviews(selectedProduct, f, 0)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-sm text-text-secondary">쿠팡 데이터 불러오는 중...</span>
      </div>
    )
  }

  const catList    = rankings?.category ?? []
  const searchList = rankings?.search   ?? []

  const catGroups = catList.reduce<Record<string, CategoryRanking[]>>((acc, r) => {
    acc[r.category_name] = acc[r.category_name] ?? []
    acc[r.category_name].push(r)
    return acc
  }, {})

  const searchGroups = searchList.reduce<Record<string, SearchRanking[]>>((acc, r) => {
    acc[r.keyword] = acc[r.keyword] ?? []
    acc[r.keyword].push(r)
    return acc
  }, {})

  const catInsights = generateCatInsights(catList)

  const filteredCatGroups = showOursOnly
    ? Object.fromEntries(
        Object.entries(catGroups)
          .map(([k, v]) => [k, v.filter(e => e.is_ours)] as [string, CategoryRanking[]])
          .filter(([, v]) => v.length > 0)
      )
    : catGroups

  return (
    <div className="space-y-8">

      {/* ── KPI ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="col-span-2 sm:col-span-1 rounded-xl px-5 py-6 border"
             style={{ background: 'rgba(234,88,12,0.06)', borderColor: 'rgba(234,88,12,0.25)' }}>
          <p className="text-xs text-text-secondary mb-2 font-medium">평균 평점</p>
          <p className="text-[3.5rem] font-bold leading-none mb-1" style={{ color: '#ea580c' }}>
            {stats?.avg_rating != null ? Number(stats.avg_rating).toFixed(1) : '-'}
          </p>
          <p className="text-xs text-text-secondary/70">★★★★★ 기준 5점</p>
        </div>
        <div className="rounded-xl px-4 py-5 border border-border bg-surface text-center">
          <p className="text-xs text-text-secondary mb-3">누적 리뷰</p>
          <p className="text-[2rem] font-bold leading-none mb-2 text-text-primary">
            {(stats?.total_reviews ?? 0).toLocaleString()}
          </p>
          <p className="text-xs text-text-secondary/70">{stats?.total_products ?? 0}개 상품</p>
        </div>
        <div className="rounded-xl px-4 py-5 border border-border bg-surface text-center">
          <p className="text-xs text-text-secondary mb-3">카테고리 입점</p>
          <p className="text-[2rem] font-bold leading-none mb-2 text-text-primary">{Object.keys(catGroups).length}</p>
          <p className="text-xs text-text-secondary/70">개 카테고리</p>
        </div>
        <div className="rounded-xl px-4 py-5 border border-border bg-surface text-center">
          <p className="text-xs text-text-secondary mb-3">7일 신규 리뷰</p>
          <p className="text-[2rem] font-bold leading-none mb-2 text-text-primary">
            {(stats?.new_reviews_7d ?? 0).toLocaleString()}
          </p>
          <p className="text-xs text-text-secondary/70">최근 7일</p>
        </div>
        <div className={`rounded-xl px-4 py-5 border text-center ${
          (stats?.negative_ratio ?? 0) >= 15
            ? 'border-red-300 bg-red-50'
            : 'border-border bg-surface'
        }`}>
          <p className="text-xs text-text-secondary mb-3">부정 리뷰 비율</p>
          <p className={`text-[2rem] font-bold leading-none mb-2 ${
            (stats?.negative_ratio ?? 0) >= 15 ? 'text-red-600' : 'text-text-primary'
          }`}>
            {stats?.negative_ratio != null ? `${Number(stats.negative_ratio).toFixed(1)}%` : '-'}
          </p>
          <p className="text-xs text-text-secondary/70">
            {(stats?.negative_ratio ?? 0) >= 15 ? '⚠ 주의' : '3점 이하'}
          </p>
        </div>
      </div>
      {stats?.last_updated && (() => {
        const d = new Date(stats.last_updated)
        const ts = `${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
        return <p className="text-xs text-text-tertiary -mt-6 text-right">마지막 수집: {ts}</p>
      })()}

      {/* ── 탭 바 ── */}
      <div className="border-b border-border sticky top-14 z-30 bg-background/95 backdrop-blur-sm">
        <nav className="flex gap-0 -mb-px">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                active === tab.id
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div>

        {/* ══════════════════════════════════════
            오늘 현황
        ══════════════════════════════════════ */}
        {active === 'today' && (
          <div className="space-y-6">

            {/* AI 브리핑 카드 */}
            {latestBriefing && (() => {
              const sections = parseInsightSections(latestBriefing.content)
              const first = sections[0]
              if (!first) return null
              const d = new Date(latestBriefing.created_at)
              const ts = `${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
              return (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-orange-600 uppercase tracking-wide">AI 브리핑</span>
                    <span className="text-[11px] text-gray-400">{ts}</span>
                  </div>
                  <p className="text-xs font-semibold text-orange-700 mb-1.5">{first.name}</p>
                  <ul className="space-y-1">
                    {first.items.slice(0, 3).map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700 leading-relaxed">
                        <span className="text-orange-400 shrink-0 mt-0.5">·</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => setActive('reviews')}
                    className="mt-2.5 text-xs text-orange-500 hover:underline"
                  >
                    전체 리뷰 분석 보기 →
                  </button>
                </div>
              )
            })()}

            <div>
              <SectionDivider tag="시장 현황" />
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-text-primary">쿠팡 카테고리 베스트</h2>
                <span className="text-sm text-text-tertiary">Top 100 기준</span>
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

            {catList.length > 0 && (
              <div className="bg-accent-bg border border-accent-border rounded-lg px-4 py-3.5">
                <p className="text-xs font-semibold text-accent mb-2.5">오늘의 시장 현황</p>
                <ul className="space-y-1">
                  {catInsights.map((msg, i) => (
                    <li key={i} className="text-sm text-accent-fg flex items-start gap-1.5">
                      <span className="text-accent shrink-0 mt-0.5">·</span>
                      <span>{msg}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Object.keys(filteredCatGroups).length === 0 ? (
              <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
                <p className="text-sm text-text-secondary">카테고리 순위 데이터가 없어요</p>
                <p className="text-xs text-text-tertiary mt-1">수집 후 데이터가 표시됩니다</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Object.entries(filteredCatGroups).map(([cat, items]) => (
                  <CategoryPanel key={cat} catName={cat} items={items} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            리뷰 분석
        ══════════════════════════════════════ */}
        {active === 'reviews' && (
          <section>
            <CoupangInsightPanel productId={selectedProduct} />
            {kwLoading ? (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="animate-pulse bg-surface border border-border rounded-lg p-4 h-20" />
                <div className="animate-pulse bg-surface border border-border rounded-lg p-4 h-20" />
              </div>
            ) : keywords && (keywords.positive.length > 0 || keywords.negative.length > 0) ? (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <KeywordCloud label="✅ 긍정 키워드" keywords={keywords.positive} color="emerald" />
                <KeywordCloud label="⚠️ 부정 키워드" keywords={keywords.negative} color="red" />
              </div>
            ) : null}
            <div className="mb-4">
              <select
                value={selectedProduct}
                onChange={e => handleProductChange(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-base text-text-primary
                           focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50
                           appearance-none cursor-pointer transition-colors"
              >
                <option value="">전체 상품</option>
                {products.map(p => (
                  <option key={p.product_id} value={p.product_id}>
                    {(p.product_name ?? p.product_id).length > 42
                      ? (p.product_name ?? p.product_id).slice(0, 42) + '…'
                      : (p.product_name ?? p.product_id)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
              {RATING_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => handleFilterChange(f.value)}
                  className={`flex-none px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-150 whitespace-nowrap ${
                    ratingFilter === f.value
                      ? 'bg-text-primary text-white'
                      : 'bg-surface border border-border text-text-secondary hover:border-text-tertiary hover:text-text-primary'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-tertiary mb-4">{reviewTotal.toLocaleString()}개 리뷰</p>
            {reviewLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="bg-surface border border-border rounded-lg p-5">
                    <div className="skeleton h-3 w-32 rounded mb-3" />
                    <div className="skeleton h-3 w-full rounded mb-2" />
                    <div className="skeleton h-3 w-4/5 rounded" />
                  </div>
                ))}
              </div>
            ) : reviews.length === 0 ? (
              <div className="text-center py-16 text-text-tertiary text-sm">해당 조건의 리뷰가 없습니다</div>
            ) : (
              <>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${selectedProduct}-${ratingFilter}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-2.5"
                  >
                    {reviews.map((rv, i) => (
                      <CoupangReviewCard
                        key={rv.review_id}
                        review={rv}
                        showProduct={!selectedProduct}
                        onProductClick={handleProductChange}
                        index={i}
                      />
                    ))}
                  </motion.div>
                </AnimatePresence>
                {hasMore && (
                  <div className="mt-6 text-center">
                    <button
                      onClick={() => fetchReviews(selectedProduct, ratingFilter, reviewPage + 1, true)}
                      disabled={loadingMore}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg border border-border
                                 text-sm font-medium text-text-secondary hover:text-text-primary
                                 hover:border-text-tertiary transition-all duration-150 disabled:opacity-50"
                    >
                      {loadingMore
                        ? <><Loader2 size={14} className="animate-spin" /> 불러오는 중</>
                        : '리뷰 더 보기'}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ══════════════════════════════════════
            검색순위
        ══════════════════════════════════════ */}
        {active === 'search' && (
          <div className="space-y-6">
            <div>
              <SectionDivider tag="검색 순위" />
              <h2 className="text-xl font-semibold text-text-primary">키워드별 검색 순위</h2>
            </div>

            {searchList.some(r => r.is_ours) && (
              <div className="bg-accent-bg border border-accent-border rounded-lg px-4 py-3.5">
                <p className="text-xs font-semibold text-accent mb-2.5">자사 검색 노출 현황</p>
                <ul className="space-y-1">
                  {Object.entries(searchGroups).map(([kw, items]) => {
                    const ours = items.filter(r => r.is_ours)
                    if (!ours.length) return null
                    const top = ours[0]
                    const d = top.delta != null && top.delta !== 0
                      ? (top.delta > 0 ? ` ▲${top.delta}` : ` ▼${Math.abs(top.delta)}`)
                      : ''
                    return (
                      <li key={kw} className="text-sm text-accent-fg flex items-start gap-1.5">
                        <span className="text-accent shrink-0 mt-0.5">·</span>
                        <span>{kw} — {top.rank_position}위{d}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {Object.keys(searchGroups).length === 0 ? (
              <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
                <p className="text-sm text-text-secondary">검색순위 데이터가 없어요</p>
                <p className="text-xs text-text-tertiary mt-1">수집 후 데이터가 표시됩니다</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(searchGroups).map(([keyword, items]) => (
                  <SearchKeywordPanel key={keyword} keyword={keyword} items={items} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            카테고리 순위
        ══════════════════════════════════════ */}
        {active === 'category' && (
          <div className="space-y-8">

            {/* 순위 추이 차트 */}
            <div className="space-y-4">
              <div>
                <SectionDivider tag="순위 추이" />
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-text-primary">카테고리 순위 추이</h2>
                  <span className="text-sm text-text-tertiary">자사 상품 기본 선택 · 상품 추가 가능</span>
                </div>
              </div>
              {rankHistoryLoading ? (
                <div className="flex items-center gap-2 text-sm text-text-secondary py-6">
                  <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  순위 이력 불러오는 중...
                </div>
              ) : rankHistory && Object.keys(rankHistory).length > 0 ? (
                <div className="space-y-4">
                  {Object.entries(rankHistory).map(([cat, entries]) => (
                    <CoupangCategoryChart key={cat} catName={cat} entries={entries} />
                  ))}
                </div>
              ) : (
                <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center">
                  <p className="text-sm text-text-secondary">순위 이력 데이터가 없어요</p>
                  <p className="text-xs text-text-tertiary mt-1">수집 후 추이 그래프가 표시됩니다</p>
                </div>
              )}
            </div>

            {/* 현재 순위 목록 */}
            <div className="space-y-4">
              <div>
                <SectionDivider tag="현재 순위" />
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-text-primary">쿠팡 카테고리 베스트셀러</h2>
                  <span className="text-sm text-text-tertiary">Top 100</span>
                </div>
              </div>

            {Object.keys(catGroups).length === 0 ? (
              <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
                <p className="text-sm text-text-secondary">카테고리 순위 데이터가 없어요</p>
                <p className="text-xs text-text-tertiary mt-1">수집 후 데이터가 표시됩니다</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Object.entries(catGroups).map(([cat, items]) => (
                  <CategoryPanel key={cat} catName={cat} items={items} />
                ))}
              </div>
            )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
