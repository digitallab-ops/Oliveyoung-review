'use client'

import { useState, useEffect, useCallback } from 'react'
import type { OlivepickMonth, PromoMonthlyInsight } from '@/lib/types'
import OlivepickMonthAccordion from './OlivepickMonthAccordion'
import SectionDivider from './SectionDivider'

export default function OlivepickTab() {
  const [data, setData] = useState<OlivepickMonth[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/promo-history?type=olivepick')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [])

  const handleInsightUpdate = useCallback((month: string, insight: PromoMonthlyInsight) => {
    setData(prev => prev?.map(m => m.month === month ? { ...m, insight } : m) ?? prev)
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <SectionDivider tag="올영픽" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">올영픽 월별 이력</h2>
          <span className="text-sm text-text-tertiary">월별 기획 컨셉 및 입점 현황</span>
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 rounded-lg bg-border/40 animate-shimmer" />
          ))}
        </div>
      )}

      {!loading && data?.length === 0 && (
        <div className="border border-dashed border-border rounded-lg px-6 py-10 text-center">
          <p className="text-sm text-text-secondary">수집된 올영픽 데이터가 없습니다</p>
          <p className="text-xs text-text-tertiary mt-1">수집기가 실행되면 자동으로 표시됩니다</p>
        </div>
      )}

      {!loading && data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((m, i) => (
            <OlivepickMonthAccordion
              key={m.month}
              month={m}
              defaultOpen={i === 0}
              onInsightUpdate={handleInsightUpdate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
