"""
올리브영 프로모션 수집기 — 올영픽 + 오늘의 특가(하루특가)
실행: python collector/promo_collector.py

올영픽: getPlanShopDetail.do?dispCatNo=500000100018752
  - 월 단위 큐레이션, 같은 dispCatNo에 상품만 교체되는 구조
  - HTML 직접 파싱 (AJAX 불필요)

오특: getHotdealPagingListAjax.do
  - 일 단위, 세션 쿠키 필요 (메인 페이지 방문 후 요청)
  - pageIdx=1,2,... 페이지네이션
"""
import os
import sys
import re
import time
import json
import urllib.request
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

SWIT_WEBHOOK = os.getenv('SWIT_WEBHOOK_URL', '')


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


def send_alert(text: str):
    if not SWIT_WEBHOOK:
        print(f'  [알림 미설정] {text}')
        return
    try:
        payload = json.dumps({'text': text}).encode('utf-8')
        req = urllib.request.Request(
            SWIT_WEBHOOK,
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        urllib.request.urlopen(req, timeout=10)
        print('  스윗 알림 전송 완료')
    except Exception as e:
        print(f'  스윗 알림 전송 실패: {e}')
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from db.schema import get_conn, init_db

BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
}

# 올영픽 — 매월 기획전 교체. dispCatNo를 이벤트 목록에서 자동 탐색
OLIVEPICK_URL = 'https://www.oliveyoung.co.kr/store/planshop/getPlanShopDetail.do'
OLIVEPICK_CAT = '500000100018921'  # fallback — 자동 탐색 실패 시 사용

EVENT_LIST_URL = 'https://www.oliveyoung.co.kr/store/main/getEventList.do'
OLIVEPICK_EVT_KEYWORDS = ['올영PICK', '올영픽', 'OLIVEYOUNG PICK']
BRAND_EVT_KEYWORDS = ['셀퓨전씨', 'cellfusionc', 'cell fusion c']

# 오특
HOTDEAL_MAIN_URL = 'https://www.oliveyoung.co.kr/store/main/getHotdealList.do'
HOTDEAL_AJAX_URL = 'https://www.oliveyoung.co.kr/store/main/getHotdealPagingListAjax.do'
HOTDEAL_CONDITIONS = [
    ('today_deal', '오늘의 특가', '02'),
]
MAX_PAGES = 15


def make_session():
    if _USE_CFFI:
        return cf_requests.Session(impersonate='chrome124')
    return cf_requests.Session()


def fetch_olivepick_catno(session) -> str | None:
    """이벤트 목록에서 올영픽 dispCatNo 동적 탐색"""
    try:
        r = session.get(EVENT_LIST_URL, headers=BASE_HEADERS, timeout=20)
        if r.status_code != 200:
            return None
        soup = BeautifulSoup(r.text, 'html.parser')
        for li in soup.find_all('li'):
            evtNm_el = li.find('input', {'name': 'evtNm'})
            if not evtNm_el:
                continue
            if any(k in evtNm_el.get('value', '') for k in OLIVEPICK_EVT_KEYWORDS):
                urlInfo_el = li.find('input', {'name': 'urlInfo'})
                if urlInfo_el:
                    m = re.search(r'dispCatNo=(\d+)', urlInfo_el.get('value', ''))
                    if m:
                        return m.group(1)
    except Exception as e:
        print(f'  올영픽 자동 탐색 실패: {e}')
    return None


def fetch_brand_events(session) -> list[dict]:
    """이벤트 목록에서 셀퓨전씨 관련 이벤트 탐색"""
    try:
        r = session.get(EVENT_LIST_URL, headers=BASE_HEADERS, timeout=20)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, 'html.parser')
        results = []
        for li in soup.find_all('li'):
            evtNm_el = li.find('input', {'name': 'evtNm'})
            title_el = li.find('input', {'name': 'originalTitle'})
            urlInfo_el = li.find('input', {'name': 'urlInfo'})
            evt_nm = evtNm_el.get('value', '') if evtNm_el else ''
            title = title_el.get('value', '') if title_el else ''
            url_info = urlInfo_el.get('value', '') if urlInfo_el else ''
            if not (evt_nm or title):
                continue
            combined = (evt_nm + ' ' + title).lower()
            if any(k.lower() in combined for k in BRAND_EVT_KEYWORDS):
                date_el = li.select_one('.evt_date, .date, [class*="date"]')
                date_txt = date_el.get_text(strip=True) if date_el else ''
                results.append({
                    'evt_nm': evt_nm,
                    'title': title,
                    'url': url_info,
                    'period': date_txt,
                })
        return results
    except Exception as e:
        print(f'  브랜드 이벤트 탐색 실패: {e}')
        return []


