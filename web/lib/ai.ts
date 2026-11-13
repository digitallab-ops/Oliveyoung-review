import OpenAI from 'openai'
import type { MarketCategoryData, Insights, ProductNegativeData, OurRankTrend, DiscountStatus, NegativeAlertData } from './types'
import { pool } from './db'
import { buildGround, verify, formatViolations } from './grounding'

let _client: OpenAI | null = null
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _client
}

const MODEL = 'gpt-5.4-mini'

const NO_MARKDOWN_SYSTEM = '당신은 올리브영 뷰티 시장 전문 분석가입니다. 출력 규칙: 1) 모든 줄은 반드시 "- "로 시작하세요. 2) 마크다운·특수문자 서식 완전 금지(*, **, #, __, >, `, ~, 이모지, 번호+점 등 어떤 형식도 금지). 3) 섹션 제목 금지 — "리뷰 분석:", "순위:" 같은 카테고리 구분 없이 바로 인사이트 bullet로만 작성. 4) 데이터 재나열 금지 — 해석과 판단만 써라. 5) 각 bullet은 마케터가 즉시 행동할 수 있는 하나의 전략적 결론을 담아야 한다. 6) bullet 사이 빈 줄 없이 연속 작성. 7) 첫 글자부터 "- "로 시작하라. 다른 어떤 것도 출력하지 마라.'

