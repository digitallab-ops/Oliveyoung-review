'use client'

import { useState, useCallback, useTransition, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import ReviewCard from './ReviewCard'
import type { Review, FilterType, Product } from '@/lib/types'

const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'all',       label: '전체' },
  { value: 'five',      label: '★5 만족' },
  { value: 'four_plus', label: '★4 이상' },
  { value: 'negative',  label: '불만족' },
  { value: 'repurchase',label: '재구매자만' },
]

interface ReviewFeedProps {
  initialReviews: Review[]
  initialTotal:   number
  initialHasMore: boolean
  products:       Product[]
  activeKeywords?: string[]
  onRemoveKeyword?: (word: string) => void
  onClearKeywords?: () => void
}

export default function ReviewFeed({
  initialReviews,
  initialTotal,
  initialHasMore,
  products,
  activeKeywords = [],
  onRemoveKeyword,
  onClearKeywords,
}: ReviewFeedProps) {
  const [selectedProduct, setSelectedProduct] = useState<string>('')
  const [filter, setFilter]           = useState<FilterType>('all')
  const [reviews, setReviews]         = useState<Review[]>(initialReviews)
  const [total, setTotal]             = useState(initialTotal)
  const [hasMore, setHasMore]         = useState(initialHasMore)
  const [page, setPage]               = useState(0)
  const [loading, setLoading]         = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [, startTransition]           = useTransition()

  const fetchReviews = useCallback(async (
    goodsNo: string,
    f: FilterType,
    keywords: string[],
    p: number,
    append = false
  ) => {
    if (append) setLoadingMore(true)
    else setLoading(true)

    const params = new URLSearchParams({ filter: f, page: String(p), limit: '20' })
    if (goodsNo) params.set('goodsNo', goodsNo)
    if (keywords.length > 0) params.set('keywords', keywords.join(','))

    try {
      const res = await fetch(`/api/reviews?${params}`)
      const data = await res.json()
      startTransition(() => {
        setReviews(prev => append ? [...prev, ...data.reviews] : data.reviews)
        setTotal(data.total)
        setHasMore(data.has_more)
        setPage(p)
      })
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // re-fetch when activeKeywords changes from parent
  useEffect(() => {
    fetchReviews(selectedProduct, filter, activeKeywords, 0)
  }, [activeKeywords]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleProductChange = (goodsNo: string) => {
    setSelectedProduct(goodsNo)
    setFilter('all')
    fetchReviews(goodsNo, 'all', activeKeywords, 0)
  }

  const handleFilterChange = (f: FilterType) => {
    setFilter(f)
    fetchReviews(selectedProduct, f, activeKeywords, 0)
  }

  const handleLoadMore = () => {
    fetchReviews(selectedProduct, filter, activeKeywords, page + 1, true)
  }

  const countLabel = activeKeywords.length > 0
    ? `#${activeKeywords.join(', #')} 관련 리뷰 ${total.toLocaleString()}개`
    : `${total.toLocaleString()}개 리뷰`

  return (
    <section>
      {/* 제품 선택 */}
      <div className="mb-4">
        <select
          value={selectedProduct}
          onChange={e => handleProductChange(e.target.value)}
          className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-base text-text-primary
                     focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50
                     appearance-none cursor-pointer transition-colors"
        >
          <option value="">전체 상품</option>
          {products.map(p => (
            <option key={p.goods_no} value={p.goods_no}>
              {p.goods_name.length > 40 ? p.goods_name.slice(0, 40) + '…' : p.goods_name}
            </option>
          ))}
        </select>
      </div>

      {/* 필터 바 */}
      <div className="flex gap-2 overflow-x-auto filter-scroll pb-1 mb-4">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => handleFilterChange(f.value)}
            className={`flex-none px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-150 whitespace-nowrap
              ${filter === f.value
                ? 'bg-text-primary text-white'
                : 'bg-surface border border-border text-text-secondary hover:border-text-tertiary hover:text-text-primary'
              }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 키워드 활성 필터 pills */}
      {activeKeywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-text-tertiary">필터:</span>
          {activeKeywords.map(kw => (
            <button
              key={kw}
              onClick={() => onRemoveKeyword?.(kw)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
                         bg-accent-bg text-accent-fg border border-accent-border
                         hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors duration-150"
            >
              #{kw}
              <X size={10} />
            </button>
          ))}
          <button
            onClick={onClearKeywords}
            className="text-xs text-text-tertiary hover:text-text-primary transition-colors duration-150 underline"
          >
            전체 초기화
          </button>
        </div>
      )}

      {/* 리뷰 수 */}
      <p className="text-xs text-text-tertiary mb-4">{countLabel}</p>

      {/* 리뷰 목록 */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-lg p-5">
              <div className="skeleton h-3 w-32 rounded mb-3" />
              <div className="skeleton h-3 w-full rounded mb-2" />
              <div className="skeleton h-3 w-4/5 rounded mb-2" />
              <div className="skeleton h-3 w-3/5 rounded" />
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-16 text-text-tertiary text-sm">
          해당 조건의 리뷰가 없습니다
        </div>
      ) : (
        <>
          <AnimatePresence mode="wait">
            <motion.div
              key={`${selectedProduct}-${filter}-${activeKeywords.join(',')}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-2.5"
            >
              {reviews.map((r, i) => (
                <ReviewCard
                  key={r.review_id}
                  review={r}
                  index={i}
                  onProductClick={handleProductChange}
                  isProductFiltered={!!selectedProduct}
                />
              ))}
            </motion.div>
          </AnimatePresence>

          {hasMore && (
            <div className="mt-6 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg border border-border
                           text-sm font-medium text-text-secondary hover:text-text-primary
                           hover:border-text-tertiary transition-all duration-150 disabled:opacity-50"
              >
                {loadingMore ? (
                  <><Loader2 size={14} className="animate-spin" /> 불러오는 중</>
                ) : (
                  '리뷰 더 보기'
                )}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
