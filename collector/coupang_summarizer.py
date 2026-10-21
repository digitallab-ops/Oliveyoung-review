import os
import sys
import time
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from openai import OpenAI
from db.coupang_schema import get_conn, init_db

# 요약은 정확도보다 꾸준히 도는 게 중요해서 저가 모델을 쓴다.
# summarizer.py 와 같은 모델로 맞춰 둔다
client = OpenAI()  # reads OPENAI_API_KEY from env
MODEL = 'gpt-4o-mini'

SYSTEM = """당신은 K-뷰티 브랜드 전략 전문가입니다. 셀퓨전씨 제품팀의 전속 인사이트 파트너로, 쿠팡 실구매 리뷰를 분석하여 제품 개선과 마케팅에 바로 활용할 수 있는 인사이트를 도출합니다.

반드시 아래 4개 섹션으로 구분하여 분석하세요. 섹션 헤더는 정확히 대괄호 형식을 사용하세요.

[핵심 칭찬 포인트]
[아쉬운 점 & 개선 기회]
[소비자 특성]
[마케팅 인사이트]

규칙:
· 각 항목은 반드시 "· " 기호로 시작
· **, ##, >, 백틱 등 마크다운 기호 절대 사용 금지
· 이모지 사용 금지
· "많다" 대신 "5★ 리뷰의 약 N%" 또는 "10개 중 N개" 같은 구체적 표현
· 셀퓨전씨 제품팀이 내일 당장 실행할 수 있는 제안 포함
· 각 섹션 3~4개 항목"""


def _already_ran_today(conn, product_id):
    with conn.cursor() as cur:
        if product_id:
            cur.execute(
                "SELECT 1 FROM insight_history "
                "WHERE product_id = %s "
                "AND DATE(created_at AT TIME ZONE 'Asia/Seoul') = CURRENT_DATE "
                "LIMIT 1",
                (product_id,),
            )
        else:
            cur.execute(
                "SELECT 1 FROM insight_history "
                "WHERE product_id IS NULL "
                "AND DATE(created_at AT TIME ZONE 'Asia/Seoul') = CURRENT_DATE "
                "LIMIT 1"
            )
        return cur.fetchone() is not None


def _fetch_reviews(conn, product_id):
    cond = "AND r.product_id = %s" if product_id else ""
    params = [product_id] if product_id else []
    query = f"""
        (SELECT r.rating, SUBSTRING(r.content, 1, 200) AS content,
                COALESCE(p.product_name, '') AS product_name
         FROM reviews r LEFT JOIN products p ON r.product_id = p.product_id
         WHERE r.content IS NOT NULL AND LENGTH(r.content) > 10
               AND r.rating <= 2 {cond}
         ORDER BY r.created_at DESC LIMIT 40)
        UNION ALL
        (SELECT r.rating, SUBSTRING(r.content, 1, 200) AS content,
                COALESCE(p.product_name, '') AS product_name
         FROM reviews r LEFT JOIN products p ON r.product_id = p.product_id
         WHERE r.content IS NOT NULL AND LENGTH(r.content) > 10
               AND r.rating = 3 {cond}
         ORDER BY r.created_at DESC LIMIT 20)
        UNION ALL
        (SELECT r.rating, SUBSTRING(r.content, 1, 200) AS content,
                COALESCE(p.product_name, '') AS product_name
         FROM reviews r LEFT JOIN products p ON r.product_id = p.product_id
         WHERE r.content IS NOT NULL AND LENGTH(r.content) > 10
               AND r.rating >= 4 {cond}
         ORDER BY r.created_at DESC LIMIT 90)
    """
    with conn.cursor() as cur:
        cur.execute(query, params * 3)
        return list(cur.fetchall())


def _generate_insight(reviews):
    review_text = '\n'.join(
        f"[★{r['rating']}] {(r['product_name'] + ' — ') if r['product_name'] else ''}{r['content']}"
        for r in reviews
    )
    res = client.chat.completions.create(
        model=MODEL,
        max_tokens=1200,
        messages=[
            {'role': 'system', 'content': SYSTEM},
            {'role': 'user', 'content': f"쿠팡 실구매 리뷰 {len(reviews)}개를 분석해줘:\n\n{review_text}"},
        ],
    )
    return (res.choices[0].message.content or '').strip()


def _save(conn, product_id, product_name, review_count, content):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO insight_history (product_id, product_name, review_count, content) "
            "VALUES (%s, %s, %s, %s)",
            [product_id or None, product_name or None, review_count, content],
        )


def _run_for(conn, product_id, label):
    if _already_ran_today(conn, product_id):
        print(f"  {label}: 오늘 이미 분석 완료 — 스킵")
        return

    reviews = _fetch_reviews(conn, product_id)
    if len(reviews) < 10:
        print(f"  {label}: 리뷰 부족 ({len(reviews)}개) — 스킵")
        return

    print(f"  {label}: {len(reviews)}개 리뷰 분석 중...")
    for attempt in range(2):
        try:
            content = _generate_insight(reviews)
            product_name = reviews[0]['product_name'] if product_id else ''
            _save(conn, product_id, product_name, len(reviews), content)
            print(f"  {label}: 저장 완료")
            return
        except Exception as e:
            if attempt == 0 and ('rate_limit' in str(e).lower() or '429' in str(e)):
                print(f"  {label}: rate limit — 60초 대기...")
                time.sleep(60)
            else:
                print(f"  {label}: 오류 — {e}")
                return


def run():
    print("=== 쿠팡 리뷰 AI 인사이트 생성 시작 ===\n")
    conn = get_conn()
    conn.autocommit = True
    try:
        init_db(conn=conn)

        # 전체 브랜드
        _run_for(conn, None, '전체 브랜드')
        time.sleep(10)

        # 상품별
        with conn.cursor() as cur:
            cur.execute("SELECT product_id, product_name FROM products ORDER BY product_name")
            products = list(cur.fetchall())

        for p in products:
            _run_for(conn, p['product_id'], (p['product_name'] or p['product_id'])[:30])
            time.sleep(10)

        print("\n=== 완료 ===")
    finally:
        conn.close()


if __name__ == "__main__":
    run()
