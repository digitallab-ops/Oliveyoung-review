import os
import sys
import html as html_lib
import re
import psycopg2
from psycopg2.extras import RealDictCursor
import streamlit as st
import pandas as pd
import plotly.express as px
from collections import Counter
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

DATABASE_URL = os.environ["DATABASE_URL"]

st.set_page_config(
    page_title="셀퓨전씨 리뷰 현황",
    page_icon="💊",
    layout="wide",
    initial_sidebar_state="collapsed",
)

st.markdown("""
<style>
  /* ── 베이스 ── */
  .stApp { background: #F5F6F9; }
  .block-container { padding-top: 24px !important; padding-bottom: 40px !important; }

  /* ── 브랜드 헤더 ── */
  .brand-header {
    background: linear-gradient(135deg, #0D1B36 0%, #1A3464 100%);
    padding: 22px 30px;
    border-radius: 14px;
    color: white;
    margin-bottom: 20px;
  }
  .brand-header h2 { margin:0; font-size:20px; font-weight:700; letter-spacing:-0.3px; }
  .brand-header .meta { font-size:12px; opacity:0.55; margin-top:6px; }

  /* ── KPI 카드 ── */
  .kpi-card {
    background: white;
    border-radius: 12px;
    padding: 18px 20px 16px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.07);
    border-top: 3px solid;
    text-align: center;
    height: 100%;
  }
  .kpi-label { font-size:11px; color:#8892A4; font-weight:700; text-transform:uppercase; letter-spacing:.6px; margin-bottom:8px; }
  .kpi-num   { font-size:36px; font-weight:800; line-height:1.05; color:#0D1B36; }
  .kpi-sub   { font-size:12px; color:#9BAABB; margin-top:5px; }

  /* ── 인사이트 카드 ── */
  .insight-card {
    background: #F0F7FF;
    border: 1px solid #BFDBFE;
    border-radius: 12px;
    padding: 16px 22px;
    margin: 18px 0 4px;
  }
  .insight-badge {
    display:inline-block;
    background:#DBEAFE; color:#1D4ED8;
    font-size:11px; font-weight:700;
    padding:3px 10px; border-radius:20px;
    margin-bottom:8px;
  }
  .insight-name  { font-size:15px; font-weight:700; color:#0D1B36; margin-bottom:3px; }
  .insight-stats { font-size:12px; color:#64748B; margin-bottom:6px; }
  .insight-quote { font-size:13px; color:#374151; line-height:1.6; font-style:italic; }

  /* ── 섹션 레이블 ── */
  .sec-label {
    font-size:11px; font-weight:700; color:#9BAABB;
    text-transform:uppercase; letter-spacing:.9px;
    margin: 0 0 10px; padding: 0;
  }

  /* ── 키워드 뱃지 ── */
  .kw-wrap  { display:flex; flex-wrap:wrap; gap:7px; margin:10px 0 14px; }
  .kw-badge {
    background:#EFF6FF; color:#1D4ED8;
    font-size:12px; font-weight:600;
    padding:4px 12px; border-radius:20px;
    border:1px solid #DBEAFE;
  }

  /* ── 리뷰 개수 배지 ── */
  .count-badge {
    display:inline-block;
    background:#F1F5F9; color:#64748B;
    font-size:12px; padding:3px 10px;
    border-radius:20px; margin-bottom:12px;
  }

  /* ── 평점 분포 바 ── */
  .rating-row {
    display:flex; align-items:center;
    gap:10px; margin-bottom:9px;
  }
  .rating-stars { font-size:12px; color:#0D1B36; font-weight:600; min-width:74px; }
  .rating-track { flex:1; background:#F0F2F5; border-radius:4px; height:7px; overflow:hidden; }
  .rating-fill  { height:100%; border-radius:4px; }
  .rating-pct   { font-size:12px; color:#6B7280; min-width:38px; text-align:right; }
  .rating-cnt   { font-size:11px; color:#C4CAD4; min-width:46px; }

  /* ── Expander (리뷰 카드) ── */
  [data-testid="stExpander"] {
    background: white !important;
    border: 1px solid #E8ECF3 !important;
    border-radius: 10px !important;
    margin-bottom: 7px !important;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important;
    overflow: hidden !important;
  }
  [data-testid="stExpander"] > details > summary {
    padding: 11px 16px !important;
    font-size: 13px !important;
    color: #1E293B !important;
    font-weight: 500 !important;
  }
  [data-testid="stExpander"] > details > div {
    padding: 2px 16px 14px !important;
  }

  /* ── 데이터프레임 ── */
  [data-testid="stDataFrame"] { border-radius: 10px; overflow: hidden; }

  /* ── 구분선 ── */
  hr { border: none; border-top: 1px solid #E2E6EE; margin: 20px 0; }

  /* ── 푸터 ── */
  .page-footer {
    text-align:center; color:#C4CAD4; font-size:11px;
    padding: 20px 0 8px;
    border-top: 1px solid #E2E6EE;
    margin-top: 32px;
  }
</style>
""", unsafe_allow_html=True)


