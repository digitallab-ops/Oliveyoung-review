import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]

_STOPWORDS_SQL = """
    '이','가','을','를','은','는','에','의','도','로','이고','하고',
    '있어','없어','같아','같은','너무','진짜','정말','많이','조금',
    '이거','거예요','에요','아요','어요','네요','해요','했어','해서',
    '그리고','그냥','근데','하지만','그런데','때문에','사용','구매',
    '후기','리뷰','상품','제품','배송','올리브영','한번','처음',
    '계속','매일','항상','하루','저는','제가','저도','이런','그런',
    '좋아','좋고','좋은','좋은데','좋았','바르고','피부','크림',
    '세럼','앰플','토너','로션','에센스','미스트','수분','보습',
    '좋아요','같아요','있어요','없어요','있어서','없어서','없이',
    '이에요','인데요','거든요','이라서','이라고','이라는','이라도',
    '처럼','에서','에도','으로','와서','이라','이며','이나',
    '약간','이건','이게','이번','이미','그간','그게','그건',
    '아요','어요','아서','어서','와요','되요','되어','됩니다',
    '해줘','해요','해서','해도','하면','하며','하는','한다',
    '있고','없고','같고','하고','이고','이든','인지','인데',
    '정도','때문','경우','기간','이후','이전','그후','이상',
    '사실','부분','느낌','생각','정말로','너무나','조금씩',
    '셀퓨전씨','셀퓨전','올리브','느낌이','느낌은','느낌도',
    '것같','것도','것이','건지','건데','거라','거고','거야',
    '엄청','꾸준히','아주','살짝','일단','다시','원래','아직',
    '항상','그냥','정도로','따로','더욱','특히','오히려','확실히',
    '바로','같이','함께','다들','많은','적은','없는','있는',
    '완전','요즘','생각보다','그래도','그러나','하지만','그리고'
"""

_SUFFIX_FILTER_SQL = """
    word !~ '(아요|어요|이에요|해요|하고|이고|이라|에서|으로|에도|처럼|아서|어서|와서|이며|이나|이든|없이|인데|한다|됩니다|해서|하면|하며|습니다|가|이|을|를|은|는|에|의|도|로|와|고|며|면|서|든|른|지|라|요|기|데|게|다|ㄹ|할|수|서|적)$'
"""


def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor,
                            options="-c statement_timeout=0")


