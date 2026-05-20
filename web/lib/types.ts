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
}

export interface ProductStats {
  goods_name: string
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
