'use client'

import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import SectionDivider from '@/components/SectionDivider'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

interface TrendPoint { date: string; ratio: number }
interface SearchRankItem {
  keyword: string; rank_position: number; product_title: string
  mall_name: string; price: number; link: string; is_ours: boolean
  rank_date: string; prev_rank: number | null; delta: number | null
}
interface MarketItem {
  category: string; brand: string | null; product_title: string
  mall_name: string; price: number; is_ours: boolean
  volume_ml: number | null; collected_date: string
}
interface NaverInsight { id: number; content: string; collected_at: string }

// ─── 상수 ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'trends',  label: '검색 트렌드' },
  { id: 'ranks',   label: '검색 노출' },
  { id: 'market',  label: '시장 현황' },
  { id: 'insight', label: 'AI 인사이트' },
] as const
type TabId = typeof TABS[number]['id']

const COLORS = ['#2563EB', '#16A34A', '#DC2626', '#9333EA', '#EA580C']

const INSIGHT_SECTIONS: Record<string, { dot: string; header: string; topBorder: string }> = {
  '트렌드 시그널':  { dot: 'bg-blue-500',    header: 'text-blue-700',    topBorder: 'border-t-blue-200' },
  '검색 노출 현황': { dot: 'bg-emerald-500', header: 'text-emerald-700', topBorder: 'border-t-emerald-200' },
  '경쟁사 시장':    { dot: 'bg-orange-400',  header: 'text-orange-700',  topBorder: 'border-t-orange-200' },
  '액션 제안':      { dot: 'bg-accent',      header: 'text-accent',      topBorder: 'border-t-accent/40' },
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────────

function parseInsightSections(text: string) {
  const sections: { name: string; items: string[] }[] = []
  const parts = text.split(/\[([^\]]+)\]/).filter(Boolean)
  let lastName = ''
  for (const part of parts) {
    if (INSIGHT_SECTIONS[part.trim()]) {
      lastName = part.trim()
    } else if (lastName) {
      const items = part.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('·'))
        .map(l => l.replace(/^·\s*/, ''))
      sections.push({ name: lastName, items })
      lastName = ''
    }
  }
  return sections
}

function DeltaBadge({ delta, prevRank }: { delta: number | null; prevRank: number | null }) {
  if (prevRank === null) return (
    <span className="text-[10px] font-bold text-blue-600 w-8 text-right shrink-0">NEW</span>
  )
  if (delta === null || delta === 0) return (
    <span className="text-[11px] text-text-tertiary w-8 text-right shrink-0">-</span>
  )
  return delta > 0
    ? <span className="text-[11px] font-semibold text-emerald-600 w-8 text-right shrink-0">▲{delta}</span>
    : <span className="text-[11px] font-semibold text-red-500 w-8 text-right shrink-0">▼{Math.abs(delta)}</span>
}

// ─── 트렌드 탭 ────────────────────────────────────────────────────────────────

