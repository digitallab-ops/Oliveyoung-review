"""인증마크 분석 — 어떤 제품군이 어떤 마크를 박는가.

마크 이름은 브랜드마다 다르게 적는다("V-LABEL 비건", "비건 인증 완료",
"한국비건인증원"). 그대로 세면 같은 마크가 흩어진다. 그래서 묶음 규칙을
두되, 어디에도 안 걸린 이름은 숨기지 않고 드러낸다 — 목록은 반드시 썩고,
썩는 걸 알아차리는 장치가 같이 있어야 한다. taxonomy.discover() 와 같은 태도다.

    python -m collector.detail_page_certs              # 전체
    python -m collector.detail_page_certs --type 선쿠션  # 유형별
    python -m collector.detail_page_certs --new        # 미분류 이름만
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict

from db.schema import get_conn
from collector.detail_page_bytype import classify

# 묶음 → 그 묶음으로 볼 키워드. 위에서부터 먼저 걸리는 쪽을 택한다.
GROUPS: dict[str, tuple[str, ...]] = {
    "비건·크루얼티프리": ("비건", "vegan", "v-label", "vlabel", "크루얼티",
                          "cruelty", "leaping bunny", "동물실험", "againstanimal"),
    "피부 안전시험": ("피부자극", "저자극", "자극테스트", "논코메도", "non-comedo",
                      "코메도제닉", "더마테스트", "dermatest", "알러지", "allergy",
                      "안과", "안자극", "민감성피부", "패치테스트", "피부과테스트",
                      "irritation", "하이포알러", "hypoaller",
                      "사용적합", "피부안전성", "안심formula", "안심포뮬라",
                      "여드름성", "민감피부사용", "민감피부", "더마톨로지",
                      "dermatolog", "excellent", "엑설런트", "멸균",
                      "피부과전문의", "sensitive skin", "hypoallergenic",
                      "무자극", "자극없"),
    "기능성·규제": ("기능성", "식약처", "식품의약품", "kfda", "mfds", "fda",
                    "의약외품", "심사필", "의료기기", "안전정보원"),
    # "reef" 를 그냥 두면 norm() 이 하이픈을 지운 '12FREEFORMULA' 안의
    # f|ree f|ormula 에 걸려 성분 배제 표기를 통째로 가져간다. 계열어로 좁힌다.
    # "eco" 도 NAOS ECOBIOLOGY 같은 브랜드 기술명을 잡아 인증어만 남긴다.
    "환경·패키지": ("fsc", "친환경", "재활용", "리프세이프", "리프프렌들리",
                    "reefsafe", "reeffriendly", "탄소", "친산림", "플라스틱",
                    "ecocert", "에코서트", "ecofriendly", "지속가능",
                    "soyink", "콩기름", "논나노", "nonnano", "cites"),
    "시험기관": ("sgs", "intertek", "인터텍", "kcl", "ktr", "katri", "시험기관",
                 "시험연구원", "과학연구원", "연구원", "인체적용", "임상시험",
                 "검증기관", "시험완료", "tests completed", "test completed",
                 "시험성적", "테스트완료", "tested", "임상연구", "iso2444",
                 "fiti", "flir", "연구센터", "피부임상", "clinicaltest",
                 "clinical test", "testcomplete", "test complete", "인증완료",
                 "지수테스트", "mctt", "피부과학연구소", "dermapro", "더마프로"),
    "성분 안전등급": ("ewg", "그린등급", "클린뷰티", "clean", "무첨가", "free",
                      "오코텍스", "oeko", "1등급"),
    "제조·품질": ("gmp", "iso22716", "제조시설", "청정실", "cgmp"),
    # "배리어/barrier" 는 '피부 장벽' 마케팅 문구를 끌어온다.
    # 유일한 멤버가 TRIPLE BARRIER SCIENCE 였다 — 묶음 전체가 오탐이었다.
    "접근성": ("점자", "braille"),
    "수상·어워드": ("어워드", "어워즈", "award", "대상", "수상", "그랑프리",
                    "1등", "1위", "bestperformer", "best performer",
                    # 맨 "올리브영"/"oliveyoung" 은 'ONLY 올리브영 단독기획' 같은
                    # 기획 딱지까지 끌어온다. 어워드 표기는 어워즈/award 로 충분하다.
                    "glowpick", "allure", "영예의전당", "올리브영어워즈",
                    "베스트퍼포머", "베스트셀러", "bestseller",
                    "singles", "n°1", "no.1"),
    "특허": ("특허", "patent", "brevet", "출원", "등록번호"),
    "정품 인증": ("정품", "가품", "공식판매처", "authentic",
                 "authorized seller", "official seller", "official store",
                 "officialstore", "공식스토어", "공식몰", "네이버", "naver",
                 "쿠팡", "coupang", "다이소", "watsons", "왓슨스", "면세점",
                 "백화점", "직영몰", "본사직영"),
}

# 인증마크가 아닌데 모델이 집어오는 것들. 차단지수·신제품 딱지·추천인 같은 것.
# 거르지 않으면 "가장 많이 쓰는 마크" 상위가 SPF50+ 로 채워진다.
NOISE = (
    re.compile(r"^(spf|spa|pa)\s*[0-9+±./\s]*$", re.I),
    re.compile(r"^(spf|spa)\s*[0-9+.]+\s*/?\s*pa\s*\+*$", re.I),
    re.compile(r"^uv[ab]?\s", re.I),
    re.compile(r"(신제품|\bnew\b|리뉴얼)", re.I),
    re.compile(r"(pick|추천|license|라이선스)", re.I),
    re.compile(r"(단독기획|단독|기획구성|한정판매|증정)", re.I),
    re.compile(r"^since\s*\d{4}$", re.I),
    re.compile(r"(지속$|지속력|밀착\s*100)", re.I),
    re.compile(r"^\d+\s*시간"),
)


def is_noise(name: str) -> bool:
    t = (name or "").strip()
    if not t or len(t) > 60:
        return True
    return any(p.search(t) for p in NOISE)


def keep(name: str) -> bool:
    r"""이 이름을 인증마크로 셀 것인가.

    노이즈 판정을 그룹 판정보다 먼저 돌리면 진짜 마크가 조용히 사라진다.
    실제로 네 패턴이 324개 중 59개(18%)에서 진짜 마크를 지우고 있었다.
      pick     -> GLOWPICK AWARDS 전부
      추천      -> '모든 피부 추천 저자극테스트 완료' (피부 안전시험 인증)
      ^\d+시간  -> '24시간 패치테스트 완료'
      신제품     -> 'hwahae awards 베스트 신제품 1위' (어워드 부문명이다)
    심지어 GROUPS 의 "glowpick" 키워드는 노이즈가 먼저 걸러 도달조차 못 했다.

    그래서 순서를 뒤집는다 — 어느 묶음에든 걸리면 그건 마크다.
    노이즈는 '아무 묶음에도 안 걸린 것'에만 적용하는 마지막 체다.
    """
    t = (name or "").strip()
    if not t:
        return False
    if group_of(t):
        return True
    return not is_noise(t)


_NORM = re.compile(r"[\s_\-·,./()\[\]®™℠:+＋]+")


def norm(s: str) -> str:
    return _NORM.sub("", (s or "").strip().lower())


def group_of(name: str) -> str | None:
    """공백·구분자를 지우고 맞춰 본다.

    '피부 자극 테스트'와 '피부자극테스트'는 같은 말인데 그대로 비교하면
    후자만 걸린다. 실제로 그 구멍 때문에 24종이 미분류로 샜다.
    """
    low = norm(name)
    for g, kws in GROUPS.items():
        for k in kws:
            if norm(k) in low:
                return g
    return None


def _load(conn, product_type: str | None = None) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT ds.goods_no, ds.role, ds.certs, ds.scroll_pct,
                   COALESCE(p.goods_name,
                            (SELECT MAX(m.goods_name) FROM market_rankings m
                             WHERE m.goods_no = ds.goods_no)) AS goods_name,
                   COALESCE(p.is_competitor, true) AS is_competitor
            FROM detail_sections ds
-- products 에는 선케어 파이프라인이 넣은 상품만 있다. 더모·마스크팩으로
            -- 확대하면서 93개가 products 에 없어 통째로 빠졌다. 이름과 자사 여부는
            -- market_rankings 로 메운다 (랭킹에만 잡힌 상품은 모두 경쟁사다).
            LEFT JOIN products p ON p.goods_no = ds.goods_no
            WHERE ds.certs IS NOT NULL
        """)
        rows = [dict(r) for r in cur.fetchall()]
    out = []
    for r in rows:
        c = r["certs"]
        if isinstance(c, str):
            try:
                c = json.loads(c)
            except Exception:
                c = []
        r["certs"] = [str(x).strip() for x in (c or []) if keep(str(x))]
        r["ptype"] = classify(r["goods_name"])
        if product_type and r["ptype"] != product_type:
            continue
        out.append(r)
    return out


