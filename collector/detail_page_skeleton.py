"""상세페이지 초안 뼈대 — '어느 자리에 무엇을 넣는가'를 데이터에서 뽑는다.

BM팀이 상세페이지를 잡을 때 가장 오래 걸리는 건 구성이다. 무슨 말을 할지는
제품을 아니까 나오는데, 그 말을 어느 순서로 어떤 그림과 근거에 얹을지가 막힌다.

74개 상세페이지 3,099개 섹션에서 역할별 표준 위치를 뽑아 그 순서를 만들고,
각 자리마다 업계가 실제로 쓰는 말투·비주얼·근거·소구어를 붙인다.

    python -m collector.detail_page_skeleton                  # 표준 뼈대
    python -m collector.detail_page_skeleton --type 선쿠션      # 유형별
    python -m collector.detail_page_skeleton --type 선스틱 --gap # 자사 대비 미사용 표시
"""
from __future__ import annotations

import argparse
import statistics
from collections import Counter, defaultdict

from db.schema import get_conn
from collector.detail_page_library import _load, _appeal_terms, _brand, _is_lettering, _norm

# 채택률이 이 아래면 업계 관행이 아니라 한두 브랜드의 특이사항이다
MIN_ADOPTION = 25.0
# 근거 비율이 이 아래면 내부 구성비를 보여주지 않는다 — 표본이 몇 개 안 된다
MIN_EV_RATE = 15.0
# 뼈대의 한 칸으로 쓸 수 없는 역할 — '여기에 기타를 넣으세요'는 지시가 못 된다
SKIP_ROLES = {"기타", "해당없음"}
# 이 아래면 '업계 흐름'이라 부르기 어렵다. 숨기지 말고 경고만 붙인다
MIN_PRODUCTS = 10


def _slots(rows: list[dict]) -> list[dict]:
    """역할별 표준 위치를 구해 순서를 만든다.

    평균이 아니라 중앙값을 쓴다. '브랜드'처럼 맨 앞과 맨 뒤 양쪽에 오는 역할은
    평균을 내면 한가운데로 가버려서, 실제로는 아무도 안 쓰는 자리에 놓인다.
    """
    n_prod = len({r["goods_no"] for r in rows}) or 1
    by_role: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_role[r["role"]].append(r)

    out = []
    for role, rs in by_role.items():
        pos = [float(r["scroll_pct"]) for r in rs if r["scroll_pct"] is not None]
        if not pos:
            continue
        prods = {r["goods_no"] for r in rs}
        adoption = len(prods) * 100 / n_prod
        if adoption < MIN_ADOPTION or role in SKIP_ROLES:
            continue
        out.append({
            "role": role,
            "median": statistics.median(pos),
            "spread": (statistics.quantiles(pos, n=4)[2] - statistics.quantiles(pos, n=4)[0])
                      if len(pos) >= 4 else 0.0,
            "adoption": adoption,
            "n_products": len(prods),
            "per_product": len(rs) / len(prods),
            "copy": Counter(r["copy_type"] for r in rs if r["copy_type"]),
            "visual": Counter(r["visual"] for r in rs if r["visual"]),
            "evidence": Counter(r["evidence"] for r in rs
                                if r["evidence"] and r["evidence"] != "없음"),
            "ev_rate": sum(1 for r in rs if r["evidence"] and r["evidence"] != "없음") * 100 / len(rs),
            "num_rate": sum(1 for r in rs if r["has_number"]) * 100 / len(rs),
            "terms": _appeal_terms(rs),
            "rows": rs,
        })
    return sorted(out, key=lambda x: x["median"])


def _examples(rs: list[dict], terms: Counter, k: int = 2) -> list[tuple[str, str]]:
    score = {t: n for t, n in terms.items()}
    seen_b, seen_t, out = set(), set(), []
    for r in sorted(rs, key=lambda x: -sum(score.get(a, 0) for a in x["appeals"])):
        h = (r["headline"] or "").strip()
        b = _brand(r["goods_name"])
        if not h or len(h) < 6 or _is_lettering(h) or b in seen_b or _norm(h) in seen_t:
            continue
        seen_b.add(b)
        seen_t.add(_norm(h))
        out.append((h, b))
        if len(out) >= k:
            break
    return out


