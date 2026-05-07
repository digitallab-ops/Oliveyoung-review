import { Pool } from 'pg'
import type { Stats, Product, Review, Insights, ProductStats, ScoreDist, ReviewsResponse, FilterType } from './types'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
})

async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const client = await pool.connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}

export async function getStats(): Promise<Stats> {
  const [totals] = await query<{
    total_reviews: string
    total_products: string
    avg_score: string
    five_star_count: string
    repurchase_count: string
    last_updated: string | null
  }>(`
    SELECT
      (SELECT COUNT(*) FROM reviews)::int                          AS total_reviews,
      (SELECT COUNT(*) FROM products)::int                         AS total_products,
      ROUND(AVG(r.score)::numeric, 2)                              AS avg_score,
      COUNT(*) FILTER (WHERE r.score = 5)                         AS five_star_count,
      COUNT(*) FILTER (WHERE r.is_repurchase = TRUE)              AS repurchase_count,
      MAX(r.collected_at)                                          AS last_updated
    FROM reviews r
  `)

  const total = Number(totals.total_reviews)
  return {
    total_reviews:   total,
    total_products:  Number(totals.total_products),
    avg_score:       Number(totals.avg_score) || 0,
    five_star_count: Number(totals.five_star_count),
    repurchase_count: Number(totals.repurchase_count),
    five_star_pct:   total > 0 ? Math.round(Number(totals.five_star_count) / total * 1000) / 10 : 0,
    repurchase_pct:  total > 0 ? Math.round(Number(totals.repurchase_count) / total * 1000) / 10 : 0,
    last_updated:    totals.last_updated,
  }
}

export async function getProducts(): Promise<Product[]> {
  return query<Product>(`
    SELECT p.goods_no, p.goods_name, p.rating, p.review_count,
           COUNT(r.review_id) AS actual_review_count
    FROM products p
    LEFT JOIN reviews r ON p.goods_no = r.goods_no
    GROUP BY p.goods_no, p.goods_name, p.rating, p.review_count
    ORDER BY actual_review_count DESC
  `)
}

export async function getInsights(goodsNo?: string): Promise<Insights> {
  const where = goodsNo ? 'WHERE r.goods_no = $1' : ''
  const params = goodsNo ? [goodsNo] : []

  // 긍정 키워드 (★4-5)
  const posRows = await query<{ word: string; cnt: string }>(
    `SELECT word, COUNT(*) AS cnt FROM (
       SELECT UNNEST(REGEXP_MATCHES(content, '[가-힣]{2,6}', 'g')) AS word
       FROM reviews r
       ${where ? where + ' AND' : 'WHERE'} score >= 4
         AND content IS NOT NULL AND content != ''
         ${goodsNo && !where ? '' : ''}
     ) t
     WHERE word NOT IN (
       '이','가','을','를','은','는','에','의','도','로','이고','하고',
       '있어','없어','같아','같은','너무','진짜','정말','많이','조금',
       '이거','거예요','에요','아요','어요','네요','해요','했어','해서',
       '그리고','그냥','근데','하지만','그런데','때문에','사용','구매',
       '후기','리뷰','상품','제품','배송','올리브영','한번','처음',
       '계속','매일','항상','하루','저는','제가','저도','이런','그런',
       '좋아','좋고','좋은','좋은데','좋았','바르고','피부','크림',
       '세럼','앰플','토너','로션','에센스','미스트','수분','보습'
     )
     GROUP BY word ORDER BY cnt DESC LIMIT 8`,
    params
  )

  // 부정 키워드 (★1-3)
  const negRows = await query<{ word: string; cnt: string }>(
    `SELECT word, COUNT(*) AS cnt FROM (
       SELECT UNNEST(REGEXP_MATCHES(content, '[가-힣]{2,6}', 'g')) AS word
       FROM reviews r
       ${where ? where + ' AND' : 'WHERE'} score <= 3
         AND content IS NOT NULL AND content != ''
     ) t
     WHERE word NOT IN (
       '이','가','을','를','은','는','에','의','도','로','이고','하고',
       '있어','없어','같아','같은','너무','진짜','정말','많이','조금',
       '이거','거예요','에요','아요','어요','네요','해요','했어','해서',
       '그리고','그냥','근데','하지만','그런데','때문에','사용','구매',
       '후기','리뷰','상품','제품','배송','올리브영','한번','처음',
       '계속','매일','항상','하루','저는','제가','저도','이런','그런',
       '좋아','좋고','좋은','좋은데','좋았','바르고','피부','크림',
       '세럼','앰플','토너','로션','에센스','미스트'
     )
     GROUP BY word ORDER BY cnt DESC LIMIT 6`,
    params
  )

  // 피부타입 분포
  const skinRows = await query<{ skin_type: string; cnt: string }>(
    `SELECT skin_type, COUNT(*) AS cnt FROM reviews r
     ${where}
     WHERE skin_type IS NOT NULL AND skin_type != ''
     GROUP BY skin_type ORDER BY cnt DESC LIMIT 6`,
    params
  )

  // 상위 상품 (전체 인사이트용)
  let topProduct = null
  if (!goodsNo) {
    const topRows = await query<{
      goods_name: string; avg_score: string; cnt: string; sample: string
    }>(`
      SELECT p.goods_name,
             ROUND(AVG(r.score)::numeric, 2) AS avg_score,
             COUNT(r.review_id) AS cnt,
             (SELECT content FROM reviews r2
              WHERE r2.goods_no = p.goods_no AND r2.score = 5
                AND r2.content IS NOT NULL AND r2.content != ''
              ORDER BY r2.created_at DESC LIMIT 1) AS sample
      FROM products p
      JOIN reviews r ON p.goods_no = r.goods_no
      GROUP BY p.goods_name, p.goods_no
      ORDER BY cnt DESC LIMIT 1
    `)
    if (topRows[0]) {
      topProduct = {
        goods_name: topRows[0].goods_name,
        avg_score:  Number(topRows[0].avg_score),
        cnt:        Number(topRows[0].cnt),
        sample_review: (topRows[0].sample || '').replace(/<[^>]+>/g, '').trim().slice(0, 100),
      }
    }
  }

  return {
    positive_keywords: posRows.map(r => r.word),
    negative_keywords: negRows.map(r => r.word),
    skin_dist: skinRows.map(r => ({ skin_type: r.skin_type, cnt: Number(r.cnt) })),
    top_product: topProduct,
  }
}