# ── 유틸 ──────────────────────────────────────────────────────────────

def query(sql, params=None):
    with psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def sanitize(text: str) -> str:
    """HTML 태그 제거 + 엔티티 디코딩 + 재이스케이프."""
    if not text:
        return ""
    text = html_lib.unescape(text)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return html_lib.escape(text)


STOPWORDS = {
    "이", "가", "을", "를", "은", "는", "에", "의", "도", "로", "이고", "하고",
    "있어", "없어", "같아", "같은", "너무", "진짜", "정말", "많이", "조금",
    "이거", "거예요", "에요", "아요", "어요", "네요", "해요", "했어", "해서",
    "그리고", "그냥", "근데", "하지만", "그런데", "때문에", "이라서", "이라",
    "써요", "쓰고", "써서", "받고", "되고", "되어", "되는", "되면", "했는데",
    "사용", "구매", "후기", "리뷰", "상품", "제품", "배송", "올리브영",
    "한번", "처음", "계속", "매일", "항상", "하루", "저는", "제가", "저도",
    "이런", "그런", "좋아", "좋고", "좋은", "좋은데", "좋았", "아주", "바르고",
    "피부", "크림", "세럼", "앰플", "토너", "로션", "에센스", "미스트",
}


def extract_keywords(reviews: list, top_n: int = 8) -> list:
    words = []
    for r in reviews:
        content = r.get("content") or ""
        tokens = re.findall(r'[가-힣]{2,6}', content)
        words.extend(w for w in tokens if w not in STOPWORDS)
    return [w for w, _ in Counter(words).most_common(top_n)]


def rating_bars_html(score_dist: list) -> str:
    total = sum(r["cnt"] for r in score_dist)
    score_map = {r["score"]: r["cnt"] for r in score_dist}
    colors = {5: "#059669", 4: "#10B981", 3: "#FBBF24", 2: "#FB923C", 1: "#EF4444"}
    rows = []
    for s in [5, 4, 3, 2, 1]:
        cnt = score_map.get(s, 0)
        pct = round(cnt / total * 100, 1) if total else 0
        stars = "★" * s + "☆" * (5 - s)
        rows.append(f"""
        <div class="rating-row">
          <span class="rating-stars">{stars}</span>
          <div class="rating-track">
            <div class="rating-fill" style="width:{pct}%;background:{colors[s]};"></div>
          </div>
          <span class="rating-pct">{pct}%</span>
          <span class="rating-cnt">({cnt:,})</span>
        </div>""")
    return "".join(rows)


def score_cls(score: int) -> str:
    colors = {5: "#059669", 4: "#10B981", 3: "#D97706", 2: "#EA580C", 1: "#DC2626"}
    return colors.get(score, "#6B7280")


# ── 캐시된 데이터 로더 ─────────────────────────────────────────────────

@st.cache_data(ttl=3600)
def load_summary():
    total = query("SELECT COUNT(*) AS cnt FROM reviews")[0]["cnt"]
    total_products = query("SELECT COUNT(*) AS cnt FROM products")[0]["cnt"]
    avg_row = query("SELECT ROUND(AVG(score)::numeric, 2) AS avg FROM reviews")[0]["avg"]
    avg_score = float(avg_row) if avg_row else 0.0
    five_star = query("SELECT COUNT(*) AS cnt FROM reviews WHERE score = 5")[0]["cnt"]
    five_pct = round(five_star / total * 100, 1) if total else 0.0
    repurchase = query("SELECT COUNT(*) AS cnt FROM reviews WHERE is_repurchase = TRUE")[0]["cnt"]
    repurchase_pct = round(repurchase / total * 100, 1) if total else 0.0
    last_ts = query("SELECT MAX(collected_at) AS ts FROM reviews")[0]["ts"]
    last_str = last_ts.strftime("%Y.%m.%d %H:%M") if last_ts else "-"
    return dict(
        total=total, total_products=total_products,
        avg_score=avg_score, five_pct=five_pct, five_star=five_star,
        repurchase_pct=repurchase_pct, repurchase=repurchase,
        last_str=last_str,
    )


