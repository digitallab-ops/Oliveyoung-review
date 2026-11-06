'use client'

import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import SectionDivider from '@/components/SectionDivider'

/*
 * 네이버는 DataLab 검색 트렌드만 남겼다.
 *
 * 쇼핑 검색 API(search/shop.json)를 네이버가 2026-08-01 부터 닫았다.
 * 키 문제가 아니다 — 같은 키로 블로그 검색은 200 이 오고 쇼핑만
 * `404 SE05 존재하지 않는 검색 api` 가 온다.
 *
 * 그래서 '검색 노출', '시장 현황', 'AI 인사이트' 탭을 들어냈다.
 * 마지막 데이터가 2026-07-30/31 인데 화면에서는 최신처럼 보였고,
 * 인사이트는 빈 입력으로 지어낸 글이었다.
 *
 * DataLab 은 별개 API 라 지금도 정상이다. 되살릴 땐 git 이력에서
 * SearchRanksTab / MarketTab / InsightTab 을 꺼내 쓰면 된다.
 */

interface TrendPoint { date: string; ratio: number }

const COLORS = ['#2563EB', '#16A34A', '#DC2626', '#9333EA', '#EA580C']

// ─── 트렌드 탭 ────────────────────────────────────────────────────────────────

function TrendsTab({ data }: { data: Record<string, TrendPoint[]> }) {
  const keywords = Object.keys(data)
  if (keywords.length === 0) return (
    <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
      <p className="text-sm text-text-secondary">트렌드 데이터가 없어요</p>
      <p className="text-xs text-text-tertiary mt-1">수집 후 표시됩니다</p>
    </div>
  )

  const allDates = [...new Set(keywords.flatMap(k => data[k].map(p => p.date)))].sort()
  const chartData = allDates.map(date => {
    const point: Record<string, any> = { date: date.slice(5) }
    for (const kw of keywords) {
      const found = data[kw].find(p => p.date === date)
      if (found) point[kw] = found.ratio
    }
    return point
  })

  // 최신 주차 값 요약
  const lastDate = allDates[allDates.length - 1]
  const latestValues = keywords.map(kw => {
    const pt = data[kw].find(p => p.date === lastDate)
    return { kw, ratio: pt?.ratio ?? null }
  }).filter(v => v.ratio !== null).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))

  return (
    <div className="space-y-4">
      <div>
        <SectionDivider tag="DataLab" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">네이버 검색 트렌드</h2>
          <span className="text-sm text-text-tertiary">최근 8주 · 0~100 상대지수</span>
        </div>
      </div>

      {/* 최신 수치 요약 칩 */}
      {latestValues.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {latestValues.map(({ kw, ratio }, i) => (
            <div key={kw} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-surface text-xs">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[keywords.indexOf(kw) % COLORS.length] }} />
              <span className="text-text-secondary">{kw}</span>
              <span className="font-semibold text-text-primary">{ratio}</span>
            </div>
          ))}
          <span className="text-[11px] text-text-tertiary self-center">{lastDate?.slice(5)} 기준</span>
        </div>
      )}

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

// ─── 메인 ─────────────────────────────────────────────────────────────────────

export default function NaverDashboard() {
  const [trends, setTrends] = useState<Record<string, TrendPoint[]> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/naver/trends')
      .then(r => r.json())
      .then(d => setTrends(d && typeof d === 'object' ? d : {}))
      .catch(() => setTrends({}))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-text-secondary">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          불러오는 중...
        </div>
      ) : (
        <TrendsTab data={trends ?? {}} />
      )}

      <p className="text-xs text-text-tertiary leading-relaxed border-t border-border pt-4">
        네이버는 검색 트렌드만 제공합니다. 쇼핑 검색 API 가 2026년 8월부터
        중단되어 검색 노출 순위와 경쟁사 시장 데이터는 수집할 수 없습니다.
      </p>
    </div>
  )
}
