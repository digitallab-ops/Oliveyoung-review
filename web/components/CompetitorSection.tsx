'use client'

import { useState, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { CompetitorSummary, CompetitorInsight } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'
import CompetitorKeywords from '@/components/CompetitorKeywords'

interface Props {
  summaries: CompetitorSummary[]
  insights?: CompetitorInsight[]
}

function extractBrand(goods_name: string): string {
  const m = goods_name.match(/^([^\[]+?)(?:\[|$)/)
  return m ? m[1].trim() : goods_name.split(' ')[0]
}

function formatDate(ts: string) {
  const d = new Date(ts)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

function ProductCard({ s }: { s: CompetitorSummary }) {
  const [open, setOpen] = useState(false)
  const bestRank = s.categories.length > 0
    ? s.categories.reduce((a, b) => a.rank < b.rank ? a : b)
    : null

  const shortName = s.goods_name
    .replace(/\[.*?\]\s*/g, '')
    .replace(/^셀퓨전씨\s*/, '')
    .trim()

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-surface">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-border-subtle/40 transition-colors"
      >
        <div className="flex-1 min-w-0 pr-3">
          <p className="text-sm font-medium text-text-primary truncate">{shortName}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
            {bestRank && (
              <span className="text-xs text-red-500 font-semibold">{bestRank.name} {bestRank.rank}위</span>
            )}
            {s.categories.filter(c => c !== bestRank).slice(0, 2).map(c => (
              <span key={c.name} className="text-xs text-text-tertiary">{c.name} {c.rank}위</span>
            ))}
            {s.review_cnt > 0 && (
              <span className="text-[10px] text-text-tertiary/60">리뷰 {s.review_cnt}개</span>
            )}
          </div>
          {(s.price || s.volume || s.bundle_info) && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {s.price && (
                <span className="text-[10px] font-medium bg-muted border border-border text-text-secondary px-1.5 py-0.5 rounded">
                  {s.price.toLocaleString()}원
                </span>
              )}
              {s.volume && (
                <span className="text-[10px] font-medium bg-muted border border-border text-text-secondary px-1.5 py-0.5 rounded">
                  {s.volume}
                </span>
              )}
              {s.bundle_info && (
                <span className="text-[10px] font-medium bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded truncate max-w-[180px]" title={s.bundle_info}>
                  {s.bundle_info}
                </span>
              )}
            </div>
          )}
        </div>
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
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-border space-y-4 pt-3">
              <div>
                <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-2">장점</p>
                <ul className="space-y-1.5">
                  {(s.pros || []).map((pro, i) => (
                    <li key={i} className="flex gap-2 text-xs text-text-primary">
                      <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
                      {pro}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-2">단점</p>
                <ul className="space-y-1.5">
                  {(s.cons || []).map((con, i) => (
                    <li key={i} className="flex gap-2 text-xs text-text-primary">
                      <span className="text-red-400 shrink-0 mt-0.5">✕</span>
                      {con}
                    </li>
                  ))}
                </ul>
              </div>
              {s.customer_profile && (
                <div className="bg-accent-bg border border-accent-border border-t-2 border-t-accent/40 rounded-md px-3 py-2.5">
                  <p className="font-label text-[10px] tracking-[0.14em] uppercase text-accent-fg/70 mb-1">Customer Profile</p>
                  <p className="text-xs text-text-secondary">{s.customer_profile}</p>
                </div>
              )}
              <p className="text-[10px] text-text-tertiary/60">AI 분석 {formatDate(s.generated_at)}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function BrandGroup({ brand, products }: { brand: string; products: CompetitorSummary[] }) {
  const [open, setOpen] = useState(false)

  const allRanks = products.flatMap(p => p.categories)
  const bestRank = allRanks.length > 0
    ? allRanks.reduce((a, b) => a.rank < b.rank ? a : b)
    : null

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3.5 bg-surface hover:bg-border-subtle/40 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-text-primary">{brand}</span>
          <span className="text-xs text-text-tertiary bg-muted px-2 py-0.5 rounded-full border border-border">
            {products.length}개
          </span>
          {bestRank && (
            <span className="text-xs text-red-500 font-semibold">{bestRank.name} 최고 {bestRank.rank}위</span>
          )}
        </div>
        <ChevronDown
          size={15}
          className={`shrink-0 text-text-tertiary transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="p-3 border-t border-border bg-background space-y-2">
              {products.map(s => (
                <ProductCard key={s.goods_no} s={s} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function CompetitorSection({ summaries, insights = [] }: Props) {
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const s of summaries) {
      for (const c of s.categories) set.add(c.name)
    }
    return ['전체', ...Array.from(set).sort()]
  }, [summaries])

  const [activeCategory, setActiveCategory] = useState('전체')

  const filtered = useMemo(() =>
    activeCategory === '전체'
      ? summaries
      : summaries.filter(s => s.categories.some(c => c.name === activeCategory)),
    [summaries, activeCategory]
  )

  const brandGroups = useMemo(() => {
    const map = new Map<string, CompetitorSummary[]>()
    for (const s of filtered) {
      const brand = extractBrand(s.goods_name)
      if (!map.has(brand)) map.set(brand, [])
      map.get(brand)!.push(s)
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="mb-5">
        <SectionDivider tag="경쟁사 분석" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">경쟁사 AI 분석</h2>
          {summaries.length > 0 && (
            <span className="text-sm text-text-tertiary">{brandGroups.length}개 브랜드 · {summaries.length}개 상품</span>
          )}
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          랭킹 상위 경쟁사 상품의 실구매 리뷰를 AI로 분석합니다
        </p>
      </div>

      {summaries.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg px-6 py-10 text-center space-y-2">
          <p className="text-sm text-text-secondary">아직 경쟁사 분석이 생성되지 않았어요</p>
          <p className="text-xs text-text-tertiary font-mono">python -m collector.competitor_pipeline</p>
          <p className="text-xs text-text-tertiary font-mono">python -m collector.summarizer --mode competitors</p>
        </div>
      ) : (
        <>
          {categories.length > 2 && (
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    activeCategory === cat
                      ? 'bg-accent text-white'
                      : 'bg-surface border border-border text-text-secondary hover:border-accent/50'
                  }`}
                >
                  {cat}
                  {cat !== '전체' && (
                    <span className="ml-1 opacity-60">
                      {summaries.filter(s => s.categories.some(c => c.name === cat)).length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {brandGroups.map(([brand, products]) => (
              <BrandGroup key={brand} brand={brand} products={products} />
            ))}
          </div>

          {brandGroups.length === 0 && (
            <p className="text-sm text-text-tertiary text-center py-8">해당 카테고리 분석 데이터가 없어요</p>
          )}
        </>
      )}

      {/* 키워드 비교 분석 */}
      <div className="mt-8">
        <CompetitorKeywords insights={insights} />
      </div>
    </div>
  )
}
