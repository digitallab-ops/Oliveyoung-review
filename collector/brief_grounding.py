# -*- coding: utf-8 -*-
"""브리핑 접지(grounding) 검사 — 모델이 재료에 없는 숫자·브랜드를 말했는지 본다.

왜 있는가
---------
2026-11-13 생산 브리핑(웹 생성분)이 재료에 없는 숫자를 확신에 찬 문장으로 썼다.
검증 가능한 수치 14건 중 8건이 틀렸고, 일부는 방향까지 반대였다.

  "선케어 매끈밀착썬은 7일간 27위에서 31위로 밀렸고"
     → 재료는 `34 → 27 → 24 → 34 → 18 → 17 → 18위 (7일 +16계단)`. 올랐다. 31은 없다.
  "아떼 무기자차 82위에서 46위"
     → 아떼는 그날 급상승 블록에 한 줄도 없었다. 브랜드째 지어냈다.

프롬프트 지시로는 못 막는다. 실제로 급상승 블록은 이미 `82위 → 46위 (+36)`라는
명시적 형식이었는데도 날조됐다. 그래서 **생성한 뒤 기계로 대조**한다.

설계 원칙
---------
- '근거'로 말한 숫자·고유명사는 재료에 있어야 한다.
- '예상'으로 말한 숫자는 재료에 없는 게 정상이다 — 면제한다.

예상과 근거를 가르는 기준은 **표현의 정밀도**다. 한국어는 예상 표지가 문장 끝에
오기 때문에("~할 가능성이 크다") 위치만으로는 못 가른다. 대신:

    환각은 정확하다   — "7위에서 28위로", "82위에서 46위로"
    예상은 뭉뚱그린다 — "20위권", "30위 밖", "20위 후반", "50위권 아래"

그래서 모호 접미사(권/대/밖/초반/중반/후반…)가 붙은 숫자는 예상으로 보고 면제한다.

교정 이력 (오탐을 만든 버그들 — 되돌리지 말 것)
-----------------------------------------------
1) 추세 줄 `27 → 24 → … → 25위` 는 **마지막 숫자에만 '위'가 붙는다.**
   `\\d+위` 만 모으면 앞 원소가 접지셋에서 빠져, 정확한 문장 "27위에서 25위로"를
   환각으로 찍는다. 실측에서 오탐 33건이 이 버그였다.
2) 예상 절을 문장 분할 휴리스틱으로 잡으면 "다음 주 30위 밖" 류를 전부 놓친다.

보정 후 실측: 정상 브리핑 20회에 오탐 0건, 생산 11/13 브리핑에서 위반 17건 탐지.

_KNOWN_GAP — 아직 못 잡는 것
----------------------------
**건수의 귀속**을 못 가린다. 재료의 `불만 205건` 은 '쿨링 마스크 1P' 의 수치인데
모델이 '쿨링 패드' 문장에 갖다 쓰면(패드는 129건) 그냥 통과한다.
숫자 자체는 재료에 있기 때문이다. 2026-11-13 독립 모델 교차검증에서 발견했고,
웹 10회 중 3회에서 실제로 나왔다.

고치려고 상품명 토큰 겹침으로 임자를 가리는 규칙을 넣어 봤다가 **되돌렸다**:
  - bullet 의 "마스크**팩**"(카테고리명)이 '쿨링 마스크' 의 '마스크' 와 겹쳐
    임자 판정이 무너진다 → 목표인 205건은 못 잡는다.
  - 반대로 정상 문장("3건 -> 7건", 스킨 블레미쉬 밤)은 무더기로 걸린다.
    실측 통과율 100% -> 40%. 멀쩡한 브리핑을 버리게 된다.
토큰 겹침으로는 안 된다. 고치려면 재료 쪽에서 이름을 구분 가능하게 만들어야 한다
(예: 누적 불만 줄에 카테고리/식별자를 붙이거나, 추세 블록에 없는 상품은 빼기).
순위 쌍(PAIR)의 귀속은 ATTRIB 규칙으로 막고 있다 — 그쪽은 오탐 0건으로 검증됐다.
"""
import re

__all__ = ["load_brands", "build_ground", "verify", "format_violations"]

# 예상 표지. 이 뒤에 나온 숫자는 검사하지 않는다.
PRED_MARK = (
    "가능성", "예상", "전망", "유력", "확률",
    "이대로", "그대로면", "앞으로", "볼 수 있",
    "지금 속도면", "이 속도면", "지금 구조면", "이 구조면",
    "흐름이면", "지금 추세면",
    "다음 주", "다음주", "다음 1주", "이번 주", "이번 달", "안에",
)

