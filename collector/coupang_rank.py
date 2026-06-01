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

from db.coupang_schema import get_conn, init_db

BRAND_QUERY = os.getenv('COUPANG_BRAND', '셀퓨전씨')

SEARCH_KEYWORDS = [
    '셀퓨전씨',
    '선크림',
    '자외선차단제',
    '더모코스메틱',
    '마스크팩 셀퓨전씨',
]

CATEGORIES = [
    ('선케어/태닝', '176563'),
    ('스킨케어',   '176530'),
    ('마스크/팩',  '176554'),
]

SEARCH_URL   = 'https://www.coupang.com/np/search'
CATEGORY_URL = 'https://www.coupang.com/np/categories/{cat_id}'


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


def _extract_product_id(href: str) -> str | None:
    m = re.search(r'/vp/products/(\d+)', href)
    return m.group(1) if m else None


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


def fetch_search_ranking(driver: uc.Chrome, keyword: str) -> list[dict]:
    """키워드 검색 결과에서 자사 상품 위치 파악 (유기순위 상위 50개)"""
    results = []
    organic_rank = 0

    for page in range(1, 3):
        url = (f'{SEARCH_URL}?q={keyword}&channel=relate'
               f'&sorter=scoreDesc&listSize=36&page={page}')
        try:
            content = _load_page(driver, url)
            soup = BeautifulSoup(content, 'html.parser')
            items = soup.select('li[data-id]')
            if not items:
                break

            for item in items:
                link = item.find('a', href=re.compile(r'/vp/products/'))
                if not link:
                    continue
                product_id = _extract_product_id(link.get('href', ''))
                if not product_id:
                    continue

                is_ad = '광고' in item.get_text()
                if not is_ad:
                    organic_rank += 1

                name_el = item.select_one('[class*="productNameV2"], [class*="name"]')
                product_name = name_el.get_text(strip=True) if name_el else ''

                if BRAND_QUERY in product_name:
                    results.append({
                        'keyword': keyword,
                        'product_id': product_id,
                        'product_name': product_name,
                        'rank_position': organic_rank if not is_ad else 0,
                        'is_ad': is_ad,
                    })

                if organic_rank >= 50:
                    break

            if organic_rank >= 50 or len(items) < 10:
                break

            time.sleep(random.uniform(2, 3))

        except Exception as e:
            print(f'  검색 [{keyword}] 페이지 {page} 오류: {e}')
            break

    return results


def fetch_category_ranking(driver: uc.Chrome, cat_name: str, cat_id: str) -> list[dict]:
    """카테고리 베스트 Top 100 수집"""
    results = []
    seen = set()

    for page in range(1, 4):
        url = (f'{CATEGORY_URL.format(cat_id=cat_id)}'
               f'?listSize=36&page={page}&sorter=bestAsc')
        try:
            content = _load_page(driver, url)

            # Verify page didn't redirect to homepage
            if 'categories' not in driver.current_url:
                print(f'    [{cat_name}] 페이지 {page}: 리다이렉트 감지 — 스킵')
                break

            soup = BeautifulSoup(content, 'html.parser')
            items = soup.select('li[data-id]')
            if not items:
                break

            for item in items:
                if len(results) >= 100:
                    break
                link = item.find('a', href=re.compile(r'/vp/products/'))
                if not link:
                    continue
                product_id = _extract_product_id(link.get('href', ''))
                if not product_id or product_id in seen:
                    continue
                seen.add(product_id)

                name_el = item.select_one('[class*="productNameV2"], [class*="name"]')
                product_name = name_el.get_text(strip=True) if name_el else ''

                results.append({
                    'category_name': cat_name,
                    'rank_position': len(results) + 1,
                    'product_id': product_id,
                    'product_name': product_name,
                })

            if len(results) >= 100 or len(items) < 10:
                break

            time.sleep(random.uniform(2, 4))

        except Exception as e:
            print(f'  카테고리 [{cat_name}] 페이지 {page} 오류: {e}')
            break

    return results[:100]


def _is_cat_unchanged(cur, cat_name: str, ranking: list[dict]) -> bool:
    cur.execute("""
        SELECT product_id FROM category_rankings
        WHERE category_name = %s
          AND (rank_date, rank_hour) = (
              SELECT rank_date, rank_hour FROM category_rankings
              WHERE category_name = %s
              ORDER BY rank_date DESC, rank_hour DESC
              LIMIT 1
          )
        ORDER BY rank_position
    """, (cat_name, cat_name))
    prev = [r['product_id'] for r in cur.fetchall()]
    curr = [item['product_id'] for item in ranking]
    return prev == curr


def run():
    rank_hour = datetime.now(timezone.utc).hour
    today = date.today()
    print(f"=== 쿠팡 순위 수집 ({today} UTC {rank_hour:02d}시) ===\n")

    conn = get_conn()
    conn.autocommit = True
    driver = None

    try:
        init_db(conn=conn)
        driver = _init_driver()

        # ── 검색 순위 ──────────────────────────────
        print("[ 검색 순위 수집 ]")
        for keyword in SEARCH_KEYWORDS:
            print(f"  키워드: {keyword}")
            hits = fetch_search_ranking(driver, keyword)
            if hits:
                with conn.cursor() as cur:
                    for h in hits:
                        cur.execute("""
                            INSERT INTO search_rankings
                                (keyword, rank_date, product_id, product_name, rank_position, is_ad)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            ON CONFLICT (keyword, rank_date, product_id)
                            DO UPDATE SET rank_position = EXCLUDED.rank_position,
                                          is_ad = EXCLUDED.is_ad
                        """, (h['keyword'], today, h['product_id'], h['product_name'],
                              h['rank_position'], h['is_ad']))
                print(f"    자사 상품 {len(hits)}개 발견")
            else:
                print(f"    자사 상품 Top50 내 없음")
            time.sleep(random.uniform(2, 4))

        # ── 카테고리 베스트 ────────────────────────
        print("\n[ 카테고리 베스트 수집 ]")
        for cat_name, cat_id in CATEGORIES:
            print(f"  [{cat_name}] 수집 중...")
            ranking = fetch_category_ranking(driver, cat_name, cat_id)
            if not ranking:
                print(f"    수집 실패")
                time.sleep(random.uniform(2, 4))
                continue

            with conn.cursor() as cur:
                if _is_cat_unchanged(cur, cat_name, ranking):
                    print(f"    변화 없음 — 스킵")
                    time.sleep(random.uniform(2, 4))
                    continue

                for item in ranking:
                    cur.execute("""
                        INSERT INTO category_rankings
                            (rank_date, rank_hour, category_name, rank_position, product_id, product_name)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (rank_date, rank_hour, category_name, rank_position)
                        DO UPDATE SET product_id = EXCLUDED.product_id,
                                      product_name = EXCLUDED.product_name
                    """, (today, rank_hour, item['category_name'], item['rank_position'],
                          item['product_id'], item['product_name']))

            print(f"    {len(ranking)}개 저장")
            time.sleep(random.uniform(2, 4))

        print("\n=== 완료 ===")
        revalidate_vercel()

    finally:
        if driver:
            _quit_driver(driver)
        conn.close()


if __name__ == '__main__':
    run()
