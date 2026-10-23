"""상세페이지 구성 분석 — 이미지를 비전 모델로 읽어 '흐름도'를 뽑는다.

왜 OCR이 아닌가:
  OCR은 글자만 준다. 우리가 알고 싶은 건 "뭐라고 썼나"가 아니라
  "어떤 역할의 블록을 어떤 순서로 배치했나"다. 그건 분류 문제이지 추출 문제가 아니다.
  비전 모델은 한 번에 역할 분류와 소구점 추출을 함께 해준다.

왜 이어 붙이는가:
  비전 API는 긴 쪽을 약 1568px로 축소한다. 960x52000 통짜를 넣으면 한글이 뭉개진다.
  960x2500 내외로 잘라 넣으면 축소 후에도 헤드라인이 읽힌다.

실행:
    python -m collector.detail_page_analyzer --goods A000000257097
    python -m collector.detail_page_analyzer --all
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from db.schema import get_conn  # noqa: E402

# 비전 호출이 이 프로젝트의 가장 큰 지출이다(324개 분석에 $28.69).
# gpt-4o-mini 로 내려 봤다가 되돌렸다. 같은 패널 8개를 돌린 실측:
#   gpt-5.4-mini  입력 23,871 토큰 · 역할 분류 기준
#   gpt-4o-mini   입력 326,076 토큰 (13.7배) · 역할 일치 66%
# 세로로 긴 패널을 4o-mini 가 잘게 타일링해 입력 토큰이 폭증한다.
# 싼 모델이 더 비싸고 품질도 낮다. 모델을 내려 절감하려 하지 마라 —
# 줄일 곳은 '축을 추가할 때마다 전수 재분석하는 것'과 '신규 상품만 돌리는 것'이다.
MODEL = "gpt-5.4-mini"
PANEL_MAX_H = 2500      # 합성 패널 최대 세로 — 축소 후 가독성이 유지되는 선
PANEL_W = 960

# 패널 1장당 단가. 공시가가 아니라 '이 파이프라인에서 실제로 나간 돈'이다.
# 누적 $28.69 를 실제 호출 패널 수로 나눈다. 호출된 패널은 324개 전수(6,979장)
# 한 번 + 74개 부분집합 두 번이라 정확한 분모를 모른다. 그래서 하한을 쓴다:
#   28.69 / 6,979(= 전수 1회분) = $0.0041  ← 이 값. 분모가 실제보다 작으므로
#   단가는 보수적으로 크게 잡히고, 견적은 과소 추정되지 않는다.
# 전에 0.0034 로 뒀는데 어떤 분모로도 나오지 않는 숫자였다. 견적이 17% 낮게
# 나와 $1 게이트가 실제 $1.21 에서야 걸렸다.
# 모델이나 프롬프트를 바꾸면 detail_panels.tok_in 실측으로 다시 보정해라.
COST_PER_PANEL = 0.0041
# 이 금액을 넘는 배치는 --yes 없이는 돌지 않는다.
# 74개를 말없이 두 번 돌려 $5 를 버린 적이 있다. 그때 이 게이트가 있었으면 막혔다.
BUDGET_GATE = 1.00

# ── 섹션 역할 분류 ──────────────────────────────────────────
# 한국 화장품 상세페이지에서 반복적으로 관찰되는 블록 유형.
# 하드코딩된 목록은 낡는다. 모델이 '기타'로 분류한 것이 쌓이면 목록을 갱신할 신호다.
ROLES = {
    "후킹":        "첫 화면. 제품컷 + 한 줄 카피로 시선을 잡는 구간",
    "문제제기":    "소비자 고민·불편을 환기 (이런 고민 있나요)",
    "핵심소구":    "제품의 주요 효능·약속을 내세우는 구간",
    "성분":        "원료·성분 설명, 함량, 성분 클로즈업",
    # 과학적 근거와 사회적 증명은 설득 수단이 다르므로 나눈다
    "임상인증":    "인체적용시험 결과, 피부과 테스트, 특허, 인증 마크 등 과학적 근거",
    "실적소구":    "누적 판매량, 판매 랭킹, 어워드 수상, 재구매율 등 시장에서의 성과",
    "제형텍스처":  "발림성·흡수·제형 시연 컷",
    "사용법":      "사용 순서, 사용량, 사용 시점",
    "비교":        "비포애프터, 경쟁 비교, 자사 라인 간 비교, 호수 비교",
    "후기소셜":    "리뷰 인용, SNS 반응, 인플루언서·셀럽",
    "라인업옵션":  "색상·호수·종류 선택 안내",
    "기획증정":    "세트 구성, 사은품, 1+1 안내",
    "브랜드":      "브랜드 스토리·철학, 라인 체계 소개",
    "판매처안내":  "공식 판매처·정품 인증 고지",
    "안내":        "배송·교환·주의사항·전성분 표기",
}

# 축을 추가할 때마다 여기를 가장 최근 컬럼으로 바꾼다.
# '분석됐나'로 판정하면 구스키마 행이 그대로 남아 조용히 누락된다 (실제로 28개가 그랬다).
SCHEMA_MARKER = "certs"

# ── 추가 분석 축 ───────────────────────────────────────────
# 역할만으로는 초안을 못 쓴다. BM이 구간마다 결정해야 하는 것을 축으로 삼는다.
#   카피 유형 → 톤을 정한다
#   비주얼 유형 → 디자인팀에 의뢰할 것이 정해진다
#   근거 유형 → '임상인증'이 뭉뚱그려져 있어 쪼갠다
#   텍스트 밀도 → 분량 감
# 스크롤 위치는 이미지 높이 누적으로 계산한다(비전 호출 불필요).
COPY_TYPES = {
    "질문형": "독자에게 묻는다 (이런 고민 있나요?)",
    "수치형": "숫자를 앞세운다 (24시간, 97%, 475만개)",
    "선언형": "단정한다 (1등 선크림, 결 고민 종결)",
    "공감형": "상황을 묘사해 공감을 부른다",
    "명령형": "행동을 지시한다 (지금 확인하세요)",
    "설명형": "사실을 담담히 설명한다",
}
VISUAL_TYPES = {
    "모델컷": "사람이 제품을 쓰거나 얼굴이 나온다",
    "제품컷": "제품 단독 사진",
    "시연컷": "손등 발림, 텍스처 클로즈업",
    "그래프": "막대·선 그래프, 수치 시각화",
    "비교표": "표 형태의 비교, 전후 대조",
    "인포그래픽": "도식·아이콘으로 설명",
    "텍스트": "글자 위주, 이미지 요소가 거의 없음",
}
EVIDENCE_TYPES = {
    "시험결과": "인체적용시험·임상 결과 수치",
    "인증마크": "기관 인증, 수상 배지, 특허",
    "판매실적": "누적 판매량, 랭킹, 재구매율",
    "후기인용": "실제 리뷰·SNS 문구 인용",
    "전후사진": "비포애프터 이미지",
    "성분함량": "성분명과 함량 수치",
    "없음": "근거 제시가 없는 구간",
}

SYSTEM = """당신은 화장품 상세페이지 구조를 분석하는 전문가입니다.
주어진 이미지는 올리브영 상품 상세페이지를 위에서부터 순서대로 잘라낸 것입니다.
각 구간의 역할과 표현 방식을 분류하세요.

