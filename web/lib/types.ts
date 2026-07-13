export interface Product {
  goods_no: string
  goods_name: string
  rating: number | null
  review_count: string | null
}

export interface Review {
  review_id: number
  goods_no: string
  goods_name?: string
  content: string
  score: number
  skin_type: string | null
  skin_trouble: string | null
  is_repurchase: boolean
  created_at: string
  collected_at: string
}

export interface Stats {
  total_reviews: number
  total_products: number
  avg_score: number
  five_star_pct: number
  repurchase_pct: number
  repurchase_count: number
  five_star_count: number
  last_updated: string | null
  rank_last_updated: string | null
  promo_last_updated: string | null
}

export interface ProductStats {
  goods_no: string
  goods_name: string
  first_seen: string | null
  review_cnt: number
  avg_score: number
  repurchase_pct: number
  five_star_cnt: number
}

export interface ScoreDist {
  score: number
  cnt: number
  pct: number
}

export interface SkinDist {
  skin_type: string
  cnt: number
}

export interface KeywordItem {
  word: string
  cnt: number
}

export interface Insights {
  positive_keywords: KeywordItem[]
  negative_keywords: KeywordItem[]
  total_reviews: number
  skin_dist: SkinDist[]
  top_product: {
    goods_name: string
    avg_score: number
    cnt: number
    sample_review: string
  } | null
}

export type FilterType = 'all' | 'five' | 'four_plus' | 'negative' | 'repurchase'

export interface ReviewsResponse {
  reviews: Review[]
  has_more: boolean
  total: number
}

export interface TimeSeriesPoint {
  month: string    // "2024.01"
  review_cnt: number
  avg_score: number
  pos_pct: number
  neg_pct: number
}

export interface ProductNegativeData {
  goods_no: string
  goods_name: string
  neg_count: number
  keywords: KeywordItem[]
  samples: { content: string; score: number; created_at: string }[]
}

export interface ProductSummary {
  goods_no: string
  goods_name: string
  pros: string[]
  cons: string[]
  customer_profile: string
  generated_at: string
}

export interface CompetitorSummary extends ProductSummary {
  categories: { name: string; rank: number }[]
  review_cnt: number
  price: number | null
  volume: string | null
  bundle_info: string | null
}

export interface ProductRankingData {
  goods_no: string
  goods_name: string
  category_name: string
  history: { date: string; rank: number }[]
}

export interface MarketRankingEntry {
  rank_position: number
  goods_no: string
  goods_name: string
  prev_rank: number | null
  delta: number | null
  is_ours: boolean
}

export interface MarketCategoryData {
  category_name: string
  entries: MarketRankingEntry[]
}

export interface NewProductData {
  goods_no: string
  goods_name: string
  first_seen: string
  days_since_launch: number
  total_reviews: number
  daily_avg: number
  pos_pct: number
  neg_pct: number
  top_keywords: KeywordItem[]
}

export interface NegativeAlertData {
  goods_no: string
  goods_name: string
  recent_neg: number
  prev_neg: number
  increase_pct: number
  top_keywords: KeywordItem[]
  sample: string
}

export interface ProductKeywordData {
  goods_no: string
  goods_name: string
  review_cnt: number
  pos_keywords: { word: string; cnt: number }[]
  neg_keywords: { word: string; cnt: number }[]
}

export interface ProductTopicData {
  goods_no: string
  purchase_motivation: string[]
  usage_timing: string[]
  co_mentioned: string[]
}

export interface OurRankingTimelineEntry {
  rank_hour: number
  category_name: string
  rank_position: number
  goods_no: string
  goods_name: string
}

export interface PromoStatusData {
  promo_type: string
  our_items: { goods_no: string; goods_name: string; rank_position: number | null }[]
  top_items: { rank_position: number; goods_no: string; goods_name: string; is_ours: boolean }[]
  total_count: number
}

export interface OlivepickProduct {
  goods_no: string
  goods_name: string
  rank_position: number | null
  category_name: string | null
  is_ours: boolean
}

export interface PromoMonthlyInsight {
  month: string
  concept_tags: string[]
  summary: string
  action_points: string[]
  generated_at: string | null
}

export interface PromoInsightHistoryEntry {
  id: number
  month: string
  concept_tags: string[]
  summary: string
  action_points: string[]
  saved_at: string
}

export interface OlivepickMonth {
  month: string
  products: OlivepickProduct[]
  category_counts: { category_name: string; count: number }[]
  our_count: number
  total_count: number
  insight: PromoMonthlyInsight | null
}

export interface TodayDealItem {
  id: number
  collected_at: string
  rank_position: number | null
  goods_no: string
  goods_name: string
  is_ours: boolean
}

export interface TodayDealHistoryResponse {
  items: TodayDealItem[]
  total: number
}

export interface ReviewContent {
  goods_name: string
  score: number
  content: string
  created_at: string
  skin_type: string | null
  is_repurchase: boolean
}

export interface WeeklyDelta {
  this_week: { review_cnt: number; avg_score: number; pos_pct: number; neg_pct: number }
  last_week: { review_cnt: number; avg_score: number; pos_pct: number; neg_pct: number }
  delta: { review_cnt: number; avg_score: number; pos_pct: number; neg_pct: number }
}

export interface ProductSummaryFull {
  goods_no: string
  goods_name: string
  stats: { review_cnt: number; avg_score: number; repurchase_pct: number; five_star_cnt: number }
  positive_keywords: KeywordItem[]
  negative_keywords: KeywordItem[]
  recent_reviews: ReviewContent[]
  ranking: { category_name: string; rank_position: number; rank_date: string }[]
}

export interface InsightsSnapshot {
  id: number
  snapshot_at: string
  total_reviews: number
  new_reviews: number
  avg_score: number
  repurchase_pct: number
  five_star_pct: number
  positive_keywords: { word: string; cnt: number }[]
  negative_keywords: { word: string; cnt: number }[]
}

export interface BrandEvent {
  id: number
  event_date: string
  event_type: 'olivepick_entry' | 'olivepick_exit' | 'rank_jump' | 'review_surge' | 'new_product' | 'price_drop' | 'action_taken'
  brand_name: string | null
  goods_no: string | null
  category_name: string | null
  event_detail: Record<string, unknown>
  source: 'auto' | 'user'
  detected_at: string
}

export interface PriceHistoryPoint {
  recorded_date: string
  price: number
}

export interface RepurchaseTrendPoint {
  month: string
  repurchase_pct: number
  total_reviews: number
}

export interface OlivepickRankTrendPoint {
  month: string
  rank_position: number
  category_name: string | null
}

export interface CompetitorInsight {
  week_start: string
  category_name: string
  goods_no: string
  goods_name: string
  brand_name: string | null
  rank_position: number | null
  review_count: number
  avg_score: number | null
  positive_keywords: { word: string; cnt: number }[]
  negative_keywords: { word: string; cnt: number }[]
  is_ours: boolean
}