function TrendsTab({ data }: { data: Record<string, TrendPoint[]> }) {
  const keywords = Object.keys(data)
  if (keywords.length === 0) return (
    <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
      <p className="text-sm text-text-secondary">트렌드 데이터가 없어요</p>
      <p className="text-xs text-text-tertiary mt-1">수집 후 표시됩니다</p>
    </div>
  )

  // 날짜 기준 병합
  const allDates = [...new Set(keywords.flatMap(k => data[k].map(p => p.date)))].sort()
  const chartData = allDates.map(date => {
    const point: Record<string, any> = { date: date.slice(5) }
    for (const kw of keywords) {
      const found = data[kw].find(p => p.date === date)
      if (found) point[kw] = found.ratio
    }
    return point
  })

  return (
    <div className="space-y-4">
      <div>
        <SectionDivider tag="DataLab" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">네이버 검색 트렌드</h2>
          <span className="text-sm text-text-tertiary">최근 8주 · 0~100 상대지수</span>
        </div>
      </div>
      <div className="border border-border rounded-lg bg-surface p-4">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#57534E' }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#78716C' }} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1c1917', border: 'none', borderRadius: 8 }}
              labelStyle={{ color: '#a8a29e', fontSize: 11 }}
              itemStyle={{ color: '#fff', fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {keywords.map((kw, i) => (
              <Line
                key={kw}
                dataKey={kw}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3, fill: COLORS[i % COLORS.length], strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── 검색 노출 탭 ─────────────────────────────────────────────────────────────

function SearchRanksTab({ items }: { items: SearchRankItem[] }) {
  const byKeyword: Record<string, SearchRankItem[]> = {}
  for (const item of items) {
    if (!byKeyword[item.keyword]) byKeyword[item.keyword] = []
    byKeyword[item.keyword].push(item)
  }

  if (Object.keys(byKeyword).length === 0) return (
    <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
      <p className="text-sm text-text-secondary">검색 노출 데이터가 없어요</p>
      <p className="text-xs text-text-tertiary mt-1">수집 후 표시됩니다</p>
    </div>
  )

  const ownItems = items.filter(i => i.is_ours)

  return (
    <div className="space-y-6">
      {/* 자사 요약 */}
      {ownItems.length > 0 && (
        <div className="space-y-3">
          <SectionDivider tag="자사 노출 요약" />
          <div className="flex flex-wrap gap-2">
            {ownItems.map(item => (
              <div key={`${item.keyword}-${item.rank_position}`}
                   className="flex items-center gap-2 px-3 py-2 rounded-lg border border-accent/30 bg-accent-bg/30">
                <span className="text-xs text-text-secondary truncate max-w-[120px]">{item.keyword}</span>
                <span className="text-sm font-bold text-accent">{item.rank_position}위</span>
                <DeltaBadge delta={item.delta} prevRank={item.prev_rank} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 키워드별 전체 목록 */}
      <div className="space-y-4">
        <SectionDivider tag="키워드별 순위" />
        {Object.entries(byKeyword).map(([keyword, kItems]) => (
          <div key={keyword} className="border border-border rounded-lg bg-surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/40 flex items-center justify-between">
              <p className="text-sm font-semibold text-text-primary">{keyword}</p>
              <p className="text-xs text-text-tertiary">{kItems[0]?.rank_date} 기준 Top {kItems.length}</p>
            </div>
            <div className="divide-y divide-border">
              {kItems.slice(0, 20).map(item => (
                <div key={item.rank_position}
                     className={`flex items-center gap-3 px-4 py-2 hover:bg-gray-50 transition-colors ${
                       item.is_ours ? 'bg-accent-bg/20' : ''
                     }`}>
                  <span className={`w-6 text-center text-xs font-bold shrink-0 ${
                    item.rank_position === 1 ? 'text-yellow-500' :
                    item.rank_position === 2 ? 'text-gray-400' :
                    item.rank_position === 3 ? 'text-orange-400' : 'text-text-tertiary'
                  }`}>{item.rank_position}</span>
                  <span className={`flex-1 text-xs truncate ${item.is_ours ? 'font-semibold text-accent' : 'text-text-primary'}`}>
                    {item.product_title}
                  </span>
                  <span className="text-[11px] text-text-tertiary shrink-0 w-20 text-right truncate">{item.mall_name}</span>
                  <span className="text-[11px] text-text-secondary shrink-0 w-16 text-right">
                    {item.price > 0 ? `${item.price.toLocaleString()}원` : '-'}
                  </span>
                  <DeltaBadge delta={item.delta} prevRank={item.prev_rank} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 시장 현황 탭 ─────────────────────────────────────────────────────────────

function MarketTab({ items }: { items: MarketItem[] }) {
  const byCategory: Record<string, MarketItem[]> = {}
  for (const item of items) {
    if (!byCategory[item.category]) byCategory[item.category] = []
    byCategory[item.category].push(item)
  }

  if (Object.keys(byCategory).length === 0) return (
    <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
      <p className="text-sm text-text-secondary">시장 데이터가 없어요</p>
      <p className="text-xs text-text-tertiary mt-1">수집 후 표시됩니다</p>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <SectionDivider tag="경쟁사 현황" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">카테고리별 시장 현황</h2>
          <span className="text-sm text-text-tertiary">{items[0]?.collected_date} 기준</span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(byCategory).map(([cat, catItems]) => {
          const singles   = catItems.filter(i => !i.is_ours && i.price > 0)
          const ours      = catItems.filter(i => i.is_ours)
          const prices    = singles.map(i => i.price).sort((a, b) => a - b)
          const minPrice  = prices[0]
          const medPrice  = prices[Math.floor(prices.length / 2)]
          const top10     = catItems.slice(0, 10)

          return (
            <div key={cat} className="border border-border rounded-lg bg-surface overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/40">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-text-primary">{cat}</p>
                  <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
                    <span>최저 {minPrice?.toLocaleString()}원</span>
                    <span>중간 {medPrice?.toLocaleString()}원</span>
                    <span>총 {singles.length}개</span>
                  </div>
                </div>
                {ours.length > 0 && (
                  <p className="mt-1 text-xs text-accent font-medium">
                    자사 {ours.length}개 · 평균 {Math.round(ours.reduce((s, i) => s + i.price, 0) / ours.length).toLocaleString()}원
                  </p>
                )}
              </div>
              <div className="divide-y divide-border">
                {top10.map((item, idx) => (
                  <div key={idx}
                       className={`flex items-center gap-3 px-4 py-2 text-xs hover:bg-gray-50 ${
                         item.is_ours ? 'bg-accent-bg/20' : ''
                       }`}>
                    <span className={`flex-1 truncate ${item.is_ours ? 'font-semibold text-accent' : 'text-text-primary'}`}>
                      {item.product_title}
                    </span>
                    {item.volume_ml && (
                      <span className="text-text-tertiary shrink-0">{item.volume_ml}ml</span>
                    )}
                    <span className="text-text-secondary font-medium shrink-0 w-20 text-right">
                      {item.price.toLocaleString()}원
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── AI 인사이트 탭 ───────────────────────────────────────────────────────────

function InsightSections({ text }: { text: string }) {
  const sections = parseInsightSections(text)
  if (sections.length === 0) return (
    <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">{text}</p>
  )
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {sections.map(sec => {
        const style = INSIGHT_SECTIONS[sec.name] ?? { dot: 'bg-gray-400', header: 'text-text-primary', topBorder: 'border-t-gray-200' }
        return (
          <div key={sec.name}
               className={`border border-border rounded-lg p-4 bg-surface border-t-2 ${style.topBorder}`}>
            <div className="flex items-center gap-2 mb-2.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
              <p className={`text-xs font-bold ${style.header}`}>{sec.name}</p>
            </div>
            <ul className="space-y-1.5">
              {sec.items.map((item, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-text-secondary leading-relaxed">
                  <span className="shrink-0 text-text-tertiary mt-px">·</span>
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

function InsightTab() {
  const [loading, setLoading]     = useState(true)
  const [latest, setLatest]       = useState<NaverInsight | null>(null)
  const [history, setHistory]     = useState<NaverInsight[]>([])
  const [expandedId, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/naver/insights')
      .then(r => r.json())
      .then((data: NaverInsight[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setLatest(data[0])
          setHistory(data.slice(1))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="border border-border rounded-lg px-5 py-5 flex items-center gap-2">
      <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
      <p className="text-sm text-text-secondary">인사이트 불러오는 중...</p>
    </div>
  )

  if (!latest) return (
    <div className="border border-dashed border-border rounded-lg px-5 py-8 text-center">
      <p className="text-sm text-text-secondary">아직 분석된 인사이트가 없습니다</p>
      <p className="text-xs text-text-tertiary mt-1">다음 수집 시 자동으로 분석됩니다</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">AI 네이버 쇼핑 분석</p>
        <span className="text-[11px] text-text-tertiary">{latest.collected_at}</span>
      </div>
      <InsightSections text={latest.content} />
      {history.length > 0 && (
        <div className="pt-1 border-t border-border mt-3">
          <p className="text-xs text-text-tertiary font-medium py-2">이전 분석</p>
          {history.map(entry => (
            <div key={entry.id} className="border border-border rounded-lg mb-2 overflow-hidden">
              <button
                onClick={() => setExpanded(v => v === entry.id ? null : entry.id)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 text-left"
              >
                <span className="text-xs text-text-secondary">{entry.collected_at}</span>
                <span className="text-[10px] text-text-tertiary">{expandedId === entry.id ? '▲' : '▼'}</span>
              </button>
              {expandedId === entry.id && (
                <div className="px-4 pb-4 pt-1">
                  <InsightSections text={entry.content} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function NaverDashboard() {
  const [active, setActive] = useState<TabId>('trends')

  const [trends,      setTrends]      = useState<Record<string, TrendPoint[]> | null>(null)
  const [ranks,       setRanks]       = useState<SearchRankItem[] | null>(null)
  const [market,      setMarket]      = useState<MarketItem[] | null>(null)
  const [trendsLoad,  setTrendsLoad]  = useState(false)
  const [ranksLoad,   setRanksLoad]   = useState(false)
  const [marketLoad,  setMarketLoad]  = useState(false)

  useEffect(() => {
    if (active === 'trends' && trends === null && !trendsLoad) {
      setTrendsLoad(true)
      fetch('/api/naver/trends').then(r => r.json()).then(setTrends).catch(() => setTrends({})).finally(() => setTrendsLoad(false))
    }
    if (active === 'ranks' && ranks === null && !ranksLoad) {
      setRanksLoad(true)
      fetch('/api/naver/search-ranks').then(r => r.json()).then(setRanks).catch(() => setRanks([])).finally(() => setRanksLoad(false))
    }
    if (active === 'market' && market === null && !marketLoad) {
      setMarketLoad(true)
      fetch('/api/naver/market').then(r => r.json()).then(setMarket).catch(() => setMarket([])).finally(() => setMarketLoad(false))
    }
  }, [active, trends, ranks, market, trendsLoad, ranksLoad, marketLoad])

  function Spinner() {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-secondary">
        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        불러오는 중...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 탭 바 */}
      <div className="flex gap-0.5 p-0.5 bg-muted rounded-lg border border-border w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              active === tab.id
                ? 'bg-background text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      {active === 'trends' && (
        trendsLoad ? <Spinner /> : <TrendsTab data={trends ?? {}} />
      )}
      {active === 'ranks' && (
        ranksLoad ? <Spinner /> : <SearchRanksTab items={ranks ?? []} />
      )}
      {active === 'market' && (
        marketLoad ? <Spinner /> : <MarketTab items={market ?? []} />
      )}
      {active === 'insight' && <InsightTab />}
    </div>
  )
}
