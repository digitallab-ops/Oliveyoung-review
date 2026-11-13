"""
매일 오전 9시 실행 — 오늘의 종합 인사이트 브리핑을 daily_briefs 테이블에 저장.

이건 '백업' 생성기다. 평소에는 KST 자정 직후 web/lib/ai.ts 의 generateDailyBrief
가 먼저 쓰고, 여기는 ON CONFLICT DO NOTHING 으로 건너뛴다. 웹이 못 만든 날에만
이쪽이 그 칸을 채운다.

그래서 이 파일의 프롬프트와 데이터는 web/lib/ai.ts 의 buildDailyBriefPrompt 와
같은 수준으로 유지해야 한다. 2026-11-12 이전까지 여기는 옛날 프롬프트
("데이터 근거 + 한 줄 해석", "마지막에 액션 포인트 1개") 그대로였고,
11/01~11/08 여드레 내내 이쪽이 당첨돼 대시보드에 "평균 평점 4.78로 매우 높습니다.
이는 고객 만족도가 전반적으로 우수함을 나타냅니다" 같은 브리핑이 걸렸다.
한쪽만 고치면 다른 쪽이 그대로 나간다 — 프롬프트를 손볼 땐 양쪽을 같이 본다.

출력 형식도 웹과 같아야 한다. 이 텍스트는 Slack 이 아니라 대시보드
(DashboardTabs '오늘 브리핑')가 '\n' 으로 잘라서 bullet 으로 렌더한다.
Slack mrkdwn(*굵게*, 번호목록)을 쓰면 화면에서 깨진다.

사용: python -m collector.daily_brief_generator
"""
import os
import logging
import psycopg2
from datetime import date
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_URL = os.environ["DATABASE_URL"]
OPENAI_KEY = os.environ["OPENAI_API_KEY"]

# 웹(web/lib/ai.ts)과 같은 모델을 쓴다. 다른 모델을 쓰면 같은 데이터로도
# 결과 품질이 갈려서 "어제는 좋았는데 오늘은 왜" 가 반복된다.
from collector.brief_grounding import (load_brands, build_ground, verify,
                                       format_violations)

MODEL = os.environ.get("BRIEF_MODEL", "gpt-5.4-mini")

# 웹의 NO_MARKDOWN_SYSTEM 과 같은 규칙.
SYSTEM = (
    '당신은 올리브영 뷰티 시장 전문 분석가입니다. 출력 규칙: '
    '1) 모든 줄은 반드시 "- "로 시작하세요. '
    '2) 마크다운·특수문자 서식 완전 금지(*, **, #, __, >, `, ~, 이모지, 번호+점 등 어떤 형식도 금지). '
    '3) 섹션 제목 금지 — "리뷰 분석:", "순위:" 같은 카테고리 구분 없이 바로 인사이트 bullet로만 작성. '
    '4) 데이터 재나열 금지 — 해석과 판단만 써라. '
    '5) 각 bullet은 마케터가 즉시 행동할 수 있는 하나의 전략적 결론을 담아야 한다. '
    '6) bullet 사이 빈 줄 없이 연속 작성. '
    '7) 첫 글자부터 "- "로 시작하라. 다른 어떤 것도 출력하지 마라.'
)

