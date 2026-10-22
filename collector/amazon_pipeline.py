import json
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

from db.amazon_schema import get_conn, init_db

BRAND_QUERY = os.getenv('AMAZON_BRAND', 'CellFusionC')
SEARCH_URL = 'https://www.amazon.com/s'
PROFILE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'chrome_profile_amazon')


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
        print('  Vercel cache revalidated')
    except Exception as e:
        print(f'  Vercel revalidate failed: {e}')


def _load_page(driver: uc.Chrome, url: str, retries: int = 3) -> str:
    for attempt in range(retries):
        driver.get(url)
        time.sleep(random.uniform(5, 8))
        content = driver.page_source
        if 'api-services-support@amazon.com' in content or 'Type the characters you see' in content:
            wait = 60 * (attempt + 1)
            print(f'    CAPTCHA detected — waiting {wait}s ({attempt+1}/{retries})')
            time.sleep(wait)
            continue
        return content
    return driver.page_source


def _extract_asin(url_or_href: str) -> str | None:
    m = re.search(r'/dp/([A-Z0-9]{10})', url_or_href)
    return m.group(1) if m else None


def fetch_brand_products(driver: uc.Chrome) -> list[dict]:
    products = {}

    for page in range(1, 5):
        url = f'{SEARCH_URL}?k={BRAND_QUERY}&page={page}'
        content = _load_page(driver, url)
        soup = BeautifulSoup(content, 'html.parser')

        items = soup.select('[data-component-type="s-search-result"]')
        if not items:
            print(f'  Page {page}: no results — stopping')
            break

        for item in items:
            asin = item.get('data-asin', '')
            if not asin or asin in products:
                continue

            title_el = item.select_one('h2 span, h2 a span')
            title = title_el.get_text(strip=True) if title_el else ''

            brand_el = item.select_one('.a-row .a-size-base.a-color-secondary')
            brand = brand_el.get_text(strip=True) if brand_el else BRAND_QUERY

            rating_el = item.select_one('i[class*="a-star"] span.a-offscreen')
            rating_text = rating_el.get_text(strip=True) if rating_el else ''
            try:
                rating = float(rating_text.split()[0].replace(',', '.'))
            except Exception:
                rating = None

            review_count_el = item.select_one('[aria-label*="ratings"], .a-size-base[aria-label]')
            review_count = None
            if review_count_el:
                rc_text = review_count_el.get('aria-label', '').replace(',', '').strip()
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

        print(f'  Search page {page}: {len(items)} items, total {len(products)} products')
        if len(items) < 5:
            break
        time.sleep(random.uniform(3, 5))

    return list(products.values())


def fetch_reviews(driver: uc.Chrome, asin: str, existing_ids: set) -> list[dict]:
    """Navigate to product page then use same-origin AJAX to fetch reviews — no login required."""
    reviews = []
    try:
        driver.get(f'https://www.amazon.com/dp/{asin}')
        time.sleep(random.uniform(4, 6))
        if '/ap/signin' in driver.current_url:
            print(f'    Redirected to sign-in — skipping')
            return reviews
    except Exception as e:
        print(f'    Product page load error: {e}')
        return reviews

    for page in range(1, 11):
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
    print(f"=== Amazon review collection start ({datetime.now().strftime('%Y-%m-%d %H:%M')}) ===\n")

    conn = get_conn()
    conn.autocommit = True
    driver = None

    try:
        init_db(conn=conn)

        with conn.cursor() as cur:
            cur.execute('SELECT review_id FROM reviews')
            existing_ids = {r['review_id'] for r in cur.fetchall()}
        print(f"Existing reviews: {len(existing_ids)}\n")

        print(f"[Product discovery] Searching '{BRAND_QUERY}'...")
        driver = _init_driver()
        products = fetch_brand_products(driver)
        print(f"Found {len(products)} products\n")

        if not products:
            print("No products found. Exiting.")
            return

        with conn.cursor() as cur:
            for p in products:
                cur.execute("""
                    INSERT INTO products (asin, title, brand, is_ours, rating, review_count, first_seen, last_seen)
                    VALUES (%s, %s, %s, TRUE, %s, %s, CURRENT_DATE, CURRENT_DATE)
                    ON CONFLICT (asin) DO UPDATE SET
                        title        = EXCLUDED.title,
                        brand        = EXCLUDED.brand,
                        rating       = COALESCE(EXCLUDED.rating, products.rating),
                        review_count = COALESCE(EXCLUDED.review_count, products.review_count),
                        last_seen    = CURRENT_DATE
                """, (p['asin'], p['title'], p['brand'], p['rating'], p['review_count']))

        total_new = 0
        for p in products:
            safe_title = p['title'][:40].encode('ascii', 'replace').decode('ascii')
            print(f"[{safe_title}] collecting reviews...")
            new_reviews = fetch_reviews(driver, p['asin'], existing_ids)

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
                print(f"  Saved {len(new_reviews)} new reviews")
            else:
                print(f"  No new reviews")

            time.sleep(random.uniform(2, 4))

        print(f"\n=== Done — {total_new} new reviews saved ===")
        revalidate_vercel()

    finally:
        if driver:
            _quit_driver(driver)
        conn.close()


if __name__ == '__main__':
    run()
