"""네이버 데이터 수집 — 현재는 DataLab 검색 트렌드만 받는다.

쇼핑 검색(search/shop.json)은 2026-08-01 부터 네이버가 닫았다.
키 문제가 아니다 — 같은 키로 블로그 검색은 200 이 오고, 쇼핑만
`404 SE05 존재하지 않는 검색 api` 가 온다. 우리 쪽에서 고칠 방법이 없다.

그래서 검색 순위(search_ranks)와 시장 수집(market_items)은 떼어 냈다.
마지막 데이터는 2026-07-30/31 이고, 화면에서도 뺐다 — 3개월 지난 값이
최신처럼 보이는 게 제일 나쁘다.

DataLab 트렌드는 별개 API 라 지금도 정상이다. 키워드 수요 추이는 계속 쌓인다.
쇼핑 API 가 다시 열리면 search_shopping / save_search_ranks / save_market_items
가 아래에 그대로 남아 있으니 run() 에 단계만 되살리면 된다.
"""
import os
import re
import sys
import time
import requests
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from openai import OpenAI
from db.naver_schema import get_conn, init_db

# 인사이트 요약은 꾸준히 도는 게 우선이라 저가 모델을 쓴다
MODEL = 'gpt-4o-mini'

NAVER_ID     = os.environ["NAVER_CLIENT_ID"]
NAVER_SECRET = os.environ["NAVER_CLIENT_SECRET"]

# NAVER API HUB 로 이관됐다(2026-06-25 개시, 구 개발자센터 키는 2027-06-30 까지).
# 주소와 인증 헤더가 둘 다 바뀌었다 — 구 키/구 헤더로는 401 이 난다.
#   구: openapi.naver.com        + X-Naver-Client-Id / -Secret
#   신: naverapihub.apigw.ntruss.com + X-NCP-APIGW-API-KEY-ID / -KEY
HUB_BASE = "https://naverapihub.apigw.ntruss.com"

_HEADERS = {
    "X-NCP-APIGW-API-KEY-ID": NAVER_ID,
    "X-NCP-APIGW-API-KEY":    NAVER_SECRET,
}

# 구 개발자센터 헤더 — 쇼핑 검색을 되살릴 일이 있으면 쓸 수 있게 남겨 둔다.
# (쇼핑 검색 API 자체가 2026-07-31 에 종료돼 지금은 쓸 데가 없다)
_LEGACY_HEADERS = {
    "X-Naver-Client-Id":     NAVER_ID,
    "X-Naver-Client-Secret": NAVER_SECRET,
}

OUR_IDENTIFIERS = ["셀퓨전씨", "cellfusionc", "cell fusion c"]

TREND_KEYWORDS = ["셀퓨전씨", "선크림", "선세럼", "선스프레이", "선스틱"]

OWN_QUERIES = [
    "셀퓨전씨 레이저UV 썬스크린",
    "셀퓨전씨 아쿠아티카 선크림",
    "셀퓨전씨 선세럼",
    "셀퓨전씨 선스프레이",
    "셀퓨전씨 스팟토닝 선크림",
    "셀퓨전씨 더마릴리프 선크림",
]

CATEGORIES = ["선크림", "선세럼", "선스프레이", "선스틱"]
COMPETITORS = ["닥터지", "라로슈포제", "AHC", "달바", "이니스프리", "비오레", "라운드랩", "아누아"]

_ML_RE  = re.compile(r'(\d+(?:\.\d+)?)\s*(?:ml|mL|㎖)', re.IGNORECASE)
_TAG_RE = re.compile(r'<[^>]+>')


def _clean(text: str) -> str:
    return _TAG_RE.sub('', text).strip()

def _parse_ml(text: str):
    m = _ML_RE.search(text)
    return float(m.group(1)) if m else None

def _is_ours(title: str, mall: str = "") -> bool:
    combined = (title + " " + mall).lower()
    return any(kw.lower() in combined for kw in OUR_IDENTIFIERS)

def _infer_brand(title: str):
    if _is_ours(title):
        return "셀퓨전씨"
    for b in COMPETITORS:
        if b in title:
            return b
    return None


# ── API 호출 ─────────────────────────────────────────────────────────────────

