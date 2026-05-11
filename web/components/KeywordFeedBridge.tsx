'use client'

import { useState, useCallback, useRef } from 'react'
import InsightCards from './InsightCards'
import ReviewFeed from './ReviewFeed'
import type { Insights, Review, Product } from '@/lib/types'

interface KeywordFeedBridgeProps {
  insights: Insights
  initialReviews: Review[]
  initialTotal: number
  initialHasMore: boolean
  products: Product[]
}

export default function KeywordFeedBridge({
  insights,
  initialReviews,
  initialTotal,
  initialHasMore,
  products,
}: KeywordFeedBridgeProps) {
  const [activeKeywords, setActiveKeywords] = useState<string[]>([])
  const reviewSectionRef = useRef<HTMLDivElement>(null)

  const handleKeywordClick = useCallback((word: string) => {
    setActiveKeywords(prev => {
      const next = prev.includes(word)
        ? prev.filter(k => k !== word)
        : [...prev, word]
      return next
    })
    // scroll to review section when activating a keyword
    setTimeout(() => {
      reviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }, [])

  const handleRemoveKeyword = useCallback((word: string) => {
    setActiveKeywords(prev => prev.filter(k => k !== word))
  }, [])

  const handleClearKeywords = useCallback(() => {
    setActiveKeywords([])
  }, [])

  return (
    <>
      <InsightCards
        insights={insights}
        onKeywordClick={handleKeywordClick}
        activeKeywords={activeKeywords}
      />

      <hr className="border-border-subtle" />

      <div ref={reviewSectionRef}>
        <ReviewFeed
          initialReviews={initialReviews}
          initialTotal={initialTotal}
          initialHasMore={initialHasMore}
          products={products}
          activeKeywords={activeKeywords}
          onRemoveKeyword={handleRemoveKeyword}
          onClearKeywords={handleClearKeywords}
        />
      </div>
    </>
  )
}
