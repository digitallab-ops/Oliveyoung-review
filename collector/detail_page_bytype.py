"""A단계 — 제품 유형별로 구성이 다른가.

순위로는 구성 차이가 안 나왔다(detail_page_hypothesis 결과).
남은 가설은 '제품 유형이 구성을 가른다'이다. 선스틱과 선세럼은
쓰는 상황도 소구점도 다르므로 페이지 구성도 달라야 자연스럽다.

유형당 표본이 3~5개뿐이라 방향만 본다.

실행:
    python -m collector.detail_page_bytype
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from db.schema import get_conn  # noqa: E402

# 제품 유형. 위에서부터 먼저 걸리는 쪽을 택하므로 순서가 곧 우선순위다.
# 선케어를 먼저 검사해야 '선세럼'이 '세럼'보다, '크림미스트'가 '크림'보다 먼저 걸린다.
# 2026-10 더모 코스메틱·마스크팩까지 확대하면서 선케어 밖 유형을 추가했다.
TYPES = [
    # ── 선케어 ──
    ("선쿠션",    ["선쿠션", "썬쿠션", "쿠션"]),
    ("선스틱",    ["선스틱", "썬스틱", "스틱선", "스틱썬"]),
    ("선스프레이", ["선스프레이", "썬스프레이", "선미스트", "썬미스트"]),
    ("선패치",    ["선패치", "썬패치", "유브이컷패치"]),
    ("톤업베이스", ["톤업베이스", "선베이스", "썬베이스", "프라이머"]),
    ("선세럼",    ["선세럼", "썬세럼", "선앰플", "썬앰플", "선에센스", "썬에센스"]),
    ("선비비",    ["선비비", "썬비비", "선쿠션비비"]),
    ("선크림",    ["선크림", "썬크림", "선스크린", "썬스크린", "선블록", "썬블록",
                   "자차", "업선", "선플러스", "안뗄리오스", "유브이", "uv프로텍터",
                   "uvprotector", "프로텍션선", "선올인원", "uv쉴드", "uv컷"]),
    ("애프터선",  ["수딩젤", "알로에", "애프터선"]),
    # ── 마스크·패드 ──
    ("토너패드",  ["토너패드", "패드"]),
    ("시트마스크", ["시트마스크", "마스크팩", "마스크스티커", "딥마스크", "마스크",
                   "페이스필름", "캡슐패치", "패치"]),
    ("팩",       ["모델링팩", "클레이팩", "노우즈팩", "얼음장팩", "워시오프", "팩"]),
    # ── 클렌징 ──
    ("클렌징",    ["클렌징", "클렌저", "클렌징폼", "폴리언트", "필링", "각질",
                   "클렌징워터", "리무버", "센시비오", "h2o", "바디워시"]),
    # ── 스킨케어·더모 ──
    ("미스트토너", ["미스트", "토너", "스킨로션", "부스터"]),
    ("아이크림",  ["아이크림"]),
    ("밤",       ["밤b5", "리페어밤", "시카밤", "밤 "]),
    ("크림",      ["크림", "모이스처라이저", "모이스쳐라이저", "오인트먼트", "연고"]),
    ("세럼앰플",  ["세럼", "앰플", "에센스"]),
    ("로션",      ["로션", "에멀전", "플루이드"]),
    ("젤",        ["젤", "겔"]),
    ("오일",      ["오일"]),
]
# 예전 이름 — 선케어 전용 호출부가 남아 있어 유지한다
SUN_TYPES = TYPES


def classify(name: str) -> str:
    n = re.sub(r"\s+", "", (name or "").lower())
    # 대괄호 안은 기획·프로모 문구라 유형 판정을 흐린다 ([1등 선크림] 같은 것)
    n = re.sub(r"\[[^\]]*\]", "", n)
    for label, keys in TYPES:
        if any(re.sub(r"\s+", "", k.lower()) in n for k in keys):
            return label
    return "기타"


def brand(n: str) -> str:
    return (re.sub(r"\[[^\]]*\]", " ", n or "").strip().split() or ["?"])[0]


def load(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT ds.goods_no, ds.seq, ds.role, ds.headline, ds.appeals, ds.has_number,
                   p.goods_name, p.is_competitor, dp.total_height, dp.kept_count
            FROM detail_sections ds
            JOIN detail_pages dp ON dp.goods_no = ds.goods_no
            JOIN products p ON p.goods_no = ds.goods_no
            ORDER BY ds.goods_no, ds.seq
        """)
        rows = [dict(r) for r in cur.fetchall()]
    prod = defaultdict(lambda: {"secs": []})
    for r in rows:
        p = prod[r["goods_no"]]
        p["name"] = r["goods_name"]; p["brand"] = brand(r["goods_name"])
        p["ours"] = not r["is_competitor"]
        p["height"] = r["total_height"]; p["imgs"] = r["kept_count"]
        p["type"] = classify(r["goods_name"])
        p["secs"].append(r)
    return prod


