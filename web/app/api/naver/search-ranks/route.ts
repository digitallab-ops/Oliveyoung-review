import { Pool } from 'pg'
import { NextResponse } from 'next/server'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10000,
  options: '-c search_path=naver',
})

export const dynamic = 'force-dynamic'

export async function GET() {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(`
      WITH latest AS (SELECT MAX(rank_date) AS rd FROM search_ranks),
      prev AS (
        SELECT MAX(rank_date) AS rd FROM search_ranks
        WHERE rank_date < (SELECT rd FROM latest)
      )
      SELECT
        c.keyword,
        c.rank_position,
        c.product_title,
        c.mall_name,
        c.price,
        c.link,
        c.is_ours,
        c.rank_date::text,
        p.rank_position AS prev_rank,
        (p.rank_position - c.rank_position)::int AS delta
      FROM search_ranks c
      LEFT JOIN search_ranks p
        ON p.keyword = c.keyword
       AND p.product_title = c.product_title
       AND p.rank_date = (SELECT rd FROM prev)
      WHERE c.rank_date = (SELECT rd FROM latest)
      ORDER BY c.keyword, c.rank_position
    `)
    return NextResponse.json(rows)
  } catch (e) {
    console.error(e)
    return NextResponse.json([])
  } finally {
    client.release()
  }
}
