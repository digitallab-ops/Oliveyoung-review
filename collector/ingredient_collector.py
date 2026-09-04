"""
올리브영 전성분 수집기
- getGoodsArtcAjax 엔드포인트에서 "화장품법에 따라 기재해야 하는 모든 성분" 파싱
- products 테이블의 ingredients_raw / ingredients_fetched_at 컬럼 저장
- 실행: python -m collector.ingredient_collector
        python -m collector.ingredient_collector --force   # 이미 수집된 것도 재수집
"""
import os, sys, re, time, random, argparse
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

from db.schema import get_conn, init_db

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Referer': 'https://www.oliveyoung.co.kr/store/main/getBestList.do',
}
ARTC_URL = 'https://www.oliveyoung.co.kr/store/goods/getGoodsArtcAjax.do'


def fetch_artc(goods_no: str) -> str | None:
    kwargs = dict(params={'goodsNo': goods_no}, headers=HEADERS, timeout=20)
    try:
        if _IMPERSONATE:
            r = cf_requests.get(ARTC_URL, impersonate=_IMPERSONATE, **kwargs)
        else:
            r = cf_requests.get(ARTC_URL, **kwargs)
        return r.text if r.status_code == 200 else None
    except Exception as e:
        print(f"    fetch 오류: {e}")
        return None


def parse_ingredients(html: str) -> str | None:
    m = re.search(
        r'<dt[^>]*>화장품법에 따라 기재해야 하는 모든 성분</dt>\s*(?:<[^>]+>\s*)*<dd[^>]*>([\s\S]*?)</dd>',
        html, re.I
    )
    if not m:
        return None
    raw = re.sub(r'<[^>]+>', '', m.group(1))
    raw = raw.replace('&amp;', '&').replace('&nbsp;', ' ')
    raw = re.sub(r'\s+', ' ', raw).strip()
    return raw if len(raw) > 5 else None


def run(force: bool = False):
    conn = get_conn()
    conn.autocommit = True
    try:
        init_db(conn=conn)

        with conn.cursor() as cur:
            if force:
                cur.execute("""
                    SELECT goods_no, goods_name FROM products
                    WHERE is_competitor = true
                    ORDER BY goods_name
                """)
            else:
                cur.execute("""
                    SELECT goods_no, goods_name FROM products
                    WHERE is_competitor = true
                      AND ingredients_fetched_at IS NULL
                    ORDER BY goods_name
                """)
            products = list(cur.fetchall())

        if not products:
            print("수집할 상품 없음 (이미 모두 완료)")
            return

        print(f"수집 대상: {len(products)}개\n")
        ok = skipped = 0

        for i, p in enumerate(products):
            gno = p['goods_no']
            name = (p['goods_name'] or '')[:40]
            print(f"  ({i+1}/{len(products)}) {name}")

            html = fetch_artc(gno)
            raw = parse_ingredients(html) if html else None

            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE products
                    SET ingredients_raw = %s, ingredients_fetched_at = %s
                    WHERE goods_no = %s
                """, (raw, date.today(), gno))

            if raw:
                count = len([s for s in raw.split(',') if s.strip()])
                print(f"    ✅ {count}개 성분 | {raw[:60]}...")
                ok += 1
            else:
                print(f"    ❌ 전성분 없음 (패치류/비화장품)")
                skipped += 1

            time.sleep(random.uniform(1.5, 3.0))

        print(f"\n=== 완료: {ok}개 수집 / {skipped}개 미기재 ===")
    finally:
        conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='이미 수집된 상품도 재수집')
    args = parser.parse_args()
    run(force=args.force)
