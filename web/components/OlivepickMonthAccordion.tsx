'use client'

import { useState } from 'react'
import type { OlivepickMonth, PromoMonthlyInsight } from '@/lib/types'
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
  const [saving, setSaving] = useState(false)

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
        generated_at: new Date().toISOString(),
      }
      setInsight(newInsight)
      onInsightUpdate(month.month, newInsight)
    } catch {
      alert('AI 분석 생성에 실패했습니다.')
    } finally {
      setGenerating(false)
    }
  }

  function handleEditStart() {
    setEditTags(insight?.concept_tags.join(', ') ?? '')
    setEditSummary(insight?.summary ?? '')
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    const tags = editTags.split(',').map(t => t.trim()).filter(Boolean)
    try {
      const res = await fetch('/api/promo-insight', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: month.month, concept_tags: tags, summary: editSummary }),
      })
      if (!res.ok) throw new Error()
      const updated: PromoMonthlyInsight = {
        month: month.month,
        concept_tags: tags,
        summary: editSummary,
        generated_at: insight?.generated_at ?? null,
      }
      setInsight(updated)
      onInsightUpdate(month.month, updated)
      setEditing(false)
    } catch {
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
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
              <div className="space-y-2">
                <div className="flex items-start gap-2 flex-wrap">
                  {insight.concept_tags.map(tag => (
                    <span key={tag} className="text-xs font-medium text-accent-fg bg-accent-bg border border-accent-border px-2 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                  <button
                    onClick={handleEditStart}
                    className="text-[10px] text-text-tertiary hover:text-text-secondary underline ml-auto"
                  >
                    수정
                  </button>
                </div>
                {insight.summary && (
                  <p className="text-xs text-text-secondary leading-relaxed">{insight.summary}</p>
                )}
              </div>
            )}

            {insight && editing && (
              <div className="space-y-2">
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
                  <label className="text-[10px] text-text-tertiary">요약</label>
                  <textarea
                    value={editSummary}
                    onChange={e => setEditSummary(e.target.value)}
                    rows={4}
                    className="w-full mt-0.5 text-xs border border-border rounded px-2 py-1 bg-background text-text-primary focus:outline-none focus:border-accent resize-none"
                  />
                </div>
                <div className="flex gap-2">
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
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
