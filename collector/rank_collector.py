import os
import sys
import time
import random
import re
import urllib.request
from datetime import date, datetime, timezone, timedelta

try:
    from curl_cffi import requests as cf_requests
    _IMPERSONATE = "chrome131"
except ImportError:
    import requests as cf_requests
    _IMPERSONATE = None

from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from db.schema import get_conn, init_db

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Referer': 'https://www.oliveyoung.co.kr/store/main/getBestList.do',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
}

CATEGORIES = [
    ('전체',         '900000100100001', None),
    ('스킨케어',     '900000100100001', '10000010001'),
    ('마스크팩',     '900000100100001', '10000010009'),
    ('클렌징',       '900000100100001', '10000010010'),
    ('선케어',       '900000100100001', '10000010011'),
    ('선스틱',       '900000100100001', '100000100110003'),
    ('선세럼·미스트','900000100100001', '100000100110005'),
    ('더모 코스메틱','900000100100001', '10000010008'),
    ('바디케어',     '900000100100001', '10000010003'),
    ('맨즈에딧',     '900000100100001', '10000010007'),
]

ROWS_PER_PAGE = 100


def revalidate_vercel():
    app_url = os.getenv('APP_URL', '').rstrip('/')
    if not app_url:
        return
    try:
        req = urllib.request.Request(
            f'{app_url}/api/revalidate',
            data=b'{}',
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        urllib.request.urlopen(req, timeout=10)
        print('  Vercel 캐시 초기화 완료')
    except Exception as e:
        print(f'  Vercel 캐시 초기화 실패: {e}')


def _is_unchanged(cur, cat_name: str, ranking: list[dict]) -> bool:
    """직전 저장 스냅샷과 비교해 랭킹 변화 없으면 True"""
    cur.execute("""
        SELECT goods_no FROM market_rankings
        WHERE category_name = %s
          AND (rank_date, rank_hour) = (
              SELECT rank_date, rank_hour FROM market_rankings
              WHERE category_name = %s
              ORDER BY rank_date DESC, rank_hour DESC
              LIMIT 1
          )
        ORDER BY rank_position
    """, (cat_name, cat_name))
    prev = [r['goods_no'] for r in cur.fetchall()]
    curr = [item['goods_no'] for item in ranking]
    return prev == curr


_session_cookies: dict = {}


def _save_ranking(conn, cur, rank_date, rank_hour, cat_name: str, ranking: list[dict], our_goods: set) -> int:
    """랭킹 저장 공통 로직. 저장한 항목 수 반환."""
    hits = [(i + 1, item) for i, item in enumerate(ranking) if item['goods_no'] in our_goods]

    with conn.cursor() as c:
        if _is_unchanged(c, cat_name, ranking):
            # 전체 순위 변화 없어도 자사 상품 위치는 기록 (타임라인 연속성 보장)
            if hits:
                for rank, item in hits:
                    c.execute("""
                        INSERT INTO market_rankings (rank_date, rank_hour, category_name, rank_position, goods_no, goods_name)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (rank_date, rank_hour, category_name, rank_position)
                        DO UPDATE SET goods_no = EXCLUDED.goods_no, goods_name = EXCLUDED.goods_name
                    """, (rank_date, rank_hour, cat_name, rank, item['goods_no'], item['name']))
                print(f"  변화 없음 — 자사 {len(hits)}개 위치만 저장: " +
                      ", ".join(f"{r}위 {it['goods_no']}" for r, it in hits))
            else:
                print(f"  변화 없음 — 저장 스킵")
            return 0

        for rank, item in enumerate(ranking, 1):
            c.execute("""
                INSERT INTO market_rankings (rank_date, rank_hour, category_name, rank_position, goods_no, goods_name)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (rank_date, rank_hour, category_name, rank_position)
                DO UPDATE SET goods_no = EXCLUDED.goods_no, goods_name = EXCLUDED.goods_name
            """, (rank_date, rank_hour, cat_name, rank, item['goods_no'], item['name']))

        for rank, item in hits:
            c.execute("""
                INSERT INTO product_rankings (rank_date, goods_no, category_name, rank_position)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (rank_date, goods_no, category_name)
                DO UPDATE SET rank_position = EXCLUDED.rank_position
            """, (rank_date, item['goods_no'], cat_name, rank))

    print(f"  전체 {len(ranking)}개 저장", end='')
    if hits:
        print(f"  |  자사: " + ", ".join(f"{r}위 {it['goods_no']}" for r, it in hits))
    else:
        print(f"  (자사 Top {ROWS_PER_PAGE} 없음)")
    return len(ranking)


def warm_session():
    """올리브영 메인 → 베스트 페이지 순으로 방문해 세션 쿠키 확보"""
    global _session_cookies
    try:
        main_headers = {**HEADERS, 'Referer': 'https://www.google.com/'}
        kwargs = dict(headers=main_headers, timeout=15)
        if _IMPERSONATE:
            r = cf_requests.get('https://www.oliveyoung.co.kr/',
                                impersonate=_IMPERSONATE, **kwargs)
        else:
            r = cf_requests.get('https://www.oliveyoung.co.kr/', **kwargs)
        if hasattr(r, 'cookies'):
            _session_cookies = dict(r.cookies)
        time.sleep(random.uniform(4, 8))

        # 베스트 목록 페이지도 한 번 방문
        best_headers = {**HEADERS, 'Referer': 'https://www.oliveyoung.co.kr/'}
        kwargs2 = dict(headers=best_headers, cookies=_session_cookies or None, timeout=15)
        if _IMPERSONATE:
            r2 = cf_requests.get('https://www.oliveyoung.co.kr/store/main/getBestList.do',
                                 impersonate=_IMPERSONATE, **kwargs2)
        else:
            r2 = cf_requests.get('https://www.oliveyoung.co.kr/store/main/getBestList.do', **kwargs2)
        if hasattr(r2, 'cookies'):
            _session_cookies.update(dict(r2.cookies))

        print(f"  세션 워밍업 완료 (쿠키 {len(_session_cookies)}개)")
        time.sleep(random.uniform(5, 10))
    except Exception as e:
        print(f"  세션 워밍업 실패 (무시): {e}")


def fetch_ranking(disp_cat: str, flt_cat: str | None) -> list[dict]:
    """카테고리 베스트 페이지에서 {goods_no, name} 순위 리스트 반환 (403 시 재시도 4회)"""
    params = {'dispCatNo': disp_cat, 'pageIdx': 1, 'rowsPerPage': ROWS_PER_PAGE}
    if flt_cat:
        params['fltDispCatNo'] = flt_cat

    # 즉각 1회 재시도 (짧은 대기) — 긴 대기는 run()의 post-run 재시도에서 처리
    retry_waits = [0, random.uniform(15, 25)]
    last_err = None

    for attempt in range(2):
        if attempt > 0:
            wait = retry_waits[attempt]
            print(f"    → {wait:.0f}초 대기 후 즉각 재시도...")

            time.sleep(wait)

        try:
            kwargs = dict(
                params=params,
                headers=HEADERS,
                cookies=_session_cookies if _session_cookies else None,
                timeout=25,
            )
            if _IMPERSONATE:
                r = cf_requests.get('https://www.oliveyoung.co.kr/store/main/getBestList.do',
                                    impersonate=_IMPERSONATE, **kwargs)
            else:
                r = cf_requests.get('https://www.oliveyoung.co.kr/store/main/getBestList.do', **kwargs)

            if r.status_code == 403:
                last_err = ValueError(f"HTTP 403 (시도 {attempt+1}/4)")
                continue
            if r.status_code != 200:
                raise ValueError(f"HTTP {r.status_code}")
            if len(r.text) < 1000:
                raise ValueError(f"응답이 너무 짧음 ({len(r.text)}bytes) — 차단 의심")

            soup = BeautifulSoup(r.text, 'html.parser')
            seen = set()
            results = []
            for item in soup.select('.prd_info'):
                parent = item.find_parent('li')
                link = (parent or item).select_one('a[href*="goodsNo"]')
                if not link:
                    continue
                m = re.search(r'goodsNo=([A-Z0-9]+)', link.get('href', ''))
                if not m or m.group(1) in seen:
                    continue
                goods_no = m.group(1)
                seen.add(goods_no)
                name_el = item.select_one('.tx_name, .prd_name, strong.tx_name, .name')
                name = name_el.get_text(strip=True) if name_el else ''
                results.append({'goods_no': goods_no, 'name': name})
            return results
        except ValueError:
            raise
        except Exception as e:
            last_err = e

    raise last_err or ValueError("2회 시도 실패")


def run():
    KST = timezone(timedelta(hours=9))
    now_kst = datetime.now(KST)
    rank_hour = now_kst.hour
    rank_date = now_kst.date()
    print(f"=== 올리브영 카테고리 랭킹 수집 ({rank_date} {rank_hour:02d}시 KST) ===")

    conn = get_conn()
    conn.autocommit = True

    try:
        init_db(conn=conn)

        with conn.cursor() as cur:
            cur.execute('SELECT goods_no FROM products')
            our_goods = {r['goods_no'] for r in cur.fetchall()}

        print(f"자사 상품 {len(our_goods)}개 기준으로 랭킹 탐색\n")

        total_saved = 0
        failed_cats: list[tuple[str, str, str | None]] = []

        warm_session()

        for cat_name, disp, flt in CATEGORIES:
            print(f"[{cat_name}] 수집 중...")
            try:
                ranking = fetch_ranking(disp, flt)
                saved = _save_ranking(conn, cur=None, rank_date=rank_date, rank_hour=rank_hour,
                                      cat_name=cat_name, ranking=ranking, our_goods=our_goods)
                total_saved += saved
            except Exception as e:
                print(f"  오류: {e}")
                failed_cats.append((cat_name, disp, flt))

            time.sleep(random.uniform(15, 25))

        # 실패한 카테고리 한 번 더 시도
        if failed_cats:
            print(f"\n[재시도] 실패한 {len(failed_cats)}개 카테고리 재수집 시작...")
            time.sleep(random.uniform(60, 90))
            warm_session()
            for cat_name, disp, flt in failed_cats:
                print(f"[{cat_name}] 재시도 중...")
                try:
                    ranking = fetch_ranking(disp, flt)
                    saved = _save_ranking(conn, cur=None, rank_date=rank_date, rank_hour=rank_hour,
                                          cat_name=cat_name, ranking=ranking, our_goods=our_goods)
                    total_saved += saved
                except Exception as e:
                    print(f"  재시도 실패: {e}")
                time.sleep(random.uniform(20, 35))

        print(f"\n=== 완료 - {total_saved}개 시장 순위 저장 ===")
        revalidate_vercel()

    finally:
        conn.close()


if __name__ == "__main__":
    run()
