import { Pool } from 'pg'
import type { Stats, Product, Review, Insights, ProductStats, ScoreDist, ReviewsResponse, FilterType, TimeSeriesPoint, ProductNegativeData, ProductSummary, CompetitorSummary, InsightsSnapshot, ProductRankingData, MarketCategoryData, MarketRankingEntry, NewProductData, NegativeAlertData, OurRankingTimelineEntry, PromoStatusData, ProductKeywordData, ProductTopicData, OlivepickMonth, TodayDealHistoryResponse, PromoMonthlyInsight, BrandEvent, PriceHistoryPoint, RepurchaseTrendPoint, OlivepickRankTrendPoint } from './types'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10000,
  options: '-c search_path=oliveyoung',
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

  const [[rankRow], [promoRow]] = await Promise.all([
    query<{ ts: string | null }>(`
      SELECT to_char(
        rank_date + (rank_hour || ' hours')::interval,
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      ) AS ts
      FROM market_rankings
      ORDER BY rank_date DESC, rank_hour DESC LIMIT 1
    `),
    query<{ ts: string | null }>(`
      SELECT to_char(MAX(collected_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts
      FROM promo_items
    `),
  ])

  const total = Number(totals.total_reviews)
  return {
    total_reviews:        total,
    total_products:       Number(totals.total_products),
    avg_score:            Number(totals.avg_score) || 0,
    five_star_count:      Number(totals.five_star_count),
    repurchase_count:     Number(totals.repurchase_count),
    five_star_pct:        total > 0 ? Math.round(Number(totals.five_star_count) / total * 1000) / 10 : 0,
    repurchase_pct:       total > 0 ? Math.round(Number(totals.repurchase_count) / total * 1000) / 10 : 0,
    last_updated:         totals.last_updated,
    rank_last_updated:    rankRow?.ts ?? null,
    promo_last_updated:   promoRow?.ts ?? null,
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

const STOPWORDS = `
    '이','가','을','를','은','는','에','의','도','로','이고','하고',
    '있어','없어','같아','같은','너무','진짜','정말','많이','조금',
    '이거','거예요','에요','아요','어요','네요','해요','했어','해서',
    '그리고','그냥','근데','하지만','그런데','때문에','사용','구매',
    '후기','리뷰','상품','제품','배송','올리브영','한번','처음',
    '계속','매일','항상','하루','저는','제가','저도','이런','그런',
    '좋아','좋고','좋은','좋은데','좋았','바르고','피부','크림',
    '세럼','앰플','토너','로션','에센스','미스트','수분','보습',
    '좋아요','같아요','있어요','없어요','있어서','없어서','없이',
    '이에요','인데요','거든요','이라서','이라고','이라는','이라도',
    '처럼','에서','에도','으로','와서','이라','이며','이나',
    '약간','이건','이게','이번','이미','그간','그게','그건',
    '아요','어요','아서','어서','와요','되요','되어','됩니다',
    '해줘','해요','해서','해도','하면','하며','하는','한다',
    '있고','없고','같고','하고','이고','이든','인지','인데',
    '정도','때문','경우','기간','이후','이전','그후','이상',
    '사실','부분','느낌','생각','정말로','너무나','조금씩',
    '셀퓨전씨','셀퓨전','올리브','느낌이','느낌은','느낌도',
    '것같','것도','것이','건지','건데','거라','거고','거야',
    '엄청','꾸준히','아주','살짝','일단','다시','원래','아직',
    '항상','그냥','정도로','따로','더욱','특히','오히려','확실히',
    '바로','같이','함께','다들','많은','적은','없는','있는',
    '완전','요즘','생각보다','그래도','그러나','하지만','그리고',
    '선크림','선스틱','선케어','패드','파운데이션','쿠션','아이크림',
    '젤크림','수분크림','클렌징','폼클렌징','마스크팩','스킨케어',
    '발림','흡수','촉촉','냄새','향기','용량','가성비','색감','발색','지속',
    '얼굴','목','눈가','입술','피부결',
    '완전히','진짜로','별로','무난',
    '올영','브랜드','제형','텍스처','텍처'
  `

const SUFFIX_FILTER = `
  word !~ '(아요|어요|이에요|해요|하고|이고|이라|에서|으로|에도|처럼|아서|어서|와서|이며|이나|이든|없이|인데|한다|됩니다|해서|하면|하며|습니다|가|이|을|를|은|는|에|의|도|로|와|고|며|면|서|든|른|지|라|요|기|데|게|다|ㄹ|할|수|서|적)$'
`

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
     ) t
     WHERE word NOT IN (${STOPWORDS})
     AND ${SUFFIX_FILTER}
     AND LENGTH(word) >= 2
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
     WHERE word NOT IN (${STOPWORDS})
     AND ${SUFFIX_FILTER}
     AND LENGTH(word) >= 2
     GROUP BY word ORDER BY cnt DESC LIMIT 8`,
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

  const [countRow] = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM reviews r ${where}`, params
  )
  const totalReviews = Number(countRow?.total || 0)

  return {
    positive_keywords: posRows.map(r => ({ word: r.word, cnt: Number(r.cnt) })),
    negative_keywords: negRows.map(r => ({ word: r.word, cnt: Number(r.cnt) })),
    total_reviews: totalReviews,
    skin_dist: skinRows.map(r => ({ skin_type: r.skin_type, cnt: Number(r.cnt) })),
    top_product: topProduct,
  }
}