def _top(c: Counter, n: int = 2) -> str:
    tot = sum(c.values()) or 1
    return " / ".join(f"{a}({b*100//tot}%)" for a, b in c.most_common(n))


def report(rows: list[dict], label: str, show_gap: bool = False) -> None:
    slots = _slots(rows)
    n_prod = len({r["goods_no"] for r in rows})
    total = sum(s["per_product"] * s["adoption"] / 100 for s in slots)

    print(f"상세페이지 구성 뼈대 — {label}")
    print(f"근거: 상품 {n_prod}개 · 섹션 {len(rows):,}개 · 권장 분량 약 {total:.0f}개 섹션")
    if n_prod < MIN_PRODUCTS:
        print(f"※ 상품 {n_prod}개뿐이다. 순서는 참고만 하고 전체 뼈대와 같이 봐라.")
    print()

    # 자사가 안 쓰는 자리 계산
    gap = {}
    if show_gap:
        ours = [r for r in rows if not r["is_competitor"]]
        comp = [r for r in rows if r["is_competitor"]]
        op = {r["goods_no"] for r in ours}
        cp = {r["goods_no"] for r in comp}
        for s in slots:
            o = len({r["goods_no"] for r in s["rows"] if not r["is_competitor"]})
            c = len({r["goods_no"] for r in s["rows"] if r["is_competitor"]})
            gap[s["role"]] = (o * 100 / len(op) if op else 0,
                              c * 100 / len(cp) if cp else 0)

    for i, s in enumerate(slots, 1):
        band = f"{s['median']:.0f}%"
        tag = ""
        if show_gap and s["role"] in gap:
            o, c = gap[s["role"]]
            if c - o >= 15:
                tag = f"   ⚠ 자사 {o:.0f}% vs 경쟁 {c:.0f}%"

        print(f"{i:>2}. [{band:>4}] {s['role']}{tag}")
        print(f"      채택 {s['adoption']:.0f}% · 보통 {s['per_product']:.1f}개"
              f" · 근거 {s['ev_rate']:.0f}% · 수치 {s['num_rate']:.0f}%")
        print(f"      말투 {_top(s['copy'])}")
        print(f"      그림 {_top(s['visual'])}")
        # 근거를 거의 안 붙이는 자리에서 그 소수의 내부 비율을 보여주면
        # '이 자리엔 이런 근거를 쓴다'로 잘못 읽힌다. 표본이 설 때만 보여준다
        if s["evidence"] and s["ev_rate"] >= MIN_EV_RATE and sum(s["evidence"].values()) >= 10:
            print(f"      근거 {_top(s['evidence'])}")
        elif s["ev_rate"] < MIN_EV_RATE:
            print(f"      근거 거의 안 붙임")
        tt = s["terms"].most_common(8)
        if tt:
            print(f"      소구 " + ", ".join(t for t, _ in tt))
        for h, b in _examples(s["rows"], s["terms"]):
            print(f"        예) {h[:56]}   — {b}")
        print()

    # 근거 밀도 곡선 — 흐름의 성격을 한 줄로
    print("─" * 60)
    print("근거 밀도 곡선 (이 흐름의 성격)")
    for zn, lo, hi in [("초반", 0, 20), ("전반", 20, 40), ("중반", 40, 60),
                       ("후반", 60, 80), ("마무리", 80, 101)]:
        z = [r for r in rows if r["scroll_pct"] is not None
             and lo <= float(r["scroll_pct"]) < hi]
        if not z:
            continue
        ev = sum(1 for r in z if r["evidence"] and r["evidence"] != "없음") * 100 // len(z)
        print(f"  {zn:<5} {'█' * (ev // 3):<22} 근거 {ev:>2}%  (섹션 {len(z)})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default=None)
    ap.add_argument("--gap", action="store_true", help="자사가 덜 쓰는 자리 표시")
    a = ap.parse_args()

    conn = get_conn()
    conn.autocommit = True
    rows = _load(conn, a.type)
    conn.close()
    if not rows:
        print("데이터 없음 — detail_page_analyzer --all 을 먼저 돌려라")
        return
    report(rows, a.type or "전체 (선케어)", a.gap)


if __name__ == "__main__":
    main()
