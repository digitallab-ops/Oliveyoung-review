'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { cn, scoreColor, scoreStars } from '@/lib/utils'
import type { Review } from '@/lib/types'

interface ReviewCardProps {
  review: Review
  index?: number
}

const PREVIEW_LEN = 120

export default function ReviewCard({ review, index = 0 }: ReviewCardProps) {
  const [expanded, setExpanded] = useState(false)
  const isLong = review.content.length > PREVIEW_LEN
  const color = scoreColor(review.score)

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.03, ease: [0.16, 1, 0.3, 1] }}
      className="bg-surface border border-border rounded-lg overflow-hidden hover:border-border/80 hover:shadow-card-hover transition-all duration-200"
    >
      <div className="px-5 py-4 md:px-6 md:py-5">
        {/* 메타 행 */}
        <div className="flex items-center gap-2.5 flex-wrap mb-3">
          {/* 별점 */}
          <span
            className="text-sm font-semibold tracking-wide"
            style={{ color }}
          >
            {scoreStars(review.score)}
          </span>

          {/* 날짜 */}
          <span className="text-xs text-text-tertiary">
            {review.created_at || ''}
          </span>

          <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
            {review.is_repurchase && (
              <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                재구매
              </span>
            )}
            {review.skin_type && (
              <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                {review.skin_type}
              </span>
            )}
          </div>
        </div>

        {/* 리뷰 본문 */}
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              key="expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="review-content text-base text-text-primary leading-relaxed"
              style={{ lineHeight: '1.85' }}
            >
              {review.content}
            </motion.div>
          ) : (
            <motion.div
              key="collapsed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="review-content text-base text-text-primary"
              style={{ lineHeight: '1.85' }}
            >
              {isLong ? review.content.slice(0, PREVIEW_LEN).trimEnd() + '...' : review.content}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 더 보기 버튼 */}
        {isLong && (
          <button
            onClick={() => setExpanded(v => !v)}
            className={cn(
              'mt-2.5 flex items-center gap-1 text-xs font-medium text-text-tertiary',
              'hover:text-accent transition-colors duration-150 group'
            )}
          >
            <span>{expanded ? '접기' : '더 보기'}</span>
            <ChevronDown
              size={13}
              className={cn(
                'transition-transform duration-200',
                expanded ? 'rotate-180' : 'rotate-0'
              )}
            />
          </button>
        )}
      </div>
    </motion.article>
  )
}
