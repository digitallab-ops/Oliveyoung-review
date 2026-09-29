"""
올리브영 경쟁사 소비자가 전용 수집기
- 1회 실행 시 최대 100개 처리, 15-30초 지연 (rate limiting 대응)
- price IS NULL 우선 → 7일 이상 미갱신 순으로 처리
- 실행 주기: 매일 새벽 2시 (OY_PriceCollector Task Scheduler)
"""
import os
import sys
import re
import time
import random
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

try:
    from curl_cffi import requests as cf_requests
    _IMPERSONATE = "chrome131"
except ImportError:
    import requests as cf_requests
    _IMPERSONATE = None

from bs4 import BeautifulSoup
from db.schema import get_conn, init_db
from collector.product_detail_collector import parse_price, HEADERS, DETAIL_URL

BATCH_SIZE   = 100
MIN_DELAY    = 15.0
MAX_DELAY    = 30.0
BACKOFF      = 90.0
REFRESH_DAYS = 7


def _warm_session():
    try:
        kwargs = dict(headers=HEADERS, timeout=20)
        if _IMPERSONATE:
            cf_requests.get('https://www.oliveyoung.co.kr/', impersonate=_IMPERSONATE, **kwargs)
        else:
            cf_requests.get('https://www.oliveyoung.co.kr/', **kwargs)
        print("  세션 워밍업 완료", flush=True)
        time.sleep(random.uniform(3, 6))
    except Exception as e:
        print(f"  세션 워밍업 실패 (무시): {e}", flush=True)


def _fetch_price(goods_no: str):
    """(price, status) 반환. 차단 시 status = '차단됨'"""
    kwargs = dict(params={'goodsNo': goods_no}, headers=HEADERS, timeout=20)
    try:
        if _IMPERSONATE:
            r = cf_requests.get(DETAIL_URL, impersonate=_IMPERSONATE, **kwargs)
        else:
            r = cf_requests.get(DETAIL_URL, **kwargs)

        if r.status_code in (429, 403):
            return None, f"HTTP {r.status_code}"
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}"
        if '잠시만 기다려 주세요' in r.text or len(r.text) < 2000:
            return None, "차단됨"

        soup = BeautifulSoup(r.text, 'html.parser')
        return parse_price(soup), "OK"
    except Exception as e:
        return None, f"오류: {e}"


def run(limit: int = BATCH_SIZE):
    print("=== 경쟁사 소비자가 수집 시작 ===\n", flush=True)
    conn = get_conn()
    conn.autocommit = True

    try:
        init_db(conn=conn)

        stale_threshold = date.today() - timedelta(days=REFRESH_DAYS)

        with conn.cursor() as cur:
            # 자사(is_competitor=false) 우선 — 46개뿐이고 가격 비교의 기준값
            cur.execute("""
                SELECT goods_no, goods_name
                FROM products
                WHERE (price IS NULL OR detail_fetched_at < %s)
                ORDER BY
                    is_competitor,
                    CASE WHEN price IS NULL THEN 0 ELSE 1 END,
                    COALESCE(detail_fetched_at, '2000-01-01') ASC
                LIMIT %s
            """, (stale_threshold, limit))
            products = list(cur.fetchall())

        if not products:
            print("수집할 상품 없음 (모두 최신 상태)", flush=True)
            print("\n=== 완료 - 0/0개 가격 수집 ===", flush=True)
            return

        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) cnt FROM products WHERE price IS NULL"
            )
            total_null = cur.fetchone()['cnt']

        print(f"수집 대상: {len(products)}개  (전체 NULL: {total_null}개)\n", flush=True)

        _warm_session()

        success = 0
        blocked = 0

        for i, p in enumerate(products):
            goods_no  = p['goods_no']
            goods_name = p['goods_name'] or ''
            label      = goods_name[:35]

            price, status = _fetch_price(goods_no)

            # 차단 감지 → 대기 후 1회 재시도
            if status in ("HTTP 429", "HTTP 403", "차단됨"):
                blocked += 1
                wait = BACKOFF + random.uniform(0, 30)
                print(f"  ({i+1}/{len(products)}) 차단! {status} — {wait:.0f}초 대기...", flush=True)
                time.sleep(wait)
                price, status = _fetch_price(goods_no)

            if price:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE products
                        SET price = %s, detail_fetched_at = CURRENT_DATE
                        WHERE goods_no = %s
                    """, (price, goods_no))
                    cur.execute("""
                        INSERT INTO price_history (goods_no, price, recorded_date)
                        VALUES (%s, %s, CURRENT_DATE)
                        ON CONFLICT (goods_no, recorded_date) DO NOTHING
                    """, (goods_no, price))
                print(f"  ({i+1}/{len(products)}) {label} → {price:,}원", flush=True)
                success += 1
            else:
                # 페이지 정상 로드됐으나 가격 없음 → detail_fetched_at만 갱신 (무한 재시도 방지)
                if status == "OK":
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE products SET detail_fetched_at = CURRENT_DATE WHERE goods_no = %s",
                            (goods_no,)
                        )
                print(f"  ({i+1}/{len(products)}) {label} → 가격 없음 ({status})", flush=True)

            if i < len(products) - 1:
                time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))

        print(f"\n=== 완료 - {success}/{len(products)}개 가격 수집 (차단 {blocked}회) ===", flush=True)
    finally:
        conn.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=BATCH_SIZE, help="1회 최대 수집 수")
    args = parser.parse_args()
    run(limit=args.limit)
