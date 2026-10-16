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

MODEL = "gpt-5.4-mini"
PANEL_MAX_H = 2500      # 합성 패널 최대 세로 — 축소 후 가독성이 유지되는 선
PANEL_W = 960

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

SYSTEM = """당신은 화장품 상세페이지 구조를 분석하는 전문가입니다.
주어진 이미지는 올리브영 상품 상세페이지를 위에서부터 순서대로 잘라낸 것입니다.
각 구간이 어떤 역할을 하는지 분류하고, 무엇을 소구하는지 요약하세요.

반드시 JSON만 출력하고 다른 말은 쓰지 마세요."""

USER_TMPL = """이 이미지는 상세페이지의 {idx}번째 구간입니다 (전체 {total}구간 중).

가능한 역할 분류:
{roles}

아래 JSON 형식으로만 답하세요. sections는 이 이미지 안에서 위에서 아래 순서대로 나열합니다.

{{"sections":[
  {{"role":"분류명",
    "headline":"그 구간의 가장 큰 문구 (없으면 빈 문자열)",
    "appeals":["소구 키워드 최대 4개"],
    "has_number":true/false,
    "note":"한 줄 설명"}}
]}}

규칙:
- role은 위 목록에 있는 것만 쓰되, 어디에도 해당하지 않으면 "기타"로 하고 note에 이유를 적으세요.
- has_number는 수치(퍼센트, 시간, 배수, 인원수)가 눈에 띄게 쓰였는지입니다.
- 한 이미지에 여러 역할이 섞여 있으면 나눠서 적으세요."""


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


def build_panels(goods_no: str) -> list[bytes]:
    """상세 이미지들을 순서대로 이어 붙여 읽기 좋은 크기의 패널로 만든다."""
    from PIL import Image

    d = Path(__file__).resolve().parent.parent / "exports" / "detail_pages" / goods_no
    files = sorted(d.glob("*.jpg"))
    if not files:
        return []

    panels, cur, cur_h = [], [], 0

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

    for f in files:
        im = Image.open(f).convert("RGB")
        if im.width != PANEL_W:
            im = im.resize((PANEL_W, round(im.height * PANEL_W / im.width)), Image.LANCZOS)
        if cur_h + im.height > PANEL_MAX_H and cur:
            flush()
        cur.append(im)
        cur_h += im.height
    flush()
    return panels


def analyze_panel(client, png: bytes, idx: int, total: int) -> list[dict]:
    roles_txt = "\n".join(f"  {k}: {v}" for k, v in ROLES.items())
    b64 = base64.b64encode(png).decode()
    res = client.chat.completions.create(
        model=MODEL,
        max_completion_tokens=1400,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": [
                {"type": "text", "text": USER_TMPL.format(idx=idx, total=total, roles=roles_txt)},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}},
            ]},
        ],
    )
    txt = res.choices[0].message.content or "{}"
    try:
        return json.loads(txt).get("sections", []) or []
    except json.JSONDecodeError:
        return []


def run_one(conn, client, goods_no: str, name: str = "") -> int:
    panels = build_panels(goods_no)
    if not panels:
        print(f"  이미지 없음 — 수집 먼저 필요")
        return 0

    total_kb = sum(len(p) for p in panels) / 1024
    print(f"  패널 {len(panels)}개 ({total_kb:.0f}KB) 분석 중...", flush=True)

    sections = []
    for i, p in enumerate(panels, 1):
        try:
            got = analyze_panel(client, p, i, len(panels))
            for g in got:
                g["panel"] = i
            sections.extend(got)
        except Exception as e:
            print(f"    패널 {i} 실패: {str(e).splitlines()[0][:70]}", flush=True)
        time.sleep(0.4)

    with conn.cursor() as cur:
        cur.execute("DELETE FROM detail_sections WHERE goods_no = %s", (goods_no,))
        for n, s in enumerate(sections, 1):
            cur.execute("""
                INSERT INTO detail_sections
                    (goods_no, seq, panel, role, headline, appeals, has_number, note)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (goods_no, n, s.get("panel"), s.get("role", "기타"),
                  (s.get("headline") or "")[:300],
                  json.dumps(s.get("appeals", []), ensure_ascii=False),
                  bool(s.get("has_number")), (s.get("note") or "")[:300]))
    return len(sections)


def run(goods_no: str | None = None, do_all: bool = False) -> None:
    conn = get_conn()
    conn.autocommit = True
    ensure_tables(conn)
    client = _client()

    if goods_no:
        targets = [(goods_no, "")]
    else:
        with conn.cursor() as cur:
            # 이미 분석된 상품은 건너뛴다 — 비전 호출은 비싸다
            cur.execute("""
                SELECT dp.goods_no, COALESCE(p.goods_name, dp.goods_no) AS goods_name
                FROM detail_pages dp
                LEFT JOIN products p ON p.goods_no = dp.goods_no
                WHERE dp.status = 'ok'
                  AND NOT EXISTS (
                      SELECT 1 FROM detail_sections ds WHERE ds.goods_no = dp.goods_no
                  )
                ORDER BY dp.goods_no
            """)
            targets = [(r["goods_no"], r["goods_name"]) for r in cur.fetchall()]
        if not do_all:
            targets = targets[:1]

    print(f"=== 상세페이지 구성 분석 — {len(targets)}개 ===\n")
    for i, (gno, nm) in enumerate(targets, 1):
        import re
        short = re.sub(r"\[[^\]]*\]", "", nm).strip()[:42] or gno
        print(f"({i}/{len(targets)}) {short}", flush=True)
        n = run_one(conn, client, gno, nm)
        print(f"      섹션 {n}개 추출\n", flush=True)
    conn.close()
    print("=== 완료 ===")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--goods", default=None)
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    run(a.goods, a.all)