export async function getReviews(opts: {
  goodsNo?: string
  filter?: FilterType
  keywords?: string[]
  page?: number
  limit?: number
}): Promise<ReviewsResponse> {
  const { goodsNo, filter = 'all', keywords, page = 0, limit = 20 } = opts
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

  if (keywords && keywords.length > 0) {
    const kwClauses = keywords.map(kw => {
      params.push(`%${kw}%`)
      return `r.content ILIKE $${idx++}`
    })
    conditions.push(`(${kwClauses.join(' OR ')})`)
  }

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
    SELECT p.goods_no,
           p.goods_name,
           p.first_seen::text AS first_seen,
           COUNT(r.review_id) AS review_cnt,
           ROUND(AVG(r.score)::numeric, 2) AS avg_score,
           ROUND(
             SUM(CASE WHEN r.is_repurchase THEN 1 ELSE 0 END)::numeric /
             NULLIF(COUNT(r.review_id), 0) * 100, 1
           ) AS repurchase_pct,
           SUM(CASE WHEN r.score = 5 THEN 1 ELSE 0 END) AS five_star_cnt
    FROM products p
    LEFT JOIN reviews r ON p.goods_no = r.goods_no
    GROUP BY p.goods_no, p.goods_name, p.first_seen ORDER BY review_cnt DESC
  `)
}

export async function getTimeSeriesWeekly(from: string, to: string): Promise<TimeSeriesPoint[]> {
  const rows = await query<{ month: string; review_cnt: string; avg_score: string; pos_pct: string; neg_pct: string }>(`
    SELECT
      TO_CHAR(DATE_TRUNC('week', created_at::date), 'IYYY-"W"IW') AS month,
      COUNT(*)                            AS review_cnt,
      ROUND(AVG(score)::numeric, 2)       AS avg_score,
      ROUND(
        COUNT(*) FILTER (WHERE score >= 4)::numeric / NULLIF(COUNT(*), 0) * 100, 1
      )                                   AS pos_pct,
      ROUND(
        COUNT(*) FILTER (WHERE score <= 2)::numeric / NULLIF(COUNT(*), 0) * 100, 1
      )                                   AS neg_pct
    FROM reviews
    WHERE created_at IS NOT NULL AND LENGTH(created_at) >= 10
      AND created_at::date >= $1::date
      AND created_at::date < $2::date
    GROUP BY DATE_TRUNC('week', created_at::date)
    ORDER BY DATE_TRUNC('week', created_at::date)
  `, [from, to])
  return rows.map(r => ({
    month:      r.month,
    review_cnt: Number(r.review_cnt),
    avg_score:  Number(r.avg_score),
    pos_pct:    Number(r.pos_pct),
    neg_pct:    Number(r.neg_pct),
  }))
}

export async function getTimeSeries(): Promise<TimeSeriesPoint[]> {
  const rows = await query<{ month: string; review_cnt: string; avg_score: string; pos_pct: string; neg_pct: string }>(`
    SELECT
      SUBSTRING(created_at, 1, 7)        AS month,
      COUNT(*)                            AS review_cnt,
      ROUND(AVG(score)::numeric, 2)       AS avg_score,
      ROUND(
        COUNT(*) FILTER (WHERE score >= 4)::numeric / NULLIF(COUNT(*), 0) * 100, 1
      )                                   AS pos_pct,
      ROUND(
        COUNT(*) FILTER (WHERE score <= 2)::numeric / NULLIF(COUNT(*), 0) * 100, 1
      )                                   AS neg_pct
    FROM reviews
    WHERE created_at IS NOT NULL AND LENGTH(created_at) >= 7
    GROUP BY month
    ORDER BY month
  `)
  return rows.map(r => ({
    month:      r.month,
    review_cnt: Number(r.review_cnt),
    avg_score:  Number(r.avg_score),
    pos_pct:    Number(r.pos_pct),
    neg_pct:    Number(r.neg_pct),
  }))
}

export async function getProductNegatives(): Promise<ProductNegativeData[]> {
  const topProducts = await query<{ goods_no: string; goods_name: string; neg_count: string }>(`
    SELECT r.goods_no, p.goods_name, COUNT(*) AS neg_count
    FROM reviews r
    JOIN products p ON r.goods_no = p.goods_no
    WHERE r.score <= 2 AND r.content IS NOT NULL AND r.content != ''
    GROUP BY r.goods_no, p.goods_name
    ORDER BY neg_count DESC LIMIT 8
  `)

  if (topProducts.length === 0) return []
  const goodsNos = topProducts.map(p => p.goods_no)

  const kwRows = await query<{ goods_no: string; word: string; cnt: string }>(`
    SELECT goods_no, word, COUNT(*) AS cnt FROM (
      SELECT r.goods_no, UNNEST(REGEXP_MATCHES(r.content, '[가-힣]{2,6}', 'g')) AS word
      FROM reviews r
      WHERE r.goods_no = ANY($1) AND r.score <= 2
        AND r.content IS NOT NULL AND r.content != ''
    ) t
    WHERE word NOT IN (${STOPWORDS})
    AND ${SUFFIX_FILTER}
    AND LENGTH(word) >= 2
    GROUP BY goods_no, word
    ORDER BY goods_no, cnt DESC
  `, [goodsNos])

  const sampleRows = await query<{ goods_no: string; content: string; score: number; created_at: string }>(`
    SELECT goods_no, content, score, created_at FROM (
      SELECT r.goods_no, r.content, r.score, r.created_at,
             ROW_NUMBER() OVER (PARTITION BY r.goods_no ORDER BY r.created_at DESC) AS rn
      FROM reviews r
      WHERE r.goods_no = ANY($1) AND r.score <= 2
        AND r.content IS NOT NULL AND r.content != ''
    ) t WHERE rn <= 2
  `, [goodsNos])

  const kwMap = new Map<string, typeof kwRows>()
  for (const k of kwRows) {
    if (!kwMap.has(k.goods_no)) kwMap.set(k.goods_no, [])
    kwMap.get(k.goods_no)!.push(k)
  }
  const sampleMap = new Map<string, typeof sampleRows>()
  for (const s of sampleRows) {
    if (!sampleMap.has(s.goods_no)) sampleMap.set(s.goods_no, [])
    sampleMap.get(s.goods_no)!.push(s)
  }

  return topProducts.map(p => ({
    goods_no:   p.goods_no,
    goods_name: p.goods_name,
    neg_count:  Number(p.neg_count),
    keywords: (kwMap.get(p.goods_no) ?? []).slice(0, 5).map(k => ({ word: k.word, cnt: Number(k.cnt) })),
    samples: (sampleMap.get(p.goods_no) ?? []).map(s => ({
      content:    s.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      score:      Number(s.score),
      created_at: s.created_at,
    })),
  }))
}

export async function getProductSummaries(): Promise<ProductSummary[]> {
  try {
    const rows = await query<{
      goods_no: string; goods_name: string; summary_json: string; generated_at: string
    }>(`
      SELECT ps.goods_no, p.goods_name, ps.summary_json, ps.generated_at
      FROM product_summaries ps
      JOIN products p ON ps.goods_no = p.goods_no
      WHERE p.is_competitor = false
      ORDER BY p.goods_name
    `)
    return rows.map(r => ({
      goods_no:    r.goods_no,
      goods_name:  r.goods_name,
      generated_at: r.generated_at,
      ...JSON.parse(r.summary_json),
    }))
  } catch {
    return []
  }
}

export async function getCompetitorSummaries(): Promise<CompetitorSummary[]> {
  try {
    const rows = await query<{
      goods_no: string; goods_name: string; summary_json: string
      generated_at: string; review_cnt: string
      price: number | null; volume: string | null; bundle_info: string | null
    }>(`
      SELECT ps.goods_no, p.goods_name, ps.summary_json, ps.generated_at,
             COUNT(r.review_id) AS review_cnt,
             p.price, p.volume, p.bundle_info
      FROM product_summaries ps
      JOIN products p ON ps.goods_no = p.goods_no
      LEFT JOIN reviews r ON ps.goods_no = r.goods_no
      WHERE p.is_competitor = true
      GROUP BY ps.goods_no, p.goods_name, ps.summary_json, ps.generated_at,
               p.price, p.volume, p.bundle_info
      ORDER BY p.goods_name
    `)
    if (rows.length === 0) return []

    const goodsNos = rows.map(r => r.goods_no)
    const rankRows = await query<{
      goods_no: string; category_name: string; rank_position: string
    }>(`
      SELECT DISTINCT ON (goods_no, category_name) goods_no, category_name, rank_position
      FROM market_rankings
      WHERE goods_no = ANY($1)
        AND rank_date = (SELECT MAX(rank_date) FROM market_rankings)
      ORDER BY goods_no, category_name, rank_position
    `, [goodsNos])

    const rankMap: Record<string, { name: string; rank: number }[]> = {}
    for (const r of rankRows) {
      if (!rankMap[r.goods_no]) rankMap[r.goods_no] = []
      rankMap[r.goods_no].push({ name: r.category_name, rank: Number(r.rank_position) })
    }

    return rows.map(r => ({
      goods_no: r.goods_no,
      goods_name: r.goods_name,
      generated_at: r.generated_at,
      review_cnt: Number(r.review_cnt),
      categories: (rankMap[r.goods_no] || []).sort((a, b) => a.rank - b.rank),
      price: r.price ?? null,
      volume: r.volume ?? null,
      bundle_info: r.bundle_info ?? null,
      ...JSON.parse(r.summary_json),
    }))
  } catch {
    return []
  }
}

export async function getProductRankingsByMode(): Promise<{
  best: ProductRankingData[]
  avg: ProductRankingData[]
  weekly: ProductRankingData[]
  lastCollected: Record<string, string>
}> {
  try {
    const dailyRows = await query<{
      goods_no: string; goods_name: string; category_name: string
      date: string; best_rank: string; avg_rank: string
    }>(`
      SELECT mr.goods_no, p.goods_name, mr.category_name,
             mr.rank_date::text AS date,
             MIN(mr.rank_position) AS best_rank,
             ROUND(AVG(mr.rank_position)) AS avg_rank
      FROM market_rankings mr
      JOIN products p ON mr.goods_no = p.goods_no
      WHERE mr.rank_date >= CURRENT_DATE - INTERVAL '30 days'
        AND p.is_competitor = false
        AND mr.category_name NOT IN ('선스틱', '선세럼·미스트')
      GROUP BY mr.rank_date, mr.goods_no, p.goods_name, mr.category_name
      ORDER BY mr.category_name, mr.goods_no, mr.rank_date
    `)

    const weeklyRows = await query<{
      goods_no: string; goods_name: string; category_name: string
      date: string; rank: string
    }>(`
      SELECT mr.goods_no, p.goods_name, mr.category_name,
             DATE_TRUNC('week', mr.rank_date)::date::text AS date,
             ROUND(AVG(mr.rank_position)) AS rank
      FROM market_rankings mr
      JOIN products p ON mr.goods_no = p.goods_no
      WHERE mr.rank_date >= CURRENT_DATE - INTERVAL '30 days'
        AND p.is_competitor = false
        AND mr.category_name NOT IN ('선스틱', '선세럼·미스트')
      GROUP BY DATE_TRUNC('week', mr.rank_date), mr.goods_no, p.goods_name, mr.category_name
      ORDER BY mr.category_name, mr.goods_no, date
    `)

    const lastRows = await query<{
      category_name: string; last_date: string; rank_hour: number
    }>(`
      SELECT DISTINCT ON (category_name)
             category_name, rank_date::text AS last_date, rank_hour
      FROM market_rankings
      ORDER BY category_name, rank_date DESC, rank_hour DESC
    `)

    const toData = (rows: { goods_no: string; goods_name: string; category_name: string; date: string; rank: string }[]): ProductRankingData[] => {
      const map = new Map<string, ProductRankingData>()
      for (const r of rows) {
        const key = `${r.goods_no}__${r.category_name}`
        if (!map.has(key)) map.set(key, { goods_no: r.goods_no, goods_name: r.goods_name, category_name: r.category_name, history: [] })
        map.get(key)!.history.push({ date: r.date.slice(0, 10), rank: Number(r.rank) })
      }
      return Array.from(map.values())
    }

    const lastCollected: Record<string, string> = {}
    for (const r of lastRows) {
      const kstH = (Number(r.rank_hour) + 9) % 24
      lastCollected[r.category_name] = `${r.last_date} ${kstH}시`
    }

    return {
      best:   toData(dailyRows.map(r => ({ ...r, rank: r.best_rank }))),
      avg:    toData(dailyRows.map(r => ({ ...r, rank: r.avg_rank }))),
      weekly: toData(weeklyRows),
      lastCollected,
    }
  } catch {
    return { best: [], avg: [], weekly: [], lastCollected: {} }
  }
}

export async function getProductRankings(): Promise<ProductRankingData[]> {
  try {
    const rows = await query<{
      goods_no: string; goods_name: string; category_name: string
      rank_date: string; rank_position: string
    }>(`
      SELECT pr.goods_no, p.goods_name, pr.category_name,
             pr.rank_date::text, pr.rank_position
      FROM product_rankings pr
      JOIN products p ON pr.goods_no = p.goods_no
      WHERE pr.rank_date >= CURRENT_DATE - INTERVAL '60 days'
      ORDER BY pr.category_name, pr.goods_no, pr.rank_date
    `)

    // 상품+카테고리별로 그룹핑
    const map = new Map<string, ProductRankingData>()
    for (const r of rows) {
      const key = `${r.goods_no}__${r.category_name}`
      if (!map.has(key)) {
        map.set(key, {
          goods_no: r.goods_no,
          goods_name: r.goods_name,
          category_name: r.category_name,
          history: [],
        })
      }
      map.get(key)!.history.push({
        date: r.rank_date.slice(0, 10),
        rank: Number(r.rank_position),
      })
    }
    return Array.from(map.values())
  } catch {
    return []
  }
}

export async function getMarketRankings(): Promise<MarketCategoryData[]> {
  try {
    const rows = await query<{
      category_name: string
      rank_position: string
      goods_no: string
      goods_name: string
      prev_rank: string | null
      delta: string | null
      is_ours: boolean
    }>(`
      WITH latest_per_cat AS (
        SELECT DISTINCT ON (category_name)
          category_name, rank_date, rank_hour
        FROM market_rankings
        ORDER BY category_name, rank_date DESC, rank_hour DESC
      ),
      prev_per_cat AS (
        SELECT DISTINCT ON (mr.category_name)
          mr.category_name, mr.rank_date, mr.rank_hour
        FROM market_rankings mr
        JOIN latest_per_cat lpc ON mr.category_name = lpc.category_name
        WHERE (mr.rank_date, mr.rank_hour) < (lpc.rank_date, lpc.rank_hour)
        ORDER BY mr.category_name, mr.rank_date DESC, mr.rank_hour DESC
      ),
      today_snap AS (
        SELECT mr.category_name, mr.goods_no, mr.goods_name, mr.rank_position
        FROM market_rankings mr
        JOIN latest_per_cat lpc ON
          mr.category_name = lpc.category_name AND
          mr.rank_date = lpc.rank_date AND
          mr.rank_hour = lpc.rank_hour
      ),
      yesterday_snap AS (
        SELECT mr.category_name, mr.goods_no, mr.rank_position
        FROM market_rankings mr
        JOIN prev_per_cat ppc ON
          mr.category_name = ppc.category_name AND
          mr.rank_date = ppc.rank_date AND
          mr.rank_hour = ppc.rank_hour
      )
      SELECT
        t.category_name,
        t.rank_position,
        t.goods_no,
        t.goods_name,
        y.rank_position                           AS prev_rank,
        y.rank_position - t.rank_position         AS delta,
        EXISTS(SELECT 1 FROM products p WHERE p.goods_no = t.goods_no) AS is_ours
      FROM today_snap t
      LEFT JOIN yesterday_snap y
        ON t.goods_no = y.goods_no AND t.category_name = y.category_name
      ORDER BY
        CASE t.category_name
          WHEN '전체'          THEN 1
          WHEN '스킨케어'      THEN 2
          WHEN '마스크팩'      THEN 3
          WHEN '클렌징'        THEN 4
          WHEN '선케어'        THEN 5
          WHEN '더모 코스메틱' THEN 6
          WHEN '바디케어'      THEN 7
          WHEN '맨즈에딧'      THEN 8
          ELSE 99
        END,
        t.rank_position
    `)

    const map = new Map<string, MarketRankingEntry[]>()
    for (const r of rows) {
      if (!map.has(r.category_name)) map.set(r.category_name, [])
      map.get(r.category_name)!.push({
        rank_position: Number(r.rank_position),
        goods_no:      r.goods_no,
        goods_name:    r.goods_name,
        prev_rank:     r.prev_rank != null ? Number(r.prev_rank) : null,
        delta:         r.delta != null ? Number(r.delta) : null,
        is_ours:       Boolean(r.is_ours),
      })
    }
    return Array.from(map.entries()).map(([category_name, entries]) => ({ category_name, entries }))
  } catch {
    return []
  }
}

export async function getInsightsHistory(limit = 60): Promise<InsightsSnapshot[]> {
  try {
    const rows = await query<{
      id: string; snapshot_at: string; total_reviews: string; new_reviews: string
      avg_score: string; repurchase_pct: string; five_star_pct: string
      positive_keywords: unknown; negative_keywords: unknown
    }>(`
      SELECT id, snapshot_at, total_reviews, new_reviews,
             avg_score, repurchase_pct, five_star_pct,
             positive_keywords, negative_keywords
      FROM insights_snapshots
      ORDER BY snapshot_at DESC
      LIMIT $1
    `, [limit])

    return rows.map(r => ({
      id:                Number(r.id),
      snapshot_at:       r.snapshot_at,
      total_reviews:     Number(r.total_reviews),
      new_reviews:       Number(r.new_reviews),
      avg_score:         Number(r.avg_score),
      repurchase_pct:    Number(r.repurchase_pct),
      five_star_pct:     Number(r.five_star_pct),
      positive_keywords: typeof r.positive_keywords === 'string'
        ? JSON.parse(r.positive_keywords) : (r.positive_keywords as { word: string; cnt: number }[]),
      negative_keywords: typeof r.negative_keywords === 'string'
        ? JSON.parse(r.negative_keywords) : (r.negative_keywords as { word: string; cnt: number }[]),
    }))
  } catch {
    return []
  }
}

export async function getNewProducts(withinDays = 30): Promise<NewProductData[]> {
  try {
    const newProds = await query<{ goods_no: string; goods_name: string; first_seen: string }>(`
      SELECT goods_no, goods_name, first_seen::text
      FROM products
      WHERE first_seen >= CURRENT_DATE - $1::int
        AND is_competitor = false
      ORDER BY first_seen DESC
    `, [withinDays])

    if (newProds.length === 0) return []

    const goodsNos = newProds.map(p => p.goods_no)

    const reviewStats = await query<{
      goods_no: string; total: string; pos: string; neg: string; daily_avg: string
    }>(`
      SELECT
        r.goods_no,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE r.score >= 4) AS pos,
        COUNT(*) FILTER (WHERE r.score <= 2) AS neg,
        ROUND(COUNT(*)::numeric / GREATEST(1, CURRENT_DATE - p.first_seen), 1) AS daily_avg
      FROM reviews r
      JOIN products p ON r.goods_no = p.goods_no
      WHERE r.goods_no = ANY($1)
      GROUP BY r.goods_no
    `, [goodsNos])

    const kwRows = await query<{ goods_no: string; word: string; cnt: string }>(`
      SELECT goods_no, word, COUNT(*) AS cnt FROM (
        SELECT r.goods_no, UNNEST(REGEXP_MATCHES(r.content, '[가-힣]{2,6}', 'g')) AS word
        FROM reviews r
        WHERE r.goods_no = ANY($1) AND r.content IS NOT NULL AND r.content != ''
      ) t
      WHERE word NOT IN (${STOPWORDS})
      AND ${SUFFIX_FILTER}
      AND LENGTH(word) >= 2
      GROUP BY goods_no, word
      ORDER BY goods_no, cnt DESC
    `, [goodsNos])

    const statsMap = new Map(reviewStats.map(r => [r.goods_no, r]))
    const kwMap = new Map<string, { word: string; cnt: number }[]>()
    for (const k of kwRows) {
      if (!kwMap.has(k.goods_no)) kwMap.set(k.goods_no, [])
      if ((kwMap.get(k.goods_no)!.length) < 5) {
        kwMap.get(k.goods_no)!.push({ word: k.word, cnt: Number(k.cnt) })
      }
    }

    return newProds.map(p => {
      const s = statsMap.get(p.goods_no)
      const total = Number(s?.total ?? 0)
      const pos = Number(s?.pos ?? 0)
      const neg = Number(s?.neg ?? 0)
      const firstSeen = new Date(p.first_seen)
      const daysLaunched = Math.max(1, Math.floor((Date.now() - firstSeen.getTime()) / 86400000))
      return {
        goods_no: p.goods_no,
        goods_name: p.goods_name,
        first_seen: p.first_seen,
        days_since_launch: daysLaunched,
        total_reviews: total,
        daily_avg: Number(s?.daily_avg ?? 0),
        pos_pct: total > 0 ? Math.round(pos / total * 100) : 0,
        neg_pct: total > 0 ? Math.round(neg / total * 100) : 0,
        top_keywords: kwMap.get(p.goods_no) ?? [],
      }
    }).filter(p => p.total_reviews > 0)
  } catch {
    return []
  }
}

export async function getOurRankingTimeline(): Promise<OurRankingTimelineEntry[]> {
  try {
    return await query<OurRankingTimelineEntry>(`
      SELECT
        mr.rank_hour,
        mr.category_name,
        mr.rank_position,
        mr.goods_no,
        mr.goods_name
      FROM market_rankings mr
      JOIN products p ON mr.goods_no = p.goods_no
      WHERE mr.rank_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
        AND mr.rank_hour <= EXTRACT(HOUR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'))::int
        AND p.is_competitor = false
        AND mr.category_name NOT IN ('선스틱', '선세럼·미스트')
      ORDER BY mr.goods_no, mr.category_name, mr.rank_hour
    `)
  } catch {
    return []
  }
}

export async function getPromoStatus(): Promise<PromoStatusData[]> {
  try {
    const latestDate = await query<{ d: string }>(`
      SELECT MAX(collected_at)::text AS d FROM promo_items
    `)
    const dateStr = latestDate[0]?.d
    if (!dateStr) return []

    const rows = await query<{
      promo_type: string
      goods_no: string
      goods_name: string | null
      rank_position: string | null
      is_ours: boolean
    }>(`
      SELECT promo_type, goods_no, goods_name, rank_position, is_ours
      FROM promo_items
      WHERE collected_at = $1
      ORDER BY promo_type, rank_position NULLS LAST
    `, [dateStr])

    const typeMap = new Map<string, {
      our_items: PromoStatusData['our_items']
      top_items: PromoStatusData['top_items']
      total_count: number
    }>()
    for (const r of rows) {
      if (!typeMap.has(r.promo_type)) typeMap.set(r.promo_type, { our_items: [], top_items: [], total_count: 0 })
      const entry = typeMap.get(r.promo_type)!
      entry.total_count++
      if (entry.top_items.length < 15) {
        entry.top_items.push({
          rank_position: r.rank_position != null ? Number(r.rank_position) : entry.total_count,
          goods_no:      r.goods_no,
          goods_name:    r.goods_name ?? r.goods_no,
          is_ours:       Boolean(r.is_ours),
        })
      }
      if (r.is_ours) {
        entry.our_items.push({
          goods_no:      r.goods_no,
          goods_name:    r.goods_name ?? r.goods_no,
          rank_position: r.rank_position != null ? Number(r.rank_position) : null,
        })
      }
    }

    return Array.from(typeMap.entries()).map(([promo_type, data]) => ({
      promo_type,
      ...data,
    }))
  } catch {
    return []
  }
}

export async function getNegativeAlerts(): Promise<NegativeAlertData[]> {
  try {
    const rows = await query<{
      goods_no: string; goods_name: string
      recent_neg: string; prev_neg: string
    }>(`
      SELECT
        p.goods_no, p.goods_name,
        COUNT(*) FILTER (WHERE r.score <= 2 AND r.created_at >= to_char(CURRENT_DATE - 7, 'YYYY-MM-DD')) AS recent_neg,
        COUNT(*) FILTER (WHERE r.score <= 2
          AND r.created_at >= to_char(CURRENT_DATE - 14, 'YYYY-MM-DD')
          AND r.created_at <  to_char(CURRENT_DATE - 7,  'YYYY-MM-DD')) AS prev_neg
      FROM reviews r
      JOIN products p ON r.goods_no = p.goods_no
      WHERE r.content IS NOT NULL AND p.is_competitor = false
      GROUP BY p.goods_no, p.goods_name
      HAVING COUNT(*) FILTER (WHERE r.score <= 2 AND r.created_at >= to_char(CURRENT_DATE - 7, 'YYYY-MM-DD')) >= 3
    `)

    const alerts = rows
      .map(r => ({
        goods_no: r.goods_no,
        goods_name: r.goods_name,
        recent_neg: Number(r.recent_neg),
        prev_neg: Number(r.prev_neg),
        increase_pct: Number(r.prev_neg) > 0
          ? Math.round((Number(r.recent_neg) - Number(r.prev_neg)) / Number(r.prev_neg) * 100)
          : 100,
      }))
      .filter(r => r.increase_pct >= 50)
      .sort((a, b) => b.increase_pct - a.increase_pct)
      .slice(0, 5)

    if (alerts.length === 0) return []

    const goodsNos = alerts.map(a => a.goods_no)

    const kwRows = await query<{ goods_no: string; word: string; cnt: string }>(`
      SELECT goods_no, word, COUNT(*) AS cnt FROM (
        SELECT r.goods_no, UNNEST(REGEXP_MATCHES(r.content, '[가-힣]{2,6}', 'g')) AS word
        FROM reviews r
        WHERE r.goods_no = ANY($1) AND r.score <= 2
          AND r.created_at >= to_char(CURRENT_DATE - 7, 'YYYY-MM-DD')
          AND r.content IS NOT NULL
      ) t
      WHERE word NOT IN (${STOPWORDS}) AND ${SUFFIX_FILTER} AND LENGTH(word) >= 2
      GROUP BY goods_no, word ORDER BY goods_no, cnt DESC
    `, [goodsNos])

    const sampleRows = await query<{ goods_no: string; content: string }>(`
      SELECT DISTINCT ON (goods_no) goods_no,
        regexp_replace(content, '<[^>]+>', '', 'g') AS content
      FROM reviews
      WHERE goods_no = ANY($1) AND score <= 2
        AND created_at >= to_char(CURRENT_DATE - 7, 'YYYY-MM-DD')
        AND content IS NOT NULL AND content != ''
      ORDER BY goods_no, created_at DESC
    `, [goodsNos])

    const kwMap = new Map<string, { word: string; cnt: number }[]>()
    for (const k of kwRows) {
      if (!kwMap.has(k.goods_no)) kwMap.set(k.goods_no, [])
      if (kwMap.get(k.goods_no)!.length < 4) {
        kwMap.get(k.goods_no)!.push({ word: k.word, cnt: Number(k.cnt) })
      }
    }
    const sampleMap = new Map(sampleRows.map(s => [s.goods_no, s.content.slice(0, 80)]))

    return alerts.map(a => ({
      ...a,
      top_keywords: kwMap.get(a.goods_no) ?? [],
      sample: sampleMap.get(a.goods_no) ?? '',
    }))
  } catch {
    return []
  }
}

export async function getProductKeywords(): Promise<ProductKeywordData[]> {
  try {
    const topProducts = await query<{ goods_no: string; goods_name: string; review_cnt: string }>(`
      SELECT r.goods_no, p.goods_name, COUNT(*) AS review_cnt
      FROM reviews r
      JOIN products p ON r.goods_no = p.goods_no
      WHERE r.content IS NOT NULL AND r.content != ''
        AND p.is_competitor = false
      GROUP BY r.goods_no, p.goods_name
      ORDER BY review_cnt DESC LIMIT 8
    `)

    if (topProducts.length === 0) return []
    const goodsNos = topProducts.map(p => p.goods_no)

    const posRows = await query<{ goods_no: string; word: string; cnt: string }>(`
      SELECT goods_no, word, COUNT(*) AS cnt FROM (
        SELECT r.goods_no, UNNEST(REGEXP_MATCHES(r.content, '[가-힣]{2,6}', 'g')) AS word
        FROM reviews r
        WHERE r.goods_no = ANY($1) AND r.score >= 4
          AND r.content IS NOT NULL AND r.content != ''
      ) t
      WHERE word NOT IN (${STOPWORDS})
      AND ${SUFFIX_FILTER}
      AND LENGTH(word) >= 2
      GROUP BY goods_no, word
      ORDER BY goods_no, cnt DESC
    `, [goodsNos])

    const negRows = await query<{ goods_no: string; word: string; cnt: string }>(`
      SELECT goods_no, word, COUNT(*) AS cnt FROM (
        SELECT r.goods_no, UNNEST(REGEXP_MATCHES(r.content, '[가-힣]{2,6}', 'g')) AS word
        FROM reviews r
        WHERE r.goods_no = ANY($1) AND r.score <= 2
          AND r.content IS NOT NULL AND r.content != ''
      ) t
      WHERE word NOT IN (${STOPWORDS})
      AND ${SUFFIX_FILTER}
      AND LENGTH(word) >= 2
      GROUP BY goods_no, word
      ORDER BY goods_no, cnt DESC
    `, [goodsNos])

    const posMap = new Map<string, { word: string; cnt: number }[]>()
    const negMap = new Map<string, { word: string; cnt: number }[]>()
    for (const k of posRows) {
      if (!posMap.has(k.goods_no)) posMap.set(k.goods_no, [])
      if (posMap.get(k.goods_no)!.length < 5)
        posMap.get(k.goods_no)!.push({ word: k.word, cnt: Number(k.cnt) })
    }
    for (const k of negRows) {
      if (!negMap.has(k.goods_no)) negMap.set(k.goods_no, [])
      if (negMap.get(k.goods_no)!.length < 5)
        negMap.get(k.goods_no)!.push({ word: k.word, cnt: Number(k.cnt) })
    }

    return topProducts.map(p => ({
      goods_no:     p.goods_no,
      goods_name:   p.goods_name,
      review_cnt:   Number(p.review_cnt),
      pos_keywords: posMap.get(p.goods_no) ?? [],
      neg_keywords: negMap.get(p.goods_no) ?? [],
    }))
  } catch {
    return []
  }
}

export async function getOlivepickHistory(): Promise<OlivepickMonth[]> {
  try {
    const monthRows = await query<{ month: string }>(`
      SELECT DISTINCT TO_CHAR(collected_at, 'YYYY-MM') AS month
      FROM promo_items
      WHERE promo_type = 'olivepick'
      ORDER BY month DESC
    `)
    if (monthRows.length === 0) return []
    const months = monthRows.map(r => r.month)

    const productRows = await query<{
      month: string
      goods_no: string
      goods_name: string | null
      rank_position: string | null
      category_name: string | null
      is_ours: boolean
    }>(`
      SELECT
        TO_CHAR(p.collected_at, 'YYYY-MM') AS month,
        p.goods_no, p.goods_name, p.rank_position, p.category_name, p.is_ours
      FROM promo_items p
      INNER JOIN (
        SELECT TO_CHAR(collected_at, 'YYYY-MM') AS m, MIN(collected_at) AS min_date
        FROM promo_items
        WHERE promo_type = 'olivepick'
        GROUP BY m
      ) md ON TO_CHAR(p.collected_at, 'YYYY-MM') = md.m AND p.collected_at = md.min_date
      WHERE p.promo_type = 'olivepick'
      ORDER BY month DESC, p.rank_position NULLS LAST
    `)

    const insightRows = await query<{
      month: string; concept_tags: string[]; summary: string; action_points: string[]; generated_at: string
    }>(`
      SELECT month, concept_tags, summary, action_points, generated_at::text
      FROM promo_monthly_insights
      WHERE month = ANY($1)
    `, [months])
    const insightMap = new Map(insightRows.map(r => [r.month, r]))

    const monthMap = new Map<string, OlivepickMonth>()
    for (const m of months) {
      const ins = insightMap.get(m)
      monthMap.set(m, {
        month: m, products: [], category_counts: [],
        our_count: 0, total_count: 0,
        insight: ins ? {
          month: m,
          concept_tags: ins.concept_tags,
          summary: ins.summary,
          action_points: ins.action_points ?? [],
          generated_at: ins.generated_at ?? null,
        } : null,
      })
    }

    for (const r of productRows) {
      const entry = monthMap.get(r.month)
      if (!entry) continue
      entry.products.push({
        goods_no: r.goods_no,
        goods_name: r.goods_name ?? r.goods_no,
        rank_position: r.rank_position != null ? Number(r.rank_position) : null,
        category_name: r.category_name,
        is_ours: Boolean(r.is_ours),
      })
      entry.total_count++
      if (r.is_ours) entry.our_count++
    }

    for (const entry of monthMap.values()) {
      const catMap = new Map<string, number>()
      for (const p of entry.products) {
        if (p.category_name) catMap.set(p.category_name, (catMap.get(p.category_name) ?? 0) + 1)
      }
      entry.category_counts = Array.from(catMap.entries())
        .map(([category_name, count]) => ({ category_name, count }))
        .sort((a, b) => b.count - a.count)
    }

    return Array.from(monthMap.values())
  } catch {
    return []
  }
}

export async function getTodayDealHistory(from: string, to: string): Promise<TodayDealHistoryResponse> {
  try {
    const rows = await query<{
      id: string; collected_at: string; rank_position: string | null
      goods_no: string; goods_name: string | null; is_ours: boolean
    }>(`
      SELECT id, collected_at::text, rank_position, goods_no, goods_name, is_ours
      FROM promo_items
      WHERE promo_type = 'today_deal'
        AND collected_at BETWEEN $1 AND $2
      ORDER BY collected_at DESC, rank_position NULLS LAST
    `, [from, to])

    const items = rows.map(r => ({
      id: Number(r.id),
      collected_at: r.collected_at.slice(0, 10),
      rank_position: r.rank_position != null ? Number(r.rank_position) : null,
      goods_no: r.goods_no,
      goods_name: r.goods_name ?? r.goods_no,
      is_ours: Boolean(r.is_ours),
    }))
    return { items, total: items.length }
  } catch {
    return { items: [], total: 0 }
  }
}

export async function getPromoMonthlyInsight(month: string): Promise<PromoMonthlyInsight | null> {
  try {
    const rows = await query<{
      month: string; concept_tags: string[]; summary: string; action_points: string[]; generated_at: string
    }>(`
      SELECT month, concept_tags, summary, action_points, generated_at::text
      FROM promo_monthly_insights WHERE month = $1
    `, [month])
    if (!rows[0]) return null
    const r = rows[0]
    return { month: r.month, concept_tags: r.concept_tags, summary: r.summary, action_points: r.action_points ?? [], generated_at: r.generated_at ?? null }
  } catch {
    return null
  }
}

export async function savePromoMonthlyInsight(month: string, concept_tags: string[], summary: string, action_points: string[] = []): Promise<void> {
  await query(`
    INSERT INTO promo_monthly_insights_history (month, concept_tags, summary, action_points, saved_at)
    SELECT month, concept_tags, summary, action_points, NOW()
    FROM promo_monthly_insights
    WHERE month = $1
  `, [month])
  await query(`
    INSERT INTO promo_monthly_insights (month, concept_tags, summary, action_points, generated_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    ON CONFLICT (month) DO UPDATE SET
      concept_tags  = EXCLUDED.concept_tags,
      summary       = EXCLUDED.summary,
      action_points = EXCLUDED.action_points,
      updated_at    = NOW()
  `, [month, concept_tags, summary, action_points])
}

export async function getPromoInsightHistory(month: string): Promise<{ id: number; month: string; concept_tags: string[]; summary: string; action_points: string[]; saved_at: string }[]> {
  try {
    const rows = await query<{
      id: number; month: string; concept_tags: string[]; summary: string; action_points: string[]; saved_at: string
    }>(`
      SELECT id, month, concept_tags, summary, action_points, saved_at::text
      FROM promo_monthly_insights_history
      WHERE month = $1
      ORDER BY saved_at DESC
    `, [month])
    return rows.map(r => ({ ...r, action_points: r.action_points ?? [] }))
  } catch {
    return []
  }
}

export async function getProductTopicInsights(): Promise<ProductTopicData[]> {
  try {
    const topProducts = await query<{ goods_no: string; goods_name: string }>(`
      SELECT r.goods_no, p.goods_name
      FROM reviews r
      JOIN products p ON r.goods_no = p.goods_no
      WHERE r.content IS NOT NULL AND r.content != ''
        AND p.is_competitor = false
      GROUP BY r.goods_no, p.goods_name
      ORDER BY COUNT(*) DESC LIMIT 5
    `)

    if (topProducts.length === 0) return []

    const goodsNos = topProducts.map(p => p.goods_no)
    const cached = await query<{ goods_no: string; topics_json: string }>(`
      SELECT goods_no, topics_json
      FROM product_topic_insights
      WHERE goods_no = ANY($1) AND insight_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
    `, [goodsNos])

    const cachedMap = new Map(cached.map(r => [r.goods_no, JSON.parse(r.topics_json)]))
    const missing = topProducts.filter(p => !cachedMap.has(p.goods_no))

    if (missing.length > 0) {
      const { generateProductTopicInsights } = await import('./ai')
      for (const prod of missing) {
        const reviewRows = await query<{ content: string }>(`
          SELECT content FROM reviews
          WHERE goods_no = $1 AND content IS NOT NULL AND content != ''
          ORDER BY created_at DESC LIMIT 80
        `, [prod.goods_no])
        const contents = reviewRows.map(r => r.content.replace(/<[^>]+>/g, ' ').trim())
        const topics = await generateProductTopicInsights(prod.goods_no, prod.goods_name, contents)
        if (topics) {
          cachedMap.set(prod.goods_no, topics)
          const client = await pool.connect()
          try {
            await client.query(`
              INSERT INTO product_topic_insights (goods_no, topics_json, insight_date)
              VALUES ($1, $2, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date)
              ON CONFLICT (goods_no, insight_date) DO UPDATE SET topics_json = EXCLUDED.topics_json
            `, [prod.goods_no, JSON.stringify(topics)])
          } finally {
            client.release()
          }
        }
      }
    }

    return topProducts
      .filter(p => cachedMap.has(p.goods_no))
      .map(p => ({ goods_no: p.goods_no, ...cachedMap.get(p.goods_no) }))
  } catch {
    return []
  }
}

// ─────────────────────────────────────────
// 브랜드 이벤트 / 실행 회고
// ─────────────────────────────────────────

export async function getBrandEvents(brandName?: string, limit = 50): Promise<BrandEvent[]> {
  try {
    const rows = await query<BrandEvent>(
      brandName
        ? `SELECT id, event_date::text, event_type, brand_name, goods_no, category_name,
                  event_detail, source, detected_at::text
           FROM brand_events
           WHERE brand_name = $1
           ORDER BY event_date DESC LIMIT $2`
        : `SELECT id, event_date::text, event_type, brand_name, goods_no, category_name,
                  event_detail, source, detected_at::text
           FROM brand_events
           ORDER BY event_date DESC LIMIT $1`,
      brandName ? [brandName, limit] : [limit]
    )
    return rows
  } catch { return [] }
}

export async function getBrandNames(): Promise<string[]> {
  try {
    const rows = await query<{ brand_name: string }>(`
      SELECT DISTINCT brand_name FROM brand_events
      WHERE brand_name IS NOT NULL
      ORDER BY brand_name
    `)
    return rows.map(r => r.brand_name)
  } catch { return [] }
}

export async function saveBrandEvent(event: Omit<BrandEvent, 'id' | 'detected_at'>): Promise<void> {
  await query(`
    INSERT INTO brand_events
      (event_date, event_type, brand_name, goods_no, category_name, event_detail, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    event.event_date, event.event_type, event.brand_name, event.goods_no,
    event.category_name, JSON.stringify(event.event_detail), event.source,
  ])
}

