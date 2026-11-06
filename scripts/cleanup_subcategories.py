"""세분 카테고리('선스틱', '선세럼·미스트') 행을 순위 테이블에서 지운다.

주의 — 원래 이 파일은 모듈 최상위에서 DELETE 를 바로 실행했다.
`import` 한 번, pytest 수집 한 번, 파일을 훑는 도구 한 번이면 운영 DB 의
market_rankings 가 지워졌다. __main__ 가드도 확인 절차도 없었다.

이제는:
  python scripts/cleanup_subcategories.py          # 몇 행이 지워질지만 보여준다
  python scripts/cleanup_subcategories.py --yes    # 실제로 지운다
"""
import argparse
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CATS = ['선스틱', '선세럼·미스트']
TABLES = ['market_rankings', 'product_rankings']


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--yes', action='store_true', help='실제로 삭제한다')
    args = ap.parse_args()

    from db.schema import get_conn
    conn = get_conn()
    conn.autocommit = False          # 한 트랜잭션으로 묶는다
    try:
        with conn.cursor() as cur:
            total = 0
            for t in TABLES:
                cur.execute(
                    f"SELECT COUNT(*) AS n FROM {t} WHERE category_name = ANY(%s)",
                    (CATS,))
                n = cur.fetchone()['n']
                total += n
                print(f"  {t}: {n:,}행")

            if not args.yes:
                print(f"\n합계 {total:,}행이 삭제 대상이다. 실제로 지우려면 --yes 를 붙여라.")
                conn.rollback()
                return

            for t in TABLES:
                cur.execute(
                    f"DELETE FROM {t} WHERE category_name = ANY(%s)", (CATS,))
                print(f"  {t} 삭제: {cur.rowcount:,}행")
        conn.commit()
        print("완료")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
