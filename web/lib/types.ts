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

export interface Insights {
  positive_keywords: string[]
  negative_keywords: string[]
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
