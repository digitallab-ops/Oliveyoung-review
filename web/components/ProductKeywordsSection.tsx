import type { ProductKeywordData, ProductTopicData } from '@/lib/types'
import SectionDivider from '@/components/SectionDivider'

interface Props {
  keywords: ProductKeywordData[]
  topics: ProductTopicData[]
}

export default function ProductKeywordsSection({ keywords, topics }: Props) {
  const topicMap = new Map(topics.map(t => [t.goods_no, t]))

  return (
    <section>
      <div className="mb-5">
        <SectionDivider tag="키워드 분석" />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary">제품별 키워드 분석</h2>
          <span className="text-sm text-text-tertiary">리뷰 상위 {keywords.length}개 제품</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {keywords.map(prod => {
          const topic = topicMap.get(prod.goods_no)
          return (
            <div key={prod.goods_no} className="border border-border rounded-lg bg-surface p-4 space-y-3">
              {/* 제품명 + 리뷰 수 */}
              <div>
                <p className="text-sm font-semibold text-text-primary leading-tight line-clamp-2">
                  {prod.goods_name}
                </p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  리뷰 {prod.review_cnt.toLocaleString()}개
                </p>
              </div>

              {/* 긍정 키워드 */}
              {prod.pos_keywords.length > 0 && (
                <div>
                  <p className="text-2xs font-medium text-emerald-600 mb-1.5">긍정</p>
                  <div className="flex flex-wrap gap-1 min-h-[44px]">
                    {prod.pos_keywords.map(kw => (
                      <span
                        key={kw.word}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs
                                   bg-emerald-50 text-emerald-700 border border-emerald-200"
                      >
                        #{kw.word}
                        <span className="ml-1 text-emerald-400">{kw.cnt}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 부정 키워드 */}
              {prod.neg_keywords.length > 0 && (
                <div>
                  <p className="text-2xs font-medium text-red-500 mb-1.5">부정</p>
                  <div className="flex flex-wrap gap-1 min-h-[44px]">
                    {prod.neg_keywords.map(kw => (
                      <span
                        key={kw.word}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs
                                   bg-red-50 text-red-700 border border-red-200"
                      >
                        #{kw.word}
                        <span className="ml-1 text-red-400">{kw.cnt}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 주제 분석 */}
              {topic && (
                <div className="pt-2 border-t border-border space-y-1.5">
                  {topic.purchase_motivation.length > 0 && (
                    <TopicRow label="구매동기" items={topic.purchase_motivation} color="violet" />
                  )}
                  {topic.usage_timing.length > 0 && (
                    <TopicRow label="사용시점" items={topic.usage_timing} color="sky" />
                  )}
                  {topic.co_mentioned.length > 0 && (
                    <TopicRow label="함께언급" items={topic.co_mentioned} color="amber" />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TopicRow({ label, items, color }: { label: string; items: string[]; color: 'violet' | 'sky' | 'amber' }) {
  const tagClass = {
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
    sky:    'bg-sky-50 border-sky-200 text-sky-700',
    amber:  'bg-amber-50 border-amber-200 text-amber-700',
  }
  const labelClass = {
    violet: 'text-violet-500',
    sky:    'text-sky-500',
    amber:  'text-amber-500',
  }

  return (
    <div className="flex items-start gap-1.5 flex-wrap">
      <span className={`text-2xs font-medium shrink-0 mt-0.5 ${labelClass[color]}`}>{label}</span>
      {items.map(item => (
        <span
          key={item}
          className={`inline-flex px-1.5 py-0.5 rounded text-2xs border ${tagClass[color]}`}
        >
          {item}
        </span>
      ))}
    </div>
  )
}
