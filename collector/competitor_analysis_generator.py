"""
매주 월요일 오전 8시 실행 — 카테고리별 경쟁사 vs 자사 키워드 비교 분석 생성.
competitor_insights 테이블에 저장. 대시보드 경쟁사 탭 + 봇 MCP 툴에서 활용.

사용: python -m collector.competitor_analysis_generator
"""
import os
import re
import json
import logging
import psycopg2
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_URL = os.environ["DATABASE_URL"]

_STOPWORDS = """
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
    '완전','요즘','생각보다','그래도','그러나','하지만','그리고',
    '선크림','선스틱','선케어','패드','파운데이션','쿠션','아이크림',
    '젤크림','수분크림','클렌징','폼클렌징','마스크팩','스킨케어',
    '발림','흡수','촉촉','냄새','향기','용량','가성비','색감','발색','지속',
    '얼굴','목','눈가','입술','피부결',
    '완전히','진짜로','별로','무난',
    '올영','브랜드','제형','텍스처','텍처'
"""

_SUFFIX_FILTER = """
    word !~ '(아요|어요|이에요|해요|하고|이고|이라|에서|으로|에도|처럼|아서|어서|와서|이며|이나|이든|없이|인데|한다|됩니다|해서|하면|하며|습니다|가|이|을|를|은|는|에|의|도|로|와|고|며|면|서|든|른|지|라|요|기|데|게|다|ㄹ|할|수|서|적)$'
"""

# 제외할 노이즈 카테고리
_SKIP_CATEGORIES = {'선스틱', '선세럼·미스트'}


def get_week_start() -> date:
    """이번 주 월요일 반환"""
    today = date.today()
    return today - timedelta(days=today.weekday())


def extract_brand(goods_name: str) -> str:
    m = re.match(r'^([^\[]+?)(?:\[|$)', goods_name)
    return m.group(1).strip() if m else goods_name.split()[0]


def extract_keywords(cur, goods_no: str, score_filter: str, limit: int = 8) -> list[dict]:
    cur.execute(f"""
        SELECT word, COUNT(*) AS cnt FROM (
            SELECT UNNEST(REGEXP_MATCHES(content, '[가-힣]{{2,6}}', 'g')) AS word
            FROM reviews
            WHERE goods_no = %s AND {score_filter}
              AND content IS NOT NULL AND content != ''
        ) t
        WHERE word NOT IN ({_STOPWORDS})
        AND {_SUFFIX_FILTER}
        AND LENGTH(word) >= 2
        GROUP BY word ORDER BY cnt DESC LIMIT %s
    """, (goods_no, limit))
    return [{"word": r[0], "cnt": r[1]} for r in cur.fetchall()]


def process_category(cur, category_name: str, week_start: date) -> int:
    """카테고리 처리 → 삽입 건수 반환"""
    # 오늘 기준 최신 순위 상위 8개 조회 (우리 상품 포함)
    cur.execute("""
        SELECT DISTINCT ON (mr.goods_no)
            mr.goods_no,
            mr.goods_name,
            mr.rank_position,
            COALESCE(p.is_competitor, TRUE) AS is_competitor,
            COUNT(r.review_id) AS review_count,
            ROUND(AVG(r.score)::numeric, 2) AS avg_score
        FROM market_rankings mr
        LEFT JOIN products p ON mr.goods_no = p.goods_no
        LEFT JOIN reviews r ON mr.goods_no = r.goods_no
        WHERE mr.rank_date = CURRENT_DATE
          AND mr.category_name = %s
        GROUP BY mr.goods_no, mr.goods_name, mr.rank_position, p.is_competitor
        ORDER BY mr.goods_no, mr.rank_position
        LIMIT 8
    """, (category_name,))
    products = cur.fetchall()

    inserted = 0
    for row in products:
        goods_no, goods_name, rank_position, is_competitor, review_count, avg_score = row
        review_count = int(review_count or 0)
        is_ours = not bool(is_competitor)

        if review_count < 3:
            continue

        pos_kw = extract_keywords(cur, goods_no, "score >= 4")
        neg_kw = extract_keywords(cur, goods_no, "score <= 2")

        if not pos_kw and not neg_kw:
            continue

        brand_name = extract_brand(goods_name)

        cur.execute("""
            INSERT INTO competitor_insights
                (week_start, category_name, goods_no, goods_name, brand_name,
                 rank_position, review_count, avg_score,
                 positive_keywords, negative_keywords, is_ours)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (week_start, category_name, goods_no) DO UPDATE SET
                goods_name        = EXCLUDED.goods_name,
                brand_name        = EXCLUDED.brand_name,
                rank_position     = EXCLUDED.rank_position,
                review_count      = EXCLUDED.review_count,
                avg_score         = EXCLUDED.avg_score,
                positive_keywords = EXCLUDED.positive_keywords,
                negative_keywords = EXCLUDED.negative_keywords,
                is_ours           = EXCLUDED.is_ours,
                generated_at      = NOW()
        """, (
            week_start, category_name, goods_no, goods_name, brand_name,
            rank_position, review_count, avg_score,
            json.dumps(pos_kw, ensure_ascii=False),
            json.dumps(neg_kw, ensure_ascii=False),
            is_ours,
        ))
        inserted += 1

    return inserted


def main():
    week_start = get_week_start()
    log.info("경쟁사 키워드 분석 시작 (week_start=%s)", week_start)

    conn = psycopg2.connect(DB_URL, options="-c search_path=oliveyoung")
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT category_name
                    FROM market_rankings
                    WHERE rank_date = CURRENT_DATE
                    ORDER BY category_name
                """)
                categories = [r[0] for r in cur.fetchall()]
                log.info("%d개 카테고리 처리 중...", len(categories))

                total = 0
                for cat in categories:
                    if cat in _SKIP_CATEGORIES:
                        continue
                    n = process_category(cur, cat, week_start)
                    total += n
                    log.info("  ✓ %s (%d건)", cat, n)

        log.info("완료: 총 %d건 저장", total)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
