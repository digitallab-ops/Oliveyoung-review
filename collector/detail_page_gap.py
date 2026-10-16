"""자사 vs 시장 상세페이지 구성 대조 — 무엇이 비어 있는지 계산한다.

"시장 트렌드는 이렇다"보다 "우리 페이지엔 이게 없다"가 초안 작성에 직접 쓰인다.
그래서 비교의 단위를 '역할'로 잡고, 두 가지를 본다.
  - 구성비 차이: 시장이 분량을 쓰는 곳에 우리도 쓰고 있는가
  - 누락: 시장 대다수가 쓰는데 우리는 아예 없는 역할

실행:
    python -m collector.detail_page_gap --category 선케어
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


def _brand(name: str) -> str:
    n = re.sub(r"\[[^\]]*\]", " ", name or "").strip()
    return (n.split() or ["?"])[0]


def load(conn) -> tuple[list[dict], list[dict]]:
    """(시장, 자사) 섹션 목록."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT ds.goods_no, ds.seq, ds.role, ds.headline, ds.appeals, ds.has_number,
                   COALESCE(p.goods_name, ds.goods_no) AS goods_name,
                   COALESCE(p.is_competitor, true) AS is_competitor,
                   dp.kept_count, dp.total_height
            FROM detail_sections ds
            JOIN detail_pages dp ON dp.goods_no = ds.goods_no
            LEFT JOIN products p ON p.goods_no = ds.goods_no
            ORDER BY ds.goods_no, ds.seq
        """)
        rows = [dict(r) for r in cur.fetchall()]
    return ([r for r in rows if r["is_competitor"]],
            [r for r in rows if not r["is_competitor"]])


def profile(rows: list[dict]) -> dict:
    """역할 구성비 + 분량 + 수치 사용률."""
    by_goods = defaultdict(list)
    for r in rows:
        by_goods[r["goods_no"]].append(r)
    if not by_goods:
        return {}

    roles = Counter(r["role"] for r in rows)
    tot = sum(roles.values()) or 1
    n = len(by_goods)
    heights = sorted(v[0]["total_height"] for v in by_goods.values())

    return {
        "products": n,
        "sections": len(rows),
        "share": {k: v * 100 / tot for k, v in roles.items()},
        "count": dict(roles),
        # 몇 개 상품이 그 역할을 쓰는가 — 구성비보다 '채택률'이 누락 판단에 맞다
        "adoption": {
            role: sum(1 for v in by_goods.values() if any(x["role"] == role for x in v)) / n
            for role in roles
        },
        "median_height": heights[len(heights) // 2],
        "median_sections": sorted(len(v) for v in by_goods.values())[n // 2],
        "number_rate": sum(1 for r in rows if r["has_number"]) * 100 / max(len(rows), 1),
        "by_goods": by_goods,
    }


def gaps(mkt: dict, our: dict) -> list[dict]:
    """역할별 차이. 시장 채택률이 높은데 우리 비중이 낮은 순으로."""
    out = []
    for role, m_share in mkt["share"].items():
        o_share = our["share"].get(role, 0.0)
        m_adopt = mkt["adoption"].get(role, 0)
        o_adopt = our["adoption"].get(role, 0)
        out.append({
            "role": role,
            "mkt_share": m_share, "our_share": o_share,
            "diff": o_share - m_share,
            "mkt_adopt": m_adopt, "our_adopt": o_adopt,
            "missing": o_share == 0 and m_adopt >= 0.5,
        })
    # 시장이 많이 쓰는데 우리가 적게 쓰는 것부터
    return sorted(out, key=lambda x: (x["diff"] - x["mkt_share"] * 0.3))


def report(category: str = "선케어") -> None:
    conn = get_conn(); conn.autocommit = True
    try:
        mkt_rows, our_rows = load(conn)
    finally:
        conn.close()

    mkt, our = profile(mkt_rows), profile(our_rows)
    if not mkt or not our:
        print("시장 또는 자사 분석 데이터가 없습니다.")
        return

    print(f"=== {category} 상세페이지 구성 대조 ===")
    print(f"  시장 {mkt['products']}개 상품 / 섹션 {mkt['sections']:,}개")
    print(f"  자사 {our['products']}개 상품 / 섹션 {our['sections']:,}개\n")

    print("=" * 72)
    print("분량")
    print("=" * 72)
    print(f"  {'':12} {'시장':>12} {'자사':>12}   차이")
    print(f"  {'세로 중앙값':12} {mkt['median_height']:>10,}px {our['median_height']:>10,}px"
          f"   {our['median_height']-mkt['median_height']:+,}px")
    print(f"  {'섹션 중앙값':12} {mkt['median_sections']:>12} {our['median_sections']:>12}"
          f"   {our['median_sections']-mkt['median_sections']:+}")
    print(f"  {'수치 사용률':12} {mkt['number_rate']:>11.1f}% {our['number_rate']:>11.1f}%"
          f"   {our['number_rate']-mkt['number_rate']:+.1f}%p")

    print("\n" + "=" * 72)
    print("역할별 구성비 — 시장이 쓰는 곳에 우리도 쓰고 있는가")
    print("=" * 72)
    print(f"  {'역할':<10} {'시장':>7} {'자사':>7} {'차이':>8}  {'시장채택':>8} {'자사채택':>8}")
    print("  " + "-" * 60)
    for g in gaps(mkt, our):
        flag = "  ← 없음" if g["missing"] else ""
        print(f"  {g['role']:<10} {g['mkt_share']:>6.1f}% {g['our_share']:>6.1f}% "
              f"{g['diff']:>+7.1f}%p  {g['mkt_adopt']*100:>7.0f}% {g['our_adopt']*100:>7.0f}%{flag}")

    print("\n" + "=" * 72)
    print("우선 보완 — 시장 대다수가 쓰는데 우리가 비어 있는 것")
    print("=" * 72)
    miss = [g for g in gaps(mkt, our) if g["missing"] or
            (g["mkt_adopt"] >= 0.6 and g["our_share"] < g["mkt_share"] * 0.5)]
    if not miss:
        print("  뚜렷한 누락 없음")
    for g in miss[:6]:
        print(f"\n  [{g['role']}]  시장 {g['mkt_share']:.1f}% / 자사 {g['our_share']:.1f}%"
              f"  (시장 {g['mkt_adopt']*100:.0f}%가 사용)")
        ex = [r for r in mkt_rows if r["role"] == g["role"] and (r["headline"] or "").strip()]
        for e in ex[:3]:
            print(f"     예: \"{e['headline'][:52]}\"  — {_brand(e['goods_name'])}")

    print("\n" + "=" * 72)
    print("자사 상품별 구성")
    print("=" * 72)
    for gno, v in sorted(our["by_goods"].items(), key=lambda kv: -kv[1][0]["total_height"]):
        nm = re.sub(r"\[[^\]]*\]", "", v[0]["goods_name"]).replace("셀퓨전씨", "").strip()[:36]
        rc = Counter(x["role"] for x in v)
        top = " · ".join(f"{k} {c}" for k, c in rc.most_common(4))
        print(f"\n  {nm}")
        print(f"     {v[0]['kept_count']}장 · {v[0]['total_height']:,}px · 섹션 {len(v)}개")
        print(f"     {top}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", default="선케어")
    a = ap.parse_args()
    report(a.category)
