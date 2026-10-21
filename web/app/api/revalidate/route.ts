import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getMarketRankings, getInsights, getProductNegatives } from '@/lib/db'
import { generateMarketInsight, generateDailyBrief, generateReviewInsight } from '@/lib/ai'

export const maxDuration = 60

export async function POST(req: Request) {
  // 두 경로로 호출된다: 수집 파이프라인(시크릿) / 화면의 새로고침 버튼(로그인 세션).
  // middleware가 이 경로의 인증을 건너뛰므로 여기서 직접 확인한다.
  const secret = process.env.REVALIDATE_SECRET
  if (secret) {
    const body = await req.json().catch(() => ({}))
    const bySecret = body.secret === secret
    const session = bySecret ? null : await auth()
    if (!bySecret && !session) {
      // 401 이 났을 때 '시크릿이 틀린 건지 세션이 없는 건지' 를 구분할 수 있어야
      // 한다. 화면의 새로고침 버튼은 시크릿 없이 세션만으로 들어온다.
      console.error('[revalidate] 401 — secret match:', bySecret,
        '/ session:', session ? 'ok' : 'none',
        '/ cookie:', req.headers.get('cookie') ? 'sent' : 'MISSING')
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
