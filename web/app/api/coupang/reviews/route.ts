import { Pool } from 'pg'
import { NextRequest, NextResponse } from 'next/server'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10000,
  options: '-c search_path=coupang',
})

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = 20
  const offset = (page - 1) * limit

  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT r.review_id, r.product_id, p.product_name, r.content,
              r.rating, r.helpful_count, r.purchased_option, r.created_at
       FROM reviews r
       LEFT JOIN products p ON r.product_id = p.product_id
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    )
    const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS total FROM reviews')
    return NextResponse.json({ reviews: rows, total: countRows[0]?.total ?? 0 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ reviews: [], total: 0 })
  } finally {
    client.release()
  }
}
