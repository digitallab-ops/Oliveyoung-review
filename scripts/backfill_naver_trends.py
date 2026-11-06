"""네이버 검색어 트렌드를 길게 받아 쌓는다 (기본 2016-01 ~ 오늘, 월별).

    python scripts/backfill_naver_trends.py                  # 2016~현재 월별
    python scripts/backfill_naver_trends.py --start 2022-01-01
    python scripts/backfill_naver_trends.py --dry            # 저장 없이 확인만

왜 필요한가:
  수집기는 최근 8주만 받는다. 계절성(선크림이 몇 월에 뜨는지)이나
  경쟁사 브랜드의 장기 추세는 8주로는 보이지 않는다.
  Data Lab 은 2016-01-01 부터 조회할 수 있고, 한 번 요청에 몇 년치가 온다.

두 가지 함정을 처리한다.

  1) 지수는 '요청 범위 안의 상대값'이다. 범위가 다르면 같은 날짜도 값이
     달라진다. 그래서 주별(최근)과 월별(장기)을 time_unit 으로 나눠 저장한다.

  2) 한 요청에 최대 5개 그룹이라 키워드가 많으면 나눠 불러야 하는데,
     묶음마다 100점 기준이 달라 그대로는 비교할 수 없다.
     그래서 기준 키워드(ANCHOR)를 모든 묶음에 넣고, 기준의 합이 같아지도록
     각 묶음을 보정한다. 합으로 맞추는 이유는 한 시점 값이 0에 가까우면
     나눗셈이 터지기 때문이다.
"""
import argparse
import os
import sys
import time
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
from dotenv import load_dotenv

load_dotenv()

from db.naver_schema import get_conn, init_db  # noqa: E402
from collector.naver_collector import HUB_BASE, _HEADERS, save_trends  # noqa: E402

# 모든 묶음에 들어가는 기준 키워드. 자사를 쓰면 '경쟁사 대비 우리'가 바로 읽힌다.
ANCHOR = '셀퓨전씨'

CATEGORY = ['선크림', '선세럼', '선스틱', '선스프레이', '톤업선크림']

# 최근 30일 올리브영 Top30 랭킹에 많이 올라온 경쟁사 (2026-11 기준)
COMPETITORS = [
    '라로슈포제', '제로이드', '에스트라', '닥터지', '달바',
    '아이오페', '피지오겔', '라운드랩', '토리든', '아누아',
    '구달', '바이오더마', '셀리맥스', '메디힐', '넘버즈인',
]


def batches(keywords: list[str], size: int = 4) -> list[list[str]]:
    """기준 키워드 + 나머지 4개씩. 한 요청 최대 5그룹."""
    out = []
    rest = [k for k in keywords if k != ANCHOR]
    for i in range(0, len(rest), size):
        out.append([ANCHOR] + rest[i:i + size])
    return out


def fetch(keywords: list[str], start: str, end: str, unit: str) -> list:
    body = {
        'startDate': start, 'endDate': end, 'timeUnit': unit,
        'keywordGroups': [{'groupName': k, 'keywords': [k]} for k in keywords],
    }
    r = requests.post(f'{HUB_BASE}/search-trend/v1/search',
                      headers={**_HEADERS, 'Content-Type': 'application/json'},
                      json=body, timeout=30)
    r.raise_for_status()
    return r.json().get('results', [])


def anchor_sum(results: list) -> float:
    for g in results:
        if g['title'] == ANCHOR:
            return sum(p['ratio'] for p in g.get('data', [])) or 0.0
    return 0.0


def run(start: str, end: str, unit: str, dry: bool) -> None:
    keywords = [ANCHOR] + CATEGORY + COMPETITORS
    groups = batches(keywords)
    print(f"키워드 {len(keywords)}개 · 묶음 {len(groups)}개 · {start} ~ {end} ({unit})\n")

    conn = None
    if not dry:
        conn = get_conn()
        conn.autocommit = True
        init_db(conn=conn)

    ref = None          # 첫 묶음의 기준 합 — 여기에 나머지를 맞춘다
    total = 0
    try:
        for i, kws in enumerate(groups, 1):
            res = fetch(kws, start, end, unit)
            a = anchor_sum(res)
            if ref is None:
                ref, scale = a, 1.0
            elif a > 0:
                scale = ref / a
            else:
                print(f"  [{i}/{len(groups)}] 기준 키워드 값이 0 — 보정 불가, 건너뜀")
                continue

            names = ', '.join(k for k in kws if k != ANCHOR)
            pts = sum(len(g.get('data', [])) for g in res)
            print(f"  [{i}/{len(groups)}] {names}")
            print(f"        포인트 {pts}개 · 보정 x{scale:.3f}")

            if not dry:
                # 기준 키워드는 첫 묶음 것만 저장한다(묶음마다 중복이라)
                keep = res if i == 1 else [g for g in res if g['title'] != ANCHOR]
                total += save_trends(conn, keep, time_unit=unit, scale=scale)
            time.sleep(0.4)          # 50 RPS 제한에 한참 못 미치지만 여유를 둔다
    finally:
        if conn:
            conn.close()

    print(f"\n{'[미저장] ' if dry else ''}저장 {total}행 (time_unit={unit})")


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', default='2016-01-01')
    ap.add_argument('--end', default=str(date.today()))
    ap.add_argument('--unit', default='month', choices=['month', 'week', 'date'])
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    run(a.start, a.end, a.unit, a.dry)
