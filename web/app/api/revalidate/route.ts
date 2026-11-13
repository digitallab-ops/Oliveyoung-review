import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { auth } from '@/auth'

/** 길이가 다르면 timingSafeEqual 이 던진다. 길이부터 본다. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
import { getMarketRankings, getInsights, getProductNegatives, getProductTopicInsights, getOurRankTrend, getDiscountStatus, getNegativeAlerts } from '@/lib/db'
import { generateMarketInsight, generateDailyBrief, generateReviewInsight } from '@/lib/ai'

export const maxDuration = 60

export async function POST(req: Request) {
  // 두 경로로 호출된다: 수집 파이프라인(시크릿) / 화면의 새로고침 버튼(로그인 세션).
  // middleware가 이 경로의 인증을 건너뛰므로 여기서 직접 확인한다.
  // 시크릿이 비어 있을 때 통과시키면(fail-open) 환경변수 누락 한 번으로 누구나
  // 호출할 수 있게 된다. 이 경로는 호출마다 큰 쿼리 3개와 AI 생성 3개를 돌린다.
  // 시크릿이 없으면 세션만 받는다 — 열어 두지 않는다.
  const secret = process.env.REVALIDATE_SECRET
  if (!secret) console.warn('[revalidate] REVALIDATE_SECRET 미설정 — 세션 로그인만 허용한다')

  const body = await req.json().catch(() => ({}))
  const bySecret = !!secret && typeof body.secret === 'string' && safeEqual(body.secret, secret)
  const session = bySecret ? null : await auth()
  if (!bySecret && !session) {
    // 401 이 났을 때 '시크릿이 틀린 건지 세션이 없는 건지' 를 구분할 수 있어야
    // 한다. 화면의 새로고침 버튼은 시크릿 없이 세션만으로 들어온다.
    console.error('[revalidate] 401 — secret match:', bySecret,
      '/ session:', session ? 'ok' : 'none',
      '/ cookie:', req.headers.get('cookie') ? 'sent' : 'MISSING')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  revalidatePath('/')

  // 수집 완료 직후 AI 캐시 워밍업 — 페이지 렌더 전에 DB에 결과 저장
  try {
    // 브리핑이 '예상'을 쓰려면 하루치 delta 말고 흐름과 가격이 필요하다.
    // 추가 쿼리는 둘 다 0.5초 미만이다(실측 0.45s / 0.04s).
    //
    // 시간 예산은 쿼리가 아니라 **브리핑 생성**이 쓴다. generateDailyBrief 는
    // 접지 검사에 걸리면 다시 만들기 때문에 모델을 최대 3번 부른다
    // (GROUNDING_TRIES, web/lib/ai.ts). 호출당 실측 중앙 5.3초 / 최대 6.7초라
    // 최악 약 20초다. 아래 Promise.all 의 셋은 동시에 도니까 maxDuration 60초에
    // 40초쯤 여유가 남는다. 재시도 횟수를 올리려면 이 여유부터 다시 재라.
    const [marketRankings, insights, negativeData, rankTrend, discount, negAlerts] = await Promise.all([
      getMarketRankings(),
      getInsights(),
      getProductNegatives(),
      getOurRankTrend(7),
      getDiscountStatus(14, 60),
      getNegativeAlerts(),
    ])
    await Promise.all([
      marketRankings.length > 0 ? generateMarketInsight(marketRankings) : Promise.resolve(''),
      marketRankings.length > 0 ? generateDailyBrief(marketRankings, insights, negativeData, rankTrend, discount, negAlerts) : Promise.resolve(''),
      generateReviewInsight(insights, negativeData),
      // 상품별 토픽은 렌더 경로에서 빼 왔다. 생성은 여기서만 한다.
      getProductTopicInsights(true),
    ])
  } catch (e) {
    console.error('AI warmup failed:', e)
  }

  return NextResponse.json({ revalidated: true })
}
