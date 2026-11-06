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

from db.coupang_schema import get_conn, init_db

BRAND_QUERY = os.getenv('COUPANG_BRAND', '셀퓨전씨')
OUR_IDENTIFIERS = [BRAND_QUERY, "cellfusionc", "cell fusion c"]

# 수집 시작 시 DB에서 로드한 자사 product_id 집합 (정확도 우선 체크)
_our_product_ids: set = set()


def _is_ours(product_id: str, product_name: str) -> bool:
    if product_id and product_id in _our_product_ids:
        return True
    name_l = product_name.lower()
    return any(kw.lower() in name_l for kw in OUR_IDENTIFIERS)


def _load_our_product_ids(conn) -> set:
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT product_id FROM products WHERE is_ours = TRUE")
            return {r['product_id'] for r in cur.fetchall()}
    except Exception:
        return set()

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
    options.add_argument('--window-position=-2400,-2400')

    driver = uc.Chrome(options=options, headless=False, version_main=_chrome_major_version())
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


def _extract_product_id(href: str) -> str | None:
    m = re.search(r'/vp/products/(\d+)', href)
    return m.group(1) if m else None


# ── 가격·평점 추출 ────────────────────────────────────────
# 순위를 받으려고 이미 연 페이지 안에 가격·할인율·별점·리뷰수가 전부 들어 있다.
# 버리지 않고 같이 저장한다 — 추가 요청이 0건이라 차단 위험이 늘지 않는다.
#
# 가격은 DOM(PriceArea)에서, 별점은 페이지에 박힌 Next.js 플라이트 JSON에서 꺼낸다.
# 별점은 DOM 에 숫자로 안 나오고(별 이미지), 리뷰수만 괄호로 보인다.

_RE_REVIEW_AREA = re.compile(
    r'"reviewArea":\{"ratingAverage":([\d.]+),"ratingCount":(\d+)')


def _num(s: str | None) -> int | None:
    return int(re.sub(r'[^\d]', '', s)) if s and re.search(r'\d', s) else None


def build_rating_index(html: str) -> dict[str, tuple[float, int]]:
    """itemId -> (평균 별점, 리뷰 수).

    플라이트 데이터는 JS 문자열 속 JSON 이라 따옴표가 \\" 로 이스케이프돼 있다.
    정규식으로 백슬래시를 세는 것보다 한 번 펴고 평범하게 읽는 편이 안전하다.
    """
    flat = html.replace('\\"', '"')
    idx: dict[str, tuple[float, int]] = {}
    for m in re.finditer(r'"itemId":(\d+)', flat):
        r = _RE_REVIEW_AREA.search(flat, m.end(), m.end() + 6000)
        if r and m.group(1) not in idx:
            idx[m.group(1)] = (float(r.group(1)), int(r.group(2)))
    return idx


def parse_price_area(text: str) -> dict:
    """'쿠폰할인80,000원54%36,350원(1개당 18,175원)' → 가격 항목들."""
    out = {'price': None, 'base_price': None, 'discount_rate': None, 'unit_price': None}
    if not text:
        return out
    u = re.search(r'1개당\s*([\d,]+)\s*원', text)
    if u:
        out['unit_price'] = _num(u.group(1))
    body = re.sub(r'\(.*?\)', '', text)          # 괄호 안 단가는 빼고 본다
    p = re.search(r'(\d{1,2})\s*%', body)
    if p:
        out['discount_rate'] = int(p.group(1))
    wons = re.findall(r'([\d,]+)\s*원', body)
    if len(wons) >= 2:                            # 정가 … 판매가 순
        out['base_price'], out['price'] = _num(wons[0]), _num(wons[-1])
    elif wons:                                    # 할인 없는 상품
        out['price'] = _num(wons[0])
    return out


def extract_snapshot(item, href: str, rating_idx: dict) -> dict:
    """검색/카테고리 결과 한 칸에서 가격·평점 스냅샷을 뽑는다."""
    pa = item.select_one('[class*="PriceArea_priceArea"]')
    snap = parse_price_area(pa.get_text(strip=True) if pa else '')
    iid = re.search(r'itemId=(\d+)', href)
    rating, review_count = rating_idx.get(iid.group(1), (None, None)) if iid else (None, None)
    snap['rating'] = rating
    snap['review_count'] = review_count
    return snap


# 한 번 실행하는 동안 모은 스냅샷. 같은 상품이 여러 키워드·카테고리에 나오므로
# product_id 로 묶어 중복을 없앤다. run() 끝에서 한 번에 저장한다.
_snapshots: dict[str, dict] = {}