// ─────────────────────────────────────────
// 가격 이력
// ─────────────────────────────────────────

export async function getPriceHistory(goodsNo: string, days = 90): Promise<PriceHistoryPoint[]> {
  try {
    return await query<PriceHistoryPoint>(`
      SELECT recorded_date::text, price
      FROM price_history
      WHERE goods_no = $1 AND recorded_date >= CURRENT_DATE - $2
      ORDER BY recorded_date ASC
    `, [goodsNo, days])
  } catch { return [] }
}

// ─────────────────────────────────────────
// 재구매율 트렌드
// ─────────────────────────────────────────

export async function getRepurchaseTrend(months = 12): Promise<RepurchaseTrendPoint[]> {
  try {
    return await query<RepurchaseTrendPoint>(`
      SELECT
        TO_CHAR(TO_DATE(created_at, 'YYYY-MM-DD'), 'YYYY.MM') AS month,
        ROUND(100.0 * COUNT(*) FILTER (WHERE is_repurchase = true) / COUNT(*), 1) AS repurchase_pct,
        COUNT(*)::int AS total_reviews
      FROM reviews r
      JOIN products p ON r.goods_no = p.goods_no
      WHERE p.is_competitor = false
        AND created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND TO_DATE(created_at, 'YYYY-MM-DD') >= CURRENT_DATE - ($1 * 31)
      GROUP BY 1
      ORDER BY 1
    `, [months])
  } catch { return [] }
}

