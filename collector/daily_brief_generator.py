"""
매일 오전 9시 실행 — 오늘의 종합 인사이트 브리핑 생성 후 daily_briefs 테이블에 저장.
봇 전용 (대시보드 미표시).

사용: python -m collector.daily_brief_generator
"""
import os
import json
import logging
import psycopg2
from datetime import date
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_URL = os.environ["DATABASE_URL"]
OPENAI_KEY = os.environ["OPENAI_API_KEY"]

BRIEF_PROMPT = """당신은 셀퓨전씨 올리브영 인사이트 분석가입니다.
아래 데이터를 바탕으로 오늘의 브리핑을 작성하세요.

규칙:
- Slack mrkdwn 포맷 사용 (*굵게*, 번호 목록)
- 3~5개 핵심 포인트만, 불필요한 서론 없이
- 각 포인트는 데이터 근거 + 한 줄 해석
- 마지막에 오늘의 액션 포인트 1개 (→ 로 시작)
- 전체 400자 이내

데이터:
{data}
"""


def fetch_data(cur) -> dict:
    """오늘 브리핑에 필요한 데이터를 DB에서 수집."""

    # 1. 기본 현황
    cur.execute("""
        SELECT
            COUNT(*)                                         AS total_reviews,
            ROUND(AVG(score)::numeric, 2)                   AS avg_score,
            ROUND(COUNT(*) FILTER (WHERE is_repurchase) * 100.0 / NULLIF(COUNT(*), 0), 1) AS repurchase_pct
        FROM oliveyoung.reviews
        WHERE collected_at >= CURRENT_DATE - INTERVAL '7 days'
    """)
    week_stats = cur.fetchone()

    # 2. 전일 대비 순위 변화 (자사)
    cur.execute("""
        WITH today AS (
            SELECT DISTINCT ON (category_name, goods_no)
                category_name, goods_no, goods_name, rank_position
            FROM oliveyoung.market_rankings
            WHERE rank_date = CURRENT_DATE
            ORDER BY category_name, goods_no, rank_hour DESC
        ),
        yesterday AS (
            SELECT DISTINCT ON (category_name, goods_no)
                category_name, goods_no, rank_position
            FROM oliveyoung.market_rankings
            WHERE rank_date = CURRENT_DATE - INTERVAL '1 day'
            ORDER BY category_name, goods_no, rank_hour DESC
        )
        SELECT
            t.category_name,
            t.goods_name,
            t.rank_position                   AS rank_today,
            y.rank_position                   AS rank_yesterday,
            y.rank_position - t.rank_position AS change
        FROM today t
        JOIN yesterday y ON t.category_name = y.category_name AND t.goods_no = y.goods_no
        JOIN oliveyoung.products p ON t.goods_no = p.goods_no
        WHERE p.is_competitor = FALSE
        ORDER BY ABS(y.rank_position - t.rank_position) DESC
        LIMIT 5
    """)
    our_rank_changes = cur.fetchall()

    # 3. 카테고리별 우리 최고 순위
    cur.execute("""
        SELECT DISTINCT ON (mr.category_name)
            mr.category_name,
            mr.goods_name,
            mr.rank_position
        FROM oliveyoung.market_rankings mr
        JOIN oliveyoung.products p ON mr.goods_no = p.goods_no
        WHERE mr.rank_date = CURRENT_DATE
          AND p.is_competitor = FALSE
        ORDER BY mr.category_name, mr.rank_position
    """)
    our_best = cur.fetchall()

    # 4. 시장 Top 3 (경쟁사 포함)
    cur.execute("""
        SELECT DISTINCT ON (mr.category_name, mr.rank_position)
            mr.category_name,
            mr.goods_name,
            mr.rank_position,
            (p.is_competitor = FALSE) AS is_ours
        FROM oliveyoung.market_rankings mr
        LEFT JOIN oliveyoung.products p ON mr.goods_no = p.goods_no
        WHERE mr.rank_date = CURRENT_DATE
          AND mr.rank_position <= 3
        ORDER BY mr.category_name, mr.rank_position, mr.rank_hour DESC
        LIMIT 30
    """)
    market_top3 = cur.fetchall()

    # 5. 부정 리뷰 급증 알림
    cur.execute("""
        SELECT goods_name, neg_count_this_week, neg_count_last_week
        FROM (
            SELECT
                p.goods_name,
                COUNT(*) FILTER (WHERE r.collected_at >= CURRENT_DATE - 7 AND r.score <= 2) AS neg_count_this_week,
                COUNT(*) FILTER (WHERE r.collected_at >= CURRENT_DATE - 14
                                   AND r.collected_at < CURRENT_DATE - 7
                                   AND r.score <= 2)                                         AS neg_count_last_week
            FROM oliveyoung.reviews r
            JOIN oliveyoung.products p ON r.goods_no = p.goods_no
            WHERE p.is_competitor = FALSE
            GROUP BY p.goods_name
        ) sub
        WHERE neg_count_this_week > 0
          AND neg_count_this_week > neg_count_last_week * 1.5
        ORDER BY neg_count_this_week DESC
        LIMIT 3
    """)
    neg_alerts = cur.fetchall()

    return {
        "date": str(date.today()),
        "week_stats": {
            "total_reviews_7d": week_stats[0],
            "avg_score": float(week_stats[1] or 0),
            "repurchase_pct": float(week_stats[2] or 0),
        },
        "our_rank_changes": [
            {"category": r[0], "product": r[1], "today": r[2], "yesterday": r[3], "change": r[4]}
            for r in our_rank_changes
        ],
        "our_best_rank": [
            {"category": r[0], "product": r[1], "rank": r[2]}
            for r in our_best
        ],
        "market_top3": [
            {"category": r[0], "product": r[1], "rank": r[2], "is_ours": r[3]}
            for r in market_top3
        ],
        "negative_alerts": [
            {"product": r[0], "this_week": r[1], "last_week": r[2]}
            for r in neg_alerts
        ],
    }


def generate_brief(data: dict) -> str:
    client = OpenAI(api_key=OPENAI_KEY)
    resp = client.chat.completions.create(
        model="gpt-4o",   # 하루 1회 → 비싼 모델 써도 비용 낮음
        messages=[
            {"role": "user", "content": BRIEF_PROMPT.format(data=json.dumps(data, ensure_ascii=False, indent=2))}
        ],
        max_tokens=600,
        temperature=0.3,
    )
    return resp.choices[0].message.content.strip()


def save_brief(cur, brief_text: str):
    cur.execute("""
        INSERT INTO oliveyoung.daily_briefs (brief_date, brief_text)
        VALUES (CURRENT_DATE, %s)
        ON CONFLICT (brief_date) DO UPDATE SET brief_text = EXCLUDED.brief_text, generated_at = NOW()
    """, (brief_text,))


def main():
    conn = psycopg2.connect(DB_URL)
    try:
        with conn:
            with conn.cursor() as cur:
                log.info("데이터 수집 중...")
                data = fetch_data(cur)
                log.info("브리핑 생성 중 (gpt-4o)...")
                brief = generate_brief(data)
                save_brief(cur, brief)
                log.info("저장 완료:\n%s", brief)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
