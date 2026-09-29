"""
올리브영 경쟁사 상품 상세 정보 수집기
- 소비자가: 상품 페이지 [class*="price-before"]
- 용량/기획구성: goods_name 정규식 추출 (이미 DB에 저장된 상품명 활용)
- 실행: python -m collector.product_detail_collector
"""
import os
import sys
import re
import time
import random
from datetime import date
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

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Referer': 'https://www.oliveyoung.co.kr/store/main/getBestList.do',
}
DETAIL_URL = 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do'

# 용량 단위 패턴 (상품명에서 추출)
_VOLUME_RE = re.compile(
    r'(\d+(?:\.\d+)?\s*(?:ml|mL|L|g|kg|oz|패치|매|포|정|개입)(?:\s*[×xX*]\s*\d+)?)',
    re.IGNORECASE,
)

# 기획/세트 키워드 (순수 번들 키워드만 — "기획"은 단독으로 쓰면 설명 태그도 걸리므로 제외)
_BUNDLE_PURE_KW = ['1+1', '2+1', '3+1', '더블', '트리플', '증정', '대용량']   # 단독으로 번들 의미
_BUNDLE_COMBO_KW = ['기획', '세트', 'SET']                                      # 다른 키워드와 함께여야 번들


def fetch_detail_page(goods_no: str) -> BeautifulSoup | None:
    kwargs = dict(params={'goodsNo': goods_no}, headers=HEADERS, timeout=20)
    try:
        if _IMPERSONATE:
            r = cf_requests.get(DETAIL_URL, impersonate=_IMPERSONATE, **kwargs)
        else:
            r = cf_requests.get(DETAIL_URL, **kwargs)
        if r.status_code != 200:
            return None
        return BeautifulSoup(r.text, 'html.parser')
    except Exception as e:
        print(f"    fetch 오류: {e}")
        return None


def parse_price(soup: BeautifulSoup) -> int | None:
    # 1차: 원가 (할인 적용 전 소비자가) — [class*="price-before"]
    el = soup.select_one('[class*="price-before"]')
    if el:
        text = el.get_text(strip=True)
        m = re.search(r'[\d,]+', text.replace(' ', ''))
        if m:
            v = int(m.group().replace(',', ''))
            if v > 100:  # 너무 작은 값(% 등) 제외
                return v

    # 2차: 현재 판매가 — [class*="price"]  (할인 없는 상품)
    for el in soup.select('[class*="price"]'):
        text = el.get_text(strip=True)
        # "원" 포함 & 3자리 이상 숫자
        m = re.search(r'([\d,]{4,})원', text)
        if m:
            v = int(m.group(1).replace(',', ''))
            if 1000 <= v <= 500000:  # 합리적 범위
                return v
    return None


def parse_volume(goods_name: str) -> str | None:
    """상품명에서 용량 추출 (ml/g/매/포 등)"""
    matches = _VOLUME_RE.findall(goods_name)
    if not matches:
        return None
    # 중복 제거 + 가장 큰 단위 값 우선 (여러 용량이 있을 때)
    unique = list(dict.fromkeys(m.strip() for m in matches))
    return ' / '.join(unique[:3])  # 최대 3개