def _stash_snapshot(item, href: str, product_id: str, product_name: str,
                    ours: bool, rating_idx: dict) -> None:
    snap = extract_snapshot(item, href, rating_idx)
    snap.update({'product_id': product_id, 'product_name': product_name, 'is_ours': ours})
    prev = _snapshots.get(product_id)
    if prev:
        # 광고 칸에는 가격이 안 보이는 경우가 있다. 값이 있는 쪽을 남긴다.
        for k, v in snap.items():
            if v is not None:
                prev[k] = v
    else:
        _snapshots[product_id] = snap


def save_price_snapshots(conn, snaps: list[dict]) -> int:
    """하루 한 행만 남긴다. 같은 날 다시 돌면 최신 값으로 갱신."""
    if not snaps:
        return 0
    n = 0
    with conn.cursor() as cur:
        for s in snaps:
            if s.get('price') is None and s.get('rating') is None:
                continue                          # 건질 게 없으면 행을 만들지 않는다
            cur.execute("""
                INSERT INTO price_history
                    (product_id, recorded_date, price, base_price, discount_rate,
                     unit_price, rating, review_count, is_ours, product_name)
                VALUES (%s, (now() AT TIME ZONE 'Asia/Seoul')::date,
                        %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (product_id, recorded_date) DO UPDATE SET
                    price         = EXCLUDED.price,
                    base_price    = EXCLUDED.base_price,
                    discount_rate = EXCLUDED.discount_rate,
                    unit_price    = EXCLUDED.unit_price,
                    rating        = COALESCE(EXCLUDED.rating, price_history.rating),
                    review_count  = COALESCE(EXCLUDED.review_count, price_history.review_count),
                    product_name  = COALESCE(EXCLUDED.product_name, price_history.product_name),
                    collected_at  = NOW()
            """, (s['product_id'], s['price'], s['base_price'], s['discount_rate'],
                  s['unit_price'], s['rating'], s['review_count'],
                  s.get('is_ours', False), s.get('product_name')))
            n += 1
    return n


def _is_challenge(content: str) -> bool:
    """봇 차단(자바스크립트 챌린지) 페이지인가.

    정상 결과 페이지는 수백 KB 인데 챌린지는 2~3KB 짜리 스크립트 한 장이다.
    이걸 구분하지 못해서 차단당한 날도 로그에는 '결과 없음'으로만 남았다.
    """
    return len(content) < 8000 and 'protected by' in content


def _load_page(driver: uc.Chrome, url: str, retries: int = 3) -> str:
    """페이지 로드 + RET9999·봇 챌린지 재시도"""
    for attempt in range(retries):
        driver.get(url)
        time.sleep(random.uniform(5, 8))
        content = driver.page_source

        if 'RET9999' in content:
            wait = 30 * (attempt + 1)
            print(f'    RET9999 오류 — {wait}초 대기 후 재시도 ({attempt+1}/{retries})')
            time.sleep(wait)
            continue

        # 챌린지 페이지는 스스로 자바스크립트를 돌린 뒤 다시 로드한다.
        # 5~8초는 그 전에 page_source 를 집어 오는 경우가 있어 조금 더 기다린다.
        if _is_challenge(content):
            for _ in range(6):
                time.sleep(5)
                content = driver.page_source
                if not _is_challenge(content):
                    break
        if _is_challenge(content):
            wait = 30 * (attempt + 1)
            print(f'    봇 차단 페이지 — {wait}초 대기 후 재시도 ({attempt+1}/{retries})')
            time.sleep(wait)
            continue

        return content

    print('    차단이 풀리지 않았다 — 이 페이지는 건너뛴다')
    return driver.page_source


