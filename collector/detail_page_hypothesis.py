"""1단계 — 가설 검증. 상위권과 중위권의 구성이 실제로 다른가.

이 질문을 먼저 푸는 이유:
  "시장 평균대로 짜라"는 조언은 평균을 만든다. 초안에 쓸 값은 '잘 되는 쪽'의 패턴이다.
  그런데 상위권과 중위권이 구성상 차이가 없다면, 구성은 성과를 가르는 변수가 아니고
  우리가 뽑아야 할 것은 '잘 나가는 구성'이 아니라 다른 것이 된다.
  데이터를 10배로 늘리기 전에 이것부터 확인한다.

검증 대상 가설 (실무 자료에서 가져온 것):
  H1. 상위권은 도입부(상단 25%)에 프로모션·후기·실적을 더 많이 둔다
  H2. 상위권은 소구 메시지가 더 적다 (집중)
  H3. 분량과 순위는 관계가 있다
  H4. 상위권은 수치를 더 많이 쓴다

표본이 20개뿐이라 통계적 유의성은 주장할 수 없다. 방향과 크기만 본다.

실행:
    python -m collector.detail_page_hypothesis
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

# 도입부로 볼 구간
HEAD_ZONE = 0.25
# 실무 자료에서 "상단에 두면 좋다"고 보는 역할들
EARLY_ROLES = {"실적소구", "후기소셜", "기획증증", "기획증정", "비교"}


def brand(n: str) -> str:
    return (re.sub(r"\[[^\]]*\]", " ", n or "").strip().split() or ["?"])[0]


def load(conn) -> dict:
    """시장 상품별 순위 + 섹션."""
    with conn.cursor() as cur:
        cur.execute("""
            WITH latest AS (SELECT MAX(rank_date) d FROM market_rankings),
            rk AS (
                SELECT DISTINCT ON (mr.goods_no) mr.goods_no, mr.rank_position
                FROM market_rankings mr, latest
                WHERE mr.rank_date = latest.d AND mr.category_name = '선케어'
                ORDER BY mr.goods_no, mr.rank_hour DESC, mr.rank_position
            )
            SELECT ds.goods_no, ds.seq, ds.role, ds.appeals, ds.has_number,
                   p.goods_name, rk.rank_position,
                   dp.total_height, dp.kept_count
            FROM detail_sections ds
            JOIN detail_pages dp ON dp.goods_no = ds.goods_no
            JOIN products p ON p.goods_no = ds.goods_no
            JOIN rk ON rk.goods_no = ds.goods_no
            WHERE p.is_competitor = true
            ORDER BY ds.goods_no, ds.seq
        """)
        rows = [dict(r) for r in cur.fetchall()]

    prod = defaultdict(lambda: {"secs": []})
    for r in rows:
        p = prod[r["goods_no"]]
        p["rank"] = r["rank_position"]
        p["name"] = r["goods_name"]
        p["brand"] = brand(r["goods_name"])
        p["height"] = r["total_height"]
        p["imgs"] = r["kept_count"]
        p["secs"].append(r)
    return prod


def metrics(p: dict) -> dict:
    secs = p["secs"]
    m = len(secs)
    head = [s for i, s in enumerate(secs) if i / max(m - 1, 1) < HEAD_ZONE]

    appeals = set()
    for s in secs:
        a = s["appeals"] if isinstance(s["appeals"], list) else json.loads(s["appeals"] or "[]")
        for x in a:
            x = str(x).strip()
            if len(x) >= 2:
                appeals.add(x)

    roles = Counter(s["role"] for s in secs)
    return {
        "rank": p["rank"], "brand": p["brand"],
        "height": p["height"], "imgs": p["imgs"], "sections": m,
        # 메시지 집중도 — 섹션당 고유 소구 수가 낮을수록 같은 말을 반복(집중)
        "appeals_unique": len(appeals),
        "appeals_per_sec": len(appeals) / max(m, 1),
        "number_rate": sum(1 for s in secs if s["has_number"]) * 100 / max(m, 1),
        "head_early": sum(1 for s in head if s["role"] in EARLY_ROLES) * 100 / max(len(head), 1),
        "head_roles": Counter(s["role"] for s in head),
        "roles": {k: v * 100 / m for k, v in roles.items()},
    }


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else 0


def corr(xs, ys):
    """피어슨 상관. 표본이 작으므로 참고치."""
    n = len(xs)
    if n < 3:
        return 0.0
    mx, my = mean(xs), mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = sum((x - mx) ** 2 for x in xs) ** 0.5
    dy = sum((y - my) ** 2 for y in ys) ** 0.5
    return num / (dx * dy) if dx and dy else 0.0


def run() -> None:
    conn = get_conn(); conn.autocommit = True
    try:
        prod = load(conn)
    finally:
        conn.close()

    ms = sorted((metrics(p) for p in prod.values()), key=lambda x: x["rank"])
    if len(ms) < 6:
        print("표본이 너무 적습니다.")
        return

    half = len(ms) // 2
    top, mid = ms[:half], ms[half:]

    print(f"=== 1단계 가설 검증 — 선케어 {len(ms)}개 ===")
    print(f"  상위권 {len(top)}개 (평균 {mean([m['rank'] for m in top]):.1f}위) vs "
          f"중위권 {len(mid)}개 (평균 {mean([m['rank'] for m in mid]):.1f}위)")
    print("  * 표본 20개라 통계적 유의성은 주장하지 않는다. 방향과 크기만 본다.\n")

    def cmp(label, key, unit="", nd=1):
        t, d = mean([m[key] for m in top]), mean([m[key] for m in mid])
        diff = t - d
        base = max(abs(d), 1e-9)
        pct = diff / base * 100
        mark = "뚜렷" if abs(pct) >= 25 else ("약함" if abs(pct) >= 10 else "없음")
        print(f"  {label:<22} 상위 {t:>9,.{nd}f}{unit}  중위 {d:>9,.{nd}f}{unit}  "
              f"차이 {diff:>+9,.{nd}f}{unit} ({pct:+.0f}%) {mark}")

    print("── H3. 분량과 순위 ──")
    cmp("페이지 세로", "height", "px", 0)
    cmp("이미지 수", "imgs", "장")
    cmp("섹션 수", "sections", "개")
    r = corr([m["rank"] for m in ms], [m["height"] for m in ms])
    print(f"  순위↔분량 상관 r = {r:+.2f}  "
          f"({'분량이 많을수록 상위' if r < -0.3 else '분량이 적을수록 상위' if r > 0.3 else '관계 약함'})")

    print("\n── H2. 메시지 집중도 ──")
    cmp("고유 소구 수", "appeals_unique", "개")
    cmp("섹션당 소구 수", "appeals_per_sec", "", 2)

    print("\n── H4. 수치 사용 ──")
    cmp("수치 사용률", "number_rate", "%")

    print("\n── H1. 도입부 구성 ──")
    cmp("도입부 실적·후기·기획 비중", "head_early", "%")
    for label, grp in (("상위권", top), ("중위권", mid)):
        c = Counter()
        for m in grp:
            c.update(m["head_roles"])
        tot = sum(c.values()) or 1
        top5 = " · ".join(f"{k} {v*100/tot:.0f}%" for k, v in c.most_common(5))
        print(f"     [{label} 도입부] {top5}")

    print("\n── 역할별 비중 차이 (상위 - 중위) ──")
    all_roles = set()
    for m in ms:
        all_roles |= set(m["roles"])
    diffs = []
    for role in all_roles:
        t = mean([m["roles"].get(role, 0) for m in top])
        d = mean([m["roles"].get(role, 0) for m in mid])
        diffs.append((role, t, d, t - d))
    diffs.sort(key=lambda x: -abs(x[3]))
    for role, t, d, df in diffs[:9]:
        bar = "+" * min(int(abs(df) * 2), 18) if df > 0 else "-" * min(int(abs(df) * 2), 18)
        print(f"  {role:<10} 상위 {t:>5.1f}%  중위 {d:>5.1f}%  {df:>+5.1f}%p  {bar}")

    print("\n── 상품별 ──")
    print(f"  {'순위':>4} {'브랜드':<12} {'세로px':>8} {'섹션':>5} {'소구':>5} {'수치%':>6}")
    for m in ms:
        print(f"  {m['rank']:>4} {m['brand']:<12} {m['height']:>8,} {m['sections']:>5} "
              f"{m['appeals_unique']:>5} {m['number_rate']:>6.0f}")


if __name__ == "__main__":
    run()