// ─────────────────────────────────────────
// 올영픽 순위 트렌드
// ─────────────────────────────────────────

export async function getOlivepickRankTrend(goodsNo: string): Promise<OlivepickRankTrendPoint[]> {
  try {
    return await query<OlivepickRankTrendPoint>(`
      SELECT
        TO_CHAR(collected_at, 'YYYY.MM') AS month,
        MIN(rank_position)::int AS rank_position,
        MAX(category_name) AS category_name
      FROM promo_items
      WHERE goods_no = $1 AND promo_type = 'olivepick'
      GROUP BY 1
      ORDER BY 1
    `, [goodsNo])
  } catch { return [] }
}

// ─────────────────────────────────────────
// 쿠팡 데이터 (chat 툴용)
// ─────────────────────────────────────────

const cpPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10000,
  options: '-c search_path=coupang',
})

async function cpQuery<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const client = await cpPool.connect()
  try {
    return (await client.query(sql, params)).rows as T[]
  } finally {
    client.release()
  }
}

export async function getCoupangStats() {
  const [row] = await cpQuery<{
    total_products: number
    total_reviews: number
    avg_rating: number
    last_updated: string | null
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM products)      AS total_products,
      (SELECT COUNT(*)::int FROM reviews)       AS total_reviews,
      ROUND(AVG(r.rating)::numeric, 2)::float  AS avg_rating,
      MAX(r.collected_at)::text                AS last_updated
    FROM reviews r
  `)
  return row ?? { total_products: 0, total_reviews: 0, avg_rating: 0, last_updated: null }
}

export async function getCoupangProductStats() {
  return cpQuery<{
    product_id: string
    product_name: string
    review_count: number
    avg_rating: number
  }>(`
    SELECT
      p.product_id,
      p.product_name,
      COUNT(r.review_id)::int                AS review_count,
      ROUND(AVG(r.rating)::numeric, 1)::float AS avg_rating
    FROM products p
    LEFT JOIN reviews r ON r.product_id = p.product_id
    WHERE p.product_name IS NOT NULL
    GROUP BY p.product_id, p.product_name
    ORDER BY review_count DESC
    LIMIT 30
  `)
}

export async function getCoupangRankings() {
  const search = await cpQuery<{
    keyword: string
    rank_date: string
    product_name: string
    rank_position: number
    is_ad: boolean
  }>(`
    SELECT keyword, rank_date::text, product_name, rank_position, is_ad
    FROM search_rankings
    WHERE rank_date = (SELECT MAX(rank_date) FROM search_rankings)
    ORDER BY keyword, rank_position
    LIMIT 50
  `)
  const category = await cpQuery<{
    category_name: string
    rank_date: string
    rank_hour: number
    product_name: string
    rank_position: number
  }>(`
    SELECT category_name, rank_date::text, rank_hour, product_name, rank_position
    FROM category_rankings
    WHERE rank_date = (SELECT MAX(rank_date) FROM category_rankings)
    ORDER BY category_name, rank_position
    LIMIT 100
  `)
  return { search, category }
}

export async function getCoupangRecentReviews(productId?: string) {
  const cond = productId ? 'AND r.product_id = $1' : ''
  const params = productId ? [productId] : []
  return cpQuery<{
    product_name: string
    rating: number
    content: string
    created_at: string
  }>(`
    SELECT p.product_name, r.rating, r.content, r.created_at
    FROM reviews r
    JOIN products p ON r.product_id = p.product_id
    WHERE r.content IS NOT NULL ${cond}
    ORDER BY r.created_at DESC
    LIMIT 40
  `, params)
}

// ── 네이버 ─────────────────────────────────────────────────────────────────

const nvPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10000,
  options: '-c search_path=naver',
})

async function nvQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await nvPool.connect()
  try {
    const { rows } = await client.query(sql, params)
    return rows as T[]
  } finally {
    client.release()
  }
}

export async function getNaverTrends() {
  return nvQuery<{ keyword: string; date: string; ratio: number }>(`
    SELECT keyword, period::text AS date, ratio
    FROM trends
    WHERE period >= CURRENT_DATE - INTERVAL '8 weeks'
    ORDER BY keyword, period
  `)
}

export async function getNaverSearchRanks() {
  return nvQuery<{
    keyword: string; rank_position: number; product_title: string
    mall_name: string; price: number; is_ours: boolean; rank_date: string
  }>(`
    SELECT keyword, rank_position, product_title, mall_name, price, is_ours, rank_date::text
    FROM search_ranks
    WHERE rank_date = (SELECT MAX(rank_date) FROM search_ranks)
    ORDER BY keyword, rank_position
    LIMIT 200
  `)
}

export async function getNaverMarket() {
  return nvQuery<{
    category: string; brand: string | null; product_title: string
    price: number; is_ours: boolean; volume_ml: number | null
  }>(`
    SELECT category, brand, product_title, price, is_ours, volume_ml
    FROM market_items
    WHERE collected_date = (SELECT MAX(collected_date) FROM market_items)
      AND price > 0
    ORDER BY category, is_ours DESC, price
    LIMIT 200
  `)
}

// ── MCP 고도화 툴 ──────────────────────────────────────────────────────────────

export async function getReviewsByDate(date: string, goodsNo = '') {
  return query<{ goods_name: string; score: number; content: string; created_at: string; skin_type: string | null; is_repurchase: boolean }>(`
    SELECT p.goods_name, r.score, r.content, r.created_at, r.skin_type, r.is_repurchase
    FROM reviews r
    JOIN products p ON r.goods_no = p.goods_no
    WHERE r.created_at::date = $1::date
      AND ($2 = '' OR r.goods_no = $2)
      AND r.content IS NOT NULL AND r.content != ''
    ORDER BY r.created_at
    LIMIT 200
  `, [date, goodsNo])
}

export async function getReviewContent(opts: {
  goodsNo?: string
  date?: string
  filter?: 'all' | 'positive' | 'negative'
  limit?: number
}) {
  const { goodsNo = '', date = '', filter = 'all', limit = 50 } = opts
  const scoreFilter =
    filter === 'positive' ? 'AND r.score >= 4' :
    filter === 'negative' ? 'AND r.score <= 2' : ''
  return query<{ goods_name: string; score: number; content: string; created_at: string; skin_type: string | null; is_repurchase: boolean }>(`
    SELECT p.goods_name, r.score, r.content, r.created_at, r.skin_type, r.is_repurchase
    FROM reviews r
    JOIN products p ON r.goods_no = p.goods_no
    WHERE ($1 = '' OR r.goods_no = $1)
      AND ($2 = '' OR r.created_at::date = $2::date)
      AND r.content IS NOT NULL AND r.content != ''
      ${scoreFilter}
    ORDER BY r.created_at DESC
    LIMIT $3
  `, [goodsNo, date, limit])
}

export async function getWeeklyDelta() {
  const rows = await query<{
    this_cnt: string; last_cnt: string
    this_score: string; last_score: string
    this_pos: string; last_pos: string
    this_neg: string; last_neg: string
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE created_at::date >= CURRENT_DATE - 7)              AS this_cnt,
      COUNT(*) FILTER (WHERE created_at::date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8) AS last_cnt,
      ROUND(AVG(score) FILTER (WHERE created_at::date >= CURRENT_DATE - 7)::numeric, 2)        AS this_score,
      ROUND(AVG(score) FILTER (WHERE created_at::date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8)::numeric, 2) AS last_score,
      ROUND(100.0 * COUNT(*) FILTER (WHERE created_at::date >= CURRENT_DATE - 7 AND score >= 4)
        / NULLIF(COUNT(*) FILTER (WHERE created_at::date >= CURRENT_DATE - 7), 0), 1) AS this_pos,
      ROUND(100.0 * COUNT(*) FILTER (WHERE created_at::date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8 AND score >= 4)
        / NULLIF(COUNT(*) FILTER (WHERE created_at::date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8), 0), 1) AS last_pos,
      ROUND(100.0 * COUNT(*) FILTER (WHERE created_at::date >= CURRENT_DATE - 7 AND score <= 2)
        / NULLIF(COUNT(*) FILTER (WHERE created_at::date >= CURRENT_DATE - 7), 0), 1) AS this_neg,
      ROUND(100.0 * COUNT(*) FILTER (WHERE created_at::date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8 AND score <= 2)
        / NULLIF(COUNT(*) FILTER (WHERE created_at::date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8), 0), 1) AS last_neg
    FROM reviews
    WHERE created_at::date >= CURRENT_DATE - 14
  `)
  const r = rows[0]
  const tw = { review_cnt: Number(r.this_cnt), avg_score: Number(r.this_score), pos_pct: Number(r.this_pos), neg_pct: Number(r.this_neg) }
  const lw = { review_cnt: Number(r.last_cnt), avg_score: Number(r.last_score), pos_pct: Number(r.last_pos), neg_pct: Number(r.last_neg) }
  return {
    this_week: tw,
    last_week: lw,
    delta: {
      review_cnt: tw.review_cnt - lw.review_cnt,
      avg_score:  Math.round((tw.avg_score - lw.avg_score) * 100) / 100,
      pos_pct:    Math.round((tw.pos_pct - lw.pos_pct) * 10) / 10,
      neg_pct:    Math.round((tw.neg_pct - lw.neg_pct) * 10) / 10,
    },
  }
}

