'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { InsightsSnapshot } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  history: InsightsSnapshot[]
}

function formatDate(ts: string) {
  const d = new Date(ts)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function SnapshotRow({ snap, prev }: { snap: InsightsSnapshot; prev?: InsightsSnapshot }) {
  const [open, setOpen] = useState(false)

  // keyword rank delta vs previous snapshot
  function getDelta(word: string, category: 'pos' | 'neg'): number | null {
    if (!prev) return null
    const prevList = category === 'pos' ? prev.positive_keywords : prev.negative_keywords
    const prevIdx = prevList.findIndex(k => k.word === word)
    const curList = category === 'pos' ? snap.positive_keywords : snap.negative_keywords
    const curIdx  = curList.findIndex(k => k.word === word)
    if (prevIdx === -1) return null  // new keyword
    return prevIdx - curIdx  // positive = moved up
  }

  const scoreColor = snap.avg_score >= 4.5 ? '#16A34A' : snap.avg_score >= 4.0 ? '#2D9C6E' : '#CA8A04'

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-surface">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-border-subtle/40 transition-colors"
      >
        {/* 날짜 */}
        <span className="text-xs text-text-tertiary w-28 sm:w-36 shrink-0">{formatDate(snap.snapshot_at)}</span>

        {/* 신규 리뷰 */}
        <span className={`text-xs font-semibold shrink-0 w-14 ${snap.new_reviews > 0 ? 'text-emerald-600' : 'text-text-tertiary'}`}>
          {snap.new_reviews > 0 ? `+${snap.new_reviews.toLocaleString()}` : '-'}
        </span>

        {/* 누적 */}
        <span className="hidden sm:block text-xs text-text-secondary shrink-0 w-20">
          총 {snap.total_reviews.toLocaleString()}개
        </span>

        {/* 평점 */}
        <span className="text-xs font-semibold shrink-0 w-10" style={{ color: scoreColor }}>
          ★ {snap.avg_score}
        </span>

        {/* 상위 키워드 미리보기 */}
        <span className="hidden sm:flex gap-1 flex-1 overflow-hidden">
          {snap.positive_keywords.slice(0, 3).map(k => (
            <span key={k.word} className="text-2xs px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 shrink-0">
              #{k.word}
            </span>
          ))}
        </span>

        <ChevronDown
          size={14}
          className={`shrink-0 text-text-tertiary transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-3 border-t border-border grid sm:grid-cols-2 gap-4">
              {/* 긍정 키워드 */}
              <div>
                <p className="text-2xs font-semibold text-emerald-600 uppercase tracking-wider mb-2">긍정 키워드 (★4–5)</p>
                <div className="flex flex-wrap gap-1.5">
                  {snap.positive_keywords.map((k, i) => {
                    const delta = getDelta(k.word, 'pos')
                    return (
                      <span key={k.word} className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100">
                        <span className="font-medium">#{k.word}</span>
                        <span className="opacity-60">{k.cnt}</span>
                        {delta !== null && delta !== 0 && (
                          <span className={delta > 0 ? 'text-emerald-500' : 'text-red-400'}>
                            {delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
                          </span>
                        )}
                        {delta === null && <span className="text-blue-400 text-2xs">new</span>}
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* 부정 키워드 */}
              <div>
                <p className="text-2xs font-semibold text-red-500 uppercase tracking-wider mb-2">불만 키워드 (★1–2)</p>
                <div className="flex flex-wrap gap-1.5">
                  {snap.negative_keywords.map((k) => {
                    const delta = getDelta(k.word, 'neg')
                    return (
                      <span key={k.word} className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-red-50 text-red-800 border border-red-100">
                        <span className="font-medium">#{k.word}</span>
                        <span className="opacity-60">{k.cnt}</span>
                        {delta !== null && delta !== 0 && (
                          <span className={delta > 0 ? 'text-emerald-500' : 'text-red-400'}>
                            {delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
                          </span>
                        )}
                        {delta === null && <span className="text-blue-400">new</span>}
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* 지표 */}
              <div className="sm:col-span-2 flex gap-6 text-xs text-text-tertiary">
                <span>재구매 언급 <strong className="text-text-secondary">{snap.repurchase_pct}%</strong></span>
                <span>5점 비율 <strong className="text-text-secondary">{snap.five_star_pct}%</strong></span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function InsightsHistory({ history }: Props) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? history : history.slice(0, 10)

  return (
    <div className="space-y-4">
      <div>
        <SectionDivider tag="수집 이력" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">수집 이력</h2>
          {history.length > 0 && (
            <span className="text-sm text-text-tertiary">{history.length}회</span>
          )}
        </div>
      </div>

      {history.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg px-6 py-10 text-center">
          <p className="text-sm text-text-secondary">아직 수집 이력이 없어요</p>
          <p className="text-xs text-text-tertiary mt-1">다음 pipeline 실행 후 자동으로 기록됩니다</p>
        </div>
      ) : (
        <>
          {/* 헤더 */}
          <div className="flex items-center gap-3 px-4 text-2xs font-semibold text-text-tertiary uppercase tracking-wider">
            <span className="w-28 sm:w-36 shrink-0">날짜</span>
            <span className="w-14 shrink-0">신규</span>
            <span className="hidden sm:block w-20 shrink-0">누적</span>
            <span className="w-10 shrink-0">평점</span>
            <span className="hidden sm:block">주요 키워드</span>
          </div>

          <div className="space-y-1.5">
            {visible.map((snap, i) => (
              <SnapshotRow key={snap.id} snap={snap} prev={history[i + 1]} />
            ))}
          </div>

          {history.length > 10 && (
            <button
              onClick={() => setShowAll(v => !v)}
              className="w-full py-2 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {showAll ? '접기 ↑' : `전체 보기 (${history.length}회) ↓`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
