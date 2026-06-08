import { Pool } from 'pg'
import { NextRequest, NextResponse } from 'next/server'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10000,
  options: '-c search_path=coupang',
})

export const dynamic = 'force-dynamic'

const STOPWORDS = new Set([
  '이', '가', '은', '는', '을', '를', '에', '의', '로', '으로', '과', '와',
  '도', '만', '에서', '에게', '한테', '처럼', '보다', '것', '거', '게',
  '이게', '그게', '그냥', '정말', '진짜', '너무', '매우', '좀', '많이',
  '제품', '상품', '구매', '사용', '리뷰', '후기', '추천', '좋아요', '좋음',
  '그리고', '그런데', '하지만', '그래서', '또한', '아직', '이미', '다시',
  '항상', '계속', '조금', '살짝', '느낌', '같아요', '같아', '있어요', '있어',
  '없어요', '없어', '됩니다', '됩니다', '해요', '해서', '하고', '하는',
])

function countWords(text: string): Map<string, number> {
  const freq = new Map<string, number>()
  const words = text
    .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
  for (const w of words) {
    if (w.length < 2) continue
    if (STOPWORDS.has(w)) continue
    freq.set(w, (freq.get(w) ?? 0) + 1)
  }
  return freq
}

function topN(freq: Map<string, number>, n: number) {
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, count]) => ({ word, count }))
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const productId = searchParams.get('productId') ?? null

  const client = await pool.connect()
  try {
    const params = productId ? [productId] : []
    const cond = productId ? 'AND product_id = $1' : ''

    const { rows } = await client.query<{ content: string | null; rating: number | null }>(
      `SELECT content, rating FROM reviews
       WHERE content IS NOT NULL ${cond}
       LIMIT 3000`,
      params
    )

    const posFreq = new Map<string, number>()
    const negFreq = new Map<string, number>()

    for (const row of rows) {
      if (!row.content) continue
      const freq = countWords(row.content)
      const target = (row.rating ?? 0) >= 4 ? posFreq : (row.rating ?? 0) <= 2 ? negFreq : null
      if (!target) continue
      for (const [w, c] of freq) {
        target.set(w, (target.get(w) ?? 0) + c)
      }
    }

    return NextResponse.json({
      positive: topN(posFreq, 30),
      negative: topN(negFreq, 30),
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ positive: [], negative: [] })
  } finally {
    client.release()
  }
}
