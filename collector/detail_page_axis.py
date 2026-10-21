"""축 하나만 채운다 — 전수 재분석 없이.

왜 있나:
  분석 축을 하나 늘릴 때마다 detail_page_analyzer --all 로 324개를 통째로 다시
  돌렸다. 패널 7,026개 × 전액이라 한 번에 약 $24 가 나간다. 실제로 74개를
  두 번 돌려 약 $5 를 그냥 버렸다. 축 하나 때문에 이미 끝난 분석을
  다시 사는 건 구조가 잘못된 것이다.

어떻게 줄이나 — 비싼 건 '이미지 입력 토큰'이다. 그래서 두 갈래로 나눈다.
  text  축: 이미 뽑아둔 글(headline/appeals/note)만으로 판정된다.
            이미지를 아예 안 보내므로 사실상 공짜다. 수십 건을 한 번에 묶는다.
  vision 축: 이미지를 봐야 한다. 대신 '볼 이유가 있는 패널'로만 좁힌다.
            roles 를 걸면 해당 역할이 들어있는 패널만 돌린다 — 보통 전체의 10~30%.

실행:
    python -m collector.detail_page_axis --list
    python -m collector.detail_page_axis --axis cta --estimate
    python -m collector.detail_page_axis --axis cta --yes
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from collections import defaultdict

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from db.schema import get_conn  # noqa: E402
from collector.detail_page_analyzer import (  # noqa: E402
    MODEL, COST_PER_PANEL, BUDGET_GATE, _client, build_panels, ensure_tables)

# 분석 당시의 패널 위치와 지금 다시 이어붙인 위치가 이만큼 벌어지면
# 이미지가 바뀐 것으로 본다 (%p).
DRIFT_TOL = 0.2

# 글만으로 판정되는 축은 이미지를 안 보내므로 패널 단가가 아니라 묶음 단가다.
# 섹션 40개를 한 번에 묶었을 때의 근사치. 첫 실행 뒤 실측으로 보정해라.
COST_PER_TEXT_BATCH = 0.0015
TEXT_BATCH = 40

# ── 축 정의 ────────────────────────────────────────────────
# 새 축을 넣을 땐 여기에 한 줄 추가하고 --estimate 로 금액을 먼저 본다.
#   kind   : "text" (공짜에 가깝다) | "vision" (이미지 필요)
#   col    : detail_sections 에 추가될 컬럼
#   roles  : vision 축에서 '볼 가치가 있는' 역할. 비우면 전수 — 그럼 절감이 없다.
AXES: dict[str, dict] = {
    "cta": {
        "kind": "text",
        "col": "cta",
        "type": "VARCHAR(12)",
        "desc": "그 구간이 구매 행동을 직접 요구하는가",
        "values": {
            "직접": "지금 구매/장바구니/확인하세요 처럼 행동을 지시",
            "암시": "품절임박·한정수량처럼 행동을 압박하지만 지시하진 않음",
            "없음": "행동 요구가 없음",
        },
    },
    "layout": {
        "kind": "vision",
        "col": "layout",
        "type": "VARCHAR(12)",
        "desc": "그 구간의 화면 구성 형태",
        "roles": ["핵심소구", "성분", "임상인증", "비교"],
        "values": {
            "전면": "이미지가 화면을 꽉 채우고 글이 그 위에 얹힘",
            "상하": "위 이미지 / 아래 글 (또는 그 반대)",
            "좌우": "좌우로 나뉜 2단",
            "격자": "3개 이상 블록이 격자로 반복",
            "목록": "아이콘+한 줄이 세로로 나열",
        },
    },
}


_USAGE = {"in": 0, "out": 0, "calls": 0}


def _bill(res) -> None:
    """실제로 나간 토큰을 센다. 이게 없으면 단가 상수를 영영 보정할 수 없다."""
    u = getattr(res, "usage", None)
    _USAGE["calls"] += 1
    _USAGE["in"] += getattr(u, "prompt_tokens", 0) or 0
    _USAGE["out"] += getattr(u, "completion_tokens", 0) or 0


def _fmt(d: dict) -> str:
    return "\n".join(f"  {k}: {v}" for k, v in d.items())


def add_column(conn, ax: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(f"ALTER TABLE detail_sections "
                    f"ADD COLUMN IF NOT EXISTS {ax['col']} {ax['type']}")


def pending(conn, ax: dict) -> list[dict]:
    """아직 그 축이 비어 있는 섹션. 이미 채운 건 두 번 사지 않는다."""
    where = f"ds.{ax['col']} IS NULL"
    if ax["kind"] == "vision" and ax.get("roles"):
        # 해당 역할이 '한 개라도 들어있는 패널'을 통째로 대상으로 잡는다.
        # 패널 단위로 과금되므로 같은 패널의 다른 섹션도 같이 채우는 게 이득이다.
        where += """ AND EXISTS (
            SELECT 1 FROM detail_sections x
            WHERE x.goods_no = ds.goods_no AND x.panel = ds.panel
              AND x.role = ANY(%(roles)s))"""
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT ds.goods_no, ds.seq, ds.panel, ds.role, ds.headline,
                   ds.appeals, ds.note, ds.scroll_pct
            FROM detail_sections ds
            WHERE {where}
            ORDER BY ds.goods_no, ds.seq
        """, {"roles": ax.get("roles") or []})
        return [dict(r) for r in cur.fetchall()]


