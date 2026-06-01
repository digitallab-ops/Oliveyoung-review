import os
import sys
import re
import time
import random
import urllib.request
import winreg
from datetime import datetime

import undetected_chromedriver as uc
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from db.coupang_schema import get_conn, init_db

BRAND_QUERY = os.getenv('COUPANG_BRAND', '셀퓨전씨')
SEARCH_URL = 'https://www.coupang.com/np/search'


def _chrome_major_version() -> int:
    try:
        for hive, path in [
            (winreg.HKEY_CURRENT_USER, r'SOFTWARE\Google\Chrome\BLBeacon'),
            (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Google\Chrome\BLBeacon'),
        ]:
            try:
                with winreg.OpenKey(hive, path) as k:
                    return int(winreg.QueryValueEx(k, 'version')[0].split('.')[0])
            except OSError:
                continue
    except Exception:
        pass
    return 148


def _init_driver() -> uc.Chrome:
    options = uc.ChromeOptions()
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-gpu')
    options.add_argument('--lang=ko-KR')
    options.add_argument('--window-size=1280,800')
    options.set_capability('goog:loggingPrefs', {'performance': 'ALL'})

    driver = uc.Chrome(options=options, version_main=_chrome_major_version())
    driver.get('https://www.coupang.com/')
    time.sleep(4)
    return driver


def _quit_driver(driver: uc.Chrome):
    try:
        driver.quit()
    except Exception:
        pass


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


def _load_page(driver: uc.Chrome, url: str, retries: int = 3) -> str:
    """페이지 로드 + RET9999 오류 자동 재시도"""
    for attempt in range(retries):
        driver.get(url)
        time.sleep(random.uniform(5, 8))
        content = driver.page_source
        if 'RET9999' in content:
            wait = 30 * (attempt + 1)
            print(f'    RET9999 오류 — {wait}초 대기 후 재시도 ({attempt+1}/{retries})')
            time.sleep(wait)
            continue
        return content
    return driver.page_source


def fetch_brand_products(driver: uc.Chrome) -> list[dict]:
    """브랜드 검색으로 상품 목록 수집 — JSON-LD structured data 파싱"""
    import json
    products = {}

    for page in range(1, 4):
        url = (f'{SEARCH_URL}?q={BRAND_QUERY}&channel=relate'
               f'&sorter=scoreDesc&listSize=36&page={page}')
        content = _load_page(driver, url)
        soup = BeautifulSoup(content, 'html.parser')

        ld_tag = soup.find('script', type='application/ld+json')
        if not ld_tag:
            print(f'  페이지 {page}: JSON-LD 없음 — 종료')
            break

        try:
            data = json.loads(ld_tag.string)
            items = data.get('mainEntity', {}).get('itemListElement', [])
        except Exception:
            items = []

        if not items:
            print(f'  페이지 {page}: 상품 없음 — 종료')
            break

        for item_el in items:
            item = item_el.get('item', {})
            item_url = item.get('url', '')
            m = re.search(r'/vp/products/(\d+)', item_url)
            if not m:
                continue
            product_id = m.group(1)
            if product_id in products:
                continue

            vi_m = re.search(r'vendorItemId=(\d+)', item_url)
            vendor_item_id = vi_m.group(1) if vi_m else None

            rating_info = item.get('aggregateRating', {})
            products[product_id] = {
                'product_id': product_id,
                'product_name': item.get('name', ''),
                'vendor_item_id': vendor_item_id,
                'rating': rating_info.get('ratingValue'),
                'review_count': rating_info.get('reviewCount'),
            }

        print(f'  검색 페이지 {page}: {len(items)}개 항목, 누적 {len(products)}개 상품')
        if len(items) < 10:
            break
        time.sleep(random.uniform(2, 4))

    return list(products.values())


def fetch_reviews(driver: uc.Chrome, product_id: str, existing_ids: set) -> list[dict]:
    """상품 리뷰 수집 (브라우저 fetch API 사용) — 최대 20페이지"""
    reviews = []
    size = 20

    for page in range(1, 21):
        api_url = (f'/next-api/review?productId={product_id}'
                   f'&page={page}&size={size}'
                   f'&sortBy=ORDER_SCORE_ASC&ratingSummary=true&ratings=&market=')
        try:
            result = driver.execute_async_script('''
                var cb = arguments[arguments.length - 1];
                fetch(arguments[0], { headers: { "Accept": "application/json" } })
                    .then(function(r) { return r.json(); })
                    .then(function(d) { cb(d); })
                    .catch(function(e) { cb({ error: e.toString() }); });
            ''', api_url)

            if result.get('error'):
                print(f'    리뷰 페이지 {page} API 오류: {result["error"]}')
                break

            paging = result.get('rData', {}).get('paging', {})
            contents = paging.get('contents', [])

            if not contents:
                break

            found_existing = False
            for rv in contents:
                review_id = rv.get('reviewId')
                if not review_id:
                    continue
                if review_id in existing_ids:
                    found_existing = True
                    continue

                ts = rv.get('reviewAt') or rv.get('createdAt')
                created_at = (datetime.fromtimestamp(ts / 1000).strftime('%Y-%m-%d')
                              if ts else '')

                reviews.append({
                    'review_id': review_id,
                    'product_id': product_id,
                    'content': rv.get('content', ''),
                    'rating': rv.get('rating'),
                    'helpful_count': rv.get('helpfulTrueCount', 0) or 0,
                    'purchased_option': rv.get('itemName', ''),
                    'created_at': created_at,
                })
                existing_ids.add(review_id)

            total = paging.get('totalCount', 0)
            total_pages = -(-total // size)  # ceiling division
            if found_existing or page >= total_pages:
                break

            time.sleep(random.uniform(0.5, 1.5))

        except Exception as e:
            print(f'    리뷰 페이지 {page} 오류: {e}')
            break

    return reviews


def run():
    print(f"=== 쿠팡 리뷰 수집 시작 ({datetime.now().strftime('%Y-%m-%d %H:%M')}) ===\n")

    conn = get_conn()
    conn.autocommit = True
    driver = None

    try:
        init_db(conn=conn)

        with conn.cursor() as cur:
            cur.execute('SELECT review_id FROM reviews')
            existing_ids = {r['review_id'] for r in cur.fetchall()}
        print(f"기존 리뷰 {len(existing_ids)}건\n")

        print(f"[상품 발견] '{BRAND_QUERY}' 검색 중...")
        driver = _init_driver()
        products = fetch_brand_products(driver)
        print(f"총 {len(products)}개 상품 발견\n")

        if not products:
            print("상품을 찾지 못했습니다. 종료.")
            return

        with conn.cursor() as cur:
            for p in products:
                cur.execute("""
                    INSERT INTO products (product_id, product_name, vendor_item_id, rating, review_count, first_seen, last_seen)
                    VALUES (%s, %s, %s, %s, %s, CURRENT_DATE, CURRENT_DATE)
                    ON CONFLICT (product_id) DO UPDATE SET
                        product_name   = EXCLUDED.product_name,
                        vendor_item_id = COALESCE(EXCLUDED.vendor_item_id, products.vendor_item_id),
                        rating         = COALESCE(EXCLUDED.rating, products.rating),
                        review_count   = COALESCE(EXCLUDED.review_count, products.review_count),
                        last_seen      = CURRENT_DATE
                """, (p['product_id'], p['product_name'], p['vendor_item_id'],
                      p['rating'], p['review_count']))

        total_new = 0
        for p in products:
            print(f"[{p['product_name'][:30]}] 리뷰 수집 중...")
            new_reviews = fetch_reviews(driver, p['product_id'], existing_ids)

            if new_reviews:
                with conn.cursor() as cur:
                    for rv in new_reviews:
                        cur.execute("""
                            INSERT INTO reviews
                                (review_id, product_id, content, rating, helpful_count, purchased_option, created_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (review_id) DO NOTHING
                        """, (rv['review_id'], rv['product_id'], rv['content'],
                              rv['rating'], rv['helpful_count'], rv['purchased_option'],
                              rv['created_at']))
                total_new += len(new_reviews)
                print(f"  신규 {len(new_reviews)}건 저장")
            else:
                print(f"  신규 없음")

            time.sleep(random.uniform(1, 2))

        print(f"\n=== 완료 — 신규 리뷰 {total_new}건 저장 ===")
        revalidate_vercel()

    finally:
        if driver:
            _quit_driver(driver)
        conn.close()


if __name__ == '__main__':
    run()