def fetch_search_ranking(driver: uc.Chrome, keyword: str) -> list[dict]:
    """키워드 검색 결과 유기순위 Top 100 전체 수집 (자사·타사 모두)"""
    results = []
    seen = set()
    organic_rank = 0

    for page in range(1, 4):
        url = (f'{SEARCH_URL}?q={keyword}&channel=relate'
               f'&sorter=scoreDesc&listSize=36&page={page}')
        try:
            content = _load_page(driver, url)
            soup = BeautifulSoup(content, 'html.parser')
            items = soup.select('li[data-id]')
            if not items:
                break
            rating_idx = build_rating_index(content)

            for item in items:
                link = item.find('a', href=re.compile(r'/vp/products/'))
                if not link:
                    continue
                href = link.get('href', '')
                product_id = _extract_product_id(href)
                if not product_id or product_id in seen:
                    continue
                seen.add(product_id)

                is_ad = '광고' in item.get_text()
                if not is_ad:
                    organic_rank += 1

                name_el = item.select_one('[class*="productNameV2"], [class*="name"]')
                product_name = name_el.get_text(strip=True) if name_el else ''
                ours = _is_ours(product_id, product_name)

                _stash_snapshot(item, href, product_id, product_name, ours, rating_idx)

                results.append({
                    'keyword': keyword,
                    'product_id': product_id,
                    'product_name': product_name,
                    'rank_position': organic_rank if not is_ad else 0,
                    'is_ad': is_ad,
                    'is_ours': ours,
                })

                if organic_rank >= 100:
                    break

            if organic_rank >= 100 or len(items) < 10:
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
            rating_idx = build_rating_index(content)

            for item in items:
                if len(results) >= 100:
                    break
                link = item.find('a', href=re.compile(r'/vp/products/'))
                if not link:
                    continue
                href = link.get('href', '')
                product_id = _extract_product_id(href)
                if not product_id or product_id in seen:
                    continue
                seen.add(product_id)

                name_el = item.select_one('[class*="productNameV2"], [class*="name"]')
                product_name = name_el.get_text(strip=True) if name_el else ''
                ours = _is_ours(product_id, product_name)

                _stash_snapshot(item, href, product_id, product_name, ours, rating_idx)

                results.append({
                    'category_name': cat_name,
                    'rank_position': len(results) + 1,
                    'product_id': product_id,
                    'product_name': product_name,
                    'is_ours': ours,
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
    global _our_product_ids
    rank_hour = datetime.now(timezone.utc).hour
    today = date.today()
    print(f"=== 쿠팡 순위 수집 ({today} UTC {rank_hour:02d}시) ===\n")

    conn = get_conn()
    conn.autocommit = True
    driver = None

    try:
        init_db(conn=conn)
        _our_product_ids = _load_our_product_ids(conn)
        print(f"  자사 등록 상품 {len(_our_product_ids)}개 로드")
        driver = _init_driver()

        # ── 검색 순위 ──────────────────────────────
        print("[ 검색 순위 수집 ]")
        for keyword in SEARCH_KEYWORDS:
            print(f"  키워드: {keyword}")
            hits = fetch_search_ranking(driver, keyword)
            if hits:
                ours = sum(1 for h in hits if h['is_ours'] and not h['is_ad'])
                with conn.cursor() as cur:
                    for h in hits:
                        cur.execute("""
                            INSERT INTO search_rankings
                                (keyword, rank_date, product_id, product_name, rank_position, is_ad, is_ours)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (keyword, rank_date, product_id)
                            DO UPDATE SET rank_position = EXCLUDED.rank_position,
                                          is_ad = EXCLUDED.is_ad,
                                          is_ours = EXCLUDED.is_ours
                        """, (h['keyword'], today, h['product_id'], h['product_name'],
                              h['rank_position'], h['is_ad'], h['is_ours']))
                print(f"    전체 {len(hits)}개 저장 (자사 {ours}개)")
            else:
                print(f"    결과 없음")
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
                            (rank_date, rank_hour, category_name, rank_position, product_id, product_name, is_ours)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (rank_date, rank_hour, category_name, rank_position)
                        DO UPDATE SET product_id = EXCLUDED.product_id,
                                      product_name = EXCLUDED.product_name,
                                      is_ours = EXCLUDED.is_ours
                    """, (today, rank_hour, item['category_name'], item['rank_position'],
                          item['product_id'], item['product_name'], item['is_ours']))

            print(f"    {len(ranking)}개 저장")
            time.sleep(random.uniform(2, 4))

        # ── 가격·평점 스냅샷 ───────────────────────
        # 위에서 순위를 받으며 같이 모아 둔 것. 추가 요청은 없다.
        saved = save_price_snapshots(conn, list(_snapshots.values()))
        print(f"\n[ 가격·평점 스냅샷 ] {saved}개 저장 "
              f"(수집 {len(_snapshots)}개 상품)")

        print("\n=== 완료 ===")
        # 아무것도 못 건졌으면 캐시를 비울 이유가 없다. 이 호출은 서버에서
        # AI 생성 3개를 돌리므로, 실패한 실행까지 부르면 돈만 나간다.
        if _snapshots:
            revalidate_vercel()
        else:
            # 한 건도 못 받았는데 exit 0 으로 끝내면 슬랙에 "OK" 가 간다.
            # 2026-11-04 18시부터 쿠팡 봇 차단으로 3회 연속 0건이었는데
            # 작업 스케줄러에도 로그에도 성공으로 남았다.
            print("  수집 결과가 없다 — 봇 차단이거나 페이지 구조가 바뀌었다")
            sys.exit(7)

    finally:
        if driver:
            _quit_driver(driver)
        conn.close()


if __name__ == '__main__':
    run()
