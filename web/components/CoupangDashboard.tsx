'use client'

import { useState, useEffect } from 'react'
import SectionDivider from '@/components/SectionDivider'

interface CoupangStats {
  total_reviews: number
  total_products: number
  avg_rating: number
  last_updated: string | null
}

interface CoupangReview {
  review_id: number
  product_id: string
  product_name: string
  content: string
  rating: number
  helpful_count: number
  purchased_option: string
  created_at: string
}

interface SearchRanking {
  keyword: string
  product_id: string
  product_name: string
  rank_position: number
  is_ad: boolean
  rank_date: string
}

interface CategoryRanking {
  category_name: string
  rank_position: number
  product_id: string
  product_name: string
  rank_date: string
  rank_hour: number
}

const TABS = [
  { id: 'today',    label: '오늘 현황' },
  { id: 'reviews',  label: '리뷰 분석' },
  { id: 'search',   label: '검색순위' },
  { id: 'category', label: '카테고리 순위' },
] as const
type TabId = typeof TABS[number]['id']

const STAR_COLORS = ['', '#ef4444', '#f97316', '#eab308', '#3b82f6', '#22c55e']

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <svg key={i} className="w-3 h-3" viewBox="0 0 20 20" fill={i <= rating ? STAR_COLORS[rating] : '#d1d5db'}>
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </span>
  )
}