def parse_bundle_info(goods_name: str) -> str | None:
    """상품명에서 기획세트 정보 추출 (순수 번들 정보만, 기능 설명 태그 제외)"""
    parts = []

    # [태그] 처리: 순수 번들 태그만 포함
    # 규칙: 슬래시(/) 없고, 순수 번들 키워드 포함 → 번들로 간주
    tags = re.findall(r'\[([^\]]+)\]', goods_name)
    for tag in tags:
        has_slash = '/' in tag
        has_pure = any(kw in tag for kw in _BUNDLE_PURE_KW)
        # 슬래시가 있는 태그는 기능 설명 태그(ex: 촉촉보라톤업/혼합자차)
        if has_pure and not has_slash:
            parts.append(tag)

    # 대괄호 밖의 번들 표현 (ex: "1+1 기획", "더블 기획", "50ml 1+1")
    name_no_tags = re.sub(r'\[[^\]]*\]', '', goods_name)
    seen_kws = set()
    for kw in _BUNDLE_PURE_KW:
        if kw in name_no_tags and kw not in seen_kws:
            seen_kws.add(kw)
            idx = name_no_tags.find(kw)
            # 키워드 앞 0~3자 + 키워드 + 뒤 8자 (용량 숫자 제외한 텍스트 맥락)
            raw = name_no_tags[max(0, idx):idx+len(kw)+8].strip()
            # 숫자+단위 제거해서 순수 번들 설명만 남김
            clean = re.sub(r'\d+(?:\.\d+)?\s*(?:ml|mL|g|kg|oz)', '', raw).strip()
            clean = re.sub(r'\s+', ' ', clean)
            if clean and clean not in parts:
                parts.append(clean)

    # "기획세트", "기획" 단독 사용 (+ 기획 조합, ex: "더블 기획", "1+1 기획")
    combined_re = re.compile(r'(?:' + '|'.join(re.escape(k) for k in _BUNDLE_PURE_KW) + r')\s*기획|기획세트')
    for m in combined_re.finditer(name_no_tags):
        txt = m.group().strip()
        if txt not in parts:
            parts.append(txt)

    if not parts:
        return None
    # 중복 제거: 더 짧은 항목이 더 긴 항목의 부분문자열이면 제거
    deduped = []
    for p in parts:
        if not any(p in existing or existing in p for existing in deduped):
            deduped.append(p)
    return ' / '.join(p[:60] for p in deduped[:3])


def run(force: bool = False, log_path: str | None = None):
    import sys as _sys
    # 로그 파일 + stdout 동시 출력 (버퍼링 없이)
    log_f = None
    if log_path:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        log_f = open(log_path, 'w', encoding='utf-8', buffering=1)

    def log(msg: str):
        print(msg, flush=True)
        if log_f:
            log_f.write(msg + '\n')
            log_f.flush()

    log("=== 경쟁사 상품 상세 수집 시작 ===\n")
    conn = get_conn()
    conn.autocommit = True
    try:
        init_db(conn=conn)

        with conn.cursor() as cur:
            # 자사(is_competitor=false)를 먼저 처리 — 46개뿐이고 비교 기준이 됨
            if force:
                cur.execute("""
                    SELECT goods_no, goods_name FROM products
                    ORDER BY is_competitor, goods_name
                """)
            else:
                cur.execute("""
                    SELECT goods_no, goods_name FROM products
                    WHERE detail_fetched_at IS NULL
                    ORDER BY is_competitor, goods_name
                """)
            products = list(cur.fetchall())

        if not products:
            log("수집할 상품 없음 (이미 모두 완료)")
            return

        log(f"수집 대상: {len(products)}개\n")
        success = 0

        for i, p in enumerate(products):
            goods_no = p['goods_no']
            goods_name = p['goods_name'] or ''
            log(f"  ({i+1}/{len(products)}) {goods_name[:40]}")

            # 용량/기획구성은 상품명에서 추출 (웹 스크래핑 불필요)
            volume = parse_volume(goods_name)
            bundle = parse_bundle_info(goods_name)

            # 소비자가만 웹 페이지에서 가져오기
            soup = fetch_detail_page(goods_no)
            price = parse_price(soup) if soup else None

            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE products
                    SET price = %s, volume = %s, bundle_info = %s, detail_fetched_at = %s
                    WHERE goods_no = %s
                """, (price, volume, bundle, date.today(), goods_no))

            info = []
            if price:   info.append(f"{price:,}원")
            if volume:  info.append(volume)
            if bundle:  info.append(f"[{bundle[:40]}]")
            log(f"    -> {' | '.join(info) if info else '가격정보 없음'}")

            success += 1
            time.sleep(random.uniform(2, 4))

        log(f"\n=== 완료 - {success}/{len(products)}개 수집 ===")
    finally:
        conn.close()
        if log_f:
            log_f.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="이미 수집된 상품도 재수집")
    parser.add_argument("--log", default=None, help="로그 파일 경로")
    args = parser.parse_args()
    run(force=args.force, log_path=args.log)
