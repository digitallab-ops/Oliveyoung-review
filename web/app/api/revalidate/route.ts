import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { getMarketRankings, getInsights, getProductNegatives } from '@/lib/db'
import { generateMarketInsight, generateDailyBrief, generateReviewInsight } from '@/lib/ai'

export const maxDuration = 60

export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET
  if (secret) {
    const body = await req.json().catch(() => ({}))
    if (body.secret !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  revalidatePath('/')

  // 수집 완료 직후 AI 캐시 워밍업 — 페이지 렌더 전에 DB에 결과 저장
  try {
    const [marketRankings, insights, negativeData] = await Promise.all([
      getMarketRankings(),
      getInsights(),
      getProductNegatives(),
    ])
    await Promise.all([
      marketRankings.length > 0 ? generateMarketInsight(marketRankings) : Promise.resolve(''),
      marketRankings.length > 0 ? generateDailyBrief(marketRankings, insights, negativeData) : Promise.resolve(''),
      generateReviewInsight(insights, negativeData),
    ])
  } catch (e) {
    console.error('AI warmup failed:', e)
  }

  return NextResponse.json({ revalidated: true })
}