export default function CoupangDashboard() {
  const [active, setActive] = useState<TabId>('today')
  const [stats, setStats] = useState<CoupangStats | null>(null)
  const [reviews, setReviews] = useState<CoupangReview[]>([])
  const [rankings, setRankings] = useState<{ search: SearchRanking[]; category: CategoryRanking[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewTotal, setReviewTotal] = useState(0)

  useEffect(() => {
    Promise.all([
      fetch('/api/coupang/stats').then(r => r.json()),
      fetch('/api/coupang/rankings').then(r => r.json()),
    ]).then(([s, r]) => {
      setStats(s)
      setRankings(r)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch(`/api/coupang/reviews?page=${reviewPage}`)
      .then(r => r.json())
      .then(d => { setReviews(d.reviews); setReviewTotal(d.total) })
      .catch(() => {})
  }, [reviewPage])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-sm text-text-secondary">쿠팡 데이터 불러오는 중...</span>
      </div>
    )
  }

  // 카테고리별 그룹핑
  const catGroups = rankings?.category.reduce<Record<string, CategoryRanking[]>>((acc, r) => {
    acc[r.category_name] = acc[r.category_name] ?? []
    acc[r.category_name].push(r)
    return acc
  }, {}) ?? {}

  // 검색순위: 키워드별 그룹
  const searchGroups = rankings?.search.reduce<Record<string, SearchRanking[]>>((acc, r) => {
    acc[r.keyword] = acc[r.keyword] ?? []
    acc[r.keyword].push(r)
    return acc
  }, {}) ?? {}

  const brandProducts = rankings?.category.filter(r =>
    r.product_name.includes('셀퓨전씨')
  ) ?? []

  return (
    <div className="space-y-8">
      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="sm:col-span-2 rounded-xl px-5 py-6 border" style={{ background: 'rgba(234,88,12,0.06)', borderColor: 'rgba(234,88,12,0.25)' }}>
          <p className="text-xs text-text-secondary mb-2 font-medium">평균 평점</p>
          <p className="text-[3.5rem] font-bold leading-none mb-1" style={{ color: '#ea580c' }}>
            {stats?.avg_rating?.toFixed(1) ?? '-'}
          </p>
          <p className="text-xs text-text-secondary/70">총 {(stats?.total_reviews ?? 0).toLocaleString()}개 리뷰</p>
        </div>
        <div className="rounded-xl px-4 py-5 border border-border bg-surface text-center">
          <p className="text-xs text-text-secondary mb-3">수집 상품</p>
          <p className="text-[2rem] font-bold leading-none mb-2 text-text-primary">
            {stats?.total_products ?? 0}
          </p>
          <p className="text-xs text-text-secondary/70">개 상품</p>
        </div>
        <div className="rounded-xl px-4 py-5 border border-border bg-surface text-center">
          <p className="text-xs text-text-secondary mb-3">카테고리 입점</p>
          <p className="text-[2rem] font-bold leading-none mb-2 text-text-primary">
            {Object.keys(catGroups).length}
          </p>
          <p className="text-xs text-text-secondary/70">개 카테고리</p>
        </div>
      </div>

      {/* 탭 바 */}
      <div className="border-b border-border sticky top-14 z-30 bg-background/95 backdrop-blur-sm">
        <nav className="flex gap-0 -mb-px">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                active === tab.id
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* 탭 콘텐츠 */}
      <div>
        {/* 오늘 현황 */}
        {active === 'today' && (
          <div className="space-y-8">
            {brandProducts.length > 0 ? (
              <div>
                <SectionDivider tag="자사 입점 현황" />
                <div className="space-y-2">
                  {brandProducts.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-surface">
                      <span className="text-lg font-bold text-accent w-10 text-right shrink-0">{r.rank_position}위</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{r.product_name}</p>
                        <p className="text-xs text-text-tertiary">{r.category_name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
                <p className="text-sm text-text-secondary">카테고리 내 자사 상품이 없어요</p>
                <p className="text-xs text-text-tertiary mt-1">순위 수집 후 데이터가 표시됩니다</p>
              </div>
            )}

            {Object.keys(catGroups).length > 0 && (
              <div>
                <SectionDivider tag="카테고리 현황" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {Object.entries(catGroups).map(([cat, items]) => (
                    <div key={cat} className="rounded-lg border border-border bg-surface px-4 py-4">
                      <p className="text-xs font-semibold text-text-secondary mb-3">{cat}</p>
                      <ol className="space-y-1.5">
                        {items.slice(0, 10).map(item => (
                          <li key={item.rank_position} className="flex items-center gap-2 text-sm">
                            <span className={`w-5 text-right text-xs font-bold shrink-0 ${item.rank_position <= 3 ? 'text-accent' : 'text-text-tertiary'}`}>
                              {item.rank_position}
                            </span>
                            <span className={`truncate ${item.product_name.includes('셀퓨전씨') ? 'text-accent font-semibold' : 'text-text-primary'}`}>
                              {item.product_name}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 리뷰 분석 */}
        {active === 'reviews' && (
          <div className="space-y-4">
            <div className="space-y-3">
              {reviews.map(rv => (
                <div key={rv.review_id} className="rounded-lg border border-border bg-surface px-4 py-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <StarRating rating={rv.rating} />
                      <span className="text-xs text-text-tertiary">{rv.created_at}</span>
                    </div>
                    {rv.helpful_count > 0 && (
                      <span className="text-xs text-text-tertiary shrink-0">도움 {rv.helpful_count}</span>
                    )}
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed">{rv.content}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-text-tertiary truncate">{rv.product_name}</span>
                    {rv.purchased_option && (
                      <span className="text-xs text-text-tertiary/60 truncate">· {rv.purchased_option}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {reviewTotal > 20 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setReviewPage(p => Math.max(1, p - 1))}
                  disabled={reviewPage === 1}
                  className="px-3 py-1.5 text-sm border border-border rounded-md disabled:opacity-40"
                >이전</button>
                <span className="text-sm text-text-secondary">
                  {reviewPage} / {Math.ceil(reviewTotal / 20)}
                </span>
                <button
                  onClick={() => setReviewPage(p => p + 1)}
                  disabled={reviewPage >= Math.ceil(reviewTotal / 20)}
                  className="px-3 py-1.5 text-sm border border-border rounded-md disabled:opacity-40"
                >다음</button>
              </div>
            )}
          </div>
        )}

        {/* 검색순위 */}
        {active === 'search' && (
          <div className="space-y-6">
            {Object.keys(searchGroups).length === 0 ? (
              <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
                <p className="text-sm text-text-secondary">검색순위 데이터가 없어요</p>
              </div>
            ) : (
              Object.entries(searchGroups).map(([keyword, items]) => (
                <div key={keyword}>
                  <SectionDivider tag={`키워드: ${keyword}`} />
                  <div className="space-y-2">
                    {items.map(item => (
                      <div key={item.product_id} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-surface">
                        <span className={`text-sm font-bold w-8 text-right shrink-0 ${item.rank_position <= 3 ? 'text-accent' : 'text-text-tertiary'}`}>
                          {item.rank_position === 0 ? '광고' : `${item.rank_position}위`}
                        </span>
                        <span className={`text-sm truncate flex-1 ${item.product_name.includes('셀퓨전씨') ? 'text-accent font-semibold' : 'text-text-primary'}`}>
                          {item.product_name}
                        </span>
                        {item.is_ad && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 shrink-0">광고</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 카테고리 순위 */}
        {active === 'category' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {Object.keys(catGroups).length === 0 ? (
              <div className="sm:col-span-3 border border-dashed border-border rounded-lg px-6 py-12 text-center">
                <p className="text-sm text-text-secondary">카테고리 순위 데이터가 없어요</p>
              </div>
            ) : (
              Object.entries(catGroups).map(([cat, items]) => (
                <div key={cat}>
                  <SectionDivider tag={cat} />
                  <ol className="space-y-2">
                    {items.slice(0, 30).map(item => (
                      <li key={item.rank_position}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
                            item.product_name.includes('셀퓨전씨')
                              ? 'border-accent/30 bg-accent-bg'
                              : 'border-border bg-surface'
                          }`}>
                        <span className={`text-sm font-bold w-7 text-right shrink-0 ${item.rank_position <= 3 ? 'text-accent' : 'text-text-tertiary'}`}>
                          {item.rank_position}
                        </span>
                        <span className={`text-sm truncate ${item.product_name.includes('셀퓨전씨') ? 'text-accent font-semibold' : 'text-text-primary'}`}>
                          {item.product_name}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
