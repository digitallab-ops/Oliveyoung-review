"""데이터 파이프라인 파수꾼 — 각 수집 단계가 실제로 데이터를 남겼는지 검증한다.

수집기가 exit 0으로 끝나도 결과가 0건이면 파이프라인은 죽은 것이다.
올영픽이 2026-08~09 두 달간 조용히 끊겼던 것이 정확히 이 경우였다
(dispCatNo 형식 변경 → 0건 수집 → exit 0 → 알림 없음).

사용법:
    python -m collector.sentinel              # 전체 점검
    python -m collector.sentinel olivepick    # 특정 단계만
    python -m collector.sentinel --quiet      # 실패 시에만 Slack 발송

수집기 안에서:
    from collector.sentinel import verify
    verify('olivepick')
"""

import os
import sys
import json
import urllib.request
from dataclasses import dataclass, field

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db.schema import get_conn  # noqa: E402

load_dotenv()


@dataclass
class Check:
    stage: str          # 수집 단계 키
    label: str          # 사람이 읽는 이름
    sql: str            # 숫자 하나를 반환하는 쿼리
    threshold: float
    mode: str = 'min'   # 'min' = 이 값 미만이면 실패 / 'max' = 초과하면 실패
    unit: str = '건'
    hint: str = ''      # 실패 시 어디를 봐야 하는지
    # 실패했을 때 '무엇이' 걸렸는지 한 줄씩 보여줄 쿼리.
    # 숫자만 울리면 결국 DB를 뒤져야 해서 아무도 안 본다.
    detail_sql: str = ''

    def failed(self, value: float) -> bool:
        return value < self.threshold if self.mode == 'min' else value > self.threshold


# ── 점검 정의 ────────────────────────────────────────────
# threshold는 "이 정도도 안 나오면 확실히 고장"인 보수적 하한으로 잡는다.
# 정상치의 절반 수준 → 자연 변동으로 인한 거짓 경보를 피한다.