export async function getReviews(opts: {
  goodsNo?: string
  filter?: FilterType
  page?: number
  limit?: number
}): Promise<ReviewsResponse> {
  const { goodsNo, filter = 'all', page = 0, limit = 20 } = opts
  const offset = page * limit

  const conditions: string[] = ['r.content IS NOT NULL', "r.content != ''"]
  const params: unknown[] = []
  let idx = 1

  if (goodsNo) {
    conditions.push(`r.goods_no = $${idx++}`)
    params.push(goodsNo)
  }

  if (filter === 'five')       conditions.push('r.score = 5')
  if (filter === 'four_plus')  conditions.push('r.score >= 4')
  if (filter === 'negative')   conditions.push('r.score <= 3')
  if (filter === 'repurchase') conditions.push('r.is_repurchase = TRUE')

  const where = 'WHERE ' + conditions.join(' AND ')

  const countRows = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM reviews r ${where}`, params
  )
  const total = Number(countRows[0]?.total || 0)

  params.push(limit + 1)  // fetch one extra to check has_more
  params.push(offset)

  const rows = await query<Review>(
    `SELECT r.review_id, r.goods_no, p.goods_name, r.content, r.score,
            r.skin_type, r.skin_trouble, r.is_repurchase, r.created_at, r.collected_at
     FROM reviews r
     LEFT JOIN products p ON r.goods_no = p.goods_no
     ${where}
     ORDER BY r.created_at DESC, r.review_id DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    params
  )

  const has_more = rows.length > limit
  return {
    reviews: rows.slice(0, limit).map(r => ({
      ...r,
      content: r.content
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, c => {
          const map: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
          return map[c] || c
        })
        .replace(/\s+/g, ' ')
        .trim(),
    })),
    has_more,
    total,
  }
}

export async function getScoreDist(goodsNo?: string): Promise<ScoreDist[]> {
  const where = goodsNo ? 'WHERE goods_no = $1' : ''
  const params = goodsNo ? [goodsNo] : []
  const rows = await query<{ score: number; cnt: string }>(
    `SELECT score, COUNT(*) AS cnt FROM reviews ${where}
     WHERE score IS NOT NULL GROUP BY score ORDER BY score DESC`,
    params
  )
  const total = rows.reduce((s, r) => s + Number(r.cnt), 0)
  return rows.map(r => ({
    score: Number(r.score),
    cnt:   Number(r.cnt),
    pct:   total > 0 ? Math.round(Number(r.cnt) / total * 1000) / 10 : 0,
  }))
}

export async function getProductStats(): Promise<ProductStats[]> {
  return query<ProductStats>(`
    SELECT p.goods_name,
           COUNT(r.review_id) AS review_cnt,
           ROUND(AVG(r.score)::numeric, 2) AS avg_score,
           ROUND(
             SUM(CASE WHEN r.is_repurchase THEN 1 ELSE 0 END)::numeric /
             NULLIF(COUNT(r.review_id), 0) * 100, 1
           ) AS repurchase_pct,
           SUM(CASE WHEN r.score = 5 THEN 1 ELSE 0 END) AS five_star_cnt
    FROM products p
    LEFT JOIN reviews r ON p.goods_no = r.goods_no
    GROUP BY p.goods_name ORDER BY review_cnt DESC
  `)
}