def fetch_trends(keywords: list) -> list:
    end   = datetime.today()
    start = end - timedelta(weeks=8)
    payload = {
        "startDate":     start.strftime("%Y-%m-%d"),
        "endDate":       end.strftime("%Y-%m-%d"),
        "timeUnit":      "week",
        "keywordGroups": [{"groupName": kw, "keywords": [kw]} for kw in keywords[:5]],
    }
    try:
        r = requests.post(
            f"{HUB_BASE}/search-trend/v1/search",
            headers={**_HEADERS, "Content-Type": "application/json"},
            json=payload,
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("results", [])
    except Exception as e:
        print(f"  DataLab 오류: {e}")
        return []


def search_shopping(query: str, display: int = 40) -> list:
    try:
        # 이 API 는 2026-07-31 에 종료됐다(공식 대체 없음). 호출부도 없다.
        # 구 개발자센터 헤더를 쓰던 함수라 그대로 남겨 둔다 — Hub 헤더로는 어차피 안 된다.
        r = requests.get(
            "https://openapi.naver.com/v1/search/shop.json",
            headers=_LEGACY_HEADERS,
            params={"query": query, "display": display, "sort": "sim"},
            timeout=10,
        )
        r.raise_for_status()
        return r.json().get("items", [])
    except Exception as e:
        # 2026-08-01 부터 전 질의가 404 인데도 빈 리스트만 돌려줘서
        # "시장 0개" 로 조용히 끝났다. 실패를 세어 두고 run() 이 종료 코드에
        # 반영한다 — 그래야 슬랙과 작업 스케줄러가 장애를 본다.
        globals()['_SHOP_ERRORS'] = globals().get('_SHOP_ERRORS', 0) + 1
        print(f"  쇼핑 검색 오류 ({query}): {e}")
        return []


# ── DB 저장 ──────────────────────────────────────────────────────────────────

def save_trends(conn, results: list, time_unit: str = 'week', scale: float = 1.0) -> int:
    """지수를 저장한다.

    time_unit 으로 계열을 나누는 이유는 db/naver_schema.py 주석 참고 —
    요청 범위가 다르면 같은 날짜도 숫자가 달라져서 섞으면 안 된다.
    scale 은 키워드를 6개 이상 볼 때 기준 키워드로 맞추기 위한 보정값이다.
    """
    count = 0
    with conn.cursor() as cur:
        for group in results:
            kw = group["title"]
            for pt in group.get("data", []):
                cur.execute(
                    """INSERT INTO trends (keyword, period, ratio, time_unit)
                       VALUES (%s, %s, %s, %s)
                       ON CONFLICT (keyword, period, time_unit)
                       DO UPDATE SET ratio = EXCLUDED.ratio""",
                    (kw, pt["period"][:10], pt["ratio"] * scale, time_unit),
                )
                count += 1
    return count


def save_search_ranks(conn, keyword: str, items: list, query_type: str = 'brand'):
    today = datetime.today().strftime("%Y-%m-%d")
    with conn.cursor() as cur:
        cur.execute("DELETE FROM search_ranks WHERE rank_date = %s AND keyword = %s", (today, keyword))
        for i, item in enumerate(items, 1):
            title = _clean(item.get("title", ""))
            mall  = item.get("mallName", "")
            cur.execute(
                """INSERT INTO search_ranks
                       (rank_date, keyword, rank_position, product_title, mall_name, price, link, is_ours, query_type)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (rank_date, keyword, rank_position) DO NOTHING""",
                (today, keyword, i, title, mall,
                 int(item.get("lprice", 0) or 0),
                 item.get("link", ""),
                 _is_ours(title, mall),
                 query_type),
            )


def save_market_items(conn, category: str, items: list):
    today = datetime.today().strftime("%Y-%m-%d")
    with conn.cursor() as cur:
        cur.execute("DELETE FROM market_items WHERE collected_date = %s AND category = %s", (today, category))
        for item in items:
            title = _clean(item.get("title", ""))
            mall  = item.get("mallName", "")
            cur.execute(
                """INSERT INTO market_items
                       (collected_date, category, brand, product_title, mall_name, price, is_ours, volume_ml)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (today, category,
                 _infer_brand(title),
                 title, mall,
                 int(item.get("lprice", 0) or 0),
                 _is_ours(title, mall),
                 _parse_ml(title)),
            )


# ── AI 인사이트 ──────────────────────────────────────────────────────────────

def _already_ran_today(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM insights "
            "WHERE DATE(collected_at AT TIME ZONE 'Asia/Seoul') = CURRENT_DATE LIMIT 1"
        )
        return cur.fetchone() is not None


def generate_and_save_insight(conn):
    if _already_ran_today(conn):
        print("  오늘 이미 분석 완료 — 스킵")
        return

    with conn.cursor() as cur:
        cur.execute("""
            SELECT keyword, period::text, ratio
            FROM trends
            WHERE period >= CURRENT_DATE - INTERVAL '8 weeks'
            ORDER BY keyword, period
        """)
        trend_rows = list(cur.fetchall())

        cur.execute("""
            SELECT keyword, rank_position, product_title, mall_name, price
            FROM search_ranks
            WHERE rank_date = CURRENT_DATE AND is_ours = TRUE
            ORDER BY keyword, rank_position
        """)
        own_ranks = list(cur.fetchall())

        cur.execute("""
            SELECT category,
                   COUNT(*)         AS cnt,
                   MIN(price)       AS min_price,
                   AVG(price)::int  AS avg_price
            FROM market_items
            WHERE collected_date = CURRENT_DATE AND is_ours = FALSE AND price > 0
            GROUP BY category
            ORDER BY category
        """)
        market_summary = list(cur.fetchall())

    if not trend_rows and not own_ranks:
        print("  데이터 없음 — 스킵")
        return

    # 쇼핑 API 가 2026-08-01 부터 404 라 search_ranks/market_items 가 비었는데도
    # 트렌드만으로 "검색 노출 현황", "경쟁사 시장" 4개 섹션을 쓰라는 프롬프트가
    # 그대로 나갔다. 근거 없는 문장이 매일 DB 에 쌓인다(환각).
    # 돈 문제가 아니라 신뢰 문제라, 입력이 비면 아예 만들지 않는다.
    if not own_ranks and not market_summary:
        print("  검색 순위·시장 데이터가 모두 비었다 — 인사이트를 만들지 않는다")
        print("  (네이버 쇼핑 API 응답을 먼저 확인할 것)")
        return

    trend_text = "\n".join(
        f"  {r['keyword']} ({r['period']}): {r['ratio']}"
        for r in trend_rows[-30:]
    ) or "  없음"
    rank_text = "\n".join(
        f"  {r['keyword']}: {r['rank_position']}위 — {r['product_title'][:40]}"
        for r in own_ranks
    ) or "  없음"
    market_text = "\n".join(
        f"  {r['category']}: 경쟁상품 {r['cnt']}개, 최저 {r['min_price']:,}원, 평균 {r['avg_price']:,}원"
        for r in market_summary
    ) or "  없음"

    prompt = f"""네이버 쇼핑 데이터를 분석해주세요.

[DataLab 검색 트렌드 (최근 8주, 0~100 지수)]
{trend_text}

[셀퓨전씨 검색 노출 순위]
{rank_text}

[경쟁사 시장 현황]
{market_text}"""

    system = """당신은 K-뷰티 브랜드 전략 전문가입니다. 셀퓨전씨 팀의 네이버 쇼핑 인사이트 파트너입니다.

반드시 아래 4개 섹션으로 분석하세요. 섹션 헤더는 정확히 대괄호 형식을 사용하세요.

[트렌드 시그널]
[검색 노출 현황]
[경쟁사 시장]
[액션 제안]

규칙:
· 각 항목은 반드시 "· " 기호로 시작
· **, ##, 마크다운 기호 절대 사용 금지
· 이모지 사용 금지
· 구체적 수치 사용 (전주 대비 N포인트, N위 등)
· 셀퓨전씨 팀이 내일 당장 실행할 수 있는 제안 포함
· 각 섹션 3~4개 항목"""

    print("  요약 생성 중...")
    client = OpenAI()  # reads OPENAI_API_KEY from env
    res = client.chat.completions.create(
        model=MODEL,
        max_tokens=1000,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    )
    content = (res.choices[0].message.content or '').strip()

    with conn.cursor() as cur:
        cur.execute("INSERT INTO insights (content) VALUES (%s)", (content,))
    print("  저장 완료")


# ── 메인 ─────────────────────────────────────────────────────────────────────

def run():
    print("=== 네이버 DataLab 검색 트렌드 수집 ===\n")
    conn = get_conn()
    conn.autocommit = True
    try:
        init_db(conn=conn)

        # DataLab 검색 트렌드 — 이 수집기에 남은 유일한 단계다.
        print("[1/1] DataLab 검색 트렌드...")
        results = fetch_trends(TREND_KEYWORDS)
        if not results:
            print("  데이터 없음 — DataLab 응답을 확인할 것")
            sys.exit(5)          # finally 에서 conn 은 닫힌다
        n = save_trends(conn, results)
        print(f"  {n}개 데이터 포인트 저장")

        print("\n=== 완료 ===")
    finally:
        conn.close()


if __name__ == "__main__":
    run()