export async function getProductSummaryFull(goodsNo: string) {
  const [statsRows, posRows, negRows, recentRows, rankRows] = await Promise.all([
    query<{ goods_name: string; review_cnt: string; avg_score: string; repurchase_pct: string; five_star_cnt: string }>(`
      SELECT p.goods_name,
        COUNT(r.review_id) AS review_cnt,
        ROUND(AVG(r.score)::numeric, 2) AS avg_score,
        ROUND(100.0 * SUM(CASE WHEN r.is_repurchase THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS repurchase_pct,
        COUNT(*) FILTER (WHERE r.score = 5) AS five_star_cnt
      FROM products p LEFT JOIN reviews r ON p.goods_no = r.goods_no
      WHERE p.goods_no = $1
      GROUP BY p.goods_no, p.goods_name
    `, [goodsNo]),
    query<{ word: string; cnt: string }>(`
      SELECT word, COUNT(*) AS cnt FROM (
        SELECT UNNEST(REGEXP_MATCHES(r.content, '[가-힣]{2,6}', 'g')) AS word
        FROM reviews r WHERE r.goods_no = $1 AND r.score >= 4 AND r.content IS NOT NULL
      ) t
      WHERE word NOT IN (${STOPWORDS})
      GROUP BY word ORDER BY cnt DESC LIMIT 10
    `, [goodsNo]),
    query<{ word: string; cnt: string }>(`
      SELECT word, COUNT(*) AS cnt FROM (
        SELECT UNNEST(REGEXP_MATCHES(r.content, '[가-힣]{2,6}', 'g')) AS word
        FROM reviews r WHERE r.goods_no = $1 AND r.score <= 2 AND r.content IS NOT NULL
      ) t
      WHERE word NOT IN (${STOPWORDS})
      GROUP BY word ORDER BY cnt DESC LIMIT 10
    `, [goodsNo]),
    query<{ score: number; content: string; created_at: string; skin_type: string | null; is_repurchase: boolean }>(`
      SELECT score, content, created_at, skin_type, is_repurchase
      FROM reviews WHERE goods_no = $1 AND content IS NOT NULL AND content != ''
      ORDER BY created_at DESC LIMIT 5
    `, [goodsNo]),
    query<{ category_name: string; rank_position: number; rank_date: string }>(`
      SELECT category_name, rank_position, rank_date::text
      FROM market_rankings WHERE goods_no = $1
      ORDER BY rank_date DESC, rank_position LIMIT 20
    `, [goodsNo]),
  ])

  const s = statsRows[0]
  return {
    goods_no:          goodsNo,
    goods_name:        s?.goods_name ?? '',
    stats: {
      review_cnt:     Number(s?.review_cnt ?? 0),
      avg_score:      Number(s?.avg_score ?? 0),
      repurchase_pct: Number(s?.repurchase_pct ?? 0),
      five_star_cnt:  Number(s?.five_star_cnt ?? 0),
    },
    positive_keywords: posRows.map(r => ({ word: r.word, cnt: Number(r.cnt) })),
    negative_keywords: negRows.map(r => ({ word: r.word, cnt: Number(r.cnt) })),
    recent_reviews:    recentRows,
    ranking:           rankRows,
  }
}