def parse_prd_info(html: str) -> list[dict]:
    """공통 .prd_info 셀렉터로 상품 목록 파싱"""
    soup = BeautifulSoup(html, 'html.parser')
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
        name_el = item.select_one('.tx_name, .prd_name')
        name = name_el.get_text(strip=True) if name_el else ''
        results.append({'goods_no': goods_no, 'name': name, 'category_name': None})
    return results


def fetch_olivepick(session, catno: str = OLIVEPICK_CAT) -> list[dict]:
    """올영픽 기획전 페이지 전체 파싱 (카테고리 섹션 포함)"""
    r = session.get(
        OLIVEPICK_URL,
        params={'dispCatNo': catno},
        headers=BASE_HEADERS,
        timeout=20,
    )
    if r.status_code != 200:
        print(f'  올영픽 HTTP {r.status_code}')
        return []

    soup = BeautifulSoup(r.text, 'html.parser')
    seen = set()
    results = []
    current_category = None

    for el in soup.find_all(['h2', 'h3', 'h4', 'li']):
        if el.name in ('h2', 'h3', 'h4'):
            text = el.get_text(strip=True)
            if text and len(text) < 40:
                current_category = text
            continue

        prd = el.select_one('.prd_info')
        if not prd:
            continue
        link = (el or prd).select_one('a[href*="goodsNo"]')
        if not link:
            continue
        m = re.search(r'goodsNo=([A-Z0-9]+)', link.get('href', ''))
        if not m or m.group(1) in seen:
            continue
        goods_no = m.group(1)
        seen.add(goods_no)
        name_el = prd.select_one('.tx_name, .prd_name')
        name = name_el.get_text(strip=True) if name_el else ''
        results.append({
            'goods_no': goods_no,
            'name': name,
            'category_name': current_category,
        })

    # fallback: 카테고리 파싱 실패 시 기존 방식으로 재시도
    if not results:
        results = [{'goods_no': p['goods_no'], 'name': p['name'], 'category_name': None}
                   for p in parse_prd_info(r.text)]
    return results


def fetch_hotdeal_page(session, today_str: str, flt_condition: str, page_idx: int) -> list[dict]:
    """오특 AJAX 단일 페이지"""
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
        return []

    # 오특은 data-impression 속성으로 파싱 (더 안정적)
    soup = BeautifulSoup(r.text, 'html.parser')
    seen = set()
    results = []
    for li in soup.select('li[data-impression]'):
        imp = li.get('data-impression', '')
        goods_no = imp.split('^')[0].strip()
        if not goods_no or not re.match(r'^[A-Z0-9]+$', goods_no) or goods_no in seen:
            continue
        seen.add(goods_no)
        name_el = li.select_one('.tx_name, .prd_name, img.pic-thumb')
        if name_el and name_el.name == 'img':
            name = name_el.get('alt', '')
        elif name_el:
            name = name_el.get_text(strip=True)
        else:
            link = li.select_one('a[href*="goodsNo"]')
            name = link.get('data-ref-goodsnm', '') if link else ''
        results.append({'goods_no': goods_no, 'name': name, 'category_name': None})
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


def save_items(conn, ptype: str, items: list[dict], our_goods: set, today: date):
    with conn.cursor() as cur:
        cur.execute(
            'DELETE FROM promo_items WHERE promo_type = %s AND collected_at = %s',
            (ptype, today)
        )
        for rank, item in enumerate(items, 1):
            is_ours = item['goods_no'] in our_goods
            cur.execute("""
                INSERT INTO promo_items
                    (promo_type, collected_at, rank_position, goods_no, goods_name, is_ours, category_name)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (promo_type, collected_at, goods_no) DO UPDATE SET
                    rank_position = EXCLUDED.rank_position,
                    goods_name    = EXCLUDED.goods_name,
                    is_ours       = EXCLUDED.is_ours,
                    category_name = EXCLUDED.category_name
            """, (ptype, today, rank, item['goods_no'], item['name'], is_ours, item.get('category_name')))

    our_hits = [(i + 1, it) for i, it in enumerate(items) if it['goods_no'] in our_goods]
    if our_hits:
        print('  자사 입점: ' + ', '.join(f"{r}위 {it['name']}" for r, it in our_hits))
    else:
        print('  자사 미입점')