INSTRUCTIONS = """────────────────────────────────

오늘 이 대시보드를 처음 여는 셀퓨전씨 마케터가 10초 안에 파악해야 할 것 4~5가지를 써라.

각 bullet 은 반드시 아래 네 조각을 이 순서로 담아라. 하나라도 못 채우면 그 bullet 은 버리고 다른 소재를 써라.
  (1) 근거 — 어떤 수치가 어떻게 움직였나. 위 데이터에 실제로 있는 숫자만 쓴다.
  (2) 해석 — 왜 그렇게 움직였다고 보는가. 반드시 위 블록 중 '다른 블록'의 데이터와 연결해서 설명한다
      (순위 ↔ 할인율, 순위 ↔ 시즌, 불만 키워드 ↔ 순위, 경쟁사 급등 ↔ 자사 가격 등).
  (3) 예상 — 이대로 가면 어떻게 될 것 같은가. 시점과 방향을 숫자로 적는다
      (예: "다음 주 안에 40위권 진입", "이번 달 안에 80위 밖으로 밀릴 것"). "지켜봐야 한다"는 예상이 아니다.
  (4) 할 일 — 누가 무엇을 바꾸거나 확인하는가.

좋은 예:
- 레이저 UV 썬스크린이 더모에서 7일간 84위에서 55위로 29계단 올라왔는데, 같은 기간 급등한 경쟁 선케어는 라로슈포제 톤업(+68), 이니스프리 톤업 1+1(+54)처럼 전부 톤업 축이다. 11월 들어 선케어 수요가 자외선이 아니라 톤 보정으로 옮겨가는 중이라, 지금 속도면 다음 주에 45위권까지는 올라가지만 톤업 소구가 없는 레이저 UV 는 그 위에서 막힐 가능성이 크다. 선케어 담당은 잡티 토닝 썬스크린을 톤업 키워드로 상세 첫 화면에 올리고, 레이저 UV 는 매끈·밀착 축으로 문구를 분리해 두 제품이 같은 검색어를 뺏지 않게 해라.
- 자사 평균 할인율이 30%로 경쟁사 26%보다 4%p 높은데도 클렌징 3종(57%, 52%, 47%)은 TOP100 밖이다. 할인 폭이 순위로 돌아오지 않는 구간이라, 이대로 두면 이번 달 안에 마진만 깎이고 순위는 그대로일 가능성이 높다. 가격 담당은 클렌징 3종 할인율을 40%대로 되돌리고, 뺀 예산을 순위가 실제로 반응하는 선케어 기획가에 옮겨 2주간 차이를 확인해라.

나쁜 예와 이유:
- "평균 평점 4.78로 높게 유지되었습니다. 이는 소비자 만족도가 높음을 시사합니다."
  → 변한 게 없고, 뒷문장이 앞문장을 바꿔 말한 것뿐이며, 예상도 할 일도 없다.
- "경쟁이 치열하므로 지속적인 마케팅 전략이 필요합니다."
  → 어느 상품에 무엇을 하라는 건지 없다. 이런 총평 bullet 은 쓰지 마라.
- "순위가 하락했으니 추이를 모니터링해야 합니다."
  → 모니터링은 예상도 행동도 아니다.

이 시장의 순위는 '추세 지속'이 아니라 '되돌림'이 지배한다. 실측값이다(자사 상품 680쌍, 최근 120일):
  - 지난 7일 방향이 다음 7일에도 이어진 비율    37pct
  - 반대로 되돌아간 비율                        63pct
  - 10계단 이상 크게 움직인 뒤 되돌아간 비율    71pct
  - 자사 상품의 하루 간 순위 변동 중앙값        12계단
그러므로:
- "이 속도면 계속 오른다 / 계속 밀린다"는 틀릴 확률이 더 높다. 쓰지 마라.
- 방향은 기계적으로 뒤집어서 시작해라. 헷갈리지 마라:
    지난 7일 순위가 **올랐으면**(계단 수가 +) → 기본 예상은 **되밀림(순위가 나빠짐)**
    지난 7일 순위가 **내렸으면**(계단 수가 -) → 기본 예상은 **반등(순위가 좋아짐)**
  이 기본값을 뒤집어 쓰려면, 순위를 그 방향으로 붙잡아 둘 원인을 위 데이터에서 직접
  짚어라 — 진행 중인 기획전·할인, 시즌 적합, 경쟁사 이탈, 불만 급증 같은 것.
  원인을 못 짚으면 기본값대로 써라.
- 하루 10계단 안쪽 움직임은 잡음이다. 그걸로 예상을 세우지 마라.
- 예상의 근거는 '추세'가 아니라 '지속될 이유'여야 한다 — 기획전, 할인, 시즌, 경쟁사 진입,
  리뷰 불만처럼 순위를 붙잡아 둘 원인이 보일 때만 방향이 이어진다고 써라.
  그런 원인이 안 보이면 "원래 자리로 돌아올 가능성이 높다"가 더 정확한 예상이다.

규칙:
- '자사'는 셀퓨전씨뿐이다. [경쟁사] 로 표시된 블록의 상품을 자사라고 쓰면 그 브리핑은 틀린 것이다.
- 누적 불만 건수는 전체 기간 합계다. '늘었다/줄었다/급증했다'로 쓰지 마라.
  변화를 말할 수 있는 건 '불만 급증' 블록뿐이다.
- 경쟁사 리뷰 데이터는 2026년 7월에 한 번 수집된 뒤 갱신이 없다.
  경쟁사 불만을 '요즘/최근'이라고 쓰지 마라. 상품 특성으로만 참고해라.
- 위 데이터에 없는 숫자를 지어내지 마라. 모르는 건 쓰지 마라.
- 변하지 않은 것은 쓰지 마라. 평점·리뷰 수가 평소와 같으면 한 줄도 쓰지 마라.
- 한 문장을 다른 말로 반복하지 마라. "이는/즉/다시 말해"로 시작하는 뒷문장은 전부 삭제 대상이다.
- 금지 표현(평서형 '-다' 꼴도 똑같이 금지): 나타냅니다/나타낸다, 시사합니다/시사한다,
  의미합니다/의미한다, 보여줍니다/보여준다, 암시합니다/암시한다, 중요합니다/중요하다,
  긍정적입니다, 필요해 보입니다, 강화하세요, 모니터링하세요, 분석하세요, 추이를 살펴보세요.
  어떤 수치가 무엇을 '보여준다'고 쓰지 마라. 무엇이 어떻게 될지를 바로 써라.
- 마지막에 '액션 포인트' 같은 종합 bullet 을 붙이지 마라. 행동은 각 bullet 안에 있다.
- 쓸 거리가 3개뿐이면 3개만 써라. 수를 채우려 평범한 것을 올리지 마라.
- 데이터 블록이 전부 '없음'이거나 쓸 근거가 하나도 없으면 **아무것도 출력하지 마라**.
  빈 문자열을 반환해라. 데이터 없이 추측으로 bullet 을 만드는 건 최악이다.
  '데이터가 없다는 점이 ~를 뜻한다' 같은 문장도 금지다. 없는 건 없는 거다.
- 섹션 제목·번호 없이 첫 글자부터 "- "로 시작"""


