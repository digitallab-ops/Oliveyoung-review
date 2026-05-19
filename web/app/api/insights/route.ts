import { NextRequest, NextResponse } from 'next/server'
import { getInsights } from '@/lib/db'

export const revalidate = 300

export async function GET(req: NextRequest) {
  const goodsNo = req.nextUrl.searchParams.get('goodsNo') || undefined
  try {
    const data = await getInsights(goodsNo)
    return NextResponse.json(data)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