export async function getNaverLatestInsight() {
  const rows = await nvQuery<{ id: number; content: string; collected_at: string }>(`
    SELECT id, content,
           to_char(collected_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS collected_at
    FROM insights
    ORDER BY collected_at DESC
    LIMIT 1
  `)
  return rows[0] ?? null
}

// ── 분석 툴 ───────────────────────────────────────────────────────────────────

/** 전일 대비 순위 변화: 오른 상품 / 내린 상품 / 신규 진입 */
export async function getRankingChanges() {
  const rows = await query<{
    category_name: string
    goods_name:    string
    goods_no:      string
    rank_today:    number
    rank_yesterday: number | null
    rank_change:   number | null
    is_ours:       boolean
  }>(`
    WITH today AS (
      SELECT DISTINCT ON (category_name, goods_no)
        category_name, goods_no, goods_name, rank_position
      FROM market_rankings
      WHERE rank_date = CURRENT_DATE
      ORDER BY category_name, goods_no, rank_hour DESC
    ),
    yesterday AS (
      SELECT DISTINCT ON (category_name, goods_no)
        category_name, goods_no, rank_position
      FROM market_rankings
      WHERE rank_date = CURRENT_DATE - INTERVAL '1 day'
      ORDER BY category_name, goods_no, rank_hour DESC
    )
    SELECT
      t.category_name,
      t.goods_name,
      t.goods_no,
      t.rank_position                            AS rank_today,
      y.rank_position                            AS rank_yesterday,
      y.rank_position - t.rank_position          AS rank_change,
      (p.is_competitor IS FALSE OR p.goods_no IS NOT NULL AND p.is_competitor = FALSE) AS is_ours
    FROM today t
    LEFT JOIN yesterday y
      ON t.category_name = y.category_name AND t.goods_no = y.goods_no
    LEFT JOIN products p ON t.goods_no = p.goods_no
    ORDER BY ABS(COALESCE(y.rank_position - t.rank_position, 0)) DESC NULLS LAST,
             t.category_name, t.rank_position
  `)

  const improved = rows.filter(r => r.rank_change != null && r.rank_change > 0)
    .sort((a, b) => (b.rank_change ?? 0) - (a.rank_change ?? 0)).slice(0, 10)
  const dropped = rows.filter(r => r.rank_change != null && r.rank_change < 0)
    .sort((a, b) => (a.rank_change ?? 0) - (b.rank_change ?? 0)).slice(0, 10)
  const new_entry = rows.filter(r => r.rank_yesterday == null).slice(0, 10)

  return { improved, dropped, new_entry, total_tracked: rows.length }
}