def season_context(today: date) -> str:
    """web/lib/ai.ts 의 getSeasonContext 와 같은 문구를 쓴다."""
    m, d = today.month, today.day
    s = f"{today.year}-{m:02d}-{d:02d}"
    if m == 12 or m <= 2:
        return f"지금은 겨울({s}) — 보습·보온 수요, 건조한 피부 고민 집중"
    if m == 3:
        return f"지금은 초봄({s}) — 봄 환절기 진입, 미세먼지·봄 맞이 스킨케어 수요 상승"
    if m <= 5:
        return f"지금은 봄({s}) — 자외선 시작, 선케어 수요 진입, 가벼운 제형 선호"
    if m == 6:
        return f"지금은 초여름({s}) — 선케어 피크 직전, 쿨링 수요 급상승"
    if m <= 8:
        return f"지금은 여름({s}) — 선케어·쿨링 피크 시즌, 땀·모공·각질 케어 수요"
    if m == 9:
        return f"지금은 초가을({s}) — 여름 마무리, 쿨링 수요 감소 시작, 보습·환절기 케어 전환기"
    if m == 10:
        return f"지금은 가을({s}) — 환절기 민감성 피부 수요, 진정·보습 강화"
    return f"지금은 늦가을({s}) — 겨울 진입 전, 집중 보습·트러블 케어 수요"


