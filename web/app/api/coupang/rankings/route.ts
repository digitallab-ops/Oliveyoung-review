import { Pool } from 'pg'
import { NextResponse } from 'next/server'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10000,
  options: '-c search_path=coupang',
})

export const dynamic = 'force-dynamic'

export async function GET() {
  const client = await pool.connect()
  try {
    // 카테고리 순위: 최신 vs 직전 스냅샷 delta 계산
    const { rows: catRows } = await client.query(`
      WITH latest AS (
        SELECT rank_date, rank_hour FROM category_rankings
        ORDER BY rank_date DESC, rank_hour DESC LIMIT 1
      ),
      prev AS (
        SELECT rank_date, rank_hour FROM category_rankings
        WHERE (rank_date, rank_hour) < (SELECT rank_date, rank_hour FROM latest)
        ORDER BY rank_date DESC, rank_hour DESC LIMIT 1
      ),
      curr_snap AS (
        SELECT category_name, rank_position, product_id, product_name, is_ours,
               rank_date, rank_hour
        FROM category_rankings
        WHERE (rank_date, rank_hour) = (SELECT rank_date, rank_hour FROM latest)
      ),
      prev_snap AS (
        SELECT category_name, product_id, rank_position
        FROM category_rankings
        WHERE (rank_date, rank_hour) = (SELECT rank_date, rank_hour FROM prev)
      )
      SELECT
        c.category_name, c.rank_position, c.product_id, c.product_name, c.is_ours,
        c.rank_date::text, c.rank_hour,
        p.rank_position                               AS prev_rank,
        (p.rank_position - c.rank_position)::int      AS delta
      FROM curr_snap c
      LEFT JOIN prev_snap p
        ON c.product_id = p.product_id AND c.category_name = p.category_name
      ORDER BY c.category_name, c.rank_position
    `)

    // 검색순위: 최신일 vs 직전일 delta 계산
    const { rows: searchRows } = await client.query(`
      WITH latest_date AS (
        SELECT MAX(rank_date) AS rd FROM search_rankings
      ),
      prev_date AS (
        SELECT MAX(rank_date) AS rd FROM search_rankings
        WHERE rank_date < (SELECT rd FROM latest_date)
      ),
      curr_snap AS (
        SELECT keyword, product_id, product_name, rank_position, is_ours,
               rank_date
        FROM search_rankings
        WHERE rank_date = (SELECT rd FROM latest_date) AND is_ad = false
      ),
      prev_snap AS (
        SELECT keyword, product_id, rank_position
        FROM search_rankings
        WHERE rank_date = (SELECT rd FROM prev_date) AND is_ad = false
      )
      SELECT
        c.keyword, c.product_id, c.product_name, c.rank_position, c.is_ours,
        c.rank_date::text,
        p.rank_position                               AS prev_rank,
        (p.rank_position - c.rank_position)::int      AS delta
      FROM curr_snap c
      LEFT JOIN prev_snap p
        ON c.keyword = p.keyword AND c.product_id = p.product_id
      ORDER BY c.keyword, c.rank_position
    `)

    return NextResponse.json({ search: searchRows, category: catRows })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ search: [], category: [] })
  } finally {
    client.release()
  }
}