반드시 JSON만 출력하고 다른 말은 쓰지 마세요."""

USER_TMPL = """이 이미지는 상세페이지의 {idx}번째 구간입니다 (전체 {total}구간 중).

[역할]
{roles}

[카피 유형]
{copy}

[비주얼 유형]
{visual}

[근거 유형]
{evidence}

아래 JSON 형식으로만 답하세요. sections는 이 이미지 안에서 위에서 아래 순서대로 나열합니다.

{{"sections":[
  {{"role":"역할",
    "copy_type":"카피 유형",
    "visual":"비주얼 유형",
    "evidence":"근거 유형",
    "density":"많음|보통|적음",
    "headline":"그 구간의 가장 큰 문구 (없으면 빈 문자열)",
    "appeals":["소구 키워드 최대 4개"],
    "has_number":true/false,
    "certs":["인증·마크 이름 그대로, 최대 5개"],
    "note":"한 줄 설명"}}
]}}

규칙:
- 각 분류는 위 목록에 있는 값만 쓰세요. 역할이 어디에도 없으면 "기타"로 하고 note에 이유를 적으세요.
- density는 그 구간의 글자량입니다.
- has_number는 수치(퍼센트, 시간, 배수, 인원수)가 눈에 띄게 쓰였는지입니다.
- 한 이미지에 여러 역할이 섞여 있으면 나눠서 적으세요.
- certs에는 화면에 보이는 인증·시험·수상 마크를 보이는 그대로 적으세요
  (예: "V-LABEL 비건", "FSC", "식품의약품안전처 기능성", "피부자극테스트 완료",
  "논코메도제닉", "더마테스트 엑설런트", "올리브영 어워즈"). 없으면 빈 배열."""


def _client():
    from openai import OpenAI
    return OpenAI(api_key=os.environ["OPENAI_API_KEY"])


def ensure_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS detail_sections (
                goods_no    VARCHAR(20) NOT NULL,
                seq         INT NOT NULL,
                panel       INT,
                role        VARCHAR(30),
                headline    TEXT,
                appeals     JSONB,
                has_number  BOOLEAN,
                note        TEXT,
                PRIMARY KEY (goods_no, seq)
            )
        """)
        # 2026-10 추가 축. 기존 행은 NULL로 남으므로 재분석이 필요하다.
        for col, typ in (("copy_type", "VARCHAR(20)"), ("visual", "VARCHAR(20)"),
                         ("evidence", "VARCHAR(20)"), ("density", "VARCHAR(10)"),
                         ("scroll_pct", "NUMERIC(5,1)"),
                         # 인증마크는 종류가 계속 생긴다. 고정 목록 대신 보이는 그대로
                         # 받아 두고 정규화는 detail_page_certs 에서 한다
                         ("certs", "JSONB")):
            cur.execute(f"ALTER TABLE detail_sections ADD COLUMN IF NOT EXISTS {col} {typ}")

        # 패널 원본 응답 보관.
        # detail_sections 에는 '그때 우리가 쓰기로 한 칸'만 남는다. 모델이 더 말해줬어도
        # 매핑 안 한 건 버려진다. 축을 하나 늘릴 때마다 전수 재분석(=전액 재지불)을
        # 하게 된 근본 원인이 이것이다. 원문을 남겨두면 글에서 뽑을 수 있는 축은
        # 돈 한 푼 없이 채운다. tok_in/tok_out 은 단가 재보정에도 쓴다.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS detail_panels (
                goods_no    VARCHAR(20) NOT NULL,
                panel       INT NOT NULL,
                model       VARCHAR(40),
                scroll_pct  NUMERIC(5,1),
                raw         JSONB,
                tok_in      INT,
                tok_out     INT,
                analyzed_at TIMESTAMP DEFAULT now(),
                PRIMARY KEY (goods_no, panel)
            )
        """)


def build_panels(goods_no: str) -> tuple[list[bytes], list[float]]:
    """상세 이미지를 이어 붙여 패널로 만들고, 각 패널의 스크롤 위치(%)를 함께 돌려준다.

    스크롤 위치는 이미지 높이 누적으로 계산한다 — 비전 호출이 필요 없다.
    "리뷰를 상단 50% 안에 둔다" 같은 배치 가설을 이 값으로 검증한다.
    """
    from PIL import Image

    d = Path(__file__).resolve().parent.parent / "exports" / "detail_pages" / goods_no
    files = sorted(d.glob("*.jpg"))
    if not files:
        return [], []

    panels, starts, cur, cur_h, acc = [], [], [], 0, 0

    def flush():
        nonlocal cur, cur_h
        if not cur:
            return
        canvas = Image.new("RGB", (PANEL_W, cur_h), "white")
        y = 0
        for im in cur:
            canvas.paste(im, (0, y))
            y += im.height
        buf = io.BytesIO()
        canvas.save(buf, "JPEG", quality=82)
        panels.append(buf.getvalue())
        cur, cur_h = [], 0

    def add(im):
        """이미지 한 장을 현재 패널에 올린다. 패널이 차면 비운다."""
        nonlocal cur, cur_h, acc
        if cur_h + im.height > PANEL_MAX_H and cur:
            flush()
        if not cur:
            starts.append(acc)          # 이 패널이 시작되는 누적 높이
        cur.append(im)
        cur_h += im.height
        acc += im.height

    for f in files:
        im = Image.open(f).convert("RGB")
        if im.width != PANEL_W:
            im = im.resize((PANEL_W, round(im.height * PANEL_W / im.width)), Image.LANCZOS)
        # 한 장이 패널보다 길면 잘라서 넣는다.
        # 대기업 더모 브랜드는 상세페이지 전체를 이미지 한 장으로 올린다(실측 960x67,445px).
        # 통째로 두면 JPEG 한계(65,535px)에 걸려 저장이 터지고, 저장돼도
        # 비전 모델이 읽을 수 없을 만큼 눌린다.
        if im.height > PANEL_MAX_H:
            for top in range(0, im.height, PANEL_MAX_H):
                add(im.crop((0, top, PANEL_W, min(top + PANEL_MAX_H, im.height))))
        else:
            add(im)
    flush()

    total = max(acc, 1)
    return panels, [round(s * 100 / total, 1) for s in starts]


def _fmt(d: dict) -> str:
    return "\n".join(f"  {k}: {v}" for k, v in d.items())


def analyze_panel(client, png: bytes, idx: int, total: int) -> list[dict]:
    b64 = base64.b64encode(png).decode()
    res = client.chat.completions.create(
        model=MODEL,
        max_completion_tokens=1800,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": [
                {"type": "text", "text": USER_TMPL.format(
                    idx=idx, total=total,
                    roles=_fmt(ROLES), copy=_fmt(COPY_TYPES),
                    visual=_fmt(VISUAL_TYPES), evidence=_fmt(EVIDENCE_TYPES))},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}},
            ]},
        ],
    )
    txt = res.choices[0].message.content or "{}"
    u = res.usage
    meta = {"tok_in": getattr(u, "prompt_tokens", None),
            "tok_out": getattr(u, "completion_tokens", None)}
    try:
        raw = json.loads(txt)
    except json.JSONDecodeError:
        return [], meta, {}
    return raw.get("sections", []) or [], meta, raw


def estimate_panels(goods_no: str) -> int:
    """패널 수만 센다 — 픽셀을 디코드하지 않으므로 324개를 세도 몇 초면 끝난다.

    돈을 쓰기 전에 얼마가 나갈지 보려고 있다. build_panels 와 같은 규칙으로 센다.
    """
    from PIL import Image

    d = Path(__file__).resolve().parent.parent / "exports" / "detail_pages" / goods_no
    cur = n = 0
    for f in sorted(d.glob("*.jpg")):
        w, h = Image.open(f).size          # lazy — 헤더만 읽는다
        if w != PANEL_W:
            h = round(h * PANEL_W / w)
        if h > PANEL_MAX_H:
            k = -(-h // PANEL_MAX_H)          # 조각 수
            if cur:                           # 첫 조각이 기존 버퍼를 밀어낸다
                n += 1
            n += k - 1                        # 마지막을 뺀 조각들이 각각 패널이 된다
            cur = h - (k - 1) * PANEL_MAX_H   # 마지막 조각은 열린 채 남는다
        else:
            if cur + h > PANEL_MAX_H:
                n += 1
                cur = 0
            cur += h
    return n + (1 if cur else 0)


def budget_gate(goods: list[str], yes: bool, what: str = "분석") -> bool:
    """얼마 나갈지 먼저 말하고, 큰 건은 승인을 받는다.

    조용히 나가는 돈을 막는 유일한 장치다. 통과시키려면 --yes 를 붙여라.
    """
    panels = sum(estimate_panels(g) for g in goods)
    cost = panels * COST_PER_PANEL
    print(f"[예상] 상품 {len(goods)}개 · 패널 {panels:,}개 · 약 ${cost:,.2f}")
    if cost <= BUDGET_GATE or yes:
        return True
    print(f"  ${BUDGET_GATE:.2f} 초과 — {what}을(를) 돌리려면 --yes 를 붙여라.")
    return False


def _panels_sql(cur, goods_no: str, raws: list) -> None:
    """패널 원문 저장. 다음 축은 여기서 공짜로 꺼낸다 — 재분석을 막는 핵심이다."""
    cur.execute("DELETE FROM detail_panels WHERE goods_no = %s", (goods_no,))
    for i, pct, raw, a, b in raws:
        cur.execute("""
            INSERT INTO detail_panels
                (goods_no, panel, model, scroll_pct, raw, tok_in, tok_out)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
        """, (goods_no, i, MODEL, pct,
              json.dumps(raw, ensure_ascii=False), a, b))


def _save_panels(conn, goods_no: str, raws: list) -> None:
    if not raws:
        return
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            _panels_sql(cur, goods_no, raws)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = True


def run_one(conn, client, goods_no: str, name: str = "") -> int:
    panels, starts = build_panels(goods_no)
    if not panels:
        print(f"  이미지 없음 — 수집 먼저 필요")
        return 0

    total_kb = sum(len(p) for p in panels) / 1024
    print(f"  패널 {len(panels)}개 ({total_kb:.0f}KB) 분석 중...", flush=True)

    sections, raws, tin, tout = [], [], 0, 0
    for i, p in enumerate(panels, 1):
        pct = starts[i - 1] if i - 1 < len(starts) else None
        try:
            got, meta, raw = analyze_panel(client, p, i, len(panels))
            for g in got:
                g["panel"] = i
                g["scroll_pct"] = pct
            sections.extend(got)
            tin += meta.get("tok_in") or 0
            tout += meta.get("tok_out") or 0
            raws.append((i, pct, raw, meta.get("tok_in"), meta.get("tok_out")))
        except Exception as e:
            print(f"    패널 {i} 실패: {str(e).splitlines()[0][:70]}", flush=True)
        time.sleep(0.4)

    # 돈은 이미 나갔다. 섹션을 못 뽑았어도 원문만은 남겨야 다음에 다시 안 산다.
    # 전에는 여기서 그냥 return 해서 과금된 응답을 통째로 버렸다.
    if not sections:
        print("  추출 0건 — 기존 섹션 보존, 원문만 저장", flush=True)
        _save_panels(conn, goods_no, raws)
        return 0

    # autocommit 이면 DELETE 가 즉시 확정된다. 뒤이은 INSERT 가 중간에 터지면
    # 기존 분석이 사라진 채로 남고, 그 상품은 다시 전액 주고 분석해야 한다.
    # 한 트랜잭션으로 묶어 '전부 되거나 전부 안 되거나' 로 만든다.
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM detail_sections WHERE goods_no = %s", (goods_no,))
            for n, sec in enumerate(sections, 1):
                cur.execute("""
                    INSERT INTO detail_sections
                        (goods_no, seq, panel, role, headline, appeals, has_number,
                         note, copy_type, visual, evidence, density, scroll_pct, certs)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (goods_no, n, sec.get("panel"),
                      # role 만 길이를 안 잘랐었다. VARCHAR(30) 이라 모델이 긴 값을
                      # 돌려주면 여기서 터지고, 위의 DELETE 는 이미 나간 뒤가 된다.
                      (sec.get("role") or "기타")[:30],
                      (sec.get("headline") or "")[:300],
                      json.dumps(sec.get("appeals", []), ensure_ascii=False),
                      bool(sec.get("has_number")), (sec.get("note") or "")[:300],
                      (sec.get("copy_type") or "")[:20] or None,
                      (sec.get("visual") or "")[:20] or None,
                      (sec.get("evidence") or "")[:20] or None,
                      (sec.get("density") or "")[:10] or None,
                      sec.get("scroll_pct"),
                      json.dumps([str(x)[:60] for x in (sec.get("certs") or [])][:5],
                                 ensure_ascii=False)))
            _panels_sql(cur, goods_no, raws)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = True

    # 호출에 성공한 패널만 과금된다. 실패한 패널까지 len(panels) 로 세면 안 된다.
    # 또 'x and y' 는 산술이 아니라 참/거짓 분기다 — 전에 이걸 곱셈처럼 써서
    # 토큰이 10배여도 같은 금액이 찍혔고, usage 가 없으면 $0.000 으로 보였다.
    print(f"      토큰 입력 {tin:,} · 출력 {tout:,} · 호출 {len(raws)}/{len(panels)}패널 "
          f"(약 ${len(raws) * COST_PER_PANEL:,.3f})", flush=True)
    return len(sections)


