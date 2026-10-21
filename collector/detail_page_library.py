"""소구 라이브러리 — 역할별로 '그들이 실제로 쓰는 말'을 뽑는다.

상세페이지 초안을 잡을 때 가장 오래 걸리는 건 '이 자리에서 무슨 말을 해야 하나'다.
전수 분석된 섹션에서 역할별 소구어·대표 헤드라인·주로 오는 위치를 모아
그 자리를 메울 재료를 준다.

    python -m collector.detail_page_library              # 전체
    python -m collector.detail_page_library --type 선쿠션  # 유형별
    python -m collector.detail_page_library --role 임상인증 --full
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict

from db.schema import get_conn
from collector.detail_page_bytype import classify

# 소구어로서 의미가 없는 토큰 — 라이브러리에 넣어봐야 초안에 도움이 안 된다
STOPWORDS = {
    "제품", "사용", "피부", "효과", "성분", "경우", "확인", "가능", "자외선",
    "선크림", "썬크림", "선스틱", "자차", "기획", "증정", "단품", "본품",
    "해당없음", "없음", "기타", "이미지", "텍스트", "안내", "참고",
}
# 섹션이 '무엇인지'를 말할 뿐 '무엇을 말하는지'가 아닌 메타 라벨.
# 남겨두면 소구어 순위를 먹고, 그 점수로 대표 문구를 고르는 바람에
# 영문 제목 레터링이 예시로 올라온다 (후킹에서 실제로 그랬다).
META = {
    "제품명", "브랜드명", "브랜드", "브랜드 소개", "브랜드 철학", "라인 소개",
    "제품 노출", "제품컷", "모델컷", "시연컷", "인포그래픽", "비교표", "그래프",
    "라인업", "옵션", "옵션 안내", "비교", "고민 환기", "공감", "후기",
    "사용 순서", "사용법", "사용 방법", "사용방법", "제품 정보", "제품정보",
    "상세 정보", "구성", "선택", "소개", "정보", "타이틀", "헤드라인",
}
MIN_APPEAL_LEN = 2


def _clean(name: str) -> str:
    return re.sub(r"\[[^\]]*\]", "", name or "").strip()


def _brand(name: str) -> str:
    """브랜드명만 집어낸다.

    수집된 상품명은 브랜드가 두 번 붙어 있다. 띄어서('셀퓨전씨 셀퓨전씨 …')
    붙을 때도 있고 공백 없이('트로이아르케트로이아르케 …') 붙을 때도 있어
    두 경우를 다 편다.
    """
    t = (_clean(name).split() or [""])[0]
    h = len(t) // 2
    if len(t) >= 4 and len(t) % 2 == 0 and t[:h] == t[h:]:
        return t[:h]
    return t


def _norm(term: str) -> str:
    """'자외선 차단'과 '자외선차단'은 같은 말이다."""
    return re.sub(r"\s+", "", term).lower()


_HANGUL = re.compile(r"[가-힣]")


def _is_lettering(h: str) -> bool:
    """영문 제목 레터링인가 — 'TEXTURE', 'HOW TO USE', 'Cell Fusion C'.

    이미지 속 장식 문구라 초안 재료가 못 된다. 한글이 거의 없으면 레터링으로 본다.
    """
    ko = len(_HANGUL.findall(h))
    return ko < 2


def _load(conn, product_type: str | None = None) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT ds.goods_no, ds.seq, ds.role, ds.copy_type, ds.visual,
                   ds.evidence, ds.density, ds.scroll_pct, ds.has_number,
                   ds.headline, ds.appeals, COALESCE(p.goods_name,
                            (SELECT MAX(m.goods_name) FROM market_rankings m
                             WHERE m.goods_no = ds.goods_no)) AS goods_name,
                   COALESCE(p.is_competitor, true) AS is_competitor
            FROM detail_sections ds
-- products 에는 선케어 파이프라인이 넣은 상품만 있다. 더모·마스크팩으로
            -- 확대하면서 93개가 products 에 없어 통째로 빠졌다. 이름과 자사 여부는
            -- market_rankings 로 메운다 (랭킹에만 잡힌 상품은 모두 경쟁사다).
            LEFT JOIN products p ON p.goods_no = ds.goods_no
            WHERE ds.copy_type IS NOT NULL
            ORDER BY ds.goods_no, ds.seq
        """)
        rows = [dict(r) for r in cur.fetchall()]

    for r in rows:
        r["ptype"] = classify(r["goods_name"])
        a = r.get("appeals")
        if isinstance(a, str):
            try:
                a = json.loads(a)
            except Exception:
                a = []
        r["appeals"] = [x for x in (a or []) if isinstance(x, str)]

    if product_type:
        rows = [r for r in rows if r["ptype"] == product_type]
    return rows


