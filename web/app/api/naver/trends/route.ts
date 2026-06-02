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
      SELECT keyword, period::text AS date, ratio
      FROM trends
      WHERE period >= CURRENT_DATE - INTERVAL '8 weeks'
      ORDER BY keyword, period
    `)

    // { [keyword]: { date, ratio }[] }
    const result: Record<string, { date: string; ratio: number }[]> = {}
    for (const row of rows) {
      if (!result[row.keyword]) result[row.keyword] = []
      result[row.keyword].push({ date: row.date, ratio: row.ratio })
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error(e)
    return NextResponse.json({})
  } finally {
    client.release()
  }
}