function getKSTDateStr(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function getSlot(): 'am' | 'pm' {
  const kstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours()
  return kstHour < 13 ? 'am' : 'pm'
}

function getSeasonContext(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const month = kst.getUTCMonth() + 1 // 1-12
  const day = kst.getUTCDate()
  const dateStr = `${kst.getUTCFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (month === 12 || month <= 2) return `지금은 겨울(${dateStr}) — 보습·보온 수요, 건조한 피부 고민 집중`
  if (month === 3) return `지금은 초봄(${dateStr}) — 봄 환절기 진입, 미세먼지·봄 맞이 스킨케어 수요 상승`
  if (month <= 5) return `지금은 봄(${dateStr}) — 자외선 시작, 선케어 수요 진입, 가벼운 제형 선호`
  if (month === 6) return `지금은 초여름(${dateStr}) — 선케어 피크 직전, 쿨링 수요 급상승`
  if (month <= 8) return `지금은 여름(${dateStr}) — 선케어·쿨링 피크 시즌, 땀·모공·각질 케어 수요`
  if (month === 9) return `지금은 초가을(${dateStr}) — 여름 마무리, 쿨링 수요 감소 시작, 보습·환절기 케어 전환기`
  if (month === 10) return `지금은 가을(${dateStr}) — 환절기 민감성 피부 수요, 진정·보습 강화`
  return `지금은 늦가을(${dateStr}) — 겨울 진입 전, 집중 보습·트러블 케어 수요`
}

async function chat(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: MODEL,
    max_completion_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
  })
  return res.choices[0].message.content?.trim() ?? ''
}

// ──────────────────────────────────────────
// 1. 오늘의 통합 브리핑 (랭킹 + 리뷰 합산)
// ──────────────────────────────────────────

function fmtWon(n: number): string {
  return n.toLocaleString('ko-KR')
}

/** 한 카테고리에서의 7일 흐름을 "[선케어] 84 → 72 → ... → 55위 (7일 +29계단)" 로 접는다. */
function fmtSeg(t: OurRankTrend): string {
  const pts = t.points
  const net = pts[0].rank_position - pts[pts.length - 1].rank_position   // 양수 = 순위 상승
  const seq = pts.map(p => p.rank_position).join(' → ')
  return `[${t.category_name}] ${seq}위 (${pts.length}일 ${net > 0 ? `+${net}` : net}계단)`
}

/**
 * 추세를 **상품 단위**로 한 줄에 합친다.
 *
 * 한 상품이 여러 카테고리 TOP100 에 동시에 들어간다. 카테고리마다 한 줄씩 쓰면
 * 모델이 서로 다른 두 상품으로 읽는다 — 2026-11-13 생산 브리핑이
 * "포스트 알파 쿨링 패드는 62위에서 55위로 회복했지만 더모 코스메틱 쿨링 패드는
 * 80위에서 93위로 밀렸다"고 썼다. 62는 마스크팩 줄, 55는 더모 줄에서 하나씩
 * 집어온 것이고 두 줄은 같은 goods_no 다.
 */
function fmtTrendLines(rankTrend: OurRankTrend[]): string[] {
  const byGoods = new Map<string, { name: string; segs: [number, string][]; best: number }>()
  for (const t of rankTrend) {
    const last = t.points[t.points.length - 1].rank_position
    const cur = byGoods.get(t.goods_no) ?? { name: t.goods_name, segs: [], best: Infinity }
    cur.segs.push([last, fmtSeg(t)])
    cur.best = Math.min(cur.best, last)
    byGoods.set(t.goods_no, cur)
  }
  return [...byGoods.values()]
    .sort((a, b) => a.best - b.best)
    .slice(0, 10)
    .map(v => {
      const segs = v.segs.sort((a, b) => a[0] - b[0]).map(s => s[1])
      const tail = segs.length > 1
        ? '   ※ 한 상품이다. 카테고리별 순위일 뿐 서로 다른 제품이 아니다' : ''
      return `${v.name}: ${segs.join(' | ')}${tail}`
    })
}

function buildDailyBriefPrompt(
  marketData: MarketCategoryData[],
  insights: Insights,
  negativeData: ProductNegativeData[],
  rankTrend: OurRankTrend[],
  discount: DiscountStatus | null,
  negAlerts: NegativeAlertData[]
): string {
  // 자사 7일 흐름. 하루치 delta 만으로는 "며칠째 어느 방향"을 말할 수 없다.
  const trendLines = fmtTrendLines(rankTrend)

  // 추세가 비면(수집 공백 등) 최소한 오늘 위치라도 넘긴다.
  const oursToday = marketData.flatMap(c =>
    c.entries.filter(e => e.is_ours)
      .map(e => `[${c.category_name}] ${e.goods_name} ${e.rank_position}위${e.delta != null ? `(${e.delta > 0 ? '+' : ''}${e.delta})` : ''}`)
  )

  const topRisers = marketData
    .flatMap(c => c.entries
      .filter(e => !e.is_ours && e.delta != null && e.delta >= 5)
      .map(e => ({ ...e, cat: c.category_name })))
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    .slice(0, 6)
    .map(e => `[${e.cat}] ${e.goods_name} ${e.prev_rank}위 → ${e.rank_position}위 (+${e.delta})`)

  const newTop10 = marketData
    .flatMap(c => c.entries
      .filter(e => !e.is_ours && e.prev_rank == null && e.rank_position <= 10)
      .map(e => `[${c.category_name}] ${e.goods_name} ${e.rank_position}위 신규진입`))
    .slice(0, 4)

  // 이 목록은 시장 전체 상위다. 섞어서 넘기면 모델이 전부 자사로 읽는다.
  // 실제로 "자사 리뷰 불만이 디오디너리 466건" 같은 문장이 나갔다.
  const fmtNeg = (p: ProductNegativeData) => {
    const kw = p.keywords.slice(0, 3).map(k => k.word).join(', ')
    return `${p.goods_name}: 불만 ${p.neg_count}건 (${kw})`
  }
  // 누적 건수는 '늘 많은 상품'만 반복해서 올라온다. 변화가 있는 건 급증 쪽이다.
  // getNegativeAlerts 는 자사 전용이고 최근 7일 vs 직전 7일 비교라 브리핑 재료로 맞다.
  const negSurge = negAlerts.slice(0, 4).map(a => {
    const kw = a.top_keywords.slice(0, 3).map(k => k.word).join(', ')
    return `${a.goods_name}: ${a.prev_neg}건 → ${a.recent_neg}건 (${a.increase_pct > 0 ? '+' : ''}${a.increase_pct}%)${kw ? ` (${kw})` : ''}`
  })

  const oursNeg  = negativeData.filter(p => !p.is_competitor).sort((a, b) => b.neg_count - a.neg_count).slice(0, 4).map(fmtNeg)
  const rivalNeg = negativeData.filter(p =>  p.is_competitor).sort((a, b) => b.neg_count - a.neg_count).slice(0, 4).map(fmtNeg)

  const posKw = insights.positive_keywords.slice(0, 8).map(k => `${k.word}(${k.cnt})`).join(', ')

  // 할인은 '경쟁사가 왜 올라왔나'를 설명하는 거의 유일한 재료다.
  let discountBlock = '수집된 세일가 없음'
  if (discount && discount.entries.length > 0) {
    const ourTop = discount.entries.filter(d => d.is_ours).slice(0, 5)
      .map(d => `${d.goods_name} ${d.discount_rate}% (${fmtWon(d.base_price)}→${fmtWon(d.sale_price)}원)`)
    const rivalTop = discount.entries.filter(d => !d.is_ours).slice(0, 6)
      .map(d => `${d.goods_name} ${d.discount_rate}% (${fmtWon(d.base_price)}→${fmtWon(d.sale_price)}원)`)
    discountBlock = [
      `평균 할인율 — 자사 ${discount.ours_avg ?? '—'}% (${discount.ours_count}개) / 경쟁사 ${discount.rival_avg ?? '—'}% (${discount.rival_count}개)`,
      ourTop.length  ? `자사 할인 상위:
${ourTop.join('\n')}`   : '자사 할인 상품 없음',
      rivalTop.length ? `경쟁사 할인 상위:
${rivalTop.join('\n')}` : '',
    ].filter(Boolean).join('\n')
  }

  return `${getSeasonContext()}

[자사 최근 순위 흐름 — 왼쪽이 과거, 오른쪽이 오늘]
${trendLines.length ? trendLines.join('\n') : (oursToday.length ? oursToday.join('\n') : 'TOP100 없음')}

[오늘 시장 급상승 — 경쟁사]
${topRisers.length ? topRisers.join('\n') : '없음'}

[오늘 TOP10 신규진입 — 경쟁사]
${newTop10.length ? newTop10.join('\n') : '없음'}

[가격·할인 현황 (최근 14일, 정가 아닌 실제 판매가 기준)]
${discountBlock}

[자사 리뷰 불만 급증 — 최근 14일 vs 직전 14일]
${negSurge.length ? negSurge.join('\n') : '급증한 상품 없음'}

[자사 리뷰 불만 — 전체 기간 누적. 오늘의 변화가 아님]
${oursNeg.length ? oursNeg.join('\n') : '없음'}

[경쟁사 리뷰 불만 — 2026-07 스냅샷. 자사 아니고, 최신도 아님]
${rivalNeg.length ? rivalNeg.join('\n') : '없음'}

[자사 긍정 키워드]
${posKw || '없음'}

────────────────────────────────

오늘 이 대시보드를 처음 여는 셀퓨전씨 마케터가 10초 안에 파악해야 할 것 4~5가지를 써라.

각 bullet 은 반드시 아래 네 조각을 이 순서로 담아라. 하나라도 못 채우면 그 bullet 은 버리고 다른 소재를 써라.
  (1) 근거 — 어떤 수치가 어떻게 움직였나. 위 데이터에 실제로 있는 숫자만 쓴다.
  (2) 해석 — 왜 그렇게 움직였다고 보는가. 반드시 위 블록 중 '다른 블록'의 데이터와 연결해서 설명한다
      (순위 ↔ 할인율, 순위 ↔ 시즌, 불만 키워드 ↔ 순위, 경쟁사 급등 ↔ 자사 가격 등).
  (3) 예상 — 이대로 가면 어떻게 될 것 같은가. 시점과 방향을 숫자로 적는다
      (예: "다음 주 안에 40위권 진입", "이번 달 안에 80위 밖으로 밀릴 것"). "지켜봐야 한다"는 예상이 아니다.
  (4) 할 일 — 누가 무엇을 바꾸거나 확인하는가.

좋은 예:
- 레이저 UV 썬스크린이 더모에서 7일간 84위에서 55위로 29계단 올라왔는데, 같은 기간 급등한 경쟁 선케어는 라로슈포제 톤업(+68), 이니스프리 톤업 1+1(+54)처럼 전부 톤업 축이다. 11월 들어 선케어 수요가 자외선이 아니라 톤 보정으로 옮겨가는 중이라, 지금 속도면 다음 주에 45위권까지는 올라가지만 톤업 소구가 없는 레이저 UV 는 그 위에서 막힐 가능성이 크다. 선케어 담당은 잡티 토닝 썬스크린을 톤업 키워드로 상세 첫 화면에 올리고, 레이저 UV 는 매끈·밀착 축으로 문구를 분리해 두 제품이 같은 검색어를 뺏지 않게 해라.
- 자사 평균 할인율이 30%로 경쟁사 26%보다 4%p 높은데도 클렌징 3종(57%, 52%, 47%)은 TOP100 밖이다. 할인 폭이 순위로 돌아오지 않는 구간이라, 이대로 두면 이번 달 안에 마진만 깎이고 순위는 그대로일 가능성이 높다. 가격 담당은 클렌징 3종 할인율을 40%대로 되돌리고, 뺀 예산을 순위가 실제로 반응하는 선케어 기획가에 옮겨 2주간 차이를 확인해라.

나쁜 예와 이유:
- "평균 평점 4.78로 높게 유지되었습니다. 이는 소비자 만족도가 높음을 시사합니다."
  → 변한 게 없고, 뒷문장이 앞문장을 바꿔 말한 것뿐이며, 예상도 할 일도 없다.
- "경쟁이 치열하므로 지속적인 마케팅 전략이 필요합니다."
  → 어느 상품에 무엇을 하라는 건지 없다. 이런 총평 bullet 은 쓰지 마라.
- "순위가 하락했으니 추이를 모니터링해야 합니다."
  → 모니터링은 예상도 행동도 아니다.

이 시장의 순위는 '추세 지속'이 아니라 '되돌림'이 지배한다. 실측값이다(자사 상품 680쌍, 최근 120일):
  - 지난 7일 방향이 다음 7일에도 이어진 비율    37pct
  - 반대로 되돌아간 비율                        63pct
  - 10계단 이상 크게 움직인 뒤 되돌아간 비율    71pct
  - 자사 상품의 하루 간 순위 변동 중앙값        12계단
그러므로:
- "이 속도면 계속 오른다 / 계속 밀린다"는 틀릴 확률이 더 높다. 쓰지 마라.
- 방향은 기계적으로 뒤집어서 시작해라. 헷갈리지 마라:
    지난 7일 순위가 **올랐으면**(계단 수가 +) → 기본 예상은 **되밀림(순위가 나빠짐)**
    지난 7일 순위가 **내렸으면**(계단 수가 -) → 기본 예상은 **반등(순위가 좋아짐)**
  이 기본값을 뒤집어 쓰려면, 순위를 그 방향으로 붙잡아 둘 원인을 위 데이터에서 직접
  짚어라 — 진행 중인 기획전·할인, 시즌 적합, 경쟁사 이탈, 불만 급증 같은 것.
  원인을 못 짚으면 기본값대로 써라.
- 하루 10계단 안쪽 움직임은 잡음이다. 그걸로 예상을 세우지 마라.
- 예상의 근거는 '추세'가 아니라 '지속될 이유'여야 한다 — 기획전, 할인, 시즌, 경쟁사 진입,
  리뷰 불만처럼 순위를 붙잡아 둘 원인이 보일 때만 방향이 이어진다고 써라.
  그런 원인이 안 보이면 "원래 자리로 돌아올 가능성이 높다"가 더 정확한 예상이다.

규칙:
- '자사'는 셀퓨전씨뿐이다. [경쟁사] 로 표시된 블록의 상품을 자사라고 쓰면 그 브리핑은 틀린 것이다.
- 누적 불만 건수는 전체 기간 합계다. '늘었다/줄었다/급증했다'로 쓰지 마라.
  변화를 말할 수 있는 건 '불만 급증' 블록뿐이다.
- 경쟁사 리뷰 데이터는 2026년 7월에 한 번 수집된 뒤 갱신이 없다.
  경쟁사 불만을 '요즘/최근'이라고 쓰지 마라. 상품 특성으로만 참고해라.
- 위 데이터에 없는 숫자를 지어내지 마라. 모르는 건 쓰지 마라.
- 변하지 않은 것은 쓰지 마라. 평점·리뷰 수가 평소와 같으면 한 줄도 쓰지 마라.
- 한 문장을 다른 말로 반복하지 마라. "이는/즉/다시 말해"로 시작하는 뒷문장은 전부 삭제 대상이다.
- 금지 표현(평서형 '-다' 꼴도 똑같이 금지): 나타냅니다/나타낸다, 시사합니다/시사한다,
  의미합니다/의미한다, 보여줍니다/보여준다, 암시합니다/암시한다, 중요합니다/중요하다,
  긍정적입니다, 필요해 보입니다, 강화하세요, 모니터링하세요, 분석하세요, 추이를 살펴보세요.
  어떤 수치가 무엇을 '보여준다'고 쓰지 마라. 무엇이 어떻게 될지를 바로 써라.
- 마지막에 '액션 포인트' 같은 종합 bullet 을 붙이지 마라. 행동은 각 bullet 안에 있다.
- 쓸 거리가 3개뿐이면 3개만 써라. 수를 채우려 평범한 것을 올리지 마라.
- 데이터 블록이 전부 '없음'이거나 쓸 근거가 하나도 없으면 **아무것도 출력하지 마라**.
  빈 문자열을 반환해라. 데이터 없이 추측으로 bullet 을 만드는 건 최악이다.
  '데이터가 없다는 점이 ~를 뜻한다' 같은 문장도 금지다. 없는 건 없는 거다.
- 섹션 제목·번호 없이 첫 글자부터 "- "로 시작`
}

// ── 캐시 읽기 전용 ────────────────────────────────────────
// 페이지 렌더는 이 셋만 쓴다. generate* 는 캐시가 없으면 OpenAI 를 부르고
// 최대 20초를 기다리는데, 그게 배포 직후 첫 로드를 그만큼 늘리고 있었다.
// 캐시는 수집기가 채운다 — rank_collector(매시) / pipeline / promo_collector 가
// /api/revalidate 를 호출하고, 그 라우트가 generate* 를 돌린다.
// 캐시가 비면 빈 문자열이 돌아가고 화면은 해당 블록을 감춘다.

async function readCached(sql: string, params: unknown[], col: string): Promise<string> {
  try {
    const r = await pool.query(sql, params)
    return r.rows[0]?.[col] ?? ''
  } catch {
    return ''
  }
}

export async function readDailyBrief(): Promise<string> {
  return readCached(
    'SELECT brief_text FROM daily_briefs WHERE brief_date = $1',
    [getKSTDateStr()], 'brief_text')
}

export async function readMarketInsight(): Promise<string> {
  return readCached(
    'SELECT insight_text FROM market_insights WHERE insight_date = $1 AND slot = $2',
    [getKSTDateStr(), getSlot()], 'insight_text')
}

export async function readReviewInsight(): Promise<string> {
  return readCached(
    'SELECT insight_text FROM review_insights WHERE insight_date = $1',
    [getKSTDateStr()], 'insight_text')
}


const GROUNDING_TRIES = 3

/** products.goods_name 앞머리에서 브랜드 토큰을 모은다. */
async function loadBrands(): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    const r = await pool.query<{ goods_name: string }>('SELECT DISTINCT goods_name FROM products')
    for (const row of r.rows) {
      const b = (row.goods_name ?? '').trim().split(/[[\s]/)[0]
      if (b.length >= 2 && !/^\d/.test(b)) out.add(b)
    }
  } catch (e) {
    console.warn('[ai:loadBrands] 브랜드 목록을 못 읽었다 — 브랜드 검사는 건너뛴다', e)
  }
  return out
}

/**
 * 생성하고 접지 검사를 통과한 것만 돌려준다. 못 넘기면 빈 문자열.
 *
 * 프롬프트 지시만으로는 환각을 못 막는다 — 2026-11-13 생산 브리핑에서 급상승
 * 블록은 이미 `82위 → 46위 (+36)` 라는 명시적 형식이었는데도 "아떼 무기자차
 * 82위에서 46위"라고 썼다. 아떼는 그날 블록에 한 줄도 없었다.
 * 그래서 만든 뒤 기계로 대조하고, 틀리면 버리고 다시 만든다.
 *
 * 틀린 브리핑보다 빈 브리핑이 낫다. 3회 모두 실패하면 저장하지 않는다.
 */
async function generateGrounded(prompt: string): Promise<string> {
  const brands = await loadBrands()
  const ground = buildGround(prompt, brands)
  for (let attempt = 1; attempt <= GROUNDING_TRIES; attempt++) {
    const text = await chat(NO_MARKDOWN_SYSTEM, prompt, 2200)
    if (!text) {
      console.warn(`[ai:grounding ${attempt}/${GROUNDING_TRIES}] 빈 응답`)
      continue
    }
    const V = verify(text, ground, brands)
    if (V.length === 0) {
      if (attempt > 1) console.info(`[ai:grounding ${attempt}/${GROUNDING_TRIES}] 통과`)
      return text
    }
    console.warn(`[ai:grounding ${attempt}/${GROUNDING_TRIES}] 위반 ${V.length}건 — `
      + `버리고 다시 만든다: ${formatViolations(V).slice(0, 300)}`)
  }
  console.error(`[ai:grounding] ${GROUNDING_TRIES}회 모두 불합격 — 저장하지 않는다`)
  return ''
}

export async function generateDailyBrief(
  marketData: MarketCategoryData[],
  insights: Insights,
  negativeData: ProductNegativeData[],
  rankTrend: OurRankTrend[] = [],
  discount: DiscountStatus | null = null,
  negAlerts: NegativeAlertData[] = []
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) return ''

  const todayStr = getKSTDateStr()

  try {
    const cached = await pool.query(
      'SELECT brief_text FROM daily_briefs WHERE brief_date = $1',
      [todayStr]
    )
    if (cached.rows[0]?.brief_text) return cached.rows[0].brief_text
  } catch { /* 테이블 없으면 skip */ }

  // 재료가 없으면 모델을 부르지 않는다. 블록이 전부 비어도 모델은
  // "데이터가 없다는 점이 ~를 뜻한다" 식으로 4~5줄을 만들어 낸다(실측).
  // 수집이 실패한 날 그런 글이 화면에 걸리면 없느니만 못하다.
  const material =
    marketData.reduce((n, c) => n + c.entries.length, 0) +
    rankTrend.length + (discount?.entries.length ?? 0) +
    negAlerts.length + negativeData.length
  if (material < 3) {
    console.warn(`[ai:generateDailyBrief] 재료 ${material}줄뿐 — 생성하지 않는다`)
    return ''
  }

  try {
    const prompt = buildDailyBriefPrompt(marketData, insights, negativeData, rankTrend, discount, negAlerts)
    const text = await generateGrounded(prompt)
    if (!text) return ''

    await pool.query(`
      INSERT INTO daily_briefs (brief_date, brief_text)
      VALUES ($1, $2)
      ON CONFLICT (brief_date) DO UPDATE
      SET brief_text = EXCLUDED.brief_text, generated_at = NOW()
    `, [todayStr, text])

    return text
  } catch (e) {
    console.error('Daily brief generation failed:', e)
    return ''
  }
}

// ──────────────────────────────────────────
// 2. 시장 인사이트 (랭킹 기반, 시장 랭킹 탭용)
// ──────────────────────────────────────────

function buildMarketPrompt(data: MarketCategoryData[]): string {
  const leaders = data
    .filter(c => c.category_name !== '전체')
    .map(c => `${c.category_name} 1위: ${c.entries[0]?.goods_name ?? '-'}`)

  const risers = data
    .flatMap(c => c.entries
      .filter(e => e.delta != null && e.delta >= 3)
      .map(e => ({ ...e, cat: c.category_name })))
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    .map(e => `[${e.cat}] ${e.rank_position}위 ${e.goods_name}(+${e.delta})`)

  const newEntries = data
    .flatMap(c => c.entries
      .filter(e => e.prev_rank == null && e.rank_position <= 20)
      .map(e => ({ ...e, cat: c.category_name })))
    .map(e => `[${e.cat}] ${e.rank_position}위 ${e.goods_name}(신규)`)

  const fallers = data
    .flatMap(c => c.entries
      .filter(e => e.delta != null && e.delta <= -5)
      .map(e => ({ ...e, cat: c.category_name })))
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))
    .slice(0, 5)
    .map(e => `[${e.cat}] ${e.rank_position}위 ${e.goods_name}(${e.delta})`)

  const ours = data.flatMap(c =>
    c.entries.filter(e => e.is_ours)
      .map(e => `${c.category_name} ${e.rank_position}위${e.delta != null ? `(${e.delta > 0 ? '+' : ''}${e.delta})` : ''}`))

  return `[올리브영 베스트100 랭킹 현황 - 셀퓨전씨 마케터용]

카테고리 1위 (시장 지배자):
${leaders.join('\n')}

급상승 상품 (전일 대비 3위↑):
${risers.length ? risers.join('\n') : '없음 — 시장 변화가 잠잠한 상태'}

신규 TOP20 진입:
${newEntries.length ? newEntries.join('\n') : '없음'}

급하락 상품:
${fallers.length ? fallers.join('\n') : '없음'}

셀퓨전씨 현재 포지션:
${ours.length ? ours.join(', ') : 'TOP100 없음'}

---
셀퓨전씨 마케터를 위한 전략 인사이트 4~5개를 써라.

[핵심 원칙]
- 변화가 없는 날도 인사이트는 있다: "왜 이 브랜드가 1위를 유지하는지", "셀퓨전씨가 이 카테고리에서 왜 상위/하위에 있는지", "지금이 공략 타이밍인지 아닌지"를 해석하라.
- 순위 숫자를 그대로 읽지 마라. 그 숫자가 의미하는 소비자 선택, 마케팅 효과, 시장 구조를 해석하라.
- 셀퓨전씨 포지션이 좋으면 → 어떻게 더 올릴지. 나쁘면 → 왜 밀리고 있고 어떤 카테고리로 집중해야 하는지.
- 경쟁사 1위 브랜드의 전략(번들, 콜라보, 올영픽 등)에서 셀퓨전씨가 배울 것 or 대응할 것을 짚어라.
- 계절/시점 맥락을 반드시 반영하라 (${getSeasonContext()}).
- 제목줄 작성 금지, 바로 - 로 시작`
}

export async function generateMarketInsight(data: MarketCategoryData[]): Promise<string> {
  if (!process.env.OPENAI_API_KEY || data.length === 0) return ''

  const todayStr = getKSTDateStr()
  const slot = getSlot()

  try {
    const cached = await pool.query(
      'SELECT insight_text FROM market_insights WHERE insight_date = $1 AND slot = $2',
      [todayStr, slot]
    )
    if (cached.rows[0]?.insight_text) return cached.rows[0].insight_text
  } catch { /* 테이블 없으면 skip */ }

  try {
    const text = await chat(NO_MARKDOWN_SYSTEM, buildMarketPrompt(data), 1000)
    if (!text) return ''

    await pool.query(`
      INSERT INTO market_insights (insight_date, slot, insight_text)
      VALUES ($1, $2, $3)
      ON CONFLICT (insight_date, slot) DO UPDATE
      SET insight_text = EXCLUDED.insight_text, generated_at = NOW()
    `, [todayStr, slot, text])

    return text
  } catch (e) {
    console.error('Market insight generation failed:', e)
    return ''
  }
}

// ──────────────────────────────────────────
// 3. 리뷰 인사이트 (자사 상품 개선 분석, 리뷰 분석 탭용)
// ──────────────────────────────────────────

function buildReviewPrompt(insights: Insights, negativeData: ProductNegativeData[]): string {
  const posKw = insights.positive_keywords.slice(0, 15).map(k => `${k.word}(${k.cnt})`).join(', ')
  const negKw = insights.negative_keywords.slice(0, 10).map(k => `${k.word}(${k.cnt})`).join(', ')

  const productIssues = negativeData
    .sort((a, b) => b.neg_count - a.neg_count)
    .slice(0, 8)
    .map(p => {
      const kw = p.keywords.slice(0, 5).map(k => k.word).join(', ')
      const sample = p.samples[0]?.content?.slice(0, 80) ?? ''
      return `- ${p.goods_name}: 불만 ${p.neg_count}건 [키워드: ${kw}] "${sample}"`
    })

  return `[셀퓨전씨 올리브영 실구매 리뷰 분석 데이터]

전체 긍정 키워드 (리뷰 빈도순):
${posKw}

전체 부정 키워드:
${negKw}

상품별 불만 상세:
${productIssues.join('\n')}

셀퓨전씨 제품팀이 다음 분기 액션을 결정하기 위해 이 리뷰 데이터를 본다. 인사이트 5~6개를 써라.
- 반복 불만 패턴에서 실제 제품/포장/마케팅의 구체적 문제를 특정하라.
- 긍정 키워드에서 '아직 마케팅에 활용하지 못한 강점'을 찾아라.
- 숫자를 그대로 인용하지 말고, 그 숫자가 의미하는 소비자 심리와 행동 패턴을 해석하라.
- 각 2문장 이내, 제목줄 작성 금지, 바로 - 로 시작`
}

export async function generateReviewInsight(
  insights: Insights,
  negativeData: ProductNegativeData[]
): Promise<string> {
  if (!process.env.OPENAI_API_KEY || insights.total_reviews === 0) return ''

  const todayStr = getKSTDateStr()

  try {
    const cached = await pool.query(
      'SELECT insight_text FROM review_insights WHERE insight_date = $1',
      [todayStr]
    )
    if (cached.rows[0]?.insight_text) return cached.rows[0].insight_text
  } catch { /* 테이블 없으면 skip */ }

  try {
    const text = await chat(NO_MARKDOWN_SYSTEM, buildReviewPrompt(insights, negativeData), 1500)
    if (!text) return ''

    await pool.query(`
      INSERT INTO review_insights (insight_date, insight_text)
      VALUES ($1, $2)
      ON CONFLICT (insight_date) DO UPDATE
      SET insight_text = EXCLUDED.insight_text, generated_at = NOW()
    `, [todayStr, text])

    return text
  } catch (e) {
    console.error('Review insight generation failed:', e)
    return ''
  }
}

// ──────────────────────────────────────────
// 4. 제품별 주제 분석 (구매동기 / 사용시점 / 같이언급제품)
// ──────────────────────────────────────────

export async function generateProductTopicInsights(
  goodsNo: string,
  goodsName: string,
  reviews: string[]
): Promise<{ purchase_motivation: string[]; usage_timing: string[]; co_mentioned: string[] } | null> {
  if (!process.env.OPENAI_API_KEY || reviews.length === 0) return null

  const sample = reviews.slice(0, 80).join('\n---\n')

  try {
    const res = await getClient().chat.completions.create({
      model: MODEL,
      max_completion_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '당신은 리뷰 분석 AI입니다. JSON만 출력하세요.' },
        { role: 'user', content: `다음은 "${goodsName}" 제품의 실구매 리뷰입니다.\n\n${sample}\n\n위 리뷰에서 다음 3가지를 각 최대 5개 한국어 키워드로 추출하세요:\n- purchase_motivation: 소비자가 이 제품을 구매한 이유/동기\n- usage_timing: 제품을 사용하는 시점/상황\n- co_mentioned: 함께 언급된 다른 제품명/브랜드명\n\n반드시 다음 JSON 형식으로만 출력:\n{"purchase_motivation":["..."],"usage_timing":["..."],"co_mentioned":["..."]}` },
      ],
    })
    const text = res.choices[0].message.content?.trim() ?? ''
    if (!text) return null
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0])
  } catch (e) {
    console.error(`Topic insights failed for ${goodsNo}:`, e)
    return null
  }
}

// ──────────────────────────────────────────
// 5. 올영픽 월별 컨셉 분석
// ──────────────────────────────────────────

export async function generateOlivepickInsight(
  month: string,
  products: { name: string; category?: string | null }[]
): Promise<{ concept_tags: string[]; summary: string; action_points: string[] } | null> {
  if (!process.env.OPENAI_API_KEY || products.length === 0) return null

  const nameList = products
    .slice(0, 100)
    .map(p => p.category ? `${p.name} (${p.category})` : p.name)
    .join('\n')

  try {
    const res = await getClient().chat.completions.create({
      model: MODEL,
      max_completion_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '당신은 올리브영 입점 브랜드의 전략 담당자입니다. JSON만 출력하세요.' },
        { role: 'user', content: `다음은 ${month} 올영픽 큐레이션 상품 목록입니다 (상품명 (카테고리) 형식):\n\n${nameList}\n\n위 상품 목록을 분석하여 다음 세 가지를 제공하세요:\n\n1. concept_tags: 이달 올영픽의 핵심 기획 컨셉 태그 최대 7개 (짧고 명확하게, 예: "포켓몬 콜라보", "1+1 기획", "선케어 강화", "굿즈 증정", "건강식품 확대")\n\n2. summary: 이달 올영픽의 기획 방향을 2~3문장으로 요약. 어떤 카테고리/테마가 중심이고, 어떤 프로모션 방식(1+1·콜라보·굿즈 등)이 사용됐는지 서술.\n\n3. action_points: 우리 브랜드(셀퓨전씨)가 이 기획에서 얻어야 할 대응 인사이트 3~5개. 각 항목은 "무엇을 해야 한다"는 실행 가능한 형태로 작성.\n\n반드시 다음 JSON 형식으로만 출력:\n{"concept_tags":["..."],"summary":"...","action_points":["...","..."]}` },
      ],
    })
    const text = res.choices[0].message.content?.trim() ?? ''
    if (!text) return null
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    return {
      concept_tags: parsed.concept_tags ?? [],
      summary: parsed.summary ?? '',
      action_points: parsed.action_points ?? [],
    }
  } catch (e) {
    console.error(`Olivepick insight failed for ${month}:`, e)
    return null
  }
}
