import json
import os
import sys
import re
import time
import random
import urllib.request
import winreg
from datetime import date, datetime, timezone

import undetected_chromedriver as uc
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from db.amazon_schema import get_conn, init_db

OUR_BRAND = os.getenv('AMAZON_BRAND', 'CellFusionC')
COMPETITORS_RAW = os.getenv('AMAZON_COMPETITORS', 'COSRX,Anua,Beauty of Joseon,TIRTIR,round lab,isntree')
PROFILE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'chrome_profile_amazon')
COMPETITORS = [b.strip() for b in COMPETITORS_RAW.split(',') if b.strip()]

CATEGORIES = [
    ('Korean Skin Care',    'https://www.amazon.com/gp/bestsellers/beauty/10048943011'),
    ('Sunscreen & Tanning', 'https://www.amazon.com/gp/bestsellers/beauty/11062621'),
    ('Face Masks',          'https://www.amazon.com/gp/bestsellers/beauty/11060451'),
]

SEARCH_URL = 'https://www.amazon.com/s'


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
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-gpu')
    options.add_argument('--lang=en-US,en')
    options.add_argument('--window-size=1280,800')
    use_profile = os.path.isdir(PROFILE_DIR)
    if not use_profile:
        print('  경고: 저장된 프로필 없음 — amazon_login_setup.py 먼저 실행 필요')

    driver = uc.Chrome(
        options=options,
        version_main=_chrome_major_version(),
        user_data_dir=PROFILE_DIR if use_profile else None,
    )
    if use_profile:
        print('  Chrome 프로필 로드 (로그인 유지)')
    driver.get('https://www.amazon.com/')
    time.sleep(5)
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
    # 시크릿 없이 부르면 라우트가 401 로 거절한다. pipeline.py 만 보내고 있어서
    # 나머지 수집기의 캐시 무효화가 전부 실패하고 있었다(오늘 하루 401 16건).
    # 매시간 도는 rank_collector 가 여기 포함돼 AI 요약 캐시도 안 채워졌다.
    secret = os.getenv('REVALIDATE_SECRET', '')
    payload = json.dumps({'secret': secret}).encode() if secret else b'{}'
    try:
        req = urllib.request.Request(
            f'{app_url}/api/revalidate',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        # 라우트가 캐시 비우기 뒤에 AI 3개를 돌린다(maxDuration 60초).
        # 10초로 두면 실제로는 성공했는데 매번 timeout 으로 찍혀
        # 진짜 장애와 구분이 안 된다. 서버 상한에 맞춰 70초로 둔다.
        urllib.request.urlopen(req, timeout=70)
        print('  Vercel 캐시 초기화 완료')
    except Exception as e:
        print(f'  Vercel 캐시 초기화 실패: {e}')


def _load_page(driver: uc.Chrome, url: str, retries: int = 3) -> str:
    for attempt in range(retries):
        driver.get(url)
        time.sleep(random.uniform(5, 8))
        content = driver.page_source
        if 'api-services-support@amazon.com' in content or 'Type the characters you see' in content:
            wait = 60 * (attempt + 1)
            print(f'    CAPTCHA 감지 — {wait}초 대기 후 재시도 ({attempt+1}/{retries})')
            time.sleep(wait)
            continue
        return content
    return driver.page_source


def _extract_brand(title: str, brand_el_text: str) -> str:
    if brand_el_text:
        return brand_el_text.strip()
    return ''


def fetch_category_ranking(driver: uc.Chrome, cat_name: str, cat_url: str,
                           rank_date: date, rank_hour: int) -> list[dict]:
    """카테고리 베스트셀러 Top 50 수집"""
    results = []
    seen = set()

    for page in range(1, 3):
        url = f'{cat_url}?pg={page}'
        try:
            content = _load_page(driver, url)
            soup = BeautifulSoup(content, 'html.parser')

            items = soup.select('.zg-grid-general-faceout, [class*="zg-item"]')
            if not items:
                # alternate selector for new BSR layout
                items = soup.select('li.zg-item-immersion')
            if not items:
                print(f'    [{cat_name}] 페이지 {page}: 항목 없음')
                break

            for item in items:
                if len(results) >= 50:
                    break

                asin = ''
                link = item.select_one('a[href*="/dp/"]')
                if link:
                    m = re.search(r'/dp/([A-Z0-9]{10})', link.get('href', ''))
                    if m:
                        asin = m.group(1)
                if not asin or asin in seen:
                    continue
                seen.add(asin)

                title_el = item.select_one('._cDEzb_p13n-sc-css-line-clamp-3_g3dy1, '
                                           '.p13n-sc-truncate, a span')
                product_title = title_el.get_text(strip=True) if title_el else ''

                brand_el = item.select_one('.a-size-small.a-color-base')
                brand = brand_el.get_text(strip=True) if brand_el else ''

                is_ours = OUR_BRAND.lower() in (product_title + brand).lower()

                results.append({
                    'rank_date': rank_date,
                    'rank_hour': rank_hour,
                    'category_name': cat_name,
                    'rank_position': len(results) + 1,
                    'asin': asin,
                    'product_title': product_title,
                    'brand': brand,
                    'is_ours': is_ours,
                })

            if len(results) >= 50 or len(items) < 5:
                break

            time.sleep(random.uniform(2, 4))

        except Exception as e:
            print(f'  카테고리 [{cat_name}] 페이지 {page} 오류: {e}')
            break

    return results[:50]


def fetch_competitor_products(driver: uc.Chrome, brand: str) -> list[dict]:
    """경쟁사 브랜드 검색으로 상품 목록 수집 (최대 2페이지)"""
    products = {}

    for page in range(1, 3):
        url = f'{SEARCH_URL}?k={brand.replace(" ", "+")}&page={page}'
        try:
            content = _load_page(driver, url)
            soup = BeautifulSoup(content, 'html.parser')
            items = soup.select('[data-component-type="s-search-result"]')

            if not items:
                break

            for item in items:
                asin = item.get('data-asin', '')
                if not asin or asin in products:
                    continue

                title_el = item.select_one('h2 span')
                title = title_el.get_text(strip=True) if title_el else ''

                rating_el = item.select_one('i[class*="a-star"] span.a-offscreen')
                rating_text = rating_el.get_text(strip=True) if rating_el else ''
                try:
                    rating = float(rating_text.split()[0].replace(',', '.'))
                except Exception:
                    rating = None

                review_count_el = item.select_one('.a-size-base[aria-label]')
                review_count = None
                if review_count_el:
                    rc_text = review_count_el.get('aria-label', '').replace(',', '')
                    m = re.search(r'(\d+)', rc_text)
                    if m:
                        review_count = int(m.group(1))

                products[asin] = {
                    'asin': asin,
                    'title': title,
                    'brand': brand,
                    'rating': rating,
                    'review_count': review_count,
                }

            if len(items) < 5:
                break
            time.sleep(random.uniform(2, 4))

        except Exception as e:
            print(f'  경쟁사 [{brand}] 페이지 {page} 오류: {e}')
            break

    return list(products.values())


def fetch_recent_reviews(driver: uc.Chrome, asin: str, existing_ids: set,
                         max_pages: int = 3) -> list[dict]:
    """Navigate to product page then use same-origin AJAX to fetch reviews — no login required."""
    reviews = []
    try:
        driver.get(f'https://www.amazon.com/dp/{asin}')
        time.sleep(random.uniform(3, 5))
        if '/ap/signin' in driver.current_url:
            return reviews
    except Exception:
        return reviews

    for page in range(1, max_pages + 1):
        ajax_url = (
            f'/hz/reviews-render/ajax/reviews/get/'
            f'?sortBy=recent&reviewerType=all_reviews'
            f'&formatType=current_format&pageNumber={page}'
            f'&pageSize=10&asin={asin}&language=en_US'
        )
        try:
            result = driver.execute_async_script('''
                var cb = arguments[arguments.length - 1];
                fetch(arguments[0], {
                    headers: {
                        "Accept": "text/html,*/*",
                        "x-requested-with": "XMLHttpRequest"
                    },
                    credentials: "include"
                })
                .then(function(r) { return r.text(); })
                .then(function(d) { cb({html: d, ok: true}); })
                .catch(function(e) { cb({error: e.toString(), ok: false}); });
            ''', ajax_url)

            if not result or not result.get('ok'):
                break

            soup = BeautifulSoup(result.get('html', ''), 'html.parser')
            items = soup.select('[data-hook="review"]')
            if not items:
                break

            found_existing = False
            for item in items:
                review_id = item.get('id', '')
                if not review_id:
                    continue
                if review_id in existing_ids:
                    found_existing = True
                    continue

                title_el = item.select_one('[data-hook="review-title"] span:not(.a-icon-alt)')
                title = title_el.get_text(strip=True) if title_el else ''

                content_el = item.select_one('[data-hook="review-body"] span')
                content_text = content_el.get_text(strip=True) if content_el else ''

                rating_el = item.select_one('i[data-hook="review-star-rating"] span.a-offscreen')
                rating_text = rating_el.get_text(strip=True) if rating_el else ''
                try:
                    rating = int(float(rating_text.split()[0].replace(',', '.')))
                except Exception:
                    rating = None

                helpful_el = item.select_one('[data-hook="helpful-vote-statement"]')
                helpful_count = 0
                if helpful_el:
                    m = re.search(r'(\d+)', helpful_el.get_text())
                    if m:
                        helpful_count = int(m.group(1))

                verified_el = item.select_one('[data-hook="avp-badge"]')
                verified_purchase = verified_el is not None

                date_el = item.select_one('[data-hook="review-date"]')
                created_at = ''
                location = ''
                if date_el:
                    date_text = date_el.get_text(strip=True)
                    loc_m = re.search(r'Reviewed in (.+?) on', date_text)
                    if loc_m:
                        location = loc_m.group(1).strip()
                    date_m = re.search(r'on (.+)$', date_text)
                    if date_m:
                        created_at = date_m.group(1).strip()

                reviews.append({
                    'review_id': review_id,
                    'asin': asin,
                    'title': title,
                    'content': content_text,
                    'rating': rating,
                    'helpful_count': helpful_count,
                    'verified_purchase': verified_purchase,
                    'reviewer_location': location,
                    'created_at': created_at,
                })
                existing_ids.add(review_id)

            if found_existing:
                break

            time.sleep(random.uniform(1, 2))

        except Exception as e:
            print(f'    Review page {page} error: {e}')
            break

    return reviews


def run():
    rank_hour = datetime.now(timezone.utc).hour
    today = date.today()
    print(f"=== Amazon 순위/경쟁사 수집 ({today} UTC {rank_hour:02d}시) ===\n")

    conn = get_conn()
    conn.autocommit = True
    driver = None

    try:
        init_db(conn=conn)
        driver = _init_driver()

        # ── 카테고리 베스트셀러 ────────────────────────
        print("[ 카테고리 베스트셀러 수집 ]")
        for cat_name, cat_url in CATEGORIES:
            print(f"  [{cat_name}] 수집 중...")
            ranking = fetch_category_ranking(driver, cat_name, cat_url, today, rank_hour)
            if not ranking:
                print(f"    수집 실패")
                time.sleep(random.uniform(2, 4))
                continue

            with conn.cursor() as cur:
                for item in ranking:
                    cur.execute("""
                        INSERT INTO category_rankings
                            (rank_date, rank_hour, category_name, rank_position,
                             asin, product_title, brand, is_ours)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (rank_date, rank_hour, category_name, rank_position)
                        DO UPDATE SET asin = EXCLUDED.asin,
                                      product_title = EXCLUDED.product_title,
                                      brand = EXCLUDED.brand,
                                      is_ours = EXCLUDED.is_ours
                    """, (item['rank_date'], item['rank_hour'], item['category_name'],
                          item['rank_position'], item['asin'], item['product_title'],
                          item['brand'], item['is_ours']))

            ours = [r for r in ranking if r['is_ours']]
            print(f"    {len(ranking)}개 저장 (자사: {len(ours)}개)")
            time.sleep(random.uniform(2, 4))

        # ── 경쟁사 상품 + 리뷰 ────────────────────────
        print("\n[ 경쟁사 수집 ]")
        with conn.cursor() as cur:
            cur.execute('SELECT review_id FROM reviews')
            existing_ids = {r['review_id'] for r in cur.fetchall()}

        for brand in COMPETITORS:
            print(f"  [{brand}] 상품 검색 중...")
            comp_products = fetch_competitor_products(driver, brand)
            if not comp_products:
                print(f"    상품 없음")
                time.sleep(random.uniform(2, 4))
                continue

            with conn.cursor() as cur:
                for p in comp_products:
                    cur.execute("""
                        INSERT INTO products (asin, title, brand, is_ours, rating, review_count, first_seen, last_seen)
                        VALUES (%s, %s, %s, FALSE, %s, %s, CURRENT_DATE, CURRENT_DATE)
                        ON CONFLICT (asin) DO UPDATE SET
                            title        = EXCLUDED.title,
                            rating       = COALESCE(EXCLUDED.rating, products.rating),
                            review_count = COALESCE(EXCLUDED.review_count, products.review_count),
                            last_seen    = CURRENT_DATE
                    """, (p['asin'], p['title'], p['brand'], p['rating'], p['review_count']))

            print(f"    {len(comp_products)}개 상품 저장")
            total_new = 0

            for p in comp_products[:5]:  # 경쟁사는 상위 5개 상품만 리뷰 수집
                new_reviews = fetch_recent_reviews(driver, p['asin'], existing_ids)
                if new_reviews:
                    with conn.cursor() as cur:
                        for rv in new_reviews:
                            cur.execute("""
                                INSERT INTO reviews
                                    (review_id, asin, title, content, rating, helpful_count,
                                     verified_purchase, reviewer_location, created_at)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (review_id) DO NOTHING
                            """, (rv['review_id'], rv['asin'], rv['title'], rv['content'],
                                  rv['rating'], rv['helpful_count'], rv['verified_purchase'],
                                  rv['reviewer_location'], rv['created_at']))
                    total_new += len(new_reviews)
                time.sleep(random.uniform(1, 3))

            print(f"    신규 리뷰 {total_new}건")
            time.sleep(random.uniform(2, 4))

        print("\n=== 완료 ===")
        revalidate_vercel()

    finally:
        if driver:
            _quit_driver(driver)
        conn.close()


if __name__ == '__main__':
    run()