def run():
    today = date.today()
    today_str = today.strftime('%Y%m%d')
    print(f'=== 올리브영 프로모션 수집 ({today}) ===\n')

    session = make_session()

    # 세션 워밍업 (오특용 Cloudflare 쿠키 취득)
    print('세션 초기화...')
    warmup_ok = False
    try:
        r = session.get(HOTDEAL_MAIN_URL, headers=BASE_HEADERS, timeout=20)
        if r.status_code == 200:
            warmup_ok = True
            print('세션 OK\n')
            time.sleep(2)
        else:
            print(f'세션 워밍업 실패 ({r.status_code}) — 오특 수집 건너뜀')
            send_alert(f'[OY] 프로모 세션 차단 ({r.status_code})\n오늘의 특가 수집 불가 — 올영픽은 계속 진행합니다.')
    except Exception as e:
        print(f'세션 워밍업 오류: {e} — 오특 수집 건너뜀')
        send_alert(f'[OY] 프로모 세션 오류\n{e}')

    conn = get_conn()
    conn.autocommit = True

    try:
        init_db(conn=conn)

        with conn.cursor() as cur:
            cur.execute('SELECT goods_no FROM products')
            our_goods = {r['goods_no'] for r in cur.fetchall()}

        print(f'자사 상품 {len(our_goods)}개 기준\n')

        # ── 올영픽 — 자동 탐색 후 fallback ──
        print('[올영픽] dispCatNo 자동 탐색...')
        detected_catno = fetch_olivepick_catno(session)
        if detected_catno:
            if detected_catno != OLIVEPICK_CAT:
                print(f'  새 dispCatNo 감지: {detected_catno} (기존: {OLIVEPICK_CAT})')
                send_alert(
                    f'[올영픽] 새 기획전 감지 ({today})\n'
                    f'dispCatNo: {detected_catno}\n'
                    f'promo_collector.py OLIVEPICK_CAT를 업데이트하세요.'
                )
            else:
                print(f'  dispCatNo 확인: {detected_catno}')
        else:
            print(f'  자동 탐색 실패 — fallback: {OLIVEPICK_CAT}')
        active_catno = detected_catno or OLIVEPICK_CAT
        time.sleep(1)

        # ── 브랜드 이벤트 탐색 ──
        print('[브랜드 이벤트] 셀퓨전씨 이벤트 탐색...')
        brand_evts = fetch_brand_events(session)
        if brand_evts:
            for evt in brand_evts:
                print(f'  발견: {evt["evt_nm"]} | {evt["title"]} | {evt["period"]}')
            names = ', '.join(e['evt_nm'] for e in brand_evts)
            send_alert(
                f'[셀퓨전씨 이벤트 발견] {today}\n'
                + '\n'.join(
                    f'· {e["evt_nm"]} — {e["title"]} ({e["period"]})\n  {e["url"]}'
                    for e in brand_evts
                )
            )
        else:
            print('  셀퓨전씨 이벤트 없음')
        time.sleep(1)

        print('[올영픽] 수집 중...')
        try:
            items = fetch_olivepick(session, active_catno)
            print(f'  총 {len(items)}개 상품')
            if items:
                save_items(conn, 'olivepick', items, our_goods, today)
            else:
                print('  경고: 상품 없음 — dispCatNo 확인 필요')
                send_alert(
                    f'[올영픽 수집 오류] {today} 상품 0건\n'
                    f'이벤트 페이지 URL이 변경되었을 수 있습니다.\n'
                    f'promo_collector.py의 OLIVEPICK_CAT 값을 확인해주세요.'
                )
        except Exception as e:
            print(f'  오류: {e}')
            send_alert(f'[올영픽 수집 오류] {today} 예외 발생\n{e}')
        time.sleep(2)

        # ── 오늘의 특가 ──
        for ptype, label, flt_cond in HOTDEAL_CONDITIONS:
            if not warmup_ok:
                print(f'[{label}] 세션 워밍업 실패로 건너뜀')
                continue
            print(f'[{label}] 수집 중...')
            try:
                items = fetch_all_hotdeal(session, today_str, flt_cond)
                print(f'  총 {len(items)}개 상품')
                if items:
                    save_items(conn, ptype, items, our_goods, today)
                else:
                    print('  경고: 상품 없음')
                    send_alert(f'[{label} 수집 오류] {today} 상품 0건\n수동으로 확인이 필요합니다.')
            except Exception as e:
                print(f'  오류: {e}')
                send_alert(f'[{label} 수집 오류] {today} 예외 발생\n{e}')
            time.sleep(2)

        print('\n=== 완료 ===')
        revalidate_vercel()

    finally:
        conn.close()


if __name__ == '__main__':
    run()
