"""경쟁사 데이터 삭제 스크립트
셀퓨전씨/CellFusionC가 아닌 products + 연결 reviews 삭제
"""
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from db.coupang_schema import get_conn

BRAND_KEYWORDS = ('셀퓨전씨', 'cellfusionc')


def is_ours(name: str) -> bool:
    if not name:
        return False
    low = name.lower()
    return any(k in low for k in BRAND_KEYWORDS)


def main():
    conn = get_conn()
    conn.autocommit = False

    with conn.cursor() as cur:
        # 1. 현황 파악
        cur.execute("SELECT COUNT(*) AS cnt FROM coupang.products")
        total_products = cur.fetchone()['cnt']

        cur.execute("SELECT COUNT(*) AS cnt FROM coupang.reviews")
        total_reviews = cur.fetchone()['cnt']

        cur.execute("""
            SELECT product_id, product_name
            FROM coupang.products
            WHERE product_name IS NOT NULL
              AND product_name NOT ILIKE '%셀퓨전씨%'
              AND product_name NOT ILIKE '%cellfusionc%'
        """)
        competitor_products = cur.fetchall()

        print(f"=== 현황 ===")
        print(f"전체 products: {total_products}개")
        print(f"전체 reviews:  {total_reviews}개")
        print(f"\n경쟁사 products ({len(competitor_products)}개):")
        for p in competitor_products:
            print(f"  - [{p['product_id']}] {p['product_name']}")

        if not competitor_products:
            print("\n삭제할 경쟁사 데이터 없음.")
            conn.close()
            return

        competitor_ids = [p['product_id'] for p in competitor_products]

        # 2. 연결 리뷰 수 확인
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM coupang.reviews WHERE product_id = ANY(%s)",
            (competitor_ids,)
        )
        competitor_review_count = cur.fetchone()['cnt']
        print(f"\n삭제 예정 reviews: {competitor_review_count}개")

        # 3. 확인 후 삭제
        print("\n삭제를 진행합니다...")

        # reviews 먼저 (FK 제약)
        cur.execute(
            "DELETE FROM coupang.reviews WHERE product_id = ANY(%s)",
            (competitor_ids,)
        )
        deleted_reviews = cur.rowcount
        print(f"  reviews 삭제: {deleted_reviews}개")

        # products 삭제
        cur.execute(
            "DELETE FROM coupang.products WHERE product_id = ANY(%s)",
            (competitor_ids,)
        )
        deleted_products = cur.rowcount
        print(f"  products 삭제: {deleted_products}개")

        conn.commit()
        print("\n=== 삭제 완료 ===")

        # 4. 결과 확인
        cur.execute("SELECT COUNT(*) AS cnt FROM coupang.products")
        remaining_products = cur.fetchone()['cnt']
        cur.execute("SELECT COUNT(*) AS cnt FROM coupang.reviews")
        remaining_reviews = cur.fetchone()['cnt']
        print(f"남은 products: {remaining_products}개")
        print(f"남은 reviews:  {remaining_reviews}개")

    conn.close()


if __name__ == '__main__':
    main()
