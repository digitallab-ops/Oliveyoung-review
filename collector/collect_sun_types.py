"""선케어 유형별 표본 보강 — 순위가 아니라 제품 유형으로 n을 맞춘다.

근거: 순위별 구성 차이는 3%(노이즈), 제품 유형별 차이는 12.7%p.
     따라서 '상위 N개'가 아니라 '유형별 N개'로 모아야 비교가 선다.

PowerShell 대신 파이썬으로 둔 이유: PS 5.1은 BOM 없는 .ps1을 ANSI로 읽어
한글 리터럴이 깨진다.

실행:
    python -m collector.collect_sun_types
    python -m collector.collect_sun_types --dry
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from collector.detail_page_collector import run as collect  # noqa: E402

# (유형, 목표 개수) — 현재 보유분을 뺀 부족분
TARGETS = [
    ("선세럼", 12),
    ("선스틱", 12),
    ("선쿠션", 8),
    ("기타", 10),
    ("선패치", 4),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", default="선케어")
    ap.add_argument("--dry", action="store_true", help="대상만 확인하고 수집하지 않음")
    a = ap.parse_args()

    if a.dry:
        from db.schema import get_conn
        from collector.detail_page_collector import pick_by_type
        conn = get_conn(); conn.autocommit = True
        total = 0
        for t, n in TARGETS:
            rows = pick_by_type(conn, a.category, t, n)
            total += len(rows)
            print(f"  {t:<8} {len(rows):>2}개")
        conn.close()
        print(f"\n합계 {total}개")
        return

    for i, (t, n) in enumerate(TARGETS, 1):
        print("\n" + "=" * 62, flush=True)
        print(f"  [{i}/{len(TARGETS)}] {t} — 최대 {n}개", flush=True)
        print("=" * 62, flush=True)
        try:
            collect(a.category, n, None, False, t)
        except Exception as e:
            print(f"  실패: {str(e).splitlines()[0][:80]}", flush=True)
        time.sleep(8)

    print("\n=== 유형별 보강 수집 완료 ===", flush=True)


if __name__ == "__main__":
    main()
