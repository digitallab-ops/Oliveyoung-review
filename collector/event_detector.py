"""
브랜드 이벤트 자동 감지기
- 올영픽 입점/이탈, 순위 급등, 리뷰 급증, 신제품, 가격 급락 감지
- brand_events 테이블에 저장
- 실행: python -m collector.event_detector
"""
import os
import sys
import re
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from db.schema import get_conn, init_db

# 감지 임계값
RANK_JUMP_THRESHOLD  = 15   # 순위 N위 이상 상승 시 이벤트
REVIEW_SURGE_PCT     = 80   # 전주 대비 N% 이상 증가 시 이벤트
PRICE_DROP_PCT       = 10   # 직전 수집 대비 N% 이상 하락 시 이벤트

# 가격 수집은 상품당 주 1회꼴이라 '어제 가격'이라는 건 존재하지 않는다.
# 직전 기록이 이 일수보다 오래됐으면 '급락'으로 보지 않는다.
PRICE_DROP_MAX_GAP_DAYS = 14


def _brand_name(goods_name: str) -> str:
    """상품명 앞부분에서 브랜드명 추출 (대문자 또는 한글 브랜드명)"""
    if not goods_name:
        return ''
    # [태그] 제거
    name = re.sub(r'\[[^\]]*\]', '', goods_name).strip()
    # 첫 단어 (영문 브랜드는 공백까지, 한글 브랜드는 보통 2-4글자)
    m = re.match(r'^([A-Za-z0-9&\.]+|[가-힣]{2,5})', name)
    return m.group(1) if m else name[:6]


def detect_olivepick_changes(conn, today: date) -> list[dict]:
    """올영픽 입점/이탈 감지 — 이번 달 vs 데이터가 있는 직전 달.

    올영픽은 월 단위로 큐레이션이 바뀌므로 비교는 월 경계에서만 의미가 있다.
    매일 실행되더라도 같은 상품에 대해 한 달에 한 번만 이벤트를 남긴다.
    """
    events = []
    this_month = today.strftime('%Y-%m')

    with conn.cursor() as cur:
        cur.execute("""
            SELECT goods_no, goods_name, category_name, rank_position
            FROM promo_items
            WHERE promo_type = 'olivepick'
              AND TO_CHAR(collected_at, 'YYYY-MM') = %s
        """, (this_month,))
        this_set = {r['goods_no']: r for r in cur.fetchall()}

        # 달력상 직전 달이 수집 장애로 비어 있을 수 있다 (2026-08: dispCatNo 형식 변경으로 0건).
        # 그 경우 빈 집합과 비교하게 되어 이탈이 영원히 0건이 된다.
        # → 데이터가 실제로 있는 가장 최근 이전 달을 기준으로 삼는다.
        cur.execute("""
            SELECT TO_CHAR(collected_at, 'YYYY-MM') AS m
            FROM promo_items
            WHERE promo_type = 'olivepick'
              AND TO_CHAR(collected_at, 'YYYY-MM') < %s
            GROUP BY 1 ORDER BY 1 DESC LIMIT 1
        """, (this_month,))
        prev_row = cur.fetchone()
        if not prev_row:
            return []  # 비교 기준이 없으면 전부 신규로 보이므로 아무것도 내지 않는다
        prev_month = prev_row['m']

        cur.execute("""
            SELECT goods_no
            FROM promo_items
            WHERE promo_type = 'olivepick'
              AND TO_CHAR(collected_at, 'YYYY-MM') = %s
        """, (prev_month,))
        prev_set = {r['goods_no'] for r in cur.fetchall()}

        # 매일 실행되므로 이번 달에 이미 남긴 입점/이탈은 다시 내지 않는다
        cur.execute("""
            SELECT event_type, goods_no FROM brand_events
            WHERE event_type IN ('olivepick_entry', 'olivepick_exit')
              AND TO_CHAR(event_date, 'YYYY-MM') = %s
        """, (this_month,))
        already = {(r['event_type'], r['goods_no']) for r in cur.fetchall()}

    for gno, r in this_set.items():
        if gno not in prev_set and ('olivepick_entry', gno) not in already:
            events.append({
                'event_date':   today,
                'event_type':   'olivepick_entry',
                'brand_name':   _brand_name(r['goods_name']),
                'goods_no':     gno,
                'category_name': r['category_name'],
                'event_detail': {'goods_name': r['goods_name'], 'rank_position': r['rank_position']},
            })

    for gno in prev_set:
        if gno not in this_set and ('olivepick_exit', gno) not in already:
            with conn.cursor() as cur:
                cur.execute("SELECT goods_name, category_name FROM promo_items WHERE goods_no=%s LIMIT 1", (gno,))
                row = cur.fetchone()
            if row:
                events.append({
                    'event_date':   today,
                    'event_type':   'olivepick_exit',
                    'brand_name':   _brand_name(row['goods_name']),
                    'goods_no':     gno,
                    'category_name': row['category_name'],
                    'event_detail': {'goods_name': row['goods_name']},
                })
    return events