def _pending(conn) -> list[tuple[str, str]]:
    """현재 스키마로 아직 분석되지 않은 상품."""
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT dp.goods_no, COALESCE(p.goods_name, dp.goods_no) AS goods_name
            FROM detail_pages dp
            LEFT JOIN products p ON p.goods_no = dp.goods_no
            WHERE dp.status = 'ok'
              AND NOT EXISTS (
                  SELECT 1 FROM detail_sections ds
                  WHERE ds.goods_no = dp.goods_no
                    AND ds.{SCHEMA_MARKER} IS NOT NULL
              )
            ORDER BY dp.goods_no
        """)
        return [(r["goods_no"], r["goods_name"]) for r in cur.fetchall()]


def estimate_only(goods_no: str | None = None) -> None:
    """돈을 쓰지 않고 '지금 --all 하면 얼마 나가나'만 본다."""
    conn = get_conn()
    conn.autocommit = True
    ensure_tables(conn)
    if goods_no:
        budget_gate([goods_no], True, "분석")
        conn.close()
        return

    with conn.cursor() as cur:
        cur.execute("SELECT goods_no FROM detail_pages WHERE status = 'ok' ORDER BY 1")
        allg = [r["goods_no"] for r in cur.fetchall()]
    pend = [g for g, _ in _pending(conn)]
    conn.close()

    print("신규분만 (--all 이 실제로 돌릴 것)")
    budget_gate(pend, True)
    print("\n전수 재분석 (축을 추가하면 이 금액이 통째로 다시 나간다)")
    budget_gate(allg, True)
    print("\n→ 축을 늘릴 땐 detail_page_axis 로 필요한 패널만 돌려라.")



def run(goods_no: str | None = None, do_all: bool = False,
        yes: bool = False, max_cost: float = 0.0) -> None:
    conn = get_conn()
    conn.autocommit = True
    ensure_tables(conn)
    client = _client()

    if goods_no:
        targets = [(goods_no, "")]
    else:
        with conn.cursor() as cur:
            # 현재 스키마로 분석된 것만 건너뛴다.
            # '분석 여부'로 판단하면 축이 추가됐을 때 구스키마 행이 그대로 남는다
            # (실제로 28개가 누락될 뻔했다). copy_type 유무가 스키마 세대를 가른다.
            cur.execute(f"""
                SELECT dp.goods_no, COALESCE(p.goods_name, dp.goods_no) AS goods_name
                FROM detail_pages dp
                LEFT JOIN products p ON p.goods_no = dp.goods_no
                WHERE dp.status = 'ok'
                  AND NOT EXISTS (
                      SELECT 1 FROM detail_sections ds
                      WHERE ds.goods_no = dp.goods_no
                        AND ds.{SCHEMA_MARKER} IS NOT NULL
                  )
                ORDER BY dp.goods_no
            """)
            targets = [(r["goods_no"], r["goods_name"]) for r in cur.fetchall()]
        if not do_all:
            targets = targets[:1]

    if not targets:
        print("대상 없음 — 현재 스키마로 이미 전부 분석됐다")
        conn.close()
        return
    # 자동 실행(2주 주기)에서는 사람이 --yes 를 눌러줄 수 없다. 대신 상한을
    # 준다. 평소 신규분은 몇 달러면 끝나므로, 그걸 넘으면 뭔가 잘못된 것이다
    # (스키마 표식이 초기화돼 전수 재분석이 잡혔다든지).
    if max_cost > 0:
        panels = sum(estimate_panels(g) for g, _ in targets)
        cost = panels * COST_PER_PANEL
        print(f"[예상] 상품 {len(targets)}개 · 패널 {panels:,}개 · 약 ${cost:,.2f} "
              f"(상한 ${max_cost:,.2f})")
        if cost > max_cost:
            print(f"  상한 초과 — 돌리지 않는다. 대상이 왜 이렇게 많은지 "
                  f"확인하고 수동으로 --yes 로 돌려라.")
            conn.close()
            return
    elif not budget_gate([g for g, _ in targets], yes):
        conn.close()
        return

    print(f"=== 상세페이지 구성 분석 — {len(targets)}개 ===\n")
    failed: list[tuple[str, str]] = []
    for i, (gno, nm) in enumerate(targets, 1):
        import re
        short = re.sub(r"\[[^\]]*\]", "", nm).strip()[:42] or gno
        print(f"({i}/{len(targets)}) {short}", flush=True)
        try:
            n = run_one(conn, client, gno, nm)
        except Exception as e:
            # 상품 하나가 터졌다고 배치 전체를 잃지 않는다. 남기고 넘어간다.
            # 250개 돌리다 52번째에서 죽어 나머지 198개를 못 돌린 적이 있다.
            print(f"      실패: {type(e).__name__}: {str(e).splitlines()[0][:90]}\n", flush=True)
            failed.append((gno, short))
            continue
        print(f"      섹션 {n}개 추출\n", flush=True)
    conn.close()
    if failed:
        print(f"=== 완료 (실패 {len(failed)}개) ===")
        for g, s_ in failed:
            print(f"  {g}  {s_}")
    else:
        print("=== 완료 ===")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--goods", default=None)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--yes", action="store_true",
                    help=f"예상 비용이 ${BUDGET_GATE:.2f} 를 넘어도 진행")
    ap.add_argument("--estimate", action="store_true",
                    help="돈 쓰지 않고 예상 비용만 출력")
    ap.add_argument("--max-cost", type=float, default=0.0,
                    help="예상 비용이 이 금액을 넘으면 돌리지 않는다 (자동 실행용)")
    a = ap.parse_args()
    if a.estimate:
        estimate_only(a.goods)
    else:
        run(a.goods, a.all, a.yes, a.max_cost)
