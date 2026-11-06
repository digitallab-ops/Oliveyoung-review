import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]


def get_conn():
    # 타임존을 KST 로 맞추는 이유와 방식은 db/schema.py 의 _set_kst 참고.
    # (풀러가 options 의 timezone 을 무시해서 접속 뒤 SET 으로 건다)
    from db.schema import _set_kst
    return _set_kst(psycopg2.connect(
        DATABASE_URL, cursor_factory=RealDictCursor, connect_timeout=15,
        options="-c statement_timeout=0 -c search_path=naver"))


def init_db(conn=None):
    def _run(c):
        with c.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS naver")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS trends (
                    id           SERIAL PRIMARY KEY,
                    keyword      TEXT NOT NULL,
                    period       DATE NOT NULL,
                    ratio        REAL NOT NULL,
                    collected_at DATE DEFAULT CURRENT_DATE
                )
            """)
            # DataLab 지수는 '요청 범위 안에서의 상대값'이다. 범위가 다르면
            # 같은 키워드·같은 날짜도 숫자가 달라진다(8주 요청 93.8 vs 10년 요청 4.0).
            # 그래서 주별(최근)과 월별(장기)을 한 칸에 섞으면 그래프가 깨진다.
            # time_unit 으로 계열을 나눠 둔다.
            cur.execute("ALTER TABLE trends ADD COLUMN IF NOT EXISTS time_unit TEXT NOT NULL DEFAULT 'week'")
            cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_nv_trend_uniq2
                           ON trends(keyword, period, time_unit)""")
            cur.execute("DROP INDEX IF EXISTS naver.idx_nv_trend_uniq")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_trend_period ON trends(period DESC)")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS search_ranks (
                    id            SERIAL PRIMARY KEY,
                    rank_date     DATE NOT NULL DEFAULT CURRENT_DATE,
                    keyword       TEXT NOT NULL,
                    rank_position INT NOT NULL,
                    product_title TEXT,
                    mall_name     TEXT,
                    price         INT,
                    link          TEXT,
                    is_ours       BOOLEAN DEFAULT FALSE,
                    query_type    TEXT DEFAULT 'brand'
                )
            """)
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_nv_rank_uniq ON search_ranks(rank_date, keyword, rank_position)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_rank_date ON search_ranks(rank_date DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_rank_type  ON search_ranks(query_type)")
            # 기존 테이블에 컬럼 추가 (이미 있으면 무시)
            cur.execute("ALTER TABLE search_ranks ADD COLUMN IF NOT EXISTS query_type TEXT DEFAULT 'brand'")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS market_items (
                    id             SERIAL PRIMARY KEY,
                    collected_date DATE NOT NULL DEFAULT CURRENT_DATE,
                    category       TEXT NOT NULL,
                    brand          TEXT,
                    product_title  TEXT,
                    mall_name      TEXT,
                    price          INT,
                    is_ours        BOOLEAN DEFAULT FALSE,
                    volume_ml      REAL
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_market_date ON market_items(collected_date DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_market_cat  ON market_items(category)")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS insights (
                    id           SERIAL PRIMARY KEY,
                    content      TEXT NOT NULL,
                    collected_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_insight_date ON insights(collected_at DESC)")

    if conn is not None:
        _run(conn)
    else:
        with get_conn() as c:
            _run(c)
            c.commit()