# 뭉뚱그린 순위 표현 = 예상. "20위권", "30위 밖", "20위 후반" …
VAGUE = re.compile(
    r"\d+위\s*(?:권|대|밖|안\s*쪽|안쪽|이내|초반|중반|후반|내외|쯤|가량|선|언저리)"
)

# 재료의 추세 줄에서 수열을 뽑는다. 한 줄에 여러 개 있을 수 있다
# (상품 하나가 여러 카테고리에 걸친 경우 한 줄로 합쳐 쓴다).
SEQ = re.compile(r"((?:\d+\s*→\s*)+\d+)위")


def load_brands(cur, schema: str = "oliveyoung") -> set:
    """products.goods_name 앞머리에서 브랜드 토큰을 모은다."""
    cur.execute(f"SELECT DISTINCT goods_name FROM {schema}.products")
    out = set()
    for (nm,) in cur.fetchall():
        if not nm:
            continue
        b = re.split(r"[\[\s]", nm.strip())[0]
        if len(b) >= 2 and not b[0].isdigit():
            out.add(b)
    return out


# 상품명에서 '이 상품을 가리키는 말'만 남긴다. 브랜드·포장·용량 같은 공통어는
# 어느 줄에나 있어서 귀속 판별에 못 쓴다.
_NAME_STOP = {
    "셀퓨전씨", "기획", "더블", "트리플", "세트", "증정", "콜라보", "단품", "리필",
    "본품", "한정", "대용량", "추천", "올영픽", "에디션", "기획세트", "더블기획",
    "매", "종", "개", "리뉴얼", "신상", "특가", "할인", "사은품", "구성",
}


def _name_tokens(name: str) -> set:
    toks = set()
    for t in re.split(r"[^0-9A-Za-z가-힣+]+", name):
        if len(t) >= 2 and not t.isdigit() and t not in _NAME_STOP \
                and not re.fullmatch(r"\d+(ml|g|매|p|P|ea|EA)", t):
            toks.add(t)
    return toks


def _sentences(bullet: str):
    return [s for s in re.split(r"(?<=다)\.\s*|(?<=다)\.$", bullet) if s.strip()]


def _pred_cut(sent: str) -> int:
    idx = [sent.find(m) for m in PRED_MARK if m in sent]
    return min(idx) if idx else len(sent)


def material_only(prompt: str) -> str:
    """프롬프트에서 **재료 블록만** 남긴다.

    지시문에는 예시 문장이 들어 있고 거기에도 숫자가 있다
    ("자사 평균 할인율이 30%로 경쟁사 26%보다 4%p 높은데도 클렌징 3종(57%, 52%, 47%)…").
    프롬프트 전체로 접지셋을 만들면 **모델이 예시를 베껴도 통과한다.**
    구분선(────) 앞까지가 재료다.
    """
    return prompt.split("────")[0]


