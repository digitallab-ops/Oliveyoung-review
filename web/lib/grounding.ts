/**
 * 브리핑 접지(grounding) 검사 — 모델이 재료에 없는 숫자·브랜드를 말했는지 본다.
 *
 * ⚠️ 이 파일은 `collector/brief_grounding.py` 의 TypeScript 판이다.
 *    생성기가 둘(웹 자정 / 수집기 09시)이라 검사기도 둘이다.
 *    **한쪽만 고치면 다른 쪽이 조용히 뒤처진다.** 규칙을 바꾸면 양쪽 다 바꿔라.
 *
 * 왜 있는가
 * ---------
 * 2026-11-13 생산 브리핑(웹 생성분)이 재료에 없는 숫자를 확신에 찬 문장으로 썼다.
 * 검증 가능한 수치 14건 중 8건이 틀렸고 일부는 방향까지 반대였다.
 *
 *   "선케어 매끈밀착썬은 7일간 27위에서 31위로 밀렸고"
 *      → 재료는 `34 → 27 → 24 → 34 → 18 → 17 → 18위 (7일 +16계단)`. 올랐다. 31은 없다.
 *   "아떼 무기자차 82위에서 46위"
 *      → 그날 급상승 블록은 빌리프·VT·라로슈포제…였다. 아떼는 한 줄도 없었다.
 *
 * 프롬프트 지시로는 못 막는다. 급상승 블록은 이미 `82위 → 46위 (+36)` 라는
 * 명시적 형식이었는데도 날조됐다. 그래서 **생성한 뒤 기계로 대조**한다.
 *
 * 예상과 근거를 가르는 기준은 표현의 정밀도다:
 *   환각은 정확하다   — "7위에서 28위로"
 *   예상은 뭉뚱그린다 — "20위권", "30위 밖", "20위 후반"
 *
 * 실측(2026-11-13): 정상 브리핑 20회에 오탐 0건, 생산 11/13 브리핑에서 위반 17건 탐지.
 *
 * 아직 못 잡는 것 (KNOWN GAP)
 * ---------------------------
 * **건수의 귀속**을 못 가린다. 재료의 `불만 205건` 은 '쿨링 마스크 1P' 수치인데
 * 모델이 '쿨링 패드' 문장에 갖다 쓰면(패드는 129건) 통과한다 — 숫자 자체는
 * 재료에 있기 때문이다. 독립 모델 교차검증에서 발견했고 웹 10회 중 3회에 나왔다.
 * 상품명 토큰 겹침으로 임자를 가리는 규칙을 넣어 봤다가 되돌렸다:
 * bullet 의 "마스크팩"(카테고리명)이 '쿨링 마스크' 와 겹쳐 목표는 못 잡고,
 * 정상 문장("3건 → 7건")만 무더기로 걸려 통과율이 100% → 40% 로 떨어졌다.
 * 고치려면 재료 쪽에서 이름을 구분 가능하게 만들어야 한다.
 * 순위 쌍의 귀속은 ATTRIB 규칙으로 막고 있다 — 오탐 0건으로 검증됐다.
 */

export type Violation = { bullet: number; kind: string; msg: string }

const PRED_MARK = [
  '가능성', '예상', '전망', '유력', '확률',
  '이대로', '그대로면', '앞으로', '볼 수 있',
  '지금 속도면', '이 속도면', '지금 구조면', '이 구조면',
  '흐름이면', '지금 추세면',
  '다음 주', '다음주', '다음 1주', '이번 주', '이번 달', '안에',
]

/** 뭉뚱그린 순위 표현 = 예상. "20위권", "30위 밖", "20위 후반" … */
const VAGUE = /\d+위\s*(?:권|대|밖|안\s*쪽|안쪽|이내|초반|중반|후반|내외|쯤|가량|선|언저리)/g

/** 추세 줄의 수열. 한 줄에 여러 개 있을 수 있다(상품 하나가 여러 카테고리). */
const SEQ = /((?:\d+\s*→\s*)+\d+)위/g