# 프롬프트만으로는 못 막는다. 블록이 전부 비어도 모델은 "데이터가 없다는 점이
# ~를 뜻한다" 식으로 4~5줄을 만들어 낸다(2026-11-12 실측, bullet 4개).
# 수집이 실패한 날 그런 글이 대시보드에 걸리면 없느니만 못하다.
# 재료 줄 수를 세서 이 아래면 LLM 을 아예 부르지 않는다.
MIN_MATERIAL_LINES = 3


def _block(title: str, lines: list) -> str:
    body = "\n".join(lines) if lines else "없음"
    return f"[{title}]\n{body}"


def build_prompt(cur) -> str:
    """브리핑 재료를 블록 단위로 모아 하나의 프롬프트로 만든다.

    '예상'을 쓰게 하려면 하루치 변화만으로는 모자란다. 흐름(7일 순위),
    원인 후보(할인율), 배경(시즌)을 같이 줘야 모델이 연결을 만든다.
    """
    today = date.today()

    # ── 자사 7일 순위 흐름 ─────────────────────────────
    # 하루 여러 번(rank_hour) 수집되므로 날짜별 최고 순위로 접는다.
    # goods_name 은 GROUP BY 에서 뺀다 — 같은 goods_no 에 이름이 두 가지로 들어간 날이
    # 있었고(2026-11-02), 이름까지 묶으면 한 상품이 두 줄로 나와 모델이 서로 다른
    # 제품으로 읽는다. 백테스트에서 실제로 "하나는 오르고 하나는 내렸다"가 나왔다.
    cur.execute("""
        SELECT mr.category_name, mr.goods_no, MAX(mr.goods_name) AS goods_name,
               mr.rank_date, MIN(mr.rank_position) AS best
        FROM oliveyoung.market_rankings mr
        JOIN oliveyoung.products p ON mr.goods_no = p.goods_no
        WHERE p.is_competitor = FALSE
          AND mr.category_name <> '전체'
          AND mr.rank_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date - 6
        GROUP BY mr.category_name, mr.goods_no, mr.rank_date
        ORDER BY mr.category_name, mr.goods_no, mr.rank_date
    """)
    trends = {}
    # 키에 goods_name 을 넣으면 안 된다. MAX(goods_name) 은 날짜 그룹마다 계산되므로
    # 어떤 날은 '셀퓨전씨[...] 레이저 UV', 어떤 날은 '셀퓨전씨[...] 셀퓨전씨 레이저 UV'
    # 가 나와 한 상품이 두 줄로 갈라진다. 그러면 모델이 서로 다른 제품으로 읽고
    # "같은 축인데 하나는 오르고 하나는 내렸다" 는 없는 이야기를 만든다(백테스트 실측).
    names = {}
    for cat, gno, gname, rdate, best in cur.fetchall():
        trends.setdefault((cat, gno), []).append(int(best))
        names[(cat, gno)] = gname          # 마지막(=최신) 표기를 쓴다
    # 한 상품이 여러 카테고리 TOP100 에 동시에 들어간다. 카테고리마다 한 줄씩
    # 쓰면 모델이 **서로 다른 두 상품**으로 읽는다 — 2026-11-13 생산 브리핑이
    # "포스트 알파 쿨링 패드는 62위에서 55위로 회복했지만 더모 코스메틱 쿨링
    # 패드는 80위에서 93위로 밀렸다"고 썼다. 62는 마스크팩 줄, 55는 더모 줄에서
    # 하나씩 집어온 것이고 두 줄은 같은 goods_no 다.
    # 그래서 상품 단위로 한 줄에 합치고, 같은 상품임을 문장으로 못박는다.
    by_goods = {}
    for (cat, gno), pts in trends.items():
        if len(pts) < 2:          # 하루만 찍힌 건 추세가 아니다
            continue
        net = pts[0] - pts[-1]    # 양수 = 순위 상승
        sign = f"+{net}" if net > 0 else str(net)
        seg = f"[{cat}] {' → '.join(map(str, pts))}위 ({len(pts)}일 {sign}계단)"
        g = by_goods.setdefault(gno, {"name": names[(cat, gno)], "segs": [], "best": 10_000})
        g["segs"].append((pts[-1], seg))
        g["best"] = min(g["best"], pts[-1])

    trend_lines = []
    for gno, v in by_goods.items():
        segs = [s for _, s in sorted(v["segs"])]
        tail = "   ※ 한 상품이다. 카테고리별 순위일 뿐 서로 다른 제품이 아니다" if len(segs) > 1 else ""
        trend_lines.append((v["best"], f"{v['name']}: " + " | ".join(segs) + tail))
    trend_lines = [t for _, t in sorted(trend_lines)][:10]

    # ── 오늘 경쟁사 급등 / TOP10 신규진입 ───────────────
    cur.execute("""
        WITH t AS (
            SELECT DISTINCT ON (category_name, goods_no)
                   category_name, goods_no, goods_name, rank_position
            FROM oliveyoung.market_rankings
            WHERE rank_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
            ORDER BY category_name, goods_no, rank_hour DESC
        ),
        y AS (
            SELECT DISTINCT ON (category_name, goods_no)
                   category_name, goods_no, rank_position
            FROM oliveyoung.market_rankings
            WHERE rank_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date - 1
            ORDER BY category_name, goods_no, rank_hour DESC
        )
        SELECT t.category_name, t.goods_name, y.rank_position, t.rank_position,
               y.rank_position - t.rank_position AS delta
        FROM t
        JOIN y ON t.category_name = y.category_name AND t.goods_no = y.goods_no
        JOIN oliveyoung.products p ON p.goods_no = t.goods_no
        WHERE p.is_competitor = TRUE
          AND t.category_name <> '전체'
          AND y.rank_position - t.rank_position >= 5
        ORDER BY delta DESC
        LIMIT 6
    """)
    risers = [f"[{c}] {n} {prev}위 → {cur_r}위 (+{d})"
              for c, n, prev, cur_r, d in cur.fetchall()]

    cur.execute("""
        WITH t AS (
            SELECT DISTINCT ON (category_name, goods_no)
                   category_name, goods_no, goods_name, rank_position
            FROM oliveyoung.market_rankings
            WHERE rank_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
            ORDER BY category_name, goods_no, rank_hour DESC
        )
        SELECT t.category_name, t.goods_name, t.rank_position
        FROM t
        JOIN oliveyoung.products p ON p.goods_no = t.goods_no
        WHERE p.is_competitor = TRUE
          AND t.category_name <> '전체'
          AND t.rank_position <= 10
          AND NOT EXISTS (
              SELECT 1 FROM oliveyoung.market_rankings y
              WHERE y.rank_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date - 1
                AND y.category_name = t.category_name
                AND y.goods_no = t.goods_no
          )
        ORDER BY t.rank_position
        LIMIT 4
    """)
    new_top10 = [f"[{c}] {n} {r}위 신규진입" for c, n, r in cur.fetchall()]

    # ── 가격·할인 (정가가 아니라 실제 판매가) ────────────
    cur.execute("""
        WITH latest AS (
            SELECT DISTINCT ON (h.goods_no)
                   h.goods_no, h.base_price, h.sale_price, h.discount_rate
            FROM oliveyoung.price_history h
            WHERE h.sale_price IS NOT NULL AND h.base_price IS NOT NULL
              AND h.recorded_date >= CURRENT_DATE - 14
            ORDER BY h.goods_no, h.recorded_date DESC
        )
        SELECT p.is_competitor, COUNT(*), ROUND(AVG(l.discount_rate), 1)
        FROM latest l
        JOIN oliveyoung.products p ON p.goods_no = l.goods_no
        WHERE l.discount_rate > 0
        GROUP BY p.is_competitor
    """)
    agg = {bool(is_comp): (cnt, float(avg)) for is_comp, cnt, avg in cur.fetchall()}
    disc_lines = []
    if agg:
        o_cnt, o_avg = agg.get(False, (0, 0.0))
        r_cnt, r_avg = agg.get(True, (0, 0.0))
        disc_lines.append(f"평균 할인율 — 자사 {o_avg}% ({o_cnt}개) / 경쟁사 {r_avg}% ({r_cnt}개)")

    cur.execute("""
        WITH latest AS (
            SELECT DISTINCT ON (h.goods_no)
                   h.goods_no, h.base_price, h.sale_price, h.discount_rate
            FROM oliveyoung.price_history h
            WHERE h.sale_price IS NOT NULL AND h.base_price IS NOT NULL
              AND h.recorded_date >= CURRENT_DATE - 14
            ORDER BY h.goods_no, h.recorded_date DESC
        )
        SELECT p.is_competitor, p.goods_name, l.base_price, l.sale_price, l.discount_rate,
               ROW_NUMBER() OVER (PARTITION BY p.is_competitor ORDER BY l.discount_rate DESC) AS rn
        FROM latest l
        JOIN oliveyoung.products p ON p.goods_no = l.goods_no
        WHERE l.discount_rate > 0
    """)
    for is_comp, name, base, sale, rate, rn in cur.fetchall():
        limit = 6 if is_comp else 5
        if rn > limit:
            continue
        tag = "경쟁사" if is_comp else "자사"
        disc_lines.append(f"{tag} {name} {rate}% ({base:,}→{sale:,}원)")

    # ── 리뷰 불만: 자사와 경쟁사를 '반드시' 나눠서 넘긴다 ──
    # 섞어서 주면 모델이 전부 자사로 읽는다. 실제로 그렇게 나간 적이 있다.
    def negatives(is_competitor: bool, limit: int):
        cur.execute("""
            SELECT p.goods_name, COUNT(*) AS neg
            FROM oliveyoung.reviews r
            JOIN oliveyoung.products p ON r.goods_no = p.goods_no
            WHERE r.score <= 2 AND r.content IS NOT NULL AND r.content <> ''
              AND p.is_competitor = %s
            GROUP BY p.goods_no, p.goods_name
            ORDER BY neg DESC
            LIMIT %s
        """, (is_competitor, limit))
        return [f"{n}: 불만 {c}건" for n, c in cur.fetchall()]

    # 주의: 경쟁사 리뷰는 2026-07 에 한 번 수집된 뒤 멈췄다(124,209건/386개 상품,
    # collected_at 이 전부 2026-07). 자사만 매일 들어온다. 그래서 경쟁사 불만은
    # '지금 시장 신호'가 아니라 7월 스냅샷이고, 프롬프트에도 그렇게 라벨을 단다.
    ours_neg = negatives(False, 4)
    rival_neg = negatives(True, 4)

    # 자사 부정 리뷰 급증 (최근 7일 vs 직전 7일).
    # 누적 건수는 '늘 많은 상품'만 반복해서 나온다. 변화가 있는 건 이쪽이다.
    # web/lib/db.ts 의 getNegativeAlerts 와 같은 기준이어야 한다 — 바꾸면 양쪽 수치가 갈린다.
    # created_at 은 date 가 아니라 'YYYY.MM.DD' 텍스트다. 비교 기준을 'YYYY-MM-DD' 로
    # 만들면 '.'(46) > '-'(45) 때문에 연도만 같으면 전부 참이 되어 prev 가 항상 0 이 된다.
    # 7일 창으로는 자사 부정 리뷰가 주당 12건이라 경보가 0건이 되어 14일로 넓혔다.
    cur.execute("""
        SELECT p.goods_name,
               COUNT(*) FILTER (WHERE r.score <= 2
                 AND r.created_at >= to_char(CURRENT_DATE - 14, 'YYYY.MM.DD'))  AS recent_neg,
               COUNT(*) FILTER (WHERE r.score <= 2
                 AND r.created_at >= to_char(CURRENT_DATE - 28, 'YYYY.MM.DD')
                 AND r.created_at <  to_char(CURRENT_DATE - 14, 'YYYY.MM.DD')) AS prev_neg
        FROM oliveyoung.reviews r
        JOIN oliveyoung.products p ON r.goods_no = p.goods_no
        WHERE r.content IS NOT NULL AND p.is_competitor = FALSE
        GROUP BY p.goods_no, p.goods_name
        HAVING COUNT(*) FILTER (WHERE r.score <= 2
                 AND r.created_at >= to_char(CURRENT_DATE - 14, 'YYYY.MM.DD')) >= 3
    """)
    surge = []
    for name, recent, prev in cur.fetchall():
        pct = round((recent - prev) * 100.0 / prev) if prev else 100
        if pct < 50:
            continue
        surge.append((pct, f"{name}: {prev}건 -> {recent}건 ({pct:+d}%)"))
    neg_surge = [t for _, t in sorted(surge, reverse=True)][:4]

    # ── 자사 리뷰 주간 변화 (값 자체가 아니라 '변화'를 준다) ──
    cur.execute("""
        SELECT
            COUNT(*) FILTER (WHERE r.collected_at >= CURRENT_DATE - 7)                      AS cnt_now,
            COUNT(*) FILTER (WHERE r.collected_at >= CURRENT_DATE - 14
                               AND r.collected_at <  CURRENT_DATE - 7)                      AS cnt_prev,
            ROUND(AVG(r.score) FILTER (WHERE r.collected_at >= CURRENT_DATE - 7)::numeric, 2)  AS avg_now,
            ROUND(AVG(r.score) FILTER (WHERE r.collected_at >= CURRENT_DATE - 14
                               AND r.collected_at <  CURRENT_DATE - 7)::numeric, 2)            AS avg_prev
        FROM oliveyoung.reviews r
        JOIN oliveyoung.products p ON r.goods_no = p.goods_no
        WHERE p.is_competitor = FALSE
    """)
    cnt_now, cnt_prev, avg_now, avg_prev = cur.fetchone()
    week_lines = []
    if cnt_now or cnt_prev:
        delta_pct = (f"{(cnt_now - cnt_prev) * 100.0 / cnt_prev:+.0f}%"
                     if cnt_prev else "직전 주 없음")
        week_lines.append(f"자사 리뷰 수 — 최근 7일 {cnt_now}건 / 직전 7일 {cnt_prev}건 ({delta_pct})")
        if avg_now is not None and avg_prev is not None:
            week_lines.append(f"자사 평균 평점 — 최근 7일 {avg_now} / 직전 7일 {avg_prev} "
                              f"({float(avg_now) - float(avg_prev):+.2f})")

    material = (len(trend_lines) + len(risers) + len(new_top10) + len(disc_lines)
                + len(neg_surge) + len(ours_neg) + len(week_lines))
    if material < MIN_MATERIAL_LINES:
        log.warning("재료가 %d줄뿐 — 브리핑을 만들지 않는다 (수집 실패 의심)", material)
        return ""

    return "\n\n".join([
        season_context(today),
        _block("자사 최근 순위 흐름 — 왼쪽이 과거, 오른쪽이 오늘", trend_lines),
        _block("오늘 시장 급상승 — 경쟁사", risers),
        _block("오늘 TOP10 신규진입 — 경쟁사", new_top10),
        _block("가격·할인 현황 (최근 14일, 정가 아닌 실제 판매가 기준)", disc_lines),
        _block("자사 리뷰 불만 급증 — 최근 14일 vs 직전 14일", neg_surge),
        _block("자사 리뷰 불만 — 전체 기간 누적. 오늘의 변화가 아님", ours_neg),
        _block("경쟁사 리뷰 불만 — 2026-07 스냅샷. 자사 아니고, 최신도 아님", rival_neg),
        _block("자사 리뷰 주간 변화", week_lines),
        INSTRUCTIONS,
    ])