def _brand(name: str) -> str:
    t = (re.sub(r"\[[^\]]*\]", "", name or "").strip().split() or [""])[0]
    h = len(t) // 2
    if len(t) >= 4 and len(t) % 2 == 0 and t[:h] == t[h:]:
        return t[:h]
    return t


def report(rows: list[dict], show_new: bool = False) -> None:
    prods = {r["goods_no"] for r in rows}
    n = len(prods) or 1
    # 마크를 가진 상품 집합을 묶음별로 모은다 — 상품 단위로 세야 '얼마나 퍼졌나'가 나온다
    by_group: dict[str, set] = defaultdict(set)
    by_name: dict[str, set] = defaultdict(set)
    unknown: dict[str, set] = defaultdict(set)
    forms: dict[str, Counter] = defaultdict(Counter)

    for r in rows:
        for c in r["certs"]:
            g = group_of(c)
            k = norm(c)
            forms[k][c] += 1
            by_name[k].add(r["goods_no"])
            if g:
                by_group[g].add(r["goods_no"])
            else:
                unknown[k].add(r["goods_no"])

    with_any = {r["goods_no"] for r in rows if r["certs"]}
    print(f"상품 {n}개 · 마크를 하나라도 쓰는 상품 {len(with_any)}개 "
          f"({len(with_any)*100//n}%)\n")

    if show_new:
        print("=== 묶음에 안 걸린 이름 — GROUPS 에 추가할지 판단하라 ===")
        if not unknown:
            print("  없음")
        for k, g in sorted(unknown.items(), key=lambda x: -len(x[1]))[:40]:
            disp = forms[k].most_common(1)[0][0]
            print(f"  {len(g):>3}개 상품  {disp[:56]}")
        return

    print("=== 묶음별 — 몇 %의 상품이 쓰는가 ===")
    for g, s in sorted(by_group.items(), key=lambda x: -len(x[1])):
        pct = len(s) * 100 // n
        print(f"  {g:<16} {'█' * max(1, pct // 3):<34} {pct:>3}%  ({len(s)}개)")

    print("\n=== 개별 마크 상위 ===")
    for k, s in sorted(by_name.items(), key=lambda x: -len(x[1]))[:16]:
        disp = forms[k].most_common(1)[0][0]
        g = group_of(disp) or "미분류"
        print(f"  {len(s):>3}개  {disp[:40]:<42} [{g}]")

    print("\n=== 제품 유형별로 어떤 묶음을 쓰나 ===")
    types: dict[str, set] = defaultdict(set)
    tg: dict[str, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    for r in rows:
        types[r["ptype"]].add(r["goods_no"])
        for c in r["certs"]:
            g = group_of(c)
            if g:
                tg[r["ptype"]][g].add(r["goods_no"])
    for t, ps in sorted(types.items(), key=lambda x: -len(x[1])):
        if len(ps) < 4:
            continue
        hits = sorted(tg[t].items(), key=lambda x: -len(x[1]))[:4]
        txt = " · ".join(f"{g} {len(s)*100//len(ps)}%" for g, s in hits) or "(없음)"
        print(f"  {t:<7} ({len(ps):>2}개)  {txt}")

    print("\n=== 자사 vs 경쟁사 ===")
    op = {r["goods_no"] for r in rows if not r["is_competitor"]}
    cp = {r["goods_no"] for r in rows if r["is_competitor"]}
    for g, s in sorted(by_group.items(), key=lambda x: -len(x[1])):
        o = len(s & op) * 100 // max(len(op), 1)
        c = len(s & cp) * 100 // max(len(cp), 1)
        mark = "  ←" if c - o >= 15 else ""
        print(f"  {g:<16} 자사 {o:>3}%  경쟁 {c:>3}%  ({o-c:+d}%p){mark}")

    if unknown:
        print(f"\n※ 묶음에 안 걸린 이름 {len(unknown)}종. --new 로 확인하라.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default=None)
    ap.add_argument("--new", action="store_true", help="미분류 이름만 보기")
    a = ap.parse_args()
    conn = get_conn()
    conn.autocommit = True
    rows = _load(conn, a.type)
    conn.close()
    if not rows:
        print("데이터 없음 — detail_page_analyzer --all 을 먼저 돌려라")
        return
    if a.type:
        print(f"[유형: {a.type}]")
    report(rows, a.new)


if __name__ == "__main__":
    main()
