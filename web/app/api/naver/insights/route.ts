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
      SELECT id, content,
             to_char(collected_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS collected_at
      FROM insights
      ORDER BY collected_at DESC
      LIMIT 10
    `)
    return NextResponse.json(rows)
  } catch (e) {
    console.error(e)
    return NextResponse.json([])
  } finally {
    client.release()
  }
}