def _appeal_terms(rows: list[dict]) -> Counter:
    """소구어를 센다. 한 상품이 같은 말을 반복해도 1표로 — 그래야 '업계 공통어'가 보인다.

    표기만 다른 말은 한 항목으로 합치고, 가장 흔한 표기를 대표형으로 쓴다.
    """
    seen: dict[str, set] = defaultdict(set)
    forms: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        for a in r["appeals"]:
            t = a.strip()
            if len(t) < MIN_APPEAL_LEN or t in STOPWORDS or t in META:
                continue
            k = _norm(t)
            seen[k].add(r["goods_no"])
            forms[k][t] += 1
    return Counter({forms[k].most_common(1)[0][0]: len(g) for k, g in seen.items()})


def _zone(pct) -> str:
    if pct is None:
        return "?"
    p = float(pct)
    return ("초반", "전반", "중반", "후반", "마무리")[min(int(p // 20), 4)]


def build(rows: list[dict]) -> list[dict]:
    """역할별 라이브러리 항목을 만든다."""
    n_prod = len({r["goods_no"] for r in rows}) or 1
    by_role: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_role[r["role"]].append(r)

    out = []
    for role, rs in by_role.items():
        prods = {r["goods_no"] for r in rs}
        terms = _appeal_terms(rs)

        # 대표 문구 — 소구어 점수가 높은 순.
        # 브랜드당 1개만 뽑는다. 상품당으로 막으면 같은 브랜드의 자매 상품이
        # 토씨까지 같은 문구를 다시 올린다.
        score = {t: n for t, n in terms.items()}
        scored, used_brand, used_text = [], set(), set()
        for r in sorted(rs, key=lambda x: -sum(score.get(a, 0) for a in x["appeals"])):
            h = (r["headline"] or "").strip()
            b = _brand(r["goods_name"])
            if not h or len(h) < 6 or _is_lettering(h):
                continue
            if b in used_brand or _norm(h) in used_text:
                continue
            used_brand.add(b)
            used_text.add(_norm(h))
            scored.append({"text": h, "brand": _clean(r["goods_name"])[:22],
                           "copy": r["copy_type"], "zone": _zone(r["scroll_pct"])})

        out.append({
            "role": role,
            "n_sections": len(rs),
            "n_products": len(prods),
            "adoption": len(prods) * 100 / n_prod,
            "per_product": len(rs) / len(prods),
            "zones": Counter(_zone(r["scroll_pct"]) for r in rs),
            "copy": Counter(r["copy_type"] for r in rs if r["copy_type"]),
            "visual": Counter(r["visual"] for r in rs if r["visual"]),
            "evidence": Counter(r["evidence"] for r in rs
                                if r["evidence"] and r["evidence"] != "없음"),
            "num_rate": sum(1 for r in rs if r["has_number"]) * 100 / len(rs),
            "terms": terms,
            "samples": scored,
        })
    return sorted(out, key=lambda x: -x["adoption"])


def _bar(c: Counter, n: int = 3) -> str:
    tot = sum(c.values()) or 1
    return " · ".join(f"{a} {b*100//tot}%" for a, b in c.most_common(n))


def report(rows: list[dict], only_role: str | None = None, full: bool = False) -> None:
    lib = build(rows)
    n_prod = len({r["goods_no"] for r in rows})
    print(f"소구 라이브러리 — 상품 {n_prod}개 · 섹션 {len(rows):,}개\n")

    for e in lib:
        if only_role and e["role"] != only_role:
            continue
        # 채택률이 낮은 역할은 '업계 관행'이 아니라 한두 브랜드의 특이사항이다
        if not full and not only_role and e["adoption"] < 15:
            continue

        print("─" * 70)
        print(f"■ {e['role']}   상품 {e['n_products']}/{n_prod}개가 사용 "
              f"({e['adoption']:.0f}%) · 쓸 땐 평균 {e['per_product']:.1f}개")
        print(f"   위치   {_bar(e['zones'], 3)}")
        print(f"   말투   {_bar(e['copy'], 3)}      수치 포함 {e['num_rate']:.0f}%")
        print(f"   비주얼 {_bar(e['visual'], 3)}")
        if e["evidence"]:
            print(f"   근거   {_bar(e['evidence'], 3)}")

        top = e["terms"].most_common(14 if full else 10)
        if top:
            print("   소구어 " + ", ".join(f"{t}({n})" for t, n in top))

        print("   예시")
        for s in e["samples"][: (8 if full else 4)]:
            print(f"     · {s['text'][:58]}")
            print(f"         [{s['zone']}/{s['copy']}] {s['brand']}")
        print()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default=None, help="제품 유형 (선크림/선세럼/선스틱/선쿠션/선패치…)")
    ap.add_argument("--role", default=None, help="역할 하나만 자세히")
    ap.add_argument("--full", action="store_true", help="희귀 역할까지 전부")
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
    report(rows, a.role, a.full)


if __name__ == "__main__":
    main()
