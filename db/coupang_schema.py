import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]


def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor,
                            options="-c statement_timeout=0 -c search_path=coupang")


def init_db(conn=None):
    def _run(c):
        with c.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS coupang")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS products (
                    product_id     TEXT PRIMARY KEY,
                    product_name   TEXT,
                    vendor_item_id TEXT,
                    rating         REAL,
                    review_count   INT,
                    first_seen     DATE DEFAULT CURRENT_DATE,
                    last_seen      DATE DEFAULT CURRENT_DATE
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS reviews (
                    review_id        BIGINT PRIMARY KEY,
                    product_id       TEXT REFERENCES products(product_id),
                    content          TEXT,
                    rating           SMALLINT,
                    helpful_count    INT DEFAULT 0,
                    purchased_option TEXT,
                    created_at       TEXT,
                    collected_at     TIMESTAMP DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cp_reviews_product ON reviews(product_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cp_reviews_created ON reviews(created_at)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS search_rankings (
                    id            SERIAL PRIMARY KEY,
                    keyword       TEXT NOT NULL,
                    rank_date     DATE NOT NULL DEFAULT CURRENT_DATE,
                    product_id    TEXT NOT NULL,
                    product_name  TEXT,
                    rank_position INT NOT NULL,
                    is_ad         BOOLEAN DEFAULT FALSE,
                    is_ours       BOOLEAN DEFAULT FALSE
                )
            """)
            cur.execute("""
                ALTER TABLE search_rankings
                ADD COLUMN IF NOT EXISTS is_ours BOOLEAN DEFAULT FALSE
            """)
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_search_uniq ON search_rankings(keyword, rank_date, product_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cp_search_date ON search_rankings(rank_date DESC)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS category_rankings (
                    id            SERIAL PRIMARY KEY,
                    rank_date     DATE NOT NULL DEFAULT CURRENT_DATE,
                    rank_hour     SMALLINT NOT NULL,
                    category_name TEXT NOT NULL,
                    rank_position INT NOT NULL,
                    product_id    TEXT NOT NULL,
                    product_name  TEXT NOT NULL,
                    is_ours       BOOLEAN DEFAULT FALSE
                )
            """)
            cur.execute("""
                ALTER TABLE category_rankings
                ADD COLUMN IF NOT EXISTS is_ours BOOLEAN DEFAULT FALSE
            """)
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_cat_uniq ON category_rankings(rank_date, rank_hour, category_name, rank_position)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cp_cat_date ON category_rankings(rank_date DESC)")

    if conn is not None:
        _run(conn)
    else:
        with get_conn() as c:
            _run(c)
            c.commit()