def detect_rank_jumps(conn, today: date) -> list[dict]:
    """전일 대비 순위 RANK_JUMP_THRESHOLD위 이상 상승한 경쟁사 상품 감지"""
    yesterday = today - timedelta(days=1)
    events = []

    with conn.cursor() as cur:
        cur.execute("""
            SELECT t.goods_no, t.goods_name, t.category_name,
                   t.rank_position  AS today_rank,
                   y.rank_position  AS yesterday_rank
            FROM (
                SELECT DISTINCT ON (goods_no, category_name)
                       goods_no, goods_name, category_name, rank_position
                FROM market_rankings
                WHERE rank_date = %s
                ORDER BY goods_no, category_name, rank_hour DESC
            ) t
            JOIN (
                SELECT DISTINCT ON (goods_no, category_name)
                       goods_no, category_name, rank_position
                FROM market_rankings
                WHERE rank_date = %s
                ORDER BY goods_no, category_name, rank_hour DESC
            ) y USING (goods_no, category_name)
            WHERE y.rank_position - t.rank_position >= %s
        """, (today, yesterday, RANK_JUMP_THRESHOLD))
        rows = cur.fetchall()

    for r in rows:
        events.append({
            'event_date':   today,
            'event_type':   'rank_jump',
            'brand_name':   _brand_name(r['goods_name']),
            'goods_no':     r['goods_no'],
            'category_name': r['category_name'],
            'event_detail': {
                'goods_name':     r['goods_name'],
                'rank_before':    r['yesterday_rank'],
                'rank_after':     r['today_rank'],
                'delta':          r['yesterday_rank'] - r['today_rank'],
            },
        })
    return events


def detect_review_surges(conn, today: date) -> list[dict]:
    """이번 7일 리뷰 수가 전주 대비 REVIEW_SURGE_PCT% 이상 증가한 경쟁사 상품 감지"""
    week_ago      = today - timedelta(days=7)
    two_weeks_ago = today - timedelta(days=14)
    events = []

    with conn.cursor() as cur:
        cur.execute("""
            SELECT r.goods_no, p.goods_name,
                   COUNT(*) FILTER (WHERE r.created_at >= %s::text) AS this_week,
                   COUNT(*) FILTER (WHERE r.created_at >= %s::text AND r.created_at < %s::text) AS prev_week
            FROM reviews r
            JOIN products p USING (goods_no)
            WHERE p.is_competitor = true
              AND r.created_at >= %s::text
            GROUP BY r.goods_no, p.goods_name
            HAVING COUNT(*) FILTER (WHERE r.created_at >= %s::text) > 0
               AND COUNT(*) FILTER (WHERE r.created_at >= %s::text AND r.created_at < %s::text) > 0
        """, (
            str(week_ago), str(two_weeks_ago), str(week_ago),
            str(two_weeks_ago),
            str(week_ago),
            str(two_weeks_ago), str(week_ago),
        ))
        rows = cur.fetchall()

    for r in rows:
        if r['prev_week'] == 0:
            continue
        surge_pct = (r['this_week'] - r['prev_week']) / r['prev_week'] * 100
        if surge_pct >= REVIEW_SURGE_PCT:
            events.append({
                'event_date':   today,
                'event_type':   'review_surge',
                'brand_name':   _brand_name(r['goods_name']),
                'goods_no':     r['goods_no'],
                'category_name': None,
                'event_detail': {
                    'goods_name':   r['goods_name'],
                    'this_week':    r['this_week'],
                    'prev_week':    r['prev_week'],
                    'surge_pct':    round(surge_pct, 1),
                },
            })
    return events


def detect_new_products(conn, today: date) -> list[dict]:
    """오늘 first_seen된 경쟁사 신규 상품 감지"""
    events = []
    with conn.cursor() as cur:
        cur.execute("""
            SELECT goods_no, goods_name
            FROM products
            WHERE is_competitor = true AND first_seen = %s
        """, (today,))
        rows = cur.fetchall()

    for r in rows:
        events.append({
            'event_date':   today,
            'event_type':   'new_product',
            'brand_name':   _brand_name(r['goods_name']),
            'goods_no':     r['goods_no'],
            'category_name': None,
            'event_detail': {'goods_name': r['goods_name']},
        })
    return events