CHECKS: list[Check] = [
    # ── 랭킹 ──
    Check(
        stage='rank', label='시장 랭킹 오늘 수집',
        sql="SELECT COUNT(*) FROM market_rankings WHERE rank_date = CURRENT_DATE",
        threshold=300, unit='행',
        hint='rank_collector — 카테고리별 Top100. 정상 600~800행',
    ),
    Check(
        stage='rank', label='시장 랭킹 신선도',
        sql="SELECT COALESCE(CURRENT_DATE - MAX(rank_date), 999) FROM market_rankings",
        threshold=1, mode='max', unit='일 경과',
        hint='rank_collector가 매시간 돌아야 함',
    ),
    # 전체 행수만 보면 한 카테고리가 죽어도 나머지가 채워서 통과해버린다.
    # 맨즈에딧이 2026-09-16 이후 13일간 0건으로 조용히 끊겼던 사례.
    Check(
        stage='rank', label='카테고리별 수집 끊김',
        sql="""SELECT COALESCE(MAX(CURRENT_DATE - last_seen), 0) FROM (
                 SELECT category_name, MAX(rank_date) AS last_seen
                 FROM market_rankings GROUP BY category_name
               ) t""",
        threshold=2, mode='max', unit='일 경과',
        hint='특정 카테고리만 0건 수집되고 있다 — rank_collector 로그에서 해당 카테고리 확인',
    ),

    # ── 자사 순위 변동 ──
    # 여기까지는 '수집기가 도는가'만 봤다. 수집은 멀쩡한데 자사 상품이 랭킹에서
    # 사라지는 건 아무도 알려주지 않았다 — 실제로 147일째 안 보이는 상품이 있다.
    # 올영픽 이탈을 감지하듯(아래) 랭킹 이탈도 감지한다.
    Check(
        stage='rank', label='자사 랭킹 이탈',
        # '지금 없다'가 아니라 '최근까지 있다가 빠졌다'를 본다. 단종된 상품까지
        # 세면 매일 같은 숫자가 울려 아무도 안 보게 된다. 3~10일 창이라
        # 새로 빠진 것만 잡히고, 10일이 지나면 저절로 조용해진다.
        sql="""WITH last_seen AS (
                 SELECT mr.goods_no, MAX(mr.rank_date) AS d
                 FROM market_rankings mr
                 JOIN products p ON p.goods_no = mr.goods_no
                 WHERE p.is_competitor = false
                 GROUP BY mr.goods_no
               )
               SELECT COUNT(*) FROM last_seen
               WHERE d <= CURRENT_DATE - 3 AND d >= CURRENT_DATE - 10""",
        threshold=0, mode='max', unit='개',
        hint='최근 랭킹에 있다가 빠진 자사 상품. 단종이면 무시, 아니면 노출·가격·리뷰를 보라',
        detail_sql=r"""WITH last_seen AS (
                        SELECT mr.goods_no, MAX(mr.rank_date) AS d
                        FROM market_rankings mr
                        JOIN products p ON p.goods_no = mr.goods_no
                        WHERE p.is_competitor = false
                        GROUP BY mr.goods_no
                      )
                      SELECT (CURRENT_DATE - ls.d)::text || '일째',
                             LEFT(REGEXP_REPLACE(p.goods_name, '\[[^]]*\]', '', 'g'), 32)
                      FROM last_seen ls JOIN products p ON p.goods_no = ls.goods_no
                      WHERE ls.d <= CURRENT_DATE - 3 AND ls.d >= CURRENT_DATE - 10
                      ORDER BY ls.d""",
    ),
    Check(
        stage='rank', label='자사 순위 급락',
        # 30계단을 기준으로 잡은 건 실측 때문이다. 최근 30일 기준 하루
        # 20계단+ 0~2건 / 30계단+ 0~2건 / 50계단+ 0~1건.
        # 20은 잦아 묻히고 50은 드물어 놓친다.
        sql="""WITH best AS (
                 SELECT mr.goods_no, mr.rank_date, MIN(mr.rank_position) AS r
                 FROM market_rankings mr
                 JOIN products p ON p.goods_no = mr.goods_no
                 WHERE p.is_competitor = false
                   AND mr.rank_date >= CURRENT_DATE - 1
                 GROUP BY mr.goods_no, mr.rank_date
               )
               SELECT COUNT(*)
               FROM best t
               JOIN best y ON y.goods_no = t.goods_no AND y.rank_date = t.rank_date - 1
               WHERE t.rank_date = CURRENT_DATE AND t.r - y.r >= 30""",
        threshold=0, mode='max', unit='개',
        hint='전일 대비 최고순위가 30계단 이상 밀린 자사 상품. 경쟁사 기획전·가격 변동을 먼저 보라',
        detail_sql=r"""WITH best AS (
                        SELECT mr.goods_no, mr.rank_date, MIN(mr.rank_position) AS r
                        FROM market_rankings mr
                        JOIN products p ON p.goods_no = mr.goods_no
                        WHERE p.is_competitor = false AND mr.rank_date >= CURRENT_DATE - 1
                        GROUP BY mr.goods_no, mr.rank_date
                      )
                      SELECT y.r::text || '위 → ' || t.r::text || '위',
                             LEFT(REGEXP_REPLACE(p.goods_name, '\[[^]]*\]', '', 'g'), 32)
                      FROM best t
                      JOIN best y ON y.goods_no = t.goods_no AND y.rank_date = t.rank_date - 1
                      JOIN products p ON p.goods_no = t.goods_no
                      WHERE t.rank_date = CURRENT_DATE AND t.r - y.r >= 30
                      ORDER BY t.r - y.r DESC""",
    ),

    # ── 프로모션 (올영픽이 끊겼던 지점) ──
    Check(
        stage='olivepick', label='올영픽 오늘 수집',
        sql="""SELECT COUNT(*) FROM promo_items
               WHERE promo_type = 'olivepick' AND collected_at::date = CURRENT_DATE""",
        threshold=50, unit='개',
        hint='promo_collector — dispCatNo 형식이 또 바뀌었을 수 있음. 정상 200~300개',
    ),
    Check(
        stage='olivepick', label='오늘의 특가 수집',
        sql="""SELECT COUNT(*) FROM promo_items
               WHERE promo_type = 'today_deal' AND collected_at::date = CURRENT_DATE""",
        threshold=5, unit='개',
        hint='promo_collector — 정상 20~30개',
    ),

    # ── 이벤트 감지 ──
    # 올영픽은 월 단위 큐레이션이라 입점/이탈은 월이 바뀔 때 한 번만 나온다.
    # '며칠 지났나'로 보면 매달 중순부터 말일까지 거짓 경보가 켜진 채로 있게 되고,
    # 늘 켜진 경보는 아무도 보지 않는다 — 올영픽이 두 달 죽어 있던 이유가 그거였다.
    # 그래서 '이번 달 치가 나왔나'를 보고, 안 나왔으면 며칠 연체인지를 센다.
    Check(
        stage='event', label='올영픽 이탈 감지 (이번 달)',
        sql="""SELECT CASE
                 -- 비교 기준이 될 이전 달 수집분이 없으면 애초에 낼 수 없다
                 WHEN NOT EXISTS (
                     SELECT 1 FROM promo_items
                     WHERE promo_type = 'olivepick'
                       AND TO_CHAR(collected_at, 'YYYY-MM') < TO_CHAR(CURRENT_DATE, 'YYYY-MM')
                 ) THEN 0
                 -- 이번 달 치가 이미 나왔으면 정상
                 WHEN EXISTS (
                     SELECT 1 FROM brand_events
                     WHERE event_type = 'olivepick_exit'
                       AND TO_CHAR(event_date, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
                 ) THEN 0
                 -- 월초 며칠은 아직 안 돌았을 수 있다
                 ELSE GREATEST(EXTRACT(DAY FROM CURRENT_DATE)::int - 3, 0)
               END""",
        threshold=0, mode='max', unit='일 연체',
        hint='event_detector — 월 경계에서만 나온다. 연체면 detect_olivepick_changes 확인',
    ),
    Check(
        stage='event', label='올영픽 입점 감지 (이번 달)',
        sql="""SELECT CASE
                 -- 비교 기준이 될 이전 달 수집분이 없으면 애초에 낼 수 없다
                 WHEN NOT EXISTS (
                     SELECT 1 FROM promo_items
                     WHERE promo_type = 'olivepick'
                       AND TO_CHAR(collected_at, 'YYYY-MM') < TO_CHAR(CURRENT_DATE, 'YYYY-MM')
                 ) THEN 0
                 -- 이번 달 치가 이미 나왔으면 정상
                 WHEN EXISTS (
                     SELECT 1 FROM brand_events
                     WHERE event_type = 'olivepick_entry'
                       AND TO_CHAR(event_date, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
                 ) THEN 0
                 -- 월초 며칠은 아직 안 돌았을 수 있다
                 ELSE GREATEST(EXTRACT(DAY FROM CURRENT_DATE)::int - 3, 0)
               END""",
        threshold=0, mode='max', unit='일 연체',
        hint='event_detector — 월 경계에서만 나온다',
    ),

    # ── 리뷰 ──
    Check(
        stage='review', label='리뷰 수집 신선도',
        sql="SELECT COALESCE(CURRENT_DATE - MAX(collected_at)::date, 999) FROM reviews",
        threshold=2, mode='max', unit='일 경과',
        hint='pipeline — 매일 오전 6시 수집',
    ),

    # ── 가격 ──
    Check(
        stage='price', label='가격 수집 신선도',
        sql="SELECT COALESCE(CURRENT_DATE - MAX(recorded_date), 999) FROM price_history",
        threshold=3, mode='max', unit='일 경과',
        hint='price_collector — 매일 새벽 2시. 차단되면 0건으로 끝난다',
    ),

    # ── 자사 데이터 완전성 (2026-09-29 발견: 수집기가 자사를 제외하고 있었음) ──
    Check(
        stage='ours', label='자사 가격 누락',
        sql="SELECT COUNT(*) FROM products WHERE is_competitor = false AND price IS NULL",
        threshold=10, mode='max', unit='개',
        hint='price_collector가 자사를 수집 대상에 포함하는지 확인',
    ),
    Check(
        stage='ours', label='자사 전성분 누락',
        sql="""SELECT COUNT(*) FROM products
               WHERE is_competitor = false AND ingredients_raw IS NULL""",
        threshold=15, mode='max', unit='개',
        hint='ingredient_collector — 일부 비화장품(패치 등)은 정상적으로 없음',
    ),
    Check(
        stage='ours', label='자사 용량 누락',
        sql="SELECT COUNT(*) FROM products WHERE is_competitor = false AND volume IS NULL",
        threshold=15, mode='max', unit='개',
        hint='product_detail_collector — goods_name 정규식 추출',
    ),

    # ── AI 생성물 ──
    Check(
        stage='ai', label='일일 브리핑 신선도',
        sql="SELECT COALESCE(CURRENT_DATE - MAX(brief_date), 999) FROM daily_briefs",
        threshold=2, mode='max', unit='일 경과',
        hint='web/lib/ai.ts generateDailyBrief — OPENAI_API_KEY 또는 페이지 미방문',
    ),
    Check(
        stage='ai', label='경쟁사 키워드 분석 신선도',
        sql="SELECT COALESCE(CURRENT_DATE - MAX(week_start), 999) FROM competitor_insights",
        threshold=14, mode='max', unit='일 경과',
        hint='competitor_analysis_generator — 매주 월요일 실행',
    ),
]


