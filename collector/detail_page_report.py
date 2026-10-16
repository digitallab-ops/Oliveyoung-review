"""상세페이지 구성 집계 — 개별 분석을 '흐름 패턴'으로 묶는다.

상세페이지 초안을 짜는 사람이 알고 싶은 것은 두 가지다.
  1) 잘 나가는 제품들은 어떤 순서로 설득하는가
  2) 어디에 분량을 쓰는가 (= 어디에 힘을 주는가)

실행:
    python -m collector.detail_page_report
    python -m collector.detail_page_report --category 선케어
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from db.schema import get_conn  # noqa: E402

# 상세페이지를 네 구간으로 나눠 본다. 같은 역할이라도 어디에 놓였는지가 전략이다.
ZONES = [("도입", 0.00, 0.25), ("전개", 0.25, 0.50),
         ("설득", 0.50, 0.75), ("마무리", 0.75, 1.01)]


def _brand(name: str) -> str:
    n = re.sub(r"\[[^\]]*\]", " ", name or "").strip()
    return (n.split() or ["?"])[0]


def load(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT ds.goods_no, ds.seq, ds.role, ds.headline, ds.appeals, ds.has_number,
                   COALESCE(p.goods_name, ds.goods_no) AS goods_name,
                   dp.kept_count, dp.total_height
            FROM detail_sections ds
            JOIN detail_pages dp ON dp.goods_no = ds.goods_no
            LEFT JOIN products p ON p.goods_no = ds.goods_no
            ORDER BY ds.goods_no, ds.seq
        """)
        return [dict(r) for r in cur.fetchall()]


def report(rows: list[dict]) -> None:
    if not rows:
        print("분석 데이터가 없습니다. detail_page_analyzer를 먼저 돌리세요.")
        return

    by_goods: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_goods[r["goods_no"]].append(r)

    n = len(by_goods)
    print(f"분석 대상 {n}개 상품 · 섹션 {len(rows):,}개\n")

    # ── 1. 분량 ────────────────────────────────────────────
    print("=" * 74)
    print("1. 분량 — 얼마나 길게 설득하는가")
    print("=" * 74)
    lens = sorted(((v[0]["kept_count"], v[0]["total_height"], _brand(v[0]["goods_name"]),
                    len(v)) for v in by_goods.values()), key=lambda x: -x[1])
    print(f"  {'브랜드':<12} {'이미지':>5} {'세로px':>9} {'섹션':>5}")
    print("  " + "-" * 36)
    for c, h, b, s in lens:
        print(f"  {b:<12} {c:>5} {h:>9,} {s:>5}")
    hs = [x[1] for x in lens]
    print(f"\n  중앙값 {sorted(hs)[len(hs)//2]:,}px · 최단 {min(hs):,} · 최장 {max(hs):,}"
          f" ({max(hs)/max(min(hs),1):.1f}배 차이)")

    # ── 2. 역할 비중 ───────────────────────────────────────
    print("\n" + "=" * 74)
    print("2. 어디에 분량을 쓰는가 — 역할별 비중")
    print("=" * 74)
    roles = Counter(r["role"] for r in rows)
    tot = sum(roles.values())
    for role, c in roles.most_common():
        pct = c * 100 / tot
        carried = sum(1 for v in by_goods.values() if any(x["role"] == role for x in v))
        print(f"  {role:<10} {'█' * max(1, round(pct / 1.5)):<22} {pct:>5.1f}%  "
              f"({c:>3}개 · {carried}/{n}개 상품이 사용)")

    # ── 3. 구간별 배치 ─────────────────────────────────────
    print("\n" + "=" * 74)
    print("3. 어느 순서에 놓는가 — 구간별 역할 분포")
    print("=" * 74)
    zone_roles: dict[str, Counter] = {z[0]: Counter() for z in ZONES}
    for v in by_goods.values():
        m = len(v)
        for i, r in enumerate(v):
            p = i / max(m - 1, 1)
            for zname, lo, hi in ZONES:
                if lo <= p < hi:
                    zone_roles[zname][r["role"]] += 1
                    break
    for zname, _, _ in ZONES:
        top = zone_roles[zname].most_common(5)
        s = sum(zone_roles[zname].values()) or 1
        print(f"\n  [{zname}]")
        for role, c in top:
            print(f"     {role:<10} {c * 100 / s:>5.1f}%")

    # ── 4. 대표 흐름 ───────────────────────────────────────
    print("\n" + "=" * 74)
    print("4. 대표 흐름 — 상품별 역할 시퀀스 (연속 중복 제거)")
    print("=" * 74)
    for gno, v in sorted(by_goods.items(), key=lambda kv: -kv[1][0]["total_height"]):
        flow, prev = [], None
        for r in v:
            if r["role"] != prev:
                flow.append(r["role"]); prev = r["role"]
        b = _brand(v[0]["goods_name"])
        print(f"\n  {b}")
        line, cur = [], "     "
        for f in flow:
            if len(cur) + len(f) + 3 > 72:
                line.append(cur); cur = "     "
            cur += f + " › "
        line.append(cur.rstrip(" › "))
        print("\n".join(line))

    # ── 5. 시작과 끝 ───────────────────────────────────────
    print("\n" + "=" * 74)
    print("5. 무엇으로 열고 무엇으로 닫는가")
    print("=" * 74)
    opens = Counter(v[0]["role"] for v in by_goods.values())
    closes = Counter(v[-1]["role"] for v in by_goods.values())
    print("  [첫 섹션]  " + " · ".join(f"{k} {c}" for k, c in opens.most_common(5)))
    print("  [끝 섹션]  " + " · ".join(f"{k} {c}" for k, c in closes.most_common(5)))

    # ── 6. 소구 키워드 ─────────────────────────────────────
    print("\n" + "=" * 74)
    print("6. 반복되는 소구 키워드")
    print("=" * 74)
    kw = Counter()
    for r in rows:
        a = r["appeals"] if isinstance(r["appeals"], list) else json.loads(r["appeals"] or "[]")
        for k in a:
            k = str(k).strip()
            if len(k) >= 2:
                kw[k] += 1
    for k, c in kw.most_common(28):
        print(f"  {c:>3}  {k}")

    # ── 7. 수치 사용 ───────────────────────────────────────
    print("\n" + "=" * 74)
    print("7. 수치로 말하는 비율")
    print("=" * 74)
    num = sum(1 for r in rows if r["has_number"])
    print(f"  전체 섹션의 {num * 100 / len(rows):.1f}%가 눈에 띄는 수치를 사용 ({num}/{len(rows)})")
    by_role = defaultdict(lambda: [0, 0])
    for r in rows:
        by_role[r["role"]][1] += 1
        if r["has_number"]:
            by_role[r["role"]][0] += 1
    print("\n  역할별 수치 사용률")
    for role, (a, b) in sorted(by_role.items(), key=lambda kv: -kv[1][0] / max(kv[1][1], 1)):
        if b >= 3:
            print(f"     {role:<10} {a * 100 / b:>5.0f}%  ({a}/{b})")


def main() -> None:
    conn = get_conn()
    conn.autocommit = True
    try:
        report(load(conn))
    finally:
        conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", default="선케어")
    ap.parse_args()
    main()
