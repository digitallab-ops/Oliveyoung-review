'use client'

import { useState, useMemo } from 'react'
import type { DiscountStatus, DiscountEntry } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  data: DiscountStatus
}

type Scope = 'all' | 'ours' | 'rival'

function shortName(name: string): string {
  return name.replace(/\[.*?\]\s*/g, '').trim()
}

/** 할인율이 클수록 진하게. 눈으로 바로 크기가 읽히도록 3단계만 쓴다. */
function rateTone(pct: number): string {
  if (pct >= 40) return 'text-red-600'
  if (pct >= 20) return 'text-amber-600'
  return 'text-text-secondary'
}

function DiscountRow({ d }: { d: DiscountEntry }) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-md border ${
        d.is_ours ? 'bg-accent-bg border-accent-border' : 'bg-surface border-border'
      }`}
    >
      {/* 할인율 — 막대로 크기를 같이 보여 준다 */}
      <div className="shrink-0 w-14">
        <div className={`text-right text-sm font-semibold tabular-nums ${rateTone(d.discount_rate)}`}>
          {d.discount_rate}%
        </div>
        <div className="mt-0.5 h-1 rounded-full bg-border overflow-hidden">
          <div
            className={`h-full rounded-full ${
              d.discount_rate >= 40 ? 'bg-red-500' : d.discount_rate >= 20 ? 'bg-amber-500' : 'bg-text-tertiary'
            }`}
            style={{ width: `${Math.min(100, d.discount_rate)}%` }}
          />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {d.is_ours && (
            <span className="shrink-0 text-[10px] font-semibold bg-accent text-white px-1.5 py-0.5 rounded">
              자사
            </span>
          )}
          <p className="text-xs text-text-primary truncate">{shortName(d.goods_name)}</p>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-tertiary tabular-nums">
          <span>
            <span className="line-through">{d.base_price.toLocaleString()}원</span>
            {' → '}
            <span className="text-text-secondary font-medium">{d.sale_price.toLocaleString()}원</span>
          </span>
          {d.category_name && <span className="truncate">· {d.category_name}</span>}
          {d.rank_position != null && <span>· {d.rank_position}위</span>}
        </div>
      </div>

      <span className="shrink-0 text-[10px] text-text-tertiary/70 tabular-nums">
        {d.recorded_on.slice(5)}
      </span>
    </div>
  )
}

function StatTile({
  label, rate, count, highlight,
}: { label: string; rate: number | null; count: number; highlight?: boolean }) {
  return (
    <div
      className={`flex-1 min-w-0 rounded-lg border px-3 py-2.5 ${
        highlight ? 'bg-accent-bg border-accent-border' : 'bg-surface border-border'
      }`}
    >
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold text-text-primary tabular-nums">
          {rate != null ? `${rate}%` : '—'}
        </span>
        <span className="text-[11px] text-text-tertiary tabular-nums">{count}개</span>
      </div>
    </div>
  )
}

export default function DiscountSection({ data }: Props) {
  const [scope, setScope] = useState<Scope>('all')
  const [showAll, setShowAll] = useState(false)

  const filtered = useMemo(() => {
    if (scope === 'ours') return data.entries.filter(d => d.is_ours)
    if (scope === 'rival') return data.entries.filter(d => !d.is_ours)
    return data.entries
  }, [data.entries, scope])

  if (data.entries.length === 0) return null

  const shown = showAll ? filtered : filtered.slice(0, 10)

  // 평균 차이는 표본이 작을 때 쉽게 흔들린다. 숫자만 던지지 않고
  // 자사 표본 수를 같이 보여 줘서 과신하지 않게 한다.
  const gap =
    data.ours_avg != null && data.rival_avg != null
      ? Math.round((data.ours_avg - data.rival_avg) * 10) / 10
      : null

  const tabs: { id: Scope; label: string; n: number }[] = [
    { id: 'all',   label: '전체',   n: data.entries.length },
    { id: 'rival', label: '경쟁사', n: data.entries.filter(d => !d.is_ours).length },
    { id: 'ours',  label: '자사',   n: data.entries.filter(d => d.is_ours).length },
  ]

  return (
    <div>
      <div className="mb-4">
        <SectionDivider tag="할인 현황" />
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xl font-semibold text-text-primary">지금 얼마나 깎고 있나</h2>
          <span className="text-sm text-text-tertiary">최근 14일 · 세일가 기준</span>
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          정가가 아니라 실제 판매가로 봅니다
          {data.since && ` — ${data.since.slice(5).replace('-', '/')}부터 수집`}
        </p>
      </div>

      {/* 자사 vs 경쟁사 평균 */}
      <div className="flex gap-2 mb-3">
        <StatTile label="경쟁사 평균 할인율" rate={data.rival_avg} count={data.rival_count} />
        <StatTile label="자사 평균 할인율" rate={data.ours_avg} count={data.ours_count} highlight />
      </div>

      {gap != null && (
        <p className="text-xs text-text-secondary mb-4 px-0.5">
          {gap > 0 ? (
            <>
              자사가 경쟁사보다 평균{' '}
              <span className="font-semibold text-red-600">{Math.abs(gap)}%p 더</span>{' '}
              깎고 있어요.
            </>
          ) : gap < 0 ? (
            <>
              자사가 경쟁사보다 평균{' '}
              <span className="font-semibold text-emerald-600">{Math.abs(gap)}%p 덜</span>{' '}
              깎고 있어요.
            </>
          ) : (
            <>자사와 경쟁사의 평균 할인율이 같아요.</>
          )}
          {data.ours_count < 50 && (
            <span className="text-text-tertiary">
              {' '}자사 표본이 {data.ours_count}개라 아직 참고용입니다.
            </span>
          )}
        </p>
      )}

      {/* 필터 */}
      <div className="flex gap-1.5 mb-2.5">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => { setScope(t.id); setShowAll(false) }}
            className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
              scope === t.id
                ? 'bg-accent text-white border-accent'
                : 'border-border text-text-secondary hover:text-text-primary hover:bg-border-subtle'
            }`}
          >
            {t.label} <span className="tabular-nums opacity-70">{t.n}</span>
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {shown.map(d => (
          <DiscountRow key={`${d.goods_no}-${d.recorded_on}`} d={d} />
        ))}
        {filtered.length === 0 && (
          <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center">
            <p className="text-sm text-text-secondary">해당하는 할인 상품이 없어요</p>
          </div>
        )}
        {filtered.length > 10 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="w-full text-xs text-text-tertiary hover:text-text-secondary py-2 border-t border-border-subtle mt-1"
          >
            {showAll ? '접기 ▲' : `${filtered.length - 10}개 더 보기 ▼`}
          </button>
        )}
      </div>
    </div>
  )
}