/** 최근 7일 가장 많이 오르내린 상품 */
export async function getTopMovers() {
  return query<{
    category_name: string
    goods_name:    string
    goods_no:      string
    rank_7d_ago:   number | null
    rank_today:    number
    total_change:  number | null
    is_ours:       boolean
  }>(`
    WITH latest AS (
      SELECT DISTINCT ON (category_name, goods_no)
        category_name, goods_no, goods_name, rank_position AS rank_today
      FROM market_rankings
      WHERE rank_date = CURRENT_DATE
      ORDER BY category_name, goods_no, rank_hour DESC
    ),
    week_ago AS (
      SELECT DISTINCT ON (category_name, goods_no)
        category_name, goods_no, rank_position AS rank_7d_ago
      FROM market_rankings
      WHERE rank_date = CURRENT_DATE - INTERVAL '7 days'
      ORDER BY category_name, goods_no, rank_hour DESC
    )
    SELECT
      l.category_name,
      l.goods_name,
      l.goods_no,
      w.rank_7d_ago,
      l.rank_today,
      w.rank_7d_ago - l.rank_today        AS total_change,
      (p.is_competitor = FALSE)            AS is_ours
    FROM latest l
    LEFT JOIN week_ago w
      ON l.category_name = w.category_name AND l.goods_no = w.goods_no
    LEFT JOIN products p ON l.goods_no = p.goods_no
    WHERE w.rank_7d_ago IS NOT NULL
    ORDER BY ABS(w.rank_7d_ago - l.rank_today) DESC
    LIMIT 20
  `)
}

