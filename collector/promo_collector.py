"""
올리브영 프로모션 수집기 — 오늘의 특가(하루특가)
실행: python collector/promo_collector.py

오특 AJAX 엔드포인트:
  GET /store/main/getHotdealPagingListAjax.do
  params: date=YYYYMMDD, pageIdx=1,2,..., fltCondition=02, fltDispCatNo=, prdSort=rank
  응답: HTML (세션 쿠키 필요 — 메인 페이지 방문 후 AJAX 요청)
"""
import os
import sys
import re
import time
from datetime import date

try:
    from curl_cffi import requests as cf_requests
    _USE_CFFI = True
except ImportError:
    import requests as cf_requests
    _USE_CFFI = False

from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from db.schema import get_conn, init_db

BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9',
}

HOTDEAL_MAIN_URL = 'https://www.oliveyoung.co.kr/store/main/getHotdealList.do'
HOTDEAL_AJAX_URL = 'https://www.oliveyoung.co.kr/store/main/getHotdealPagingListAjax.do'

HOTDEAL_CONDITIONS = [
    ('today_deal', '오늘의 특가', '02'),
]

MAX_PAGES = 15


def make_session():
    if _USE_CFFI:
        session = cf_requests.Session(impersonate='chrome120')
    else:
        session = cf_requests.Session()
    return session


def warmup_session(session) -> bool:
    """메인 페이지 방문해서 Cloudflare 세션 쿠키 취득"""
    try:
        r = session.get(
            HOTDEAL_MAIN_URL,
            headers={**BASE_HEADERS, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9'},
            timeout=20,
        )
        return r.status_code == 200
    except Exception as e:
        print(f'  세션 워밍업 실패: {e}')
        return False


def fetch_hotdeal_page(session, today_str: str, flt_condition: str, page_idx: int) -> list[dict]:
    """오특 AJAX 단일 페이지 → 상품 리스트 반환"""
    params = {
        'date': today_str,
        'pageIdx': page_idx,
        'fltCondition': flt_condition,
        'fltDispCatNo': '',
        'prdSort': 'rank',
    }
    headers = {
        **BASE_HEADERS,
        'Referer': HOTDEAL_MAIN_URL,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*',
    }
    r = session.get(HOTDEAL_AJAX_URL, params=params, headers=headers, timeout=15)
    if r.status_code != 200:
        print(f'    페이지 {page_idx} HTTP {r.status_code}')
        return []

    soup = BeautifulSoup(r.text, 'html.parser')
    seen = set()
    results = []

    # data-impression="GOODS_NO^카테고리^순위" 형태로 goods_no 추출
    for li in soup.select('li[data-impression]'):
        imp = li.get('data-impression', '')
        parts = imp.split('^')
        goods_no = parts[0].strip() if parts else ''
        if not goods_no or not re.match(r'^[A-Z0-9]+$', goods_no) or goods_no in seen:
            continue
        seen.add(goods_no)

        # 상품명: img alt 또는 텍스트
        name_el = li.select_one('.tx_name, .prd_name, img.pic-thumb')
        if name_el and name_el.name == 'img':
            name = name_el.get('alt', '')
        elif name_el:
            name = name_el.get_text(strip=True)
        else:
            link = li.select_one('a[href*="goodsNo"]')
            name = link.get('data-ref-goodsnm', '') if link else ''

        results.append({'goods_no': goods_no, 'name': name})

    return results


def fetch_all_hotdeal(session, today_str: str, flt_condition: str) -> list[dict]:
    all_items = []
    for page in range(1, MAX_PAGES + 1):
        items = fetch_hotdeal_page(session, today_str, flt_condition, page)
        if not items:
            break
        all_items.extend(items)
        print(f'    p{page}: {len(items)}개')
        time.sleep(1)
    return all_items


def run():
    today = date.today()
    today_str = today.strftime('%Y%m%d')
    print(f'=== 올리브영 프로모션 수집 ({today}) ===\n')

    session = make_session()

    print('세션 초기화 중...')
    ok = warmup_session(session)
    if not ok:
        print('세션 워밍업 실패 — 수집 중단')
        return
    print('세션 OK\n')
    time.sleep(2)

    conn = get_conn()
    conn.autocommit = True

    try:
        init_db(conn=conn)

        with conn.cursor() as cur:
            cur.execute('SELECT goods_no FROM products')
            our_goods = {r['goods_no'] for r in cur.fetchall()}

        print(f'자사 상품 {len(our_goods)}개 기준\n')

        for ptype, label, flt_cond in HOTDEAL_CONDITIONS:
            print(f'[{label}] 수집 중 (fltCondition={flt_cond})...')

            try:
                items = fetch_all_hotdeal(session, today_str, flt_cond)
                print(f'  총 {len(items)}개 상품')

                if not items:
                    print('  경고: 상품 없음')
                    continue

                with conn.cursor() as cur:
                    cur.execute(
                        'DELETE FROM promo_items WHERE promo_type = %s AND collected_at = CURRENT_DATE',
                        (ptype,)
                    )
                    for rank, item in enumerate(items, 1):
                        is_ours = item['goods_no'] in our_goods
                        cur.execute("""
                            INSERT INTO promo_items
                                (promo_type, collected_at, rank_position, goods_no, goods_name, is_ours)
                            VALUES (%s, CURRENT_DATE, %s, %s, %s, %s)
                            ON CONFLICT (promo_type, collected_at, goods_no) DO UPDATE SET
                                rank_position = EXCLUDED.rank_position,
                                goods_name    = EXCLUDED.goods_name,
                                is_ours       = EXCLUDED.is_ours
                        """, (ptype, rank, item['goods_no'], item['name'], is_ours))

                our_hits = [(i + 1, it) for i, it in enumerate(items) if it['goods_no'] in our_goods]
                if our_hits:
                    print('  자사 입점: ' + ', '.join(f"{r}위 {it['name']}" for r, it in our_hits))
                else:
                    print('  자사 미입점 (오늘)')

            except Exception as e:
                print(f'  오류: {e}')

            time.sleep(2)

        print('\n=== 완료 ===')

    finally:
        conn.close()


if __name__ == '__main__':
    run()