@st.cache_data(ttl=3600)
def load_top_product():
    rows = query("""
        SELECT p.goods_name, p.goods_no,
               COUNT(r.review_id) AS cnt,
               ROUND(AVG(r.score)::numeric, 2) AS avg_score
        FROM products p
        JOIN reviews r ON p.goods_no = r.goods_no
        GROUP BY p.goods_name, p.goods_no
        ORDER BY cnt DESC LIMIT 1
    """)
    if not rows:
        return None
    top = dict(rows[0])
    sample = query("""
        SELECT content FROM reviews
        WHERE goods_no = %s AND score = 5 AND content IS NOT NULL AND content != ''
        ORDER BY created_at DESC LIMIT 1
    """, (top["goods_no"],))
    top["sample"] = sanitize(sample[0]["content"]) if sample else ""
    return top


@st.cache_data(ttl=3600)
def load_products():
    return query("SELECT goods_no, goods_name FROM products ORDER BY goods_name")


@st.cache_data(ttl=3600)
def load_score_dist():
    return query("""
        SELECT score, COUNT(*) AS cnt
        FROM reviews WHERE score IS NOT NULL
        GROUP BY score ORDER BY score DESC
    """)


@st.cache_data(ttl=3600)
def load_monthly_trend():
    return query("""
        SELECT SUBSTR(created_at, 1, 7) AS month, COUNT(*) AS cnt
        FROM reviews
        WHERE created_at IS NOT NULL AND created_at != ''
          AND LENGTH(created_at) >= 7
        GROUP BY month ORDER BY month
    """)


@st.cache_data(ttl=3600)
def load_skin_dist():
    return query("""
        SELECT skin_type, COUNT(*) AS cnt
        FROM reviews
        WHERE skin_type IS NOT NULL AND skin_type != ''
        GROUP BY skin_type ORDER BY cnt DESC LIMIT 10
    """)


@st.cache_data(ttl=3600)
def load_product_stats():
    return query("""
        SELECT
            p.goods_name,
            COUNT(r.review_id) AS review_cnt,
            ROUND(AVG(r.score)::numeric, 2) AS avg_score,
            SUM(CASE WHEN r.is_repurchase THEN 1 ELSE 0 END) AS repurchase_cnt,
            ROUND(
                SUM(CASE WHEN r.is_repurchase THEN 1 ELSE 0 END)::numeric /
                NULLIF(COUNT(r.review_id), 0) * 100, 1
            ) AS repurchase_pct,
            SUM(CASE WHEN r.score = 5 THEN 1 ELSE 0 END) AS five_star_cnt
        FROM products p
        LEFT JOIN reviews r ON p.goods_no = r.goods_no
        GROUP BY p.goods_name
        ORDER BY review_cnt DESC
    """)


@st.cache_data(ttl=3600)
def load_reviews(goods_no: str, score_min: int, score_max: int, repurchase_only: bool):
    if repurchase_only:
        return query("""
            SELECT score, content, skin_type, is_repurchase, created_at
            FROM reviews WHERE goods_no = %s AND is_repurchase = TRUE
            ORDER BY created_at DESC LIMIT 100
        """, (goods_no,))
    return query("""
        SELECT score, content, skin_type, is_repurchase, created_at
        FROM reviews
        WHERE goods_no = %s AND score BETWEEN %s AND %s
        ORDER BY created_at DESC LIMIT 100
    """, (goods_no, score_min, score_max))


# ── 페이지 렌더링 ──────────────────────────────────────────────────────

summary = load_summary()
top_product = load_top_product()
products_list = load_products()

# ① 헤더 ──────────────────────────────────────────────────────────────
st.markdown(f"""
<div class="brand-header">
  <h2>💊 셀퓨전씨 올리브영 리뷰 현황</h2>
  <div class="meta">
    실구매 리뷰 기준 &nbsp;·&nbsp; 매일 오전 6시 자동 수집 &nbsp;·&nbsp; 마지막 업데이트 {summary['last_str']}
  </div>
</div>
""", unsafe_allow_html=True)

# ② KPI 카드 3개 ───────────────────────────────────────────────────────
c1, c2, c3 = st.columns(3)
avg_stars = "★" * round(summary["avg_score"]) + "☆" * (5 - round(summary["avg_score"]))

with c1:
    st.markdown(f"""
    <div class="kpi-card" style="border-color:#059669;">
      <div class="kpi-label">전체 평균 평점</div>
      <div class="kpi-num">{summary['avg_score']:.1f}</div>
      <div class="kpi-sub">{avg_stars} &nbsp;·&nbsp; 총 {summary['total']:,}개 리뷰</div>
    </div>""", unsafe_allow_html=True)

