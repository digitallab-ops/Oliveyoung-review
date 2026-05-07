import os
import sys
import requests
import time
import random
from datetime import datetime
from dotenv import load_dotenv

try:
    from curl_cffi import requests as cf_requests
    _IMPERSONATE = "chrome124"
except ImportError:
    cf_requests = requests
    _IMPERSONATE = None


def _cf_post(url, **kwargs):
    if _IMPERSONATE:
        return cf_requests.post(url, impersonate=_IMPERSONATE, **kwargs)
    return requests.post(url, **kwargs)


def _cf_get(url, **kwargs):
    if _IMPERSONATE:
        return cf_requests.get(url, impersonate=_IMPERSONATE, **kwargs)
    return requests.get(url, **kwargs)

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from db.schema import init_db, upsert_products, insert_review, get_existing_review_ids, get_all_products

BRAND_CODE = os.environ.get("BRAND_CODE", "A001854")

HEADERS_WEB = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "Referer": "https://www.oliveyoung.co.kr/",
    "Accept-Language": "ko-KR,ko;q=0.9",
}
HEADERS_API = {
    **HEADERS_WEB,
    "Content-Type": "application/json",
    "Origin": "https://www.oliveyoung.co.kr",
    "Accept": "application/json, text/plain, */*",
}


def fetch_brand_products_requests(brand_code: str) -> list[dict]:
    """requests로 브랜드 상품 목록 수집 (GitHub Actions용 — Playwright 불필요)"""
    from bs4 import BeautifulSoup

    url = "https://www.oliveyoung.co.kr/store/display/getBrandShopDetailGoodsPagingAjax.do"
    products = []
    page = 1

    # GitHub Actions IP는 일반적으로 접근 가능, 안되면 Playwright fallback
    while True:
        params = {
            "onlBrndCd": brand_code,
            "pageIdx": page,
            "dispCatNo": "900000202410007",
            "fltDispCatNo": "",
            "prdSort": "rank",
            "rowsPerPage": 24,
            "trackingCd": "",
        }
        res = requests.get(url, params=params, headers=HEADERS_WEB, timeout=15)

        if res.status_code != 200:
            print(f"  브랜드 페이지 {res.status_code} — DB 기존 상품 목록 사용")
            break

        soup = BeautifulSoup(res.content, "html.parser")
        items = soup.select("li[data-goods-idx]")
        if not items:
            break

        for item in items:
            a_tag = item.select_one("a[data-ref-goodsNo]")
            name_tag = item.select_one(".prod-name")
            rating_tag = item.select_one(".point")
            count_tag = item.select_one(".num")
            if a_tag:
                products.append({
                    "goods_no": a_tag["data-ref-goodsNo"],
                    "goods_name": name_tag.text.strip() if name_tag else "",
                    "rating": float(rating_tag.text.strip()) if rating_tag else None,
                    "review_count": count_tag.text.strip("()") if count_tag else "0",
                })

        print(f"  브랜드 페이지 {page}: {len(items)}개")
        page += 1
        time.sleep(random.uniform(1.0, 2.0))
        if len(items) < 24:
            break

    return products


def fetch_new_review_ids(goods_no: str, existing_ids: set, size: int = 50) -> list[int]:
    """cursor 엔드포인트로 신규 리뷰 ID 수집.
    - reviewType=ALL: 사진 없는 일반 리뷰 포함
    - sortType=RECENT_DESC: 최신순 → 기존 ID 만나면 즉시 중단 (불필요한 요청 없음)
    """
    url = "https://m.oliveyoung.co.kr/review/api/v2/reviews/cursor"
    new_ids = []
    page = 0

    while True:
        payload = {
            "goodsNumber": goods_no,
            "page": page,
            "size": size,
            "sortType": "RECENT_DESC",
            "reviewType": "ALL",
        }
        try:
            res = _cf_post(url, json=payload, headers=HEADERS_API, timeout=15)
        except Exception as e:
            print(f"    요청 오류: {e}")
            break

        if res.status_code != 200:
            print(f"    cursor API {res.status_code} — 스킵")
            break

        body = res.json()
        data = body.get("data") or {}
        reviews = data.get("goodsReviewList") or []
        has_next = data.get("hasNext", False)

        if not reviews:
            break

        found_existing = False
        for r in reviews:
            rid = r["reviewId"]
            if rid in existing_ids:
                found_existing = True
                break
            new_ids.append(rid)

        if found_existing or not has_next:
            break

        page += 1
        time.sleep(random.uniform(0.5, 1.0))

    return new_ids


def fetch_review_detail(review_id: int) -> dict | None:
    res = _cf_get(
        f"https://m.oliveyoung.co.kr/review/api/v2/reviews/{review_id}",
        headers=HEADERS_API, timeout=10
    )
    if res.status_code != 200:
        return None
    return res.json().get("data")


def run():
    print(f"=== 올리브영 리뷰 수집 시작 ({datetime.now().strftime('%Y-%m-%d %H:%M')}) ===\n")
    init_db()

    # 1단계: 브랜드 상품 목록
    print("[1/3] 브랜드 상품 목록 수집 중...")
    products = fetch_brand_products_requests(BRAND_CODE)
    if products:
        upsert_products(products)
        print(f"  → {len(products)}개 상품 업서트 완료")
    else:
        products = get_all_products()
        print(f"  → DB 기존 {len(products)}개 상품 사용")

    # 2단계: 신규 리뷰만 수집
    existing_ids = get_existing_review_ids()
    print(f"\n[2/3] 리뷰 수집 시작 (기존 {len(existing_ids)}개 스킵)\n")
    total_new = 0

    for i, product in enumerate(products):
        goods_no = product["goods_no"]
        name = product["goods_name"][:30] if product["goods_name"] else goods_no
        new_ids = fetch_new_review_ids(goods_no, existing_ids)

        if not new_ids:
            continue

        print(f"  ({i+1}/{len(products)}) {name} — 신규 {len(new_ids)}개")
        for review_id in new_ids:
            detail = fetch_review_detail(review_id)
            if detail:
                insert_review(detail, goods_no)
                existing_ids.add(review_id)
                total_new += 1
            time.sleep(random.uniform(0.5, 1.0))

        time.sleep(random.uniform(1.5, 2.5))

    print(f"\n[3/3] 완료 — 신규 {total_new}개 저장")


if __name__ == "__main__":
    run()
