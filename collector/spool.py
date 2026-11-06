"""DB 가 죽어 있는 동안 수집분을 로컬에 쌓아 둔다.

왜 필요한가:
  순위와 프로모션은 **시계열**이다. 오늘 11시 순위는 11시에만 받을 수 있고,
  지나가면 영영 못 되찾는다. DB 가 멈춰 있는 동안 수집을 쉬면 그 시간만큼이
  데이터에 구멍으로 남는다.

  수집기들은 '가져오기(fetch_*)'와 '저장하기(_save_*)'가 나뉘어 있어서,
  가져오기만 떼어 쓸 수 있다. 그래서 DB 없이 받아 파일로 쌓아 두고,
  DB 가 돌아오면 같은 저장 함수로 밀어 넣는다.

리뷰는 일부러 뺐다. 리뷰는 나중에 다시 긁을 수 있지만 순위는 못 긁는다.
짧은 시간에 할 수 있는 걸 순위·프로모션에 몰아 준다.

    python -m collector.spool collect    # DB 없이 받아 파일로 (매시 실행)
    python -m collector.spool status     # 쌓인 양 확인
    python -m collector.spool flush      # DB 가 살아난 뒤 밀어 넣기
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import random
import sys
import time
from datetime import date, datetime, timedelta, timezone

from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
load_dotenv()

SPOOL = os.path.join(ROOT, "exports", "_spool")
KST = timezone(timedelta(hours=9))


def _write(kind: str, name: str, payload: dict) -> str:
    d = os.path.join(SPOOL, kind)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".json.gz")
    tmp = p + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, p)          # 쓰다 끊겨도 반쪽 파일이 남지 않는다
    return p


# ── 받기 (DB 불필요) ────────────────────────────────────
def collect_rankings() -> int:
    from collector.rank_collector import CATEGORIES, fetch_ranking, warm_session

    now = datetime.now(KST)
    stamp = f"{now.date()}_{now.hour:02d}"
    done = 0
    warm_session()
    for cat_name, disp, flt in CATEGORIES:
        name = f"{stamp}_{cat_name}"
        if os.path.exists(os.path.join(SPOOL, "rankings", name + ".json.gz")):
            print(f"  건너뜀 {cat_name} (이 시각 이미 받음)", flush=True)
            continue
        try:
            ranking = fetch_ranking(disp, flt)
        except Exception as e:
            print(f"  {cat_name} 실패: {str(e).splitlines()[0][:60]}", flush=True)
            continue
        _write("rankings", name, {
            "rank_date": str(now.date()), "rank_hour": now.hour,
            "cat_name": cat_name, "ranking": ranking,
        })
        done += 1
        print(f"  {cat_name} {len(ranking)}개", flush=True)
        time.sleep(random.uniform(15, 25))
    return done


def collect_promos() -> int:
    from collector.promo_collector import (
        OLIVEPICK_CAT, HOTDEAL_CONDITIONS, make_session,
        fetch_olivepick_catno, fetch_olivepick, fetch_all_hotdeal,
        fetch_brand_events)

    today = date.today()
    today_str = today.strftime("%Y%m%d")
    s = make_session()
    done = 0

    try:
        catno = fetch_olivepick_catno(s) or OLIVEPICK_CAT
        items = fetch_olivepick(s, catno)
        if items:
            _write("promos", f"{today}_olivepick", {
                "ptype": "olivepick", "today": str(today),
                "catno": catno, "items": items})
            done += 1
            print(f"  올영픽 {len(items)}개", flush=True)
    except Exception as e:
        print(f"  올영픽 실패: {str(e).splitlines()[0][:60]}", flush=True)

    for ptype, label, flt in HOTDEAL_CONDITIONS:
        try:
            items = fetch_all_hotdeal(s, today_str, flt)
        except Exception as e:
            print(f"  {label} 실패: {str(e).splitlines()[0][:60]}", flush=True)
            continue
        if items:
            _write("promos", f"{today}_{ptype}", {
                "ptype": ptype, "today": str(today), "items": items})
            done += 1
            print(f"  {label} {len(items)}개", flush=True)

    # 브랜드관 이벤트는 그 날짜에만 보이므로 같이 받아 둔다
    try:
        evts = fetch_brand_events(s)
        if evts:
            _write("promos", f"{today}_brandevents", {
                "ptype": "brand_events", "today": str(today), "items": evts})
            done += 1
            print(f"  브랜드 이벤트 {len(evts)}개", flush=True)
    except Exception as e:
        print(f"  브랜드 이벤트 실패: {str(e).splitlines()[0][:60]}", flush=True)
    return done


def collect() -> None:
    now = datetime.now(KST)
    print(f"=== 로컬 보관 수집 ({now:%Y-%m-%d %H:%M} KST) ===")
    print("[순위]")
    a = collect_rankings()
    print("[프로모션]")
    b = collect_promos()
    print(f"\n=== 받음: 순위 {a}개 카테고리 · 프로모션 {b}건 ===")
    status()


# ── 현황 ────────────────────────────────────────────────
def status() -> None:
    tot = 0
    for kind in ("rankings", "promos"):
        d = os.path.join(SPOOL, kind)
        if not os.path.isdir(d):
            print(f"  {kind:<10} 없음")
            continue
        fs = [x for x in os.listdir(d) if x.endswith(".json.gz")]
        sz = sum(os.path.getsize(os.path.join(d, x)) for x in fs)
        tot += len(fs)
        hours = sorted({x.rsplit("_", 1)[0] for x in fs})
        print(f"  {kind:<10} 파일 {len(fs):>4}개 · {sz/1024/1024:.1f}MB"
              + (f" · {hours[0][:13]} ~ {hours[-1][:13]}" if hours else ""))
    print(f"  합계 {tot}개 파일")


# ── 밀어 넣기 (DB 필요) ─────────────────────────────────
def flush() -> None:
    from db.schema import get_conn, init_db
    from collector.rank_collector import _save_ranking
    from collector.promo_collector import save_items

    conn = get_conn()
    conn.autocommit = True
    init_db(conn=conn)
    with conn.cursor() as cur:
        # is_competitor 조건을 빠뜨리면 수집된 상품 전부가 자사로 찍힌다.
        # 원본 수집기(promo_collector / rank_collector)와 같은 기준을 써야 한다.
        cur.execute("SELECT goods_no FROM products WHERE is_competitor = FALSE")
        our = {r["goods_no"] for r in cur.fetchall()}
    print(f"자사 {len(our)}개 기준\n")

    moved = os.path.join(SPOOL, "_flushed")
    os.makedirs(moved, exist_ok=True)

    d = os.path.join(SPOOL, "rankings")
    files = sorted(os.listdir(d)) if os.path.isdir(d) else []
    ok = 0
    for fn in files:
        if not fn.endswith(".json.gz"):
            continue
        with gzip.open(os.path.join(d, fn), "rt", encoding="utf-8") as f:
            p = json.load(f)
        try:
            _save_ranking(conn, cur=None,
                          rank_date=date.fromisoformat(p["rank_date"]),
                          rank_hour=p["rank_hour"], cat_name=p["cat_name"],
                          ranking=p["ranking"], our_goods=our)
            os.replace(os.path.join(d, fn), os.path.join(moved, fn))
            ok += 1
        except Exception as e:
            print(f"  {fn} 실패: {str(e).splitlines()[0][:70]}", flush=True)
    print(f"순위 {ok}/{len(files)}건 반영")

    d = os.path.join(SPOOL, "promos")
    files = sorted(os.listdir(d)) if os.path.isdir(d) else []
    ok = 0
    for fn in files:
        if not fn.endswith(".json.gz"):
            continue
        with gzip.open(os.path.join(d, fn), "rt", encoding="utf-8") as f:
            p = json.load(f)
        if p["ptype"] == "brand_events":
            continue            # 전용 저장 경로가 따로 있어 건드리지 않는다
        try:
            save_items(conn, p["ptype"], p["items"], our,
                       date.fromisoformat(p["today"]))
            os.replace(os.path.join(d, fn), os.path.join(moved, fn))
            ok += 1
        except Exception as e:
            print(f"  {fn} 실패: {str(e).splitlines()[0][:70]}", flush=True)
    print(f"프로모션 {ok}/{len(files)}건 반영")
    conn.close()
    print(f"\n반영한 파일은 {moved} 로 옮겼다 — 지우지 말고 확인 뒤에 치워라")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["collect", "status", "flush"])
    a = ap.parse_args()
    {"collect": collect, "status": status, "flush": flush}[a.phase]()


if __name__ == "__main__":
    main()
