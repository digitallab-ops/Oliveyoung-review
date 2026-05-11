import { NextRequest, NextResponse } from 'next/server'
import { getReviews } from '@/lib/db'
import type { FilterType } from '@/lib/types'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const goodsNo  = searchParams.get('goodsNo')  || undefined
  const filter   = (searchParams.get('filter')  || 'all') as FilterType
  const page     = parseInt(searchParams.get('page') || '0', 10)
  const limit    = parseInt(searchParams.get('limit') || '20', 10)
  const keywords = searchParams.get('keywords')?.split(',').filter(Boolean)

  try {
    const data = await getReviews({ goodsNo, filter, keywords, page, limit: Math.min(limit, 50) })
    return NextResponse.json(data)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