def estimate(rows: list[dict], ax: dict) -> float:
    if ax["kind"] == "text":
        n = -(-len(rows) // TEXT_BATCH)
        cost = n * COST_PER_TEXT_BATCH
        print(f"[예상] 섹션 {len(rows):,}개 · 묶음 {n:,}회 · "
              f"약 ${cost:,.2f}  (이미지 미전송)")
    else:
        panels = len({(r["goods_no"], r["panel"]) for r in rows})
        cost = panels * COST_PER_PANEL
        print(f"[예상] 섹션 {len(rows):,}개 · 패널 {panels:,}개 · 약 ${cost:,.2f}")
    return cost


# ── text 축 ───────────────────────────────────────────────
def _run_text(conn, client, rows: list[dict], ax: dict) -> int:
    done = 0
    for i in range(0, len(rows), TEXT_BATCH):
        chunk = rows[i:i + TEXT_BATCH]
        items = []
        for r in chunk:
            a = r["appeals"]
            if isinstance(a, str):
                try:
                    a = json.loads(a)
                except Exception:
                    a = []
            items.append({"id": f"{r['goods_no']}:{r['seq']}", "역할": r["role"],
                          "문구": (r["headline"] or "")[:120],
                          "소구": (a or [])[:4], "설명": (r["note"] or "")[:120]})
        msg = (f"아래는 화장품 상세페이지 구간들이다. 각 구간에 대해 "
               f"'{ax['desc']}'를 분류하라.\n\n"
               f"[값]\n{_fmt(ax['values'])}\n\n"
               f"[구간]\n{json.dumps(items, ensure_ascii=False)}\n\n"
               f'{{"result":[{{"id":"...","value":"..."}}]}} 형식 JSON만 출력하라. '
               f"모든 id 에 대해 빠짐없이 답하라.")
        try:
            res = client.chat.completions.create(
                model=MODEL, max_completion_tokens=3000,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": msg}])
            _bill(res)
            got = json.loads(res.choices[0].message.content or "{}").get("result", [])
        except Exception as e:
            print(f"  묶음 {i // TEXT_BATCH + 1} 실패: "
                  f"{str(e).splitlines()[0][:70]}", flush=True)
            continue
        n = _write(conn, ax, got)
        done += n
        # 묶음은 통째로 과금된다. 모델이 일부만 답하면 나머지는 돈만 내고
        # NULL 로 남아 다음 실행에서 또 과금된다. 조용히 넘어가면 안 된다.
        if n < len(chunk):
            print(f"  ! 묶음 {i // TEXT_BATCH + 1}: 보낸 {len(chunk)}개 중 "
                  f"{n}개만 채워짐 (나머지는 다음 실행에서 재과금)", flush=True)
        print(f"  {min(i + TEXT_BATCH, len(rows)):,}/{len(rows):,}", flush=True)
        time.sleep(0.3)
    return done


# ── vision 축 ─────────────────────────────────────────────
def _run_vision(conn, client, rows: list[dict], ax: dict) -> int:
    by_prod: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_prod[r["goods_no"]].append(r)

    done = skipped = 0
    for n, (gno, rs) in enumerate(by_prod.items(), 1):
        panels, starts = build_panels(gno)
        want = sorted({r["panel"] for r in rs if r["panel"]})
        print(f"({n}/{len(by_prod)}) {gno} · 패널 {len(want)}개", flush=True)
        for pi in want:
            if pi > len(panels):
                skipped += len([r for r in rs if r["panel"] == pi])
                continue
            here = [r for r in rs if r["panel"] == pi]
            # 수집 이후 이미지가 바뀌면 panel 번호가 다른 내용을 가리킨다.
            # 실측 결과 324개 중 18개가 이미 어긋나 있었다. 그대로 돌리면
            # 엉뚱한 그림을 보고 라벨을 달고, 그 라벨은 NULL 이 아니게 되어
            # 다시는 고쳐지지 않는다. 돈 쓰기 전에 걸러낸다.
            was = next((float(r["scroll_pct"]) for r in here
                        if r["scroll_pct"] is not None), None)
            now = starts[pi - 1] if pi - 1 < len(starts) else None
            if was is not None and now is not None and abs(was - now) > DRIFT_TOL:
                print(f"    패널 {pi} 건너뜀 — 이미지가 바뀜 "
                      f"(분석 당시 {was}% / 지금 {now}%)", flush=True)
                skipped += len(here)
                continue
            # 이미 뽑아둔 섹션 목록을 같이 준다. 모델이 다시 쪼개지 않고
            # seq 에 맞춰 값만 달게 하려는 것이다 — 기존 분석과 어긋나면 못 쓴다.
            known = [{"id": f"{r['goods_no']}:{r['seq']}", "역할": r["role"],
                      "문구": (r["headline"] or "")[:80]} for r in here]
            msg = (f"이 이미지는 상세페이지의 한 구간이다. 아래 목록은 이 구간에서 "
                   f"이미 식별된 섹션들이다.\n\n"
                   f"[섹션]\n{json.dumps(known, ensure_ascii=False)}\n\n"
                   f"각 섹션에 대해 '{ax['desc']}'를 분류하라.\n\n"
                   f"[값]\n{_fmt(ax['values'])}\n\n"
                   f'{{"result":[{{"id":"...","value":"..."}}]}} 형식 JSON만 출력하라.')
            b64 = base64.b64encode(panels[pi - 1]).decode()
            try:
                res = client.chat.completions.create(
                    model=MODEL, max_completion_tokens=1200,
                    response_format={"type": "json_object"},
                    messages=[{"role": "user", "content": [
                        {"type": "text", "text": msg},
                        {"type": "image_url", "image_url": {
                            "url": f"data:image/jpeg;base64,{b64}",
                            "detail": "high"}}]}])
                got = json.loads(res.choices[0].message.content or "{}").get("result", [])
            except Exception as e:
                print(f"    패널 {pi} 실패: "
                      f"{str(e).splitlines()[0][:70]}", flush=True)
                continue
            _bill(res)
            done += _write(conn, ax, got)
            time.sleep(0.35)
    if skipped:
        print(f"  이미지가 바뀌어 건너뛴 섹션 {skipped:,}개 — "
              f"detail_page_collector 로 다시 수집한 뒤 재분석이 필요하다", flush=True)
    return done


def _write(conn, ax: dict, got: list[dict]) -> int:
    """값만 UPDATE 한다. 기존 행은 절대 지우지 않는다 —
    축 하나 때문에 이미 산 분석을 날리는 사고를 막는다."""
    ok = 0
    allowed = set(ax["values"])
    seen = set()
    with conn.cursor() as cur:
        for g in got:
            v = str(g.get("value") or "").strip()
            ident = str(g.get("id") or "")
            if v not in allowed or ":" not in ident:
                continue
            gno, _, seq = ident.partition(":")
            if not seq.isdigit():
                continue
            key = (gno, int(seq))
            if key in seen:      # 같은 id 를 두 번 답해도 한 행이다
                continue
            seen.add(key)
            # IS NULL 조건이 핵심이다. 모델이 엉뚱한 id 를 지어내면 이미 채운
            # (또는 다른 패널의) 값을 조용히 덮어쓴다. 비어 있는 칸만 채운다.
            cur.execute(f"UPDATE detail_sections SET {ax['col']} = %s "
                        f"WHERE goods_no = %s AND seq = %s AND {ax['col']} IS NULL",
                        (v, gno, int(seq)))
            ok += cur.rowcount
    return ok


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--axis", default=None)
    ap.add_argument("--estimate", action="store_true", help="돈 쓰지 않고 금액만")
    ap.add_argument("--yes", action="store_true", help=f"${BUDGET_GATE:.2f} 초과 승인")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    if a.list or not a.axis:
        print("정의된 축")
        for k, v in AXES.items():
            r = "전수" if not v.get("roles") else "역할 " + "/".join(v["roles"])
            print(f"  {k:<10} {v['kind']:<7} {v['desc']}  [{r}]")
        return
    if a.axis not in AXES:
        print(f"모르는 축: {a.axis} (--list 로 확인)")
        return

    ax = AXES[a.axis]
    conn = get_conn()
    conn.autocommit = True
    ensure_tables(conn)
    add_column(conn, ax)
    rows = pending(conn, ax)
    if not rows:
        print("채울 것 없음 — 이미 전부 들어있다")
        conn.close()
        return

    cost = estimate(rows, ax)
    if a.estimate:
        conn.close()
        return
    if cost > BUDGET_GATE and not a.yes:
        print(f"  ${BUDGET_GATE:.2f} 초과 — 돌리려면 --yes 를 붙여라.")
        conn.close()
        return

    client = _client()
    n = (_run_text if ax["kind"] == "text" else _run_vision)(conn, client, rows, ax)
    conn.close()
    print(f"=== {a.axis}: 섹션 {n:,}개 채움 / 대상 {len(rows):,}개 ===")
    if _USAGE["calls"]:
        print(f"    호출 {_USAGE['calls']:,}회 · 입력 {_USAGE['in']:,} · "
              f"출력 {_USAGE['out']:,} 토큰  → 이 값으로 단가 상수를 보정해라")


if __name__ == "__main__":
    main()