def run() -> None:
    conn = get_conn(); conn.autocommit = True
    try:
        prod = load(conn)
    finally:
        conn.close()

    by_type = defaultdict(list)
    for g, p in prod.items():
        by_type[p["type"]].append(p)

    print("=== A단계 — 제품 유형별 구성 비교 ===")
    print(f"  전체 {len(prod)}개 (시장 {sum(1 for p in prod.values() if not p['ours'])} / "
          f"자사 {sum(1 for p in prod.values() if p['ours'])})")
    print("  * 유형당 표본이 작다. 방향만 본다.\n")

    print("── 유형 분포 ──")
    for t, ps in sorted(by_type.items(), key=lambda kv: -len(kv[1])):
        mk = sum(1 for p in ps if not p["ours"]); ou = len(ps) - mk
        names = ", ".join(sorted({p["brand"] for p in ps}))[:58]
        print(f"  {t:<8} {len(ps):>2}개 (시장 {mk} / 자사 {ou})  {names}")

    # 유형별 역할 비중
    print("\n── 유형별 역할 비중 (표본 3개 이상) ──")
    big = {t: ps for t, ps in by_type.items() if len(ps) >= 3}
    roles_all = Counter()
    for ps in by_type.values():
        for p in ps:
            roles_all.update(s["role"] for s in p["secs"])
    top_roles = [r for r, _ in roles_all.most_common(8)]

    hdr = "  {:<10}".format("역할") + "".join(f"{t:>10}" for t in big)
    print(hdr)
    print("  " + "-" * (10 + 10 * len(big)))
    profiles = {}
    for t, ps in big.items():
        c = Counter()
        tot = 0
        for p in ps:
            c.update(s["role"] for s in p["secs"]); tot += len(p["secs"])
        profiles[t] = {r: c.get(r, 0) * 100 / max(tot, 1) for r in roles_all}
    for r in top_roles:
        line = f"  {r:<10}"
        vals = [profiles[t].get(r, 0) for t in big]
        for v in vals:
            line += f"{v:>9.1f}%"
        spread = max(vals) - min(vals) if vals else 0
        line += f"   폭 {spread:>4.1f}%p" + ("  ←" if spread >= 8 else "")
        print(line)

    # 유형별 분량
    print("\n── 유형별 분량 ──")
    print(f"  {'유형':<10} {'상품':>4} {'세로 중앙값':>12} {'섹션 평균':>9} {'수치율':>7}")
    for t, ps in sorted(big.items(), key=lambda kv: -len(kv[1])):
        hs = sorted(p["height"] for p in ps)
        secs = [len(p["secs"]) for p in ps]
        nr = []
        for p in ps:
            nr.append(sum(1 for s in p["secs"] if s["has_number"]) * 100 / max(len(p["secs"]), 1))
        print(f"  {t:<10} {len(ps):>4} {hs[len(hs)//2]:>11,}px "
              f"{sum(secs)/len(secs):>9.1f} {sum(nr)/len(nr):>6.0f}%")

    # 유형별 대표 소구
    print("\n── 유형별 대표 소구 키워드 ──")
    for t, ps in sorted(big.items(), key=lambda kv: -len(kv[1])):
        kw = Counter()
        for p in ps:
            for s in p["secs"]:
                a = s["appeals"] if isinstance(s["appeals"], list) else json.loads(s["appeals"] or "[]")
                for x in a:
                    x = str(x).strip()
                    if len(x) >= 2:
                        kw[x] += 1
        # 다른 유형에도 흔한 말은 걸러 그 유형다운 것만 남긴다
        others = Counter()
        for t2, ps2 in big.items():
            if t2 == t:
                continue
            for p in ps2:
                for s in p["secs"]:
                    a = s["appeals"] if isinstance(s["appeals"], list) else json.loads(s["appeals"] or "[]")
                    for x in a:
                        others[str(x).strip()] += 1
        distinct = [(w, c) for w, c in kw.most_common(40)
                    if c >= 2 and c > others.get(w, 0) * 0.8]
        print(f"\n  [{t}]  " + " · ".join(f"{w}({c})" for w, c in distinct[:10]))


if __name__ == "__main__":
    run()
