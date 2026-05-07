'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts'
import type { ScoreDist, ProductStats } from '@/lib/types'

interface StatsAccordionProps {
  scoreDist:    ScoreDist[]
  productStats: ProductStats[]
}

const SCORE_COLORS = ['#DC2626', '#EA580C', '#CA8A04', '#2D9C6E', '#16A34A']

export default function StatsAccordion({ scoreDist, productStats }: StatsAccordionProps) {
  const [open, setOpen] = useState(false)

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
                <p className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider mb-4">
                  평점 분포
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
                <p className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider mb-4">
                  상품별 현황
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 pr-4 font-semibold text-text-tertiary">상품명</th>
                        <th className="text-right py-2 px-2 font-semibold text-text-tertiary">리뷰</th>
                        <th className="text-right py-2 px-2 font-semibold text-text-tertiary">평점</th>
                        <th className="text-right py-2 pl-2 font-semibold text-text-tertiary">재구매</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productStats.slice(0, 15).map((p, i) => (
                        <tr key={i} className="border-b border-border-subtle last:border-0">
                          <td className="py-2.5 pr-4 text-text-primary font-medium max-w-[200px] truncate">
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
                          <td className="py-2.5 pl-2 text-right text-text-secondary">
                            {p.repurchase_pct ? `${p.repurchase_pct}%` : '-'}
                          </td>
                        </tr>
                      ))}
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
