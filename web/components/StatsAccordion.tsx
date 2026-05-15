'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import type { ScoreDist, ProductStats } from '@/lib/types'

interface StatsAccordionProps {
  scoreDist:    ScoreDist[]
  productStats: ProductStats[]
}

const SCORE_COLORS = ['#DC2626', '#EA580C', '#CA8A04', '#2D9C6E', '#16A34A']

type SortKey = 'goods_name' | 'review_cnt' | 'avg_score' | 'repurchase_pct'

function repurchaseStyle(pct: number | null): string {
  if (pct === null || pct === undefined) return 'text-text-secondary'
  if (pct >= 50) return 'text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded'
  if (pct >= 30) return 'text-emerald-600'
  if (pct >= 10) return 'text-text-secondary'
  return 'text-red-400'
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: 'asc' | 'desc' }) {
  if (col !== sortKey) return <ChevronsUpDown size={10} className="text-text-tertiary/50 ml-0.5 inline" />
  return sortDir === 'asc'
    ? <ChevronUp size={10} className="text-accent ml-0.5 inline" />
    : <ChevronDown size={10} className="text-accent ml-0.5 inline" />
}

export default function StatsAccordion({ scoreDist, productStats }: StatsAccordionProps) {
  const [open, setOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('review_cnt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

  const handleSort = (col: SortKey) => {
    if (sortKey === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(col)
      setSortDir('desc')
    }
  }

  const filtered = productStats
    .filter(p => p.goods_name.includes(search))
    .sort((a, b) => {
      let va: string | number = a[sortKey] ?? 0
      let vb: string | number = b[sortKey] ?? 0
      if (sortKey === 'goods_name') {
        return sortDir === 'asc'
          ? String(va).localeCompare(String(vb), 'ko')
          : String(vb).localeCompare(String(va), 'ko')
      }
      return sortDir === 'asc' ? Number(va) - Number(vb) : Number(vb) - Number(va)
    })

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-surface">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-border-subtle/50 transition-colors"
      >
        <span className="text-sm font-semibold text-text-secondary">상세 통계</span>
        <ChevronDown
          size={16}
          className={`text-text-tertiary transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-6 space-y-6 border-t border-border">
              {/* 평점 분포 */}
              <div className="pt-5">
                <p className="font-label text-[10px] font-medium tracking-[0.16em] uppercase text-accent/70 mb-4">
                  Score Distribution
                </p>
                <div className="space-y-2.5">
                  {[5, 4, 3, 2, 1].map(s => {
                    const row = scoreDist.find(r => r.score === s)
                    const pct = row?.pct || 0
                    const cnt = row?.cnt || 0
                    const color = SCORE_COLORS[s - 1]
                    return (
                      <div key={s} className="flex items-center gap-3">
                        <span className="text-xs font-medium text-text-secondary w-10">★{s}</span>
                        <div className="flex-1 h-2 bg-border-subtle rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: color }}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, delay: (5 - s) * 0.06, ease: [0.16, 1, 0.3, 1] }}
                          />
                        </div>
                        <span className="text-xs text-text-tertiary w-10 text-right">{pct}%</span>
                        <span className="text-xs text-text-tertiary w-14 text-right">({cnt.toLocaleString()})</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 상품별 현황 */}
              <div>
                <p className="font-label text-[10px] font-medium tracking-[0.16em] uppercase text-accent/70 mb-3">
                  By Product
                </p>

                {/* 검색 */}
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="상품명 검색..."
                  className="w-full border border-border rounded-md px-3 py-1.5 text-xs mb-3
                             bg-surface text-text-primary placeholder:text-text-tertiary
                             focus:outline-none focus:ring-1 focus:ring-accent/30 focus:border-accent/40
                             transition-colors"
                />

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        {([
                          { key: 'goods_name' as SortKey, label: '상품명', align: 'left' },
                          { key: 'review_cnt' as SortKey, label: '리뷰', align: 'right' },
                          { key: 'avg_score' as SortKey, label: '평점', align: 'right' },
                          { key: 'repurchase_pct' as SortKey, label: '재구매', align: 'right' },
                        ]).map(col => (
                          <th
                            key={col.key}
                            className={`py-2 ${col.align === 'right' ? 'text-right px-2' : 'text-left pr-4'} font-semibold text-text-tertiary`}
                          >
                            <button
                              onClick={() => handleSort(col.key)}
                              className="hover:text-text-primary transition-colors duration-150"
                            >
                              {col.label}
                              <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-text-tertiary">
                            검색 결과가 없습니다
                          </td>
                        </tr>
                      ) : (
                        filtered.map((p, i) => (
                          <tr key={i} className="border-b border-border-subtle last:border-0">
                            <td
                              className="py-2.5 pr-4 text-text-primary font-medium max-w-[200px] truncate"
                              title={p.goods_name}
                            >
                              {p.goods_name.length > 28 ? p.goods_name.slice(0, 28) + '…' : p.goods_name}
                            </td>
                            <td className="py-2.5 px-2 text-right text-text-secondary">
                              {Number(p.review_cnt).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-2 text-right">
                              <span style={{ color: SCORE_COLORS[Math.round(Number(p.avg_score)) - 1] }}>
                                {Number(p.avg_score).toFixed(1)}
                              </span>
                            </td>
                            <td className="py-2.5 pl-2 text-right">
                              {p.repurchase_pct != null ? (
                                <span className={repurchaseStyle(Number(p.repurchase_pct))}>
                                  {p.repurchase_pct}%
                                </span>
                              ) : '-'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
