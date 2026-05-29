import os
import sys
import time
import random
import re
import urllib.request
from datetime import date, datetime, timezone

try:
    from curl_cffi import requests as cf_requests
    _IMPERSONATE = "chrome120"
except ImportError:
    import requests as cf_requests
    _IMPERSONATE = None

from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from db.schema import get_conn, init_db

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Referer': 'https://www.oliveyoung.co.kr/store/main/getBestList.do',
    'Accept-Language': 'ko-KR,ko;q=0.9',
}

CATEGORIES = [
    ('전체',         '900000100100001', None),
    ('스킨케어',     '900000100100001', '10000010001'),
    ('마스크팩',     '900000100100001', '10000010009'),
    ('클렌징',       '900000100100001', '10000010010'),
    ('선케어',       '900000100100001', '10000010011'),
    ('더모 코스메틱','900000100100001', '10000010002'),
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


def fetch_ranking(disp_cat: str, flt_cat: str | None) -> list[dict]:
    """카테고리 베스트 페이지에서 {goods_no, name} 순위 리스트 반환"""
    params = {'dispCatNo': disp_cat, 'pageIdx': 1, 'rowsPerPage': ROWS_PER_PAGE}
    if flt_cat:
        params['fltDispCatNo'] = flt_cat
    kwargs = dict(
        params=params,
        headers=HEADERS,
        timeout=15,
    )
    if _IMPERSONATE:
        r = cf_requests.get('https://www.oliveyoung.co.kr/store/main/getBestList.do',
                            impersonate=_IMPERSONATE, **kwargs)
    else:
        r = cf_requests.get('https://www.oliveyoung.co.kr/store/main/getBestList.do', **kwargs)

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


def run():
    rank_hour = datetime.now(timezone.utc).hour  # DB(UTC)와 맞추기 위해 UTC 기준
    kst_hour = datetime.now().hour
    print(f"=== 올리브영 카테고리 랭킹 수집 ({date.today()} {kst_hour:02d}시 KST / UTC {rank_hour:02d}시) ===\n")

    conn = get_conn()
    conn.autocommit = True

    try:
        init_db(conn=conn)

        with conn.cursor() as cur:
            cur.execute('SELECT goods_no FROM products')
            our_goods = {r['goods_no'] for r in cur.fetchall()}

        print(f"자사 상품 {len(our_goods)}개 기준으로 랭킹 탐색\n")

        total_saved = 0

        for cat_name, disp, flt in CATEGORIES:
            print(f"[{cat_name}] 수집 중...")
            try:
                ranking = fetch_ranking(disp, flt)

                with conn.cursor() as cur:
                    # market_rankings: 전체 100개 저장
                    for rank, item in enumerate(ranking, 1):
                        cur.execute("""
                            INSERT INTO market_rankings (rank_date, rank_hour, category_name, rank_position, goods_no, goods_name)
                            VALUES (CURRENT_DATE, %s, %s, %s, %s, %s)
                            ON CONFLICT (rank_date, rank_hour, category_name, rank_position)
                            DO UPDATE SET goods_no = EXCLUDED.goods_no, goods_name = EXCLUDED.goods_name
                        """, (rank_hour, cat_name, rank, item['goods_no'], item['name']))

                    # product_rankings: 자사 상품만
                    hits = [(i + 1, item) for i, item in enumerate(ranking) if item['goods_no'] in our_goods]
                    for rank, item in hits:
                        cur.execute("""
                            INSERT INTO product_rankings (rank_date, goods_no, category_name, rank_position)
                            VALUES (CURRENT_DATE, %s, %s, %s)
                            ON CONFLICT (rank_date, goods_no, category_name)
                            DO UPDATE SET rank_position = EXCLUDED.rank_position
                        """, (item['goods_no'], cat_name, rank))

                total_saved += len(ranking)
                print(f"  전체 {len(ranking)}개 저장", end='')
                if hits:
                    print(f"  |  자사: " + ", ".join(f"{r}위 {it['goods_no']}" for r, it in hits))
                else:
                    print(f"  (자사 Top {ROWS_PER_PAGE} 없음)")

            except Exception as e:
                print(f"  오류: {e}")

            time.sleep(random.uniform(4, 8))

        print(f"\n=== 완료 - {total_saved}개 시장 순위 저장 ===")
        revalidate_vercel()

    finally:
        conn.close()


if __name__ == "__main__":
    run()