# ── Slack ────────────────────────────────────────────────

def _send_slack(text: str) -> None:
    url = os.getenv('SLACK_WEBHOOK_URL', '').strip()
    if not url:
        return
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps({'text': text}, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json; charset=utf-8'},
            method='POST',
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"  Slack 발송 실패: {e}", flush=True)


# ── 실행 ─────────────────────────────────────────────────

def _check_taxonomy(conn) -> tuple[list[str], list[str]]:
    """분류 키워드 목록이 낡았는지 점검한다.

    하드코딩된 목록은 반드시 낡는다. 새 성분 트렌드나 마케팅 용어가 나오면
    조용히 미분류로 빠진다 (PDRN이 78회 등장하는데 목록에 없었던 것이 그 예).
    커버리지 하락과 미등록 빈출어를 감시해 목록을 갱신할 시점을 알린다.
    """
    from collector.taxonomy import coverage, discover

    passed: list[str] = []
    failed: list[str] = []

    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (goods_no) goods_name
            FROM market_rankings
            WHERE rank_date >= CURRENT_DATE - 30 AND goods_name IS NOT NULL
        """)
        market = [r['goods_name'] if isinstance(r, dict) else r[0] for r in cur.fetchall()]
        cur.execute("""
            SELECT goods_name FROM products
            WHERE is_competitor = false AND goods_name IS NOT NULL
        """)
        ours = [r['goods_name'] if isinstance(r, dict) else r[0] for r in cur.fetchall()]

    if not ours:
        return passed, ['⚠️ 분류 점검 — 자사 상품이 없어 건너뜀']

    # 자사는 우리가 직접 아는 제품이므로 100%에 가까워야 한다
    ours_cov = coverage(ours, 'efficacy')
    if ours_cov < 90:
        failed.append(
            f"❌ 자사 효능 분류 커버리지: {ours_cov}% (기준 90% 미만)\n"
            f"     → 신제품 라인의 용어가 taxonomy.EFFICACY에 없다"
        )
    else:
        passed.append(f"✅ 자사 효능 분류 커버리지: {ours_cov}%")

    # 시장은 헤어·바디·향수까지 섞여 있어 낮은 것이 정상. 급락만 본다.
    mkt_cov = coverage(market, 'efficacy')
    if mkt_cov < 35:
        failed.append(
            f"❌ 시장 효능 분류 커버리지: {mkt_cov}% (기준 35% 미만)\n"
            f"     → 시장 용어가 크게 바뀌었을 수 있다"
        )
    else:
        passed.append(f"✅ 시장 효능 분류 커버리지: {mkt_cov}%")

    # 자주 나오는데 어느 축에도 안 걸리는 말 = 목록에 추가할 후보
    candidates = [c for c in discover(market, min_count=30) if c[2] == 'tag']
    if len(candidates) > 5:
        top = ', '.join(f"{t}({n}회)" for t, n, _ in candidates[:6])
        failed.append(
            f"❌ 미등록 빈출 포지셔닝어 {len(candidates)}개 (기준 5개 초과)\n"
            f"     → {top}\n"
            f"     → taxonomy.py에 추가할지 검토 필요"
        )
    else:
        passed.append(f"✅ 미등록 빈출 포지셔닝어: {len(candidates)}개")

    return passed, failed


def verify(stage: str | None = None, notify: bool = True, quiet: bool = False) -> bool:
    """지정 단계(또는 전체)를 점검한다. 모두 통과하면 True.

    quiet=True면 실패가 있을 때만 Slack을 보낸다.
    """
    targets = [c for c in CHECKS if stage is None or c.stage == stage]
    run_taxonomy = stage in (None, 'taxonomy')
    if not targets and not run_taxonomy:
        print(f"'{stage}' 단계에 정의된 점검이 없습니다", flush=True)
        return True

    conn = get_conn()
    conn.autocommit = True
    passed: list[str] = []
    failed: list[str] = []

    try:
        with conn.cursor() as cur:
            for c in targets:
                try:
                    cur.execute(c.sql)
                    row = cur.fetchone()
                    value = float(list(row.values())[0] if isinstance(row, dict) else row[0])
                except Exception as e:
                    failed.append(f"⚠️ {c.label} — 점검 쿼리 실패: {str(e).splitlines()[0][:80]}")
                    continue

                num = int(value) if value == int(value) else value
                if c.failed(value):
                    sign = '미만' if c.mode == 'min' else '초과'
                    msg = (f"❌ {c.label}: {num}{c.unit} "
                           f"(기준 {int(c.threshold)}{c.unit} {sign})\n     → {c.hint}")
                    # 숫자만 울리면 결국 DB 를 뒤져야 해서 아무도 안 본다.
                    # 무엇이 걸렸는지 한 줄씩 붙인다 (최대 8줄).
                    if c.detail_sql:
                        try:
                            cur.execute(c.detail_sql)
                            for r in cur.fetchall()[:8]:
                                vals = list(r.values()) if isinstance(r, dict) else list(r)
                                msg += "\n       · " + " · ".join(str(v) for v in vals)
                        except Exception as e:
                            msg += f"\n       (목록: {str(e).splitlines()[0][:40]})"
                    failed.append(msg)
                else:
                    passed.append(f"✅ {c.label}: {num}{c.unit}")

        if run_taxonomy:
            try:
                tp, tf = _check_taxonomy(conn)
                passed += tp
                failed += tf
            except Exception as e:
                failed.append(f"⚠️ 분류 점검 실패: {str(e).splitlines()[0][:80]}")
    finally:
        conn.close()

    scope = f"[{stage}] " if stage else ""
    print(f"\n=== 파수꾼 점검 {scope}— 통과 {len(passed)} / 실패 {len(failed)} ===", flush=True)
    for line in passed:
        print("  " + line, flush=True)
    for line in failed:
        print("  " + line, flush=True)

    if notify and failed and not (quiet and not failed):
        header = f"🚨 [OY] 데이터 파이프라인 이상 감지 {scope}({len(failed)}건)"
        _send_slack(header + "\n" + "=" * 20 + "\n" + "\n".join(failed))
    elif notify and not quiet and not failed:
        _send_slack(f"✅ [OY] 파수꾼 점검 {scope}— 전 항목 정상 ({len(passed)}건)")

    return not failed


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    quiet = '--quiet' in sys.argv
    no_notify = '--no-notify' in sys.argv
    stage = args[0] if args else None
    ok = verify(stage=stage, notify=not no_notify, quiet=quiet)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