def generate_brief(prompt: str) -> str:
    client = OpenAI(api_key=OPENAI_KEY)
    resp = client.chat.completions.create(
        model=MODEL,
        # gpt-5 계열은 max_tokens 를 거부한다. 웹(web/lib/ai.ts)과 같은 인자를 쓴다.
        max_completion_tokens=2200,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
    )
    return (resp.choices[0].message.content or "").strip()


GROUNDING_TRIES = 3


def generate_grounded(prompt: str, cur) -> str:
    """생성하고 접지 검사를 통과한 것만 돌려준다. 못 넘기면 빈 문자열.

    프롬프트 지시만으로는 환각을 못 막는다. 2026-11-13 생산 브리핑에서
    급상승 블록은 이미 `82위 → 46위 (+36)` 라는 명시적 형식이었는데도
    "아떼 무기자차 82위에서 46위"라고 썼다 — 아떼는 그날 블록에 없었다.
    그래서 만든 뒤 기계로 대조하고, 틀리면 버리고 다시 만든다.

    틀린 브리핑보다 빈 브리핑이 낫다. 3회 모두 실패하면 저장하지 않는다.
    """
    brands = load_brands(cur)
    ground = build_ground(prompt, brands)
    for attempt in range(1, GROUNDING_TRIES + 1):
        text = generate_brief(prompt)
        if not text:
            log.warning("[접지 %d/%d] 빈 응답", attempt, GROUNDING_TRIES)
            continue
        V = verify(text, ground, brands)
        if not V:
            if attempt > 1:
                log.info("[접지 %d/%d] 통과", attempt, GROUNDING_TRIES)
            return text
        log.warning("[접지 %d/%d] 위반 %d건 — 버리고 다시 만든다: %s",
                    attempt, GROUNDING_TRIES, len(V), format_violations(V)[:300])
    return ""