/** 카테고리별 경쟁사 상위 상품 + 우리 상품 현황 종합 */
export async function getCompetitiveSummary() {
  return query<{
    category_name:    string
    rank_position:    number
    goods_name:       string
    goods_no:         string
    is_ours:          boolean
    our_best_rank:    number | null
    competitor_count: number
  }>(`
    WITH latest AS (
      SELECT DISTINCT ON (category_name, goods_no)
        category_name, goods_no, goods_name, rank_position
      FROM market_rankings
      WHERE rank_date = CURRENT_DATE
      ORDER BY category_name, goods_no, rank_hour DESC
    ),
    our_best AS (
      SELECT l.category_name, MIN(l.rank_position) AS our_best_rank
      FROM latest l
      JOIN products p ON l.goods_no = p.goods_no
      WHERE p.is_competitor = FALSE
      GROUP BY l.category_name
    ),
    cat_counts AS (
      SELECT category_name, COUNT(*) AS competitor_count
      FROM latest l
      JOIN products p ON l.goods_no = p.goods_no
      WHERE p.is_competitor = TRUE
      GROUP BY category_name
    )
    SELECT
      l.category_name,
      l.rank_position,
      l.goods_name,
      l.goods_no,
      (p.is_competitor = FALSE) AS is_ours,
      ob.our_best_rank,
      COALESCE(cc.competitor_count, 0)::int AS competitor_count
    FROM latest l
    LEFT JOIN products p ON l.goods_no = p.goods_no
    LEFT JOIN our_best ob ON l.category_name = ob.category_name
    LEFT JOIN cat_counts cc ON l.category_name = cc.category_name
    WHERE l.rank_position <= 5
    ORDER BY l.category_name, l.rank_position
  `)
}

// ─────────────────────────────────────────
// 경쟁사 키워드 분석
// ─────────────────────────────────────────

export async function getCompetitorInsights(category?: string): Promise<import('./types').CompetitorInsight[]> {
  try {
    const rows = await query<{
      week_start: string
      category_name: string
      goods_no: string
      goods_name: string
      brand_name: string | null
      rank_position: number | null
      review_count: number
      avg_score: string | null
      positive_keywords: unknown
      negative_keywords: unknown
      is_ours: boolean
    }>(`
      SELECT
        week_start::text,
        category_name,
        goods_no,
        goods_name,
        brand_name,
        rank_position,
        review_count,
        avg_score::text,
        positive_keywords,
        negative_keywords,
        is_ours
      FROM competitor_insights
      WHERE week_start = (SELECT MAX(week_start) FROM competitor_insights)
        ${category ? 'AND category_name = $1' : ''}
      ORDER BY category_name, is_ours DESC, rank_position NULLS LAST
    `, category ? [category] : [])

    return rows.map(r => ({
      ...r,
      review_count: Number(r.review_count),
      rank_position: r.rank_position != null ? Number(r.rank_position) : null,
      avg_score: r.avg_score != null ? Number(r.avg_score) : null,
      positive_keywords: typeof r.positive_keywords === 'string'
        ? JSON.parse(r.positive_keywords)
        : (r.positive_keywords as { word: string; cnt: number }[] ?? []),
      negative_keywords: typeof r.negative_keywords === 'string'
        ? JSON.parse(r.negative_keywords)
        : (r.negative_keywords as { word: string; cnt: number }[] ?? []),
    }))
  } catch {
    return []
  }
}

/** 오늘의 데일리 브리핑 조회 (없으면 null) */
export async function getDailyBrief(): Promise<{ brief_date: string; brief_text: string; generated_at: string } | null> {
  const rows = await query<{ brief_date: string; brief_text: string; generated_at: string }>(`
    SELECT
      to_char(brief_date, 'YYYY-MM-DD')                            AS brief_date,
      brief_text,
      to_char(generated_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI')  AS generated_at
    FROM daily_briefs
    WHERE brief_date = CURRENT_DATE
    ORDER BY generated_at DESC
    LIMIT 1
  `)
  return rows[0] ?? null
}
