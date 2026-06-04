'use client'

import type { OurRankingTimelineEntry } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  data: OurRankingTimelineEntry[]
}

function fmtHour(h: number): string {
  return h === 0 ? '자정' : h < 12 ? `오전 ${h}시` : h === 12 ? '오후 12시' : `오후 ${h - 12}시`
}

const CATEGORY_ORDER = ['전체', '스킨케어', '마스크팩', '클렌징', '선케어', '더모 코스메틱', '바디케어', '맨즈에딧']

export default function TodayRankingTimeline({ data }: Props) {
  if (data.length === 0) return (
    <section>
      <SectionDivider tag="오늘 순위 타임라인" />
      <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center">
        <p className="text-sm text-text-secondary">오늘 수집된 순위 데이터가 없어요</p>
        <p className="text-xs text-text-tertiary mt-1">3시간마다 자동 수집됩니다</p>
      </div>
    </section>
  )

  const productMap = new Map<string, { goods_name: string; categories: Map<string, { rank_hour: number; rank_position: number }[]> }>()
  for (const e of data) {
    if (!productMap.has(e.goods_no)) {
      productMap.set(e.goods_no, { goods_name: e.goods_name, categories: new Map() })
    }
    const prod = productMap.get(e.goods_no)!
    if (!prod.categories.has(e.category_name)) prod.categories.set(e.category_name, [])
    prod.categories.get(e.category_name)!.push({ rank_hour: e.rank_hour, rank_position: e.rank_position })
  }

  const achievements: { goods_name: string; category_name: string; rank_position: number; rank_hour: number }[] = []
  for (const [, prod] of productMap) {
    for (const [cat, snaps] of prod.categories) {
      const best = snaps.reduce((a, b) => a.rank_position <= b.rank_position ? a : b)
      if (best.rank_position <= 3) {
        achievements.push({ goods_name: prod.goods_name, category_name: cat, rank_position: best.rank_position, rank_hour: best.rank_hour })
      }
    }
  }
  achievements.sort((a, b) => a.rank_position - b.rank_position)

  const products = Array.from(productMap.entries())

  return (
    <section>
      <SectionDivider tag="오늘 순위 타임라인" />
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-xl font-semibold text-text-primary">오늘 시간별 순위 추이</h2>
        <span className="text-sm text-text-tertiary">3시간 간격</span>
      </div>

      {achievements.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {achievements.map((a, i) => (
            <div key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-bg border border-accent-border">
              <span className="text-accent font-bold text-sm">✦</span>
              <span className="text-xs font-semibold text-accent-fg">
                {fmtHour(a.rank_hour)} {a.category_name} {a.rank_position}위 달성
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {products.map(([goods_no, prod]) => {
          const sortedCats = Array.from(prod.categories.entries()).sort(([a], [b]) => {
            const ia = CATEGORY_ORDER.indexOf(a)
            const ib = CATEGORY_ORDER.indexOf(b)
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
          })

          const allHours = Array.from(
            new Set(Array.from(prod.categories.values()).flatMap(snaps => snaps.map(s => s.rank_hour)))
          ).sort((a, b) => a - b)

          if (allHours.length < 2) return null

          return (
            <div key={goods_no} className="border border-border rounded-lg bg-surface p-4 space-y-2">
              <p className="text-sm font-semibold text-text-primary">★ {prod.goods_name}</p>
              <div className="divide-y divide-border/50">
                {sortedCats.map(([catName, snaps]) => {
                  const sorted    = [...snaps].sort((a, b) => a.rank_hour - b.rank_hour)
                  const firstSnap = sorted[0]
                  const lastSnap  = sorted[sorted.length - 1]
                  const firstPos  = firstSnap.rank_position
                  const lastPos   = lastSnap.rank_position
                  const delta     = firstPos - lastPos
                  const bestPos   = Math.min(...snaps.map(s => s.rank_position))
                  const isBest    = lastPos === bestPos

                  return (
                    <div key={catName} className="flex items-center gap-3 py-2">
                      <span className="shrink-0 text-xs text-text-secondary w-24 truncate">{catName}</span>
                      <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                        <span className="text-text-tertiary">{firstPos}위</span>
                        <span className="text-text-tertiary">→</span>
                        <span className={isBest ? 'text-accent font-bold' : ''}>{lastPos}위</span>
                      </div>
                      {delta !== 0 && (
                        <span className={`text-xs font-semibold ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
                        </span>
                      )}
                      {bestPos <= 3 && lastPos !== bestPos && (
                        <span className="text-[10px] text-accent/70 ml-1">최고 {bestPos}위</span>
                      )}
                      <span className="text-[10px] text-text-tertiary ml-auto">
                        {fmtHour(firstSnap.rank_hour)} ~ {fmtHour(lastSnap.rank_hour)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        }).filter(Boolean)}
      </div>
    </section>
  )
}
