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
      SELECT
        category,
        brand,
        product_title,
        mall_name,
        price,
        is_ours,
        volume_ml,
        collected_date::text
      FROM market_items
      WHERE collected_date = (SELECT MAX(collected_date) FROM market_items)
        AND price > 0
      ORDER BY category, is_ours DESC, price
    `)
    return NextResponse.json(rows)
  } catch (e) {
    console.error(e)
    return NextResponse.json([])
  } finally {
    client.release()
  }
}