def build_ground(prompt: str, all_brands) -> dict:
    """프롬프트 재료에서 '말해도 되는 값'의 집합을 만든다."""
    material = material_only(prompt)
    g = {"text": material}
    g["ranks"] = {int(x) for x in re.findall(r"(\d+)위", material)}
    g["counts"] = {int(x) for x in re.findall(r"(\d+)건", material)}
    g["pcts"] = {int(x) for x in re.findall(r"(\d+)%", material)}
    g["pcts"] |= {int(float(x)) for x in re.findall(r"(\d+\.\d+)%", material)}
    g["floats"] = set(re.findall(r"\d+\.\d+", material))

    # 퍼센트 차이는 정당한 산수다. "자사 30.0% / 경쟁사 26.6%" 를 주면
    # "3.4%p 높다"고 쓰는 게 맞다 — 재료에 3.4 가 없다고 환각이 아니다.
    _pv = {float(x) for x in re.findall(r"(\d+(?:\.\d+)?)%", material)}
    g["pct_derived"] = {round(abs(a - b), 1) for a in _pv for b in _pv}

    g["seqs"] = []
    for line in material.splitlines():
        for m in SEQ.finditer(line):
            g["seqs"].append([int(x) for x in re.findall(r"\d+", m.group(1))])
    for s in g["seqs"]:
        g["ranks"].update(s)              # 버그1 수정: 수열 원소 전부가 정당한 순위값

    g["pairs"] = set()
    for a, b in re.findall(r"(\d+)위\s*→\s*(\d+)위", material):
        g["pairs"].add((int(a), int(b)))
    for s in g["seqs"]:
        g["pairs"].add((s[0], s[-1]))     # 시작 → 끝
        for i in range(len(s) - 1):
            g["pairs"].add((s[i], s[i + 1]))   # 인접 구간

    # 숫자쌍을 '어느 상품 줄에서 나왔는지'와 묶는다.
    # 이게 없으면 **귀속 바꿔치기**가 통과한다 — 쿨링 패드의 진짜 숫자(62→41)를
    # 잡티 토닝에 갖다 붙여도 "재료에 있는 쌍"이라 걸리지 않는다(적대시험 케이스 H).
    g["pair_owners"] = {}
    for line in material.splitlines():
        head = line.split(":")[0] if ":" in line else line
        toks = _name_tokens(head)
        if not toks:
            continue
        for m in SEQ.finditer(line):
            seq = [int(x) for x in re.findall(r"\d+", m.group(1))]
            ps = [(seq[0], seq[-1])] + [(seq[i], seq[i + 1]) for i in range(len(seq) - 1)]
            for p in ps:
                g["pair_owners"].setdefault(p, []).append(toks)
    for line in material.splitlines():
        m = re.search(r"(\d+)위\s*→\s*(\d+)위", line)
        if m:
            toks = _name_tokens(line[:m.start()])
            if toks:
                g["pair_owners"].setdefault((int(m.group(1)), int(m.group(2))), []).append(toks)

    # 건수의 귀속은 묶지 않는다 — 시도했다가 되돌렸다. _KNOWN_GAP 참조.

    g["brands"] = {b for b in all_brands if b in material}
    return g


def verify(brief: str, g: dict, all_brands) -> list:
    """위반 목록 [(bullet번호, 유형, 설명)] 을 돌려준다. 빈 리스트면 통과."""
    V = []
    bullets = [l for l in brief.splitlines() if l.strip().startswith("- ")]
    for bi, b in enumerate(bullets, 1):
        # 고유명사는 예상 절이어도 면제하지 않는다. 브랜드를 지어내면 안 된다.
        for br in all_brands:
            if len(br) >= 2 and br in b and br not in g["brands"]:
                V.append((bi, "BRAND", f"'{br}' 는 재료에 없는 브랜드"))

        for sent in _sentences(b):
            cut = _pred_cut(sent)
            vague = [(m.start(), m.end()) for m in VAGUE.finditer(sent)]

            def checkable(m) -> bool:
                if m.start() >= cut:                 # 예상 표지 뒤
                    return False
                return not any(a <= m.start() < z for a, z in vague)

            for pat in (r"(\d+)위에서\s*(\d+)위", r"(\d+)위\s*→\s*(\d+)위"):
                for m in re.finditer(pat, sent):
                    if not checkable(m):
                        continue
                    pair = (int(m.group(1)), int(m.group(2)))
                    if pair not in g["pairs"]:
                        V.append((bi, "PAIR",
                                  f"{m.group(1)}위→{m.group(2)}위 쌍이 재료에 없음"))
                        continue
                    # 쌍은 있다. 그런데 **그 상품의 쌍**인가?
                    owners = g["pair_owners"].get(pair)
                    if owners and not any(t in b for toks in owners for t in toks):
                        V.append((bi, "ATTRIB",
                                  f"{pair[0]}위→{pair[1]}위 는 이 bullet 이 말하는 상품의 수치가 아님"))
            for m in re.finditer(r"(\d+)위", sent):
                if checkable(m) and int(m.group(1)) not in g["ranks"]:
                    V.append((bi, "RANK", f"{m.group(1)}위 가 재료에 없음"))
            # 건수는 '재료에 있는가'만 본다. **누구의 건수인가는 못 가린다** —
            # 알려진 한계다. 아래 _KNOWN_GAP 주석을 읽어라.
            for m in re.finditer(r"(\d+)건", sent):
                if checkable(m) and int(m.group(1)) not in g["counts"]:
                    V.append((bi, "COUNT", f"{m.group(1)}건 이 재료에 없음"))
            for m in re.finditer(r"(\d+(?:\.\d+)?)%", sent):
                if checkable(m) and m.group(1) not in g["floats"] \
                        and int(float(m.group(1))) not in g["pcts"] \
                        and round(float(m.group(1)), 1) not in g["pct_derived"]:
                    V.append((bi, "PCT", f"{m.group(1)}% 가 재료에 없음"))
    return V


def format_violations(V) -> str:
    return "; ".join(f"bullet{b}[{k}] {m}" for b, k, m in V)
