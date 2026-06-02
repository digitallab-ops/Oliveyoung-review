import os
import re
import sys
import time
import requests
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from anthropic import Anthropic
from db.naver_schema import get_conn, init_db

NAVER_ID     = os.environ["NAVER_CLIENT_ID"]
NAVER_SECRET = os.environ["NAVER_CLIENT_SECRET"]

_HEADERS = {
    "X-Naver-Client-Id":     NAVER_ID,
    "X-Naver-Client-Secret": NAVER_SECRET,
}

OUR_BRAND = "셀퓨전씨"

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

def _is_ours(title: str, mall: str) -> bool:
    return OUR_BRAND in title or OUR_BRAND in mall

def _infer_brand(title: str):
    for b in [OUR_BRAND] + COMPETITORS:
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
            "https://openapi.naver.com/v1/datalab/search",
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
        r = requests.get(
            "https://openapi.naver.com/v1/search/shop.json",
            headers=_HEADERS,
            params={"query": query, "display": display, "sort": "sim"},
            timeout=10,
        )
        r.raise_for_status()
        return r.json().get("items", [])
    except Exception as e:
        print(f"  쇼핑 검색 오류 ({query}): {e}")
        return []


# ── DB 저장 ──────────────────────────────────────────────────────────────────

def save_trends(conn, results: list) -> int:
    count = 0
    with conn.cursor() as cur:
        for group in results:
            kw = group["title"]
            for pt in group.get("data", []):
                period = pt["period"][:10]
                cur.execute(
                    """INSERT INTO trends (keyword, period, ratio)
                       VALUES (%s, %s, %s)
                       ON CONFLICT (keyword, period) DO UPDATE SET ratio = EXCLUDED.ratio""",
                    (kw, period, pt["ratio"]),
                )
                count += 1
    return count


def save_search_ranks(conn, keyword: str, items: list):
    today = datetime.today().strftime("%Y-%m-%d")
    with conn.cursor() as cur:
        cur.execute("DELETE FROM search_ranks WHERE rank_date = %s AND keyword = %s", (today, keyword))
        for i, item in enumerate(items, 1):
            title = _clean(item.get("title", ""))
            mall  = item.get("mallName", "")
            cur.execute(
                """INSERT INTO search_ranks
                       (rank_date, keyword, rank_position, product_title, mall_name, price, link, is_ours)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (rank_date, keyword, rank_position) DO NOTHING""",
                (today, keyword, i, title, mall,
                 int(item.get("lprice", 0) or 0),
                 item.get("link", ""),
                 _is_ours(title, mall)),
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

    print("  Claude 분석 중...")
    anthropic = Anthropic()
    msg = anthropic.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1000,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    content = msg.content[0].text.strip()

    with conn.cursor() as cur:
        cur.execute("INSERT INTO insights (content) VALUES (%s)", (content,))
    print("  저장 완료")


# ── 메인 ─────────────────────────────────────────────────────────────────────

def run():
    print("=== 네이버 쇼핑 데이터 수집 시작 ===\n")
    conn = get_conn()
    conn.autocommit = True
    try:
        init_db(conn=conn)

        # 1. DataLab 트렌드
        print("[1/4] DataLab 검색 트렌드...")
        results = fetch_trends(TREND_KEYWORDS)
        if results:
            n = save_trends(conn, results)
            print(f"  {n}개 데이터 포인트 저장")
        else:
            print("  데이터 없음")
        time.sleep(1)

        # 2. 자사 검색 순위
        print("[2/4] 자사 제품 검색 노출 순위...")
        for query in OWN_QUERIES:
            items = search_shopping(query, display=40)
            if items:
                save_search_ranks(conn, query, items)
                ours = [i+1 for i, it in enumerate(items)
                        if _is_ours(_clean(it.get("title","")), it.get("mallName",""))]
                print(f"  '{query}': 자사 {len(ours)}개 노출, 위치={ours[:3]}")
            time.sleep(0.5)

        # 3. 경쟁사 시장
        print("[3/4] 경쟁사 시장 수집...")
        for cat in CATEGORIES:
            all_items = search_shopping(cat, display=40)
            for brand in COMPETITORS[:5]:
                all_items += search_shopping(f"{brand} {cat}", display=20)
                time.sleep(0.3)
            seen, deduped = set(), []
            for it in all_items:
                key = (_clean(it.get("title",""))[:50].lower(), it.get("mallName","").lower())
                if key not in seen:
                    seen.add(key)
                    deduped.append(it)
            save_market_items(conn, cat, deduped)
            print(f"  {cat}: {len(deduped)}개")
            time.sleep(0.5)

        # 4. AI 인사이트
        print("[4/4] AI 인사이트...")
        generate_and_save_insight(conn)

        print("\n=== 완료 ===")
    finally:
        conn.close()


if __name__ == "__main__":
    run()
