"""
올리브영 전성분 파싱 최종 검증 (getGoodsArtcAjax + 확인된 패턴)
"""
import re, sys, os, time
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

try:
    from curl_cffi import requests as cf_requests
    _IMPERSONATE = "chrome131"
except ImportError:
    import requests as cf_requests
    _IMPERSONATE = None

from dotenv import load_dotenv
load_dotenv()
from db.schema import get_conn

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Referer': 'https://www.oliveyoung.co.kr/store/main/getBestList.do',
}

def get(url, **kwargs):
    kw = dict(headers=HEADERS, timeout=15, **kwargs)
    if _IMPERSONATE:
        return cf_requests.get(url, impersonate=_IMPERSONATE, **kw)
    return cf_requests.get(url, **kw)

def scrape(goods_no):
    r = get(f"https://www.oliveyoung.co.kr/store/goods/getGoodsArtcAjax.do?goodsNo={goods_no}")
    if r.status_code != 200:
        return None, '요청 실패'
    html = r.text
    m = re.search(r'<dt[^>]*>화장품법에 따라 기재해야 하는 모든 성분</dt>\s*(?:<[^>]+>\s*)*<dd[^>]*>([\s\S]*?)</dd>', html, re.I)
    if not m:
        return None, '패턴 없음'
    raw = re.sub(r'<[^>]+>', '', m.group(1)).replace('&amp;', '&').replace('&nbsp;', ' ')
    raw = re.sub(r'\s+', ' ', raw).strip()
    return raw, 'OK'

# DB에서 경쟁사 10개 테스트
conn = get_conn()
with conn.cursor() as cur:
    cur.execute("SELECT goods_no, goods_name FROM products WHERE is_competitor=true LIMIT 10")
    rows = cur.fetchall()
conn.close()

ok = 0
for row in rows:
    gno = row['goods_no']
    name = row['goods_name'][:35]
    raw, status = scrape(gno)
    if raw:
        count = len([s for s in raw.split(',') if s.strip()])
        print(f"  ✅ {name}")
        print(f"     → {count}개 성분 | {raw[:80]}...")
        ok += 1
    else:
        print(f"  ❌ {name} ({status})")
    time.sleep(1.5)

print(f"\n결과: {ok}/{len(rows)} 성공")
