'use client'

import { useState } from 'react'
import type { OlivepickMonth, PromoMonthlyInsight, PromoInsightHistoryEntry } from '@/lib/types'
import { extractShortName } from '@/lib/utils'

interface Props {
  month: OlivepickMonth
  defaultOpen?: boolean
  onInsightUpdate: (month: string, insight: PromoMonthlyInsight) => void
}

export default function OlivepickMonthAccordion({ month, defaultOpen = false, onInsightUpdate }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [insight, setInsight] = useState<PromoMonthlyInsight | null>(month.insight)
  const [generating, setGenerating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTags, setEditTags] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editActionPoints, setEditActionPoints] = useState('')
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<PromoInsightHistoryEntry[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  const hasCats = month.category_counts.length > 0

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/promo-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: month.month, products: month.products }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      const newInsight: PromoMonthlyInsight = {
        month: month.month,
        concept_tags: data.concept_tags,
        summary: data.summary,
        action_points: data.action_points ?? [],
        generated_at: new Date().toISOString(),
      }
      setInsight(newInsight)
      onInsightUpdate(month.month, newInsight)
      setEditing(false)
      setHistory(null) // 히스토리 캐시 초기화 (다음 열 때 새로 로드)
    } catch {
      alert('AI 분석 생성에 실패했습니다.')
    } finally {
      setGenerating(false)
    }
  }

  function handleEditStart() {
    setEditTags(insight?.concept_tags.join(', ') ?? '')
    setEditSummary(insight?.summary ?? '')
    setEditActionPoints(insight?.action_points.join('\n') ?? '')
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    const tags = editTags.split(',').map(t => t.trim()).filter(Boolean)
    const actionPoints = editActionPoints.split('\n').map(t => t.trim()).filter(Boolean)
    try {
      const res = await fetch('/api/promo-insight', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: month.month, concept_tags: tags, summary: editSummary, action_points: actionPoints }),
      })
      if (!res.ok) throw new Error()
      const updated: PromoMonthlyInsight = {
        month: month.month,
        concept_tags: tags,
        summary: editSummary,
        action_points: actionPoints,
        generated_at: insight?.generated_at ?? null,
      }
      setInsight(updated)
      onInsightUpdate(month.month, updated)
      setEditing(false)
      setHistory(null)
    } catch {
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function handleHistoryToggle() {
    if (historyOpen) { setHistoryOpen(false); return }
    setHistoryOpen(true)
    if (history !== null) return
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/promo-insight?month=${month.month}`)
      const data: PromoInsightHistoryEntry[] = await res.json()
      setHistory(data)
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  return (
    <div className="border border-border rounded-lg bg-surface overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-background transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-text-primary">{month.month}</span>
          <span className="text-xs text-text-tertiary">{month.total_count}개 상품</span>
          {month.our_count > 0 && (
            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              자사 {month.our_count}개
            </span>
          )}
          {insight && insight.concept_tags.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {insight.concept_tags.slice(0, 3).map(tag => (
                <span key={tag} className="text-[10px] font-medium text-accent-fg bg-accent-bg border border-accent-border px-1.5 py-0.5 rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="text-text-tertiary text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {/* Category breakdown */}
          {hasCats && (
            <div>
              <p className="text-[10px] font-semibold tracking-widest uppercase text-text-tertiary mb-2">카테고리</p>
              <div className="flex flex-wrap gap-1.5">
                {month.category_counts.map(c => (
                  <span key={c.category_name}
                    className="text-xs text-text-secondary bg-background border border-border px-2 py-0.5 rounded-full">
                    {c.category_name} <span className="font-semibold text-text-primary">{c.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Product list */}
          <div>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-text-tertiary mb-2">상품 목록</p>
            <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {month.products.map((p, i) => (
                <li key={p.goods_no}
                  className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
                    p.is_ours ? 'bg-emerald-50 text-emerald-800' : 'text-text-secondary'
                  }`}
                >
                  <span className="w-6 text-right shrink-0 text-text-tertiary font-mono">
                    {p.rank_position ?? i + 1}
                  </span>
                  <span className="flex-1 truncate" title={p.goods_name}>{extractShortName(p.goods_name)}</span>
                  {p.is_ours && <span className="shrink-0 text-[10px] font-semibold text-emerald-600">자사</span>}
                  {p.category_name && (
                    <span className="shrink-0 text-[10px] text-text-tertiary">{p.category_name}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* AI Insight panel */}
          <div className="border-t border-border pt-3">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-text-tertiary mb-2">컨셉 분석</p>

            {!insight && !generating && (
              <button
                onClick={handleGenerate}
                className="text-xs font-medium text-accent border border-accent-border bg-accent-bg px-3 py-1.5 rounded hover:bg-amber-100 transition-colors"
              >
                AI 컨셉 분석 생성
              </button>
            )}

            {generating && (
              <p className="text-xs text-text-tertiary animate-pulse">분석 중...</p>
            )}

            {insight && !editing && (
              <div className="space-y-3">
                {/* 컨셉 태그 */}
                <div className="flex items-start gap-2 flex-wrap">
                  {insight.concept_tags.map(tag => (
                    <span key={tag} className="text-xs font-medium text-accent-fg bg-accent-bg border border-accent-border px-2 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                  <button
                    onClick={handleEditStart}
                    className="text-[10px] text-text-tertiary hover:text-text-secondary underline ml-auto shrink-0"
                  >
                    수정
                  </button>
                </div>

                {/* 기획 요약 */}
                {insight.summary && (
                  <div className="bg-background rounded-md px-3 py-2.5">
                    <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest mb-1.5">기획 요약</p>
                    <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">{insight.summary}</p>
                  </div>
                )}

                {/* 대응 인사이트 */}
                {insight.action_points && insight.action_points.length > 0 && (
                  <div className="bg-accent-bg border border-accent-border rounded-md px-3 py-2.5">
                    <p className="text-[10px] font-semibold text-accent uppercase tracking-widest mb-2">대응 인사이트</p>
                    <ul className="space-y-1.5">
                      {insight.action_points.map((pt, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-accent-fg leading-snug">
                          <span className="text-accent font-bold shrink-0 mt-0.5">·</span>
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {insight.generated_at && (
                  <p className="text-[10px] text-text-tertiary">
                    {new Date(insight.generated_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 생성
                  </p>
                )}
              </div>
            )}

            {insight && editing && (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-text-tertiary">태그 (쉼표로 구분)</label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={e => setEditTags(e.target.value)}
                    className="w-full mt-0.5 text-xs border border-border rounded px-2 py-1 bg-background text-text-primary focus:outline-none focus:border-accent"
                    placeholder="1+1, 봄 시즌, 굿즈 기획"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-tertiary">기획 요약</label>
                  <textarea
                    value={editSummary}
                    onChange={e => setEditSummary(e.target.value)}
                    rows={3}
                    className="w-full mt-0.5 text-xs border border-border rounded px-2 py-1 bg-background text-text-primary focus:outline-none focus:border-accent resize-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-tertiary">대응 인사이트 (줄바꿈으로 구분)</label>
                  <textarea
                    value={editActionPoints}
                    onChange={e => setEditActionPoints(e.target.value)}
                    rows={4}
                    className="w-full mt-0.5 text-xs border border-border rounded px-2 py-1 bg-background text-text-primary focus:outline-none focus:border-accent resize-none"
                    placeholder="각 항목을 줄바꿈으로 구분해서 입력"
                  />
                </div>
                <div className="flex gap-2 items-center">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="text-xs font-medium text-white bg-accent px-3 py-1 rounded disabled:opacity-50"
                  >
                    {saving ? '저장 중...' : '저장'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="text-xs text-text-tertiary hover:text-text-secondary"
                  >
                    취소
                  </button>
                  <div className="ml-auto flex flex-col items-end gap-0.5">
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="text-xs font-semibold text-amber-700 border border-amber-300 bg-amber-50 px-3 py-1 rounded hover:bg-amber-100 transition-colors disabled:opacity-50"
                    >
                      {generating ? 'AI 재생성 중...' : 'AI 재생성'}
                    </button>
                    <p className="text-[10px] text-text-tertiary">현재 내용은 이력에 보존됩니다</p>
                  </div>
                </div>
              </div>
            )}

            {/* 이전 분석 이력 */}
            {insight && (
              <div className="mt-3 border-t border-border/50 pt-2">
                <button
                  onClick={handleHistoryToggle}
                  className="text-[10px] text-text-tertiary hover:text-text-secondary flex items-center gap-1"
                >
                  <span>이전 분석 이력</span>
                  <span>{historyOpen ? '▲' : '▼'}</span>
                </button>

                {historyOpen && (
                  <div className="mt-2 space-y-3">
                    {historyLoading && (
                      <p className="text-[10px] text-text-tertiary animate-pulse">불러오는 중...</p>
                    )}
                    {!historyLoading && history?.length === 0 && (
                      <p className="text-[10px] text-text-tertiary">이전 이력이 없습니다</p>
                    )}
                    {!historyLoading && history && history.length > 0 && history.map(h => (
                      <div key={h.id} className="bg-background rounded p-2.5 space-y-1.5 border border-border/50">
                        <div className="flex flex-wrap gap-1 items-center">
                          {h.concept_tags.map(tag => (
                            <span key={tag} className="text-[10px] text-text-tertiary bg-border/40 border border-border px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                          <span className="ml-auto text-[10px] text-text-tertiary shrink-0">
                            {new Date(h.saved_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {h.summary && <p className="text-[11px] text-text-tertiary leading-relaxed">{h.summary}</p>}
                        {h.action_points?.length > 0 && (
                          <ul className="space-y-0.5 pt-0.5">
                            {h.action_points.map((pt, i) => (
                              <li key={i} className="text-[11px] text-text-tertiary flex items-start gap-1.5">
                                <span className="shrink-0">·</span><span>{pt}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