export type Ground = {
  ranks: Set<number>
  counts: Set<number>
  pcts: Set<number>
  floats: Set<string>
  pctDerived: Set<number>
  pairs: Set<string>
  brands: Set<string>
  pairOwners: Map<string, Set<string>[]>
}

/**
 * 상품명에서 '이 상품을 가리키는 말'만 남긴다.
 * 브랜드·포장·용량 같은 공통어는 어느 줄에나 있어 귀속 판별에 못 쓴다.
 */
const NAME_STOP = new Set([
  '셀퓨전씨', '기획', '더블', '트리플', '세트', '증정', '콜라보', '단품', '리필',
  '본품', '한정', '대용량', '추천', '올영픽', '에디션', '기획세트', '더블기획',
  '매', '종', '개', '리뉴얼', '신상', '특가', '할인', '사은품', '구성',
])

function nameTokens(name: string): Set<string> {
  const out = new Set<string>()
  for (const t of name.split(/[^0-9A-Za-z가-힣+]+/)) {
    if (t.length >= 2 && !/^\d+$/.test(t) && !NAME_STOP.has(t)
        && !/^\d+(ml|g|매|p|P|ea|EA)$/.test(t)) out.add(t)
  }
  return out
}

/**
 * 프롬프트에서 **재료 블록만** 남긴다.
 * 지시문에는 예시 문장이 있고 거기에도 숫자·브랜드가 있다("라로슈포제 톤업(+68) …").
 * 프롬프트 전체로 접지셋을 만들면 모델이 예시를 베껴도 통과한다.
 */
export function materialOnly(prompt: string): string {
  return prompt.split('────')[0]
}

export function buildGround(prompt: string, allBrands: Set<string>): Ground {
  const material = materialOnly(prompt)
  const all = (re: RegExp) => [...material.matchAll(re)].map(m => m[1])

  const ranks = new Set<number>(all(/(\d+)위/g).map(Number))
  const counts = new Set<number>(all(/(\d+)건/g).map(Number))
  const pcts = new Set<number>(all(/(\d+)%/g).map(Number))
  for (const f of all(/(\d+\.\d+)%/g)) pcts.add(Math.trunc(parseFloat(f)))
  const floats = new Set<string>((material.match(/\d+\.\d+/g) ?? []))

  // 퍼센트 차이는 정당한 산수다. "자사 30.0% / 경쟁사 26.6%" → "3.4%p 높다"가 맞다.
  const pv = all(/(\d+(?:\.\d+)?)%/g).map(parseFloat)
  const pctDerived = new Set<number>()
  for (const a of pv) for (const b of pv) pctDerived.add(Math.round(Math.abs(a - b) * 10) / 10)

  // 수열 원소는 전부 정당한 순위값이다. 마지막 숫자에만 '위'가 붙기 때문에
  // `\d+위` 만 모으면 "27위에서 25위로" 같은 정확한 문장을 환각으로 찍는다.
  const pairs = new Set<string>()
  for (const line of material.split('\n')) {
    for (const m of line.matchAll(SEQ)) {
      const seq = (m[1].match(/\d+/g) ?? []).map(Number)
      seq.forEach(v => ranks.add(v))
      if (seq.length) pairs.add(`${seq[0]}>${seq[seq.length - 1]}`)
      for (let i = 0; i < seq.length - 1; i++) pairs.add(`${seq[i]}>${seq[i + 1]}`)
    }
  }
  for (const m of material.matchAll(/(\d+)위\s*→\s*(\d+)위/g)) pairs.add(`${m[1]}>${m[2]}`)

  // 숫자쌍을 '어느 상품 줄에서 나왔는지'와 묶는다. 이게 없으면 귀속 바꿔치기가
  // 통과한다 — 쿨링 패드의 진짜 숫자(62→41)를 잡티 토닝에 붙여도 안 걸린다.
  const pairOwners = new Map<string, Set<string>[]>()
  const addOwner = (key: string, toks: Set<string>) => {
    if (!toks.size) return
    const cur = pairOwners.get(key) ?? []
    cur.push(toks)
    pairOwners.set(key, cur)
  }
  for (const line of material.split('\n')) {
    const toks = nameTokens(line.includes(':') ? line.split(':')[0] : line)
    for (const m of line.matchAll(SEQ)) {
      const seq = (m[1].match(/\d+/g) ?? []).map(Number)
      if (seq.length) addOwner(`${seq[0]}>${seq[seq.length - 1]}`, toks)
      for (let i = 0; i < seq.length - 1; i++) addOwner(`${seq[i]}>${seq[i + 1]}`, toks)
    }
    const r = line.match(/(\d+)위\s*→\s*(\d+)위/)
    if (r) addOwner(`${r[1]}>${r[2]}`, nameTokens(line.slice(0, r.index!)))
  }

  const brands = new Set<string>()
  for (const b of allBrands) if (material.includes(b)) brands.add(b)

  return { ranks, counts, pcts, floats, pctDerived, pairs, brands, pairOwners }
}