def detect_price_drops(conn, today: date) -> list[dict]:
    """직전 수집 대비 PRICE_DROP_PCT% 이상 세일가가 떨어진 상품 감지.

    두 군데가 틀려 있어서 2026-11-12 까지 단 한 건도 잡히지 않았다.

    1) price_history.price 를 비교했다. 그런데 그 컬럼은 수집기가 정가를
       넣는 자리다(price_collector.py 의 keep = base or sale). 정가는 거의
       움직이지 않으니 10% 하락이 나올 리가 없었다. 실제로 움직이는 건
       sale_price 이고, 그 값은 2026-11-05 부터 쌓이기 시작했다.

    2) 비교 대상을 '어제'로 못박았다(y.recorded_date = today - 1).
       가격 수집은 상품당 주 1회꼴로 돈다(한 바퀴 약 7.6일). 그래서 어떤
       상품도 이틀 연속으로 기록되지 않는다. 실제로 최근 14일간 연속 이틀
       기록이 있는 상품은 0개였다 — 조인이 영원히 안 맞는 구조였다.

    그래서 '어제' 대신 LAG 로 그 상품의 직전 기록을 집어서 비교한다.
    다만 너무 오래된 기록과 비교하면 '급락'이라고 부를 수 없으므로
    PRICE_DROP_MAX_GAP_DAYS 안쪽의 직전 기록만 본다.

    오늘 기록된 건만 본다. brand_events 에는 (event_date, event_type,
    goods_no) 유니크 제약이 없어서 _save_events 의 ON CONFLICT DO NOTHING
    이 실제로는 아무것도 걸러 주지 못한다. 여러 날을 훑으면 그대로 중복이
    쌓이므로 범위를 오늘로 제한한다.
    """
    events = []
    window_start = today - timedelta(days=PRICE_DROP_MAX_GAP_DAYS + 1)

    with conn.cursor() as cur:
        cur.execute("""
            WITH hist AS (
                SELECT goods_no, sale_price, recorded_date,
                       LAG(sale_price)    OVER w AS prev_price,
                       LAG(recorded_date) OVER w AS prev_date
                FROM price_history
                WHERE sale_price IS NOT NULL
                  AND recorded_date >= %s
                WINDOW w AS (PARTITION BY goods_no ORDER BY recorded_date)
            )
            SELECT h.goods_no, p.goods_name,
                   h.prev_price   AS price_before,
                   h.sale_price   AS price_after,
                   h.prev_date,
                   (h.recorded_date - h.prev_date) AS gap_days
            FROM hist h
            JOIN products p ON p.goods_no = h.goods_no
            WHERE h.recorded_date = %s
              AND h.prev_price IS NOT NULL
              AND h.prev_price > 0
              AND (h.recorded_date - h.prev_date) <= %s
              AND (h.prev_price - h.sale_price) * 100.0 / h.prev_price >= %s
            ORDER BY (h.prev_price - h.sale_price) * 100.0 / h.prev_price DESC
        """, (window_start, today, PRICE_DROP_MAX_GAP_DAYS, PRICE_DROP_PCT))
        rows = cur.fetchall()

    for r in rows:
        drop_pct = (r['price_before'] - r['price_after']) / r['price_before'] * 100
        events.append({
            'event_date':   today,
            'event_type':   'price_drop',
            'brand_name':   _brand_name(r['goods_name']),
            'goods_no':     r['goods_no'],
            'category_name': None,
            'event_detail': {
                'goods_name':   r['goods_name'],
                'price_before': r['price_before'],
                'price_after':  r['price_after'],
                'drop_pct':     round(drop_pct, 1),
                # 직전 기록이 며칠 전인지 같이 남긴다. 7일 전 대비 20% 하락과
                # 하루 전 대비 20% 하락은 읽는 사람에게 전혀 다른 신호다.
                'prev_date':    r['prev_date'].isoformat(),
                'gap_days':     r['gap_days'],
            },
        })
    return events


def _save_events(conn, events: list[dict]) -> int:
    """brand_events에 저장 (날짜+타입+goods_no 중복 SKIP)"""
    import json
    saved = 0
    with conn.cursor() as cur:
        for e in events:
            cur.execute("""
                INSERT INTO brand_events
                    (event_date, event_type, brand_name, goods_no, category_name, event_detail, source)
                VALUES (%s, %s, %s, %s, %s, %s, 'auto')
                ON CONFLICT DO NOTHING
            """, (
                e['event_date'], e['event_type'], e['brand_name'],
                e.get('goods_no'), e.get('category_name'),
                json.dumps(e.get('event_detail', {}), ensure_ascii=False),
            ))
            if cur.rowcount > 0:
                saved += 1
    return saved


def run():
    today = date.today()
    print(f"=== 브랜드 이벤트 감지 ({today}) ===\n", flush=True)

    conn = get_conn()
    conn.autocommit = True

    try:
        init_db(conn=conn)

        all_events = []

        detectors = [
            ('올영픽 입점/이탈', detect_olivepick_changes),
            ('순위 급등',         detect_rank_jumps),
            ('리뷰 급증',         detect_review_surges),
            ('신제품',            detect_new_products),
            ('가격 급락',         detect_price_drops),
        ]

        for label, fn in detectors:
            try:
                events = fn(conn, today)
                all_events.extend(events)
                print(f"  {label}: {len(events)}건", flush=True)
            except Exception as e:
                print(f"  {label}: 오류 — {e}", flush=True)

        saved = _save_events(conn, all_events)
        print(f"\n총 {len(all_events)}건 감지 → {saved}건 신규 저장", flush=True)
        print(f"\n=== 완료 - {saved}건 이벤트 저장 ===", flush=True)
    finally:
        conn.close()


if __name__ == '__main__':
    run()
