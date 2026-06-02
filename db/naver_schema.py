import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]


def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor,
                            options="-c statement_timeout=0 -c search_path=naver")


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
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_nv_trend_uniq ON trends(keyword, period)")
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
                    is_ours       BOOLEAN DEFAULT FALSE
                )
            """)
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_nv_rank_uniq ON search_ranks(rank_date, keyword, rank_position)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_rank_date ON search_ranks(rank_date DESC)")

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
