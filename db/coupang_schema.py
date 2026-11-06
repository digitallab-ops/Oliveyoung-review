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
        options="-c statement_timeout=0 -c search_path=coupang"))


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
            cur.execute("""
                CREATE TABLE IF NOT EXISTS insight_history (
                    id           SERIAL PRIMARY KEY,
                    product_id   TEXT,
                    product_name TEXT,
                    review_count INT,
                    content      TEXT NOT NULL,
                    created_at   TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cp_insight_created ON insight_history(created_at DESC)")

            # 가격·평점 일별 스냅샷.
            #
            # 왜 필요한가: 쿠팡에는 가격 이력이 아예 없었다(올리브영은 price_history 가
            # 있다). 쿠팡은 가격 변동이 큰 채널이라 이게 없으면 '왜 순위가 떨어졌나'
            # 를 설명할 수 없다.
            #
            # 공짜인 이유: 순위 수집이 이미 검색·카테고리 페이지를 하루 4번 열고
            # 있고, 그 페이지 안에 가격·할인율·별점·리뷰수가 전부 들어 있다.
            # 추가 요청이 0건이라 차단 위험도 늘지 않는다.
            #
            # 하루 한 행만 남긴다(UNIQUE). 같은 날 여러 번 돌면 마지막 값으로 갱신.
            cur.execute("""
                CREATE TABLE IF NOT EXISTS price_history (
                    id            SERIAL PRIMARY KEY,
                    product_id    TEXT NOT NULL,
                    recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
                    price         INT,          -- 판매가
                    base_price    INT,          -- 정가(할인 전)
                    discount_rate INT,          -- 할인율 %
                    unit_price    INT,          -- 1개당 단가 (묶음 상품만)
                    rating        REAL,         -- 평균 별점
                    review_count  INT,
                    is_ours       BOOLEAN DEFAULT FALSE,
                    product_name  TEXT,
                    collected_at  TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_price_uniq
                           ON price_history(product_id, recorded_date)""")
            cur.execute("""CREATE INDEX IF NOT EXISTS idx_cp_price_date
                           ON price_history(recorded_date DESC)""")

    if conn is not None:
        _run(conn)
    else:
        with get_conn() as c:
            _run(c)
            c.commit()
