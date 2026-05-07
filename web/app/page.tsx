import { getStats, getProducts, getInsights, getReviews, getScoreDist, getProductStats } from '@/lib/db'
import KPIStrip from '@/components/KPIStrip'
import InsightCards from '@/components/InsightCards'
import ReviewFeed from '@/components/ReviewFeed'
import StatsAccordion from '@/components/StatsAccordion'

export const revalidate = 3600

function formatLastUpdated(ts: string | null): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default async function Page() {
  const [stats, products, insights, reviewsData, scoreDist, productStats] = await Promise.all([
    getStats(),
    getProducts(),
    getInsights(),
    getReviews({ limit: 20 }),
    getScoreDist(),
    getProductStats(),
  ])

  return (
    <div className="min-h-screen bg-background">
      {/* 헤더 */}
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border-subtle">
        <div className="mx-auto max-w-content px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">💊</span>
            <span className="text-sm font-semibold text-text-primary tracking-tight">
              셀퓨전씨
            </span>
            <span className="text-xs text-text-tertiary hidden sm:block">
              리뷰 인사이트
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-text-tertiary">
              {formatLastUpdated(stats.last_updated)} 업데이트
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-content px-4 md:px-6 py-8 md:py-12 space-y-10">

        {/* HERO */}
        <section className="space-y-5 animate-fade-up">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-2xs font-semibold
                             bg-accent-bg text-accent-fg border border-accent-border">
                올리브영 공식 브랜드관
              </span>
              <span className="text-2xs text-text-tertiary">
                {stats.total_products}개 상품
              </span>
            </div>
            <h1 className="text-4xl font-bold text-text-primary tracking-tight leading-tight">
              소비자 반응<br className="sm:hidden" />
              <span className="text-text-tertiary font-normal"> 지금 어때요?</span>
            </h1>
            <p className="mt-2 text-base text-text-secondary leading-relaxed">
              실구매 고객 {stats.total_reviews.toLocaleString()}명의 솔직한 리뷰를
              매일 자동으로 수집합니다.
            </p>
          </div>

          <KPIStrip stats={stats} />
        </section>

        {/* AI 인사이트 */}
        <div className="animate-fade-up" style={{ animationDelay: '80ms' }}>
          <InsightCards insights={insights} />
        </div>

        {/* 구분선 */}
        <hr className="border-border-subtle" />

        {/* 리뷰 피드 */}
        <div className="animate-fade-up" style={{ animationDelay: '120ms' }}>
          <div className="flex items-center gap-2 mb-5">
            <h2 className="text-xl font-semibold text-text-primary">리뷰</h2>
            <span className="text-sm text-text-tertiary">
              {stats.total_reviews.toLocaleString()}개
            </span>
          </div>
          <ReviewFeed
            initialReviews={reviewsData.reviews}
            initialTotal={reviewsData.total}
            initialHasMore={reviewsData.has_more}
            products={products}
          />
        </div>

        {/* 구분선 */}
        <hr className="border-border-subtle" />

        {/* 상세 통계 */}
        <div className="animate-fade-up" style={{ animationDelay: '160ms' }}>
          <StatsAccordion scoreDist={scoreDist} productStats={productStats} />
        </div>

        {/* 푸터 */}
        <footer className="pt-4 pb-8 text-center space-y-1">
          <p className="text-xs text-text-tertiary">
            CellFusionC Review Intelligence
          </p>
          <p className="text-2xs text-text-tertiary/60">
            올리브영 공식 브랜드관 실구매 리뷰 기준 · 매일 오전 6시 자동 수집
          </p>
        </footer>
      </main>
    </div>
  )
}