def save_brief(cur, brief_text: str):
    # DO NOTHING 인 이유: 같은 칸을 web/lib/ai.ts 도 쓴다.
    # 웹은 KST 자정 직후, 여기는 09시에 돈다. 웹이 이미 썼으면 건드리지 않는다.
    cur.execute("""
        INSERT INTO oliveyoung.daily_briefs (brief_date, brief_text)
        VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, %s)
        ON CONFLICT (brief_date) DO NOTHING
    """, (brief_text,))
    return cur.rowcount          # 0 이면 이미 있어서 건너뛴 것


def brief_exists_today(cur) -> bool:
    cur.execute("""SELECT 1 FROM oliveyoung.daily_briefs
                   WHERE brief_date = (now() AT TIME ZONE 'Asia/Seoul')::date""")
    return cur.fetchone() is not None


def main(dry_run: bool = False):
    conn = psycopg2.connect(DB_URL)
    try:
        with conn:
            with conn.cursor() as cur:
                # 이미 있으면 LLM 을 부르지 않는다. 불러 놓고 버리면 돈만 나간다.
                if not dry_run and brief_exists_today(cur):
                    log.info("오늘 브리핑이 이미 있다 (웹에서 생성) — 건너뛴다")
                    return
                log.info("데이터 수집 중...")
                prompt = build_prompt(cur)
                if not prompt:
                    log.warning("재료 부족 — LLM 호출 없이 종료한다")
                    return
                log.info("브리핑 생성 중 (%s)...", MODEL)
                brief = generate_grounded(prompt, cur)
                if not brief:
                    log.error("접지 검사를 %d회 모두 통과하지 못했다 — 저장하지 않는다",
                              GROUNDING_TRIES)
                    return
                if dry_run:
                    log.info("DRY RUN — 저장하지 않는다")
                    print(brief)
                    return
                if save_brief(cur, brief):
                    log.info("저장 완료:\n%s", brief)
                else:
                    log.info("그 사이 웹이 먼저 저장했다 — 건너뛴다")
    finally:
        conn.close()


if __name__ == "__main__":
    import sys
    main(dry_run="--dry-run" in sys.argv)