with c2:
    st.markdown(f"""
    <div class="kpi-card" style="border-color:#3B82F6;">
      <div class="kpi-label">재구매 의향</div>
      <div class="kpi-num">{summary['repurchase_pct']}%</div>
      <div class="kpi-sub">{summary['repurchase']:,}명이 재구매 의향 표현</div>
    </div>""", unsafe_allow_html=True)

with c3:
    st.markdown(f"""
    <div class="kpi-card" style="border-color:#F59E0B;">
      <div class="kpi-label">만점(5점) 비율</div>
      <div class="kpi-num">{summary['five_pct']}%</div>
      <div class="kpi-sub">{summary['five_star']:,}건 · {summary['total_products']}개 상품</div>
    </div>""", unsafe_allow_html=True)

# ③ 인사이트 카드 ─────────────────────────────────────────────────────
if top_product:
    name_esc = html_lib.escape(top_product["goods_name"])
    avg = top_product["avg_score"]
    cnt = top_product["cnt"]
    quote = top_product["sample"]
    quote_short = (quote[:90] + "...") if len(quote) > 90 else quote
    quote_html = f'<div class="insight-quote">&ldquo;{quote_short}&rdquo;</div>' if quote_short else ""
    st.markdown(f"""
    <div class="insight-card">
      <span class="insight-badge">🏆 리뷰 가장 많은 상품</span>
      <div class="insight-name">{name_esc}</div>
      <div class="insight-stats">★ {avg} &nbsp;·&nbsp; 리뷰 {cnt:,}개</div>
      {quote_html}
    </div>""", unsafe_allow_html=True)

st.markdown("<hr>", unsafe_allow_html=True)

# ④ 리뷰 탐색 (메인) ──────────────────────────────────────────────────
st.markdown('<p class="sec-label">리뷰 탐색</p>', unsafe_allow_html=True)

product_map = {p["goods_name"]: p["goods_no"] for p in products_list}
selected_name = st.selectbox(
    "상품 선택",
    list(product_map.keys()),
    label_visibility="visible",
)

FILTER_OPTIONS = ["전체", "★5 최고", "★4 이상", "불만족 (★1~3)", "재구매자만"]
FILTER_MAP = {
    "전체":          (1, 5, False),
    "★5 최고":       (5, 5, False),
    "★4 이상":       (4, 5, False),
    "불만족 (★1~3)": (1, 3, False),
    "재구매자만":     (1, 5, True),
}

filter_opt = st.pills(
    "리뷰 필터",
    options=FILTER_OPTIONS,
    default="전체",
    label_visibility="collapsed",
)

s_min, s_max, repurchase_only = FILTER_MAP.get(filter_opt or "전체", (1, 5, False))

if selected_name:
    goods_no = product_map[selected_name]
    reviews = load_reviews(goods_no, s_min, s_max, repurchase_only)
    all_reviews = load_reviews(goods_no, 1, 5, False)

    # 키워드 추출
    keywords = extract_keywords(all_reviews)
    if keywords:
        kw_badges = "".join(f'<span class="kw-badge">#{kw}</span>' for kw in keywords)
        st.markdown(f'<div class="kw-wrap">{kw_badges}</div>', unsafe_allow_html=True)

    if reviews:
        st.markdown(
            f'<span class="count-badge">{len(reviews)}건 표시 (최대 100건)</span>',
            unsafe_allow_html=True,
        )

        for r in reviews:
            score = r["score"] or 0
            content = sanitize(r["content"])
            created = r["created_at"] or ""

            stars_text = "★" * score + "☆" * (5 - score)
            color = score_cls(score)

            # 뱃지 HTML (expander 내부용)
            badges = []
            if r["is_repurchase"]:
                badges.append(
                    "<span style='background:#D1FAE5;color:#065F46;font-size:11px;"
                    "padding:2px 9px;border-radius:20px;font-weight:600;'>재구매</span>"
                )
            if r["skin_type"]:
                skin_esc = html_lib.escape(r["skin_type"])
                badges.append(
                    f"<span style='background:#DBEAFE;color:#1E40AF;font-size:11px;"
                    f"padding:2px 9px;border-radius:20px;font-weight:600;'>{skin_esc}</span>"
                )
            badge_html = " ".join(badges)

            preview = content[:52] + "..." if len(content) > 52 else content
            expander_label = f"{stars_text}  {created}  {preview}"

            with st.expander(expander_label, expanded=False):
                st.markdown(
                    f"<div style='display:flex;gap:8px;align-items:center;"
                    f"flex-wrap:wrap;margin-bottom:10px;'>"
                    f"<span style='font-weight:700;color:{color};font-size:15px;'>{stars_text}</span>"
                    f"<span style='color:#9AA8BC;font-size:12px;'>{created}</span>"
                    f"{badge_html}</div>"
                    f"<div style='font-size:14px;line-height:1.8;color:#374151;'>{content}</div>",
                    unsafe_allow_html=True,
                )
    else:
        st.info("해당 조건에 맞는 리뷰가 없습니다.")

