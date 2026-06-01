import { Pool } from 'pg'
import { NextResponse } from 'next/server'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10000,
  options: '-c search_path=coupang',
})

export async function GET() {
  const client = await pool.connect()
  try {
    // 검색순위: 키워드별 최신 날짜 기준 Top 100
    const { rows: searchRows } = await client.query(`
      SELECT keyword, product_id, product_name, rank_position, is_ad, is_ours, rank_date
      FROM search_rankings
      WHERE rank_date = (SELECT MAX(rank_date) FROM search_rankings)
        AND is_ad = false
      ORDER BY keyword, rank_position
    `)

    // 카테고리 순위: 최신 rank_date + rank_hour 기준 Top 100
    const { rows: catRows } = await client.query(`
      SELECT category_name, rank_position, product_id, product_name, is_ours, rank_date, rank_hour
      FROM category_rankings
      WHERE (rank_date, rank_hour) = (
        SELECT rank_date, rank_hour FROM category_rankings
        ORDER BY rank_date DESC, rank_hour DESC
        LIMIT 1
      )
      ORDER BY category_name, rank_position
      LIMIT 300
    `)

    return NextResponse.json({ search: searchRows, category: catRows })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ search: [], category: [] })
  } finally {
    client.release()
  }
}