function sentences(bullet: string): string[] {
  return bullet.split(/(?<=다)\.\s*/).filter(s => s.trim())
}

function predCut(sent: string): number {
  let cut = sent.length
  for (const m of PRED_MARK) {
    const i = sent.indexOf(m)
    if (i >= 0 && i < cut) cut = i
  }
  return cut
}

export function verify(brief: string, g: Ground, allBrands: Set<string>): Violation[] {
  const V: Violation[] = []
  const bullets = brief.split('\n').filter(l => l.trim().startsWith('- '))

  bullets.forEach((b, idx) => {
    const bullet = idx + 1
    // 고유명사는 예상 절이어도 면제하지 않는다. 브랜드를 지어내면 안 된다.
    for (const br of allBrands) {
      if (br.length >= 2 && b.includes(br) && !g.brands.has(br)) {
        V.push({ bullet, kind: 'BRAND', msg: `'${br}' 는 재료에 없는 브랜드` })
      }
    }
    for (const sent of sentences(b)) {
      const cut = predCut(sent)
      const vague: [number, number][] = [...sent.matchAll(VAGUE)]
        .map(m => [m.index!, m.index! + m[0].length] as [number, number])
      const checkable = (i: number) =>
        i < cut && !vague.some(([a, z]) => a <= i && i < z)

      for (const re of [/(\d+)위에서\s*(\d+)위/g, /(\d+)위\s*→\s*(\d+)위/g]) {
        for (const m of sent.matchAll(re)) {
          if (!checkable(m.index!)) continue
          const key = `${m[1]}>${m[2]}`
          if (!g.pairs.has(key)) {
            V.push({ bullet, kind: 'PAIR', msg: `${m[1]}위→${m[2]}위 쌍이 재료에 없음` })
            continue
          }
          // 쌍은 있다. 그런데 **그 상품의 쌍**인가?
          const owners = g.pairOwners.get(key)
          if (owners && !owners.some(toks => [...toks].some(t => b.includes(t)))) {
            V.push({ bullet, kind: 'ATTRIB',
                     msg: `${m[1]}위→${m[2]}위 는 이 bullet 이 말하는 상품의 수치가 아님` })
          }
        }
      }
      for (const m of sent.matchAll(/(\d+)위/g)) {
        if (checkable(m.index!) && !g.ranks.has(Number(m[1]))) {
          V.push({ bullet, kind: 'RANK', msg: `${m[1]}위 가 재료에 없음` })
        }
      }
      for (const m of sent.matchAll(/(\d+)건/g)) {
        if (checkable(m.index!) && !g.counts.has(Number(m[1]))) {
          V.push({ bullet, kind: 'COUNT', msg: `${m[1]}건 이 재료에 없음` })
        }
      }
      for (const m of sent.matchAll(/(\d+(?:\.\d+)?)%/g)) {
        const v = parseFloat(m[1])
        if (checkable(m.index!) && !g.floats.has(m[1]) && !g.pcts.has(Math.trunc(v))
            && !g.pctDerived.has(Math.round(v * 10) / 10)) {
          V.push({ bullet, kind: 'PCT', msg: `${m[1]}% 가 재료에 없음` })
        }
      }
    }
  })
  return V
}

export function formatViolations(V: Violation[]): string {
  return V.map(v => `bullet${v.bullet}[${v.kind}] ${v.msg}`).join('; ')
}