st.markdown("<hr>", unsafe_allow_html=True)

# ⑤ 상세 통계 (기본 접힘) ──────────────────────────────────────────────
with st.expander("📊 상세 통계 보기", expanded=False):
    stat_l, stat_r = st.columns(2)

    with stat_l:
        st.markdown('<p class="sec-label" style="margin-top:4px;">평점 분포</p>', unsafe_allow_html=True)
        score_dist = load_score_dist()
        if score_dist:
            st.markdown(rating_bars_html(score_dist), unsafe_allow_html=True)

    with stat_r:
        st.markdown('<p class="sec-label" style="margin-top:4px;">피부 타입별 리뷰어</p>', unsafe_allow_html=True)
        skin_dist = load_skin_dist()
        if skin_dist:
            df_skin = pd.DataFrame(skin_dist)
            df_skin.columns = ["피부 타입", "리뷰 수"]
            fig_skin = px.bar(
                df_skin, x="리뷰 수", y="피부 타입",
                orientation="h",
                color_discrete_sequence=["#3B82F6"],
            )
            fig_skin.update_layout(
                margin=dict(l=0, r=30, t=4, b=0),
                plot_bgcolor="white", paper_bgcolor="white",
                xaxis=dict(showgrid=False, showticklabels=False, title=None),
                yaxis=dict(showgrid=False, tickfont=dict(size=12, color="#374151"), title=None),
                height=220, font=dict(family="sans-serif"),
                showlegend=False,
            )
            fig_skin.update_traces(marker_line_width=0)
            st.plotly_chart(fig_skin, use_container_width=True)

    st.markdown(
        '<p class="sec-label" style="margin-top:12px;">월별 리뷰 추이 (리뷰 작성일 기준)</p>',
        unsafe_allow_html=True,
    )
    trend = load_monthly_trend()
    if trend:
        df_trend = pd.DataFrame(trend)
        df_trend.columns = ["월", "리뷰 수"]
        fig_trend = px.line(
            df_trend, x="월", y="리뷰 수",
            markers=True,
            color_discrete_sequence=["#3B82F6"],
        )
        fig_trend.update_layout(
            margin=dict(l=0, r=0, t=4, b=0),
            plot_bgcolor="white", paper_bgcolor="white",
            xaxis=dict(showgrid=False, tickfont=dict(size=11), title=None),
            yaxis=dict(gridcolor="#F0F2F5", tickfont=dict(size=11), title=None),
            height=200, font=dict(family="sans-serif"),
        )
        fig_trend.update_traces(line_width=2, marker_size=5)
        st.plotly_chart(fig_trend, use_container_width=True)
    else:
        st.caption("리뷰 작성일 데이터가 충분하지 않습니다.")

# ⑥ 전체 상품 현황 (기본 접힘) ─────────────────────────────────────────
with st.expander("📦 전체 상품별 현황", expanded=False):
    product_stats = load_product_stats()
    if product_stats:
        df_p = pd.DataFrame(product_stats)
        df_p.columns = ["상품명", "리뷰 수", "평균 평점", "재구매 수", "재구매율(%)", "5점 수"]
        df_p["평균 평점"] = df_p["평균 평점"].apply(lambda x: f"{float(x):.2f}" if x else "-")
        df_p["재구매율(%)"] = df_p["재구매율(%)"].apply(lambda x: f"{x}%" if x else "-")
        st.dataframe(
            df_p,
            use_container_width=True,
            hide_index=True,
            column_config={
                "상품명":    st.column_config.TextColumn("상품명", width="large"),
                "리뷰 수":   st.column_config.NumberColumn("리뷰 수", format="%d"),
                "5점 수":    st.column_config.NumberColumn("★5", format="%d"),
                "재구매 수": st.column_config.NumberColumn("재구매 수", format="%d"),
            },
        )

# ⑦ 푸터 ──────────────────────────────────────────────────────────────
st.markdown(f"""
<div class="page-footer">
  CellFusionC Review Intelligence &nbsp;·&nbsp; 올리브영 공식 브랜드관 실구매 리뷰
  &nbsp;·&nbsp; Supabase × GitHub Actions × Render &nbsp;·&nbsp; {datetime.now().year}
</div>
""", unsafe_allow_html=True)