def init_db(conn=None):
    def _run(c):
        with c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS products (
                    goods_no    TEXT PRIMARY KEY,
                    goods_name  TEXT,
                    rating      REAL,
                    review_count TEXT,
                    first_seen  DATE DEFAULT CURRENT_DATE,
                    last_seen   DATE DEFAULT CURRENT_DATE
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS reviews (
                    review_id     BIGINT PRIMARY KEY,
                    goods_no      TEXT REFERENCES products(goods_no),
                    content       TEXT,
                    score         SMALLINT,
                    skin_type     TEXT,
                    skin_trouble  TEXT,
                    is_repurchase BOOLEAN,
                    created_at    TEXT,
                    collected_at  TIMESTAMP DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_reviews_goods_no ON reviews(goods_no)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at)
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_summaries (
                    goods_no      TEXT PRIMARY KEY REFERENCES products(goods_no),
                    summary_json  TEXT NOT NULL,
                    generated_at  TIMESTAMP DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS insights_snapshots (
                    id                SERIAL PRIMARY KEY,
                    snapshot_at       TIMESTAMP DEFAULT NOW(),
                    total_reviews     INT,
                    new_reviews       INT,
                    avg_score         NUMERIC(4,2),
                    repurchase_pct    NUMERIC(5,2),
                    five_star_pct     NUMERIC(5,2),
                    positive_keywords JSONB,
                    negative_keywords JSONB
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_snapshots_at ON insights_snapshots(snapshot_at DESC)
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_rankings (
                    id            SERIAL PRIMARY KEY,
                    rank_date     DATE NOT NULL DEFAULT CURRENT_DATE,
                    goods_no      TEXT NOT NULL REFERENCES products(goods_no),
                    category_name TEXT NOT NULL,
                    rank_position INTEGER NOT NULL
                )
            """)
            cur.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_rankings_unique
                    ON product_rankings(rank_date, goods_no, category_name)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_rankings_date
                    ON product_rankings(rank_date DESC)
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS market_rankings (
                    id            SERIAL PRIMARY KEY,
                    rank_date     DATE NOT NULL DEFAULT CURRENT_DATE,
                    category_name TEXT NOT NULL,
                    rank_position INTEGER NOT NULL,
                    goods_no      TEXT NOT NULL,
                    goods_name    TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_market_rankings_unique
                    ON market_rankings(rank_date, category_name, rank_position)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_market_rankings_date
                    ON market_rankings(rank_date DESC)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_market_rankings_goods
                    ON market_rankings(goods_no, category_name)
            """)

    if conn is not None:
        _run(conn)
    else:
        with get_conn() as c:
            _run(c)
            c.commit()


def upsert_products(products: list[dict], conn=None):
    if not products:
        return

    def _run(c):
        with c.cursor() as cur:
            for p in products:
                cur.execute("""
                    INSERT INTO products (goods_no, goods_name, rating, review_count, first_seen, last_seen)
                    VALUES (%s, %s, %s, %s, CURRENT_DATE, CURRENT_DATE)
                    ON CONFLICT (goods_no) DO UPDATE SET
                        goods_name   = EXCLUDED.goods_name,
                        rating       = EXCLUDED.rating,
                        review_count = EXCLUDED.review_count,
                        last_seen    = CURRENT_DATE
                """, (p["goods_no"], p["goods_name"], p["rating"], p["review_count"]))

    if conn is not None:
        _run(conn)
    else:
        with get_conn() as c:
            _run(c)
            c.commit()


def insert_review(review: dict, goods_no: str, conn=None):
    profile = review.get("profileDto") or {}
    trouble = json.dumps(profile.get("skinTrouble", []), ensure_ascii=False)
    params = (
        review["reviewId"],
        goods_no,
        review.get("content", ""),
        review.get("reviewScore"),
        profile.get("skinType"),
        trouble,
        review.get("isRepurchase", False),
        review.get("createdDateTime"),
    )
    sql = """
        INSERT INTO reviews
            (review_id, goods_no, content, score, skin_type, skin_trouble, is_repurchase, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (review_id) DO NOTHING
    """
    if conn is not None:
        with conn.cursor() as cur:
            cur.execute(sql, params)
    else:
        with get_conn() as c:
            with c.cursor() as cur:
                cur.execute(sql, params)
            c.commit()


def get_existing_review_ids(conn=None) -> set[int]:
    def _run(c):
        with c.cursor() as cur:
            cur.execute("SELECT review_id FROM reviews")
            return {r["review_id"] for r in cur.fetchall()}

    if conn is not None:
        return _run(conn)
    else:
        with get_conn() as c:
            return _run(c)


def get_all_products(conn=None) -> list[dict]:
    def _run(c):
        with c.cursor() as cur:
            cur.execute("SELECT goods_no, goods_name FROM products ORDER BY goods_name")
            return list(cur.fetchall())

    if conn is not None:
        return _run(conn)
    else:
        with get_conn() as c:
            return _run(c)


def snapshot_insights(new_reviews: int, conn=None):
    kw_sql = """
        SELECT word, COUNT(*) AS cnt FROM (
            SELECT UNNEST(REGEXP_MATCHES(content, '[가-힣]{{2,6}}', 'g')) AS word
            FROM reviews WHERE {score_filter} AND content IS NOT NULL AND content != ''
        ) t
        WHERE word NOT IN ({stopwords})
        AND {suffix}
        AND LENGTH(word) >= 2
        GROUP BY word ORDER BY cnt DESC LIMIT 10
    """.format(
        stopwords=_STOPWORDS_SQL,
        suffix=_SUFFIX_FILTER_SQL,
        score_filter="{score_filter}",
    )

    def _run(c):
        with c.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) AS total,
                       ROUND(AVG(score)::numeric, 2) AS avg_score,
                       ROUND(SUM(CASE WHEN is_repurchase THEN 1 ELSE 0 END)::numeric
                             / NULLIF(COUNT(*), 0) * 100, 1) AS repurchase_pct,
                       ROUND(SUM(CASE WHEN score = 5 THEN 1 ELSE 0 END)::numeric
                             / NULLIF(COUNT(*), 0) * 100, 1) AS five_star_pct
                FROM reviews
            """)
            stats = cur.fetchone()

            cur.execute(kw_sql.replace("{score_filter}", "score >= 4"))
            pos_kw = [{"word": r["word"], "cnt": r["cnt"]} for r in cur.fetchall()]

            cur.execute(kw_sql.replace("{score_filter}", "score <= 2"))
            neg_kw = [{"word": r["word"], "cnt": r["cnt"]} for r in cur.fetchall()]

            cur.execute("""
                INSERT INTO insights_snapshots
                    (total_reviews, new_reviews, avg_score, repurchase_pct, five_star_pct,
                     positive_keywords, negative_keywords)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                stats["total"], new_reviews,
                stats["avg_score"], stats["repurchase_pct"], stats["five_star_pct"],
                json.dumps(pos_kw, ensure_ascii=False),
                json.dumps(neg_kw, ensure_ascii=False),
            ))

    if conn is not None:
        _run(conn)
    else:
        with get_conn() as c:
            _run(c)
            c.commit()
