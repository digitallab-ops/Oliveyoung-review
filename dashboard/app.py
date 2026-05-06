import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

DATABASE_URL = os.environ["DATABASE_URL"]

st.set_page_config(
    page_title="셀퓨전씨 리뷰 인텔리전스",
    page_icon="💊",
    layout="wide",
    initial_sidebar_state="collapsed",
)

st.markdown("""
<style>
    /* 전체 배경 */
    .stApp { background-color: #F8F9FB; }

    /* 헤더 영역 */
    .dashboard-header {
        background: linear-gradient(135deg, #1B2A4A 0%, #2D4A7A 100%);
        padding: 28px 36px;
        border-radius: 16px;
        margin-bottom: 24px;
        color: white;
    }
    .dashboard-header h1 {
        margin: 0;
        font-size: 26px;
        font-weight: 700;
        letter-spacing: -0.5px;
    }
    .dashboard-header p {
        margin: 6px 0 0;
        font-size: 13px;
        opacity: 0.7;
    }

    /* KPI 카드 */
    .kpi-card {
        background: white;
        border-radius: 12px;
        padding: 20px 24px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        border-left: 4px solid;
        height: 100%;
    }
    .kpi-label {
        font-size: 12px;
        color: #8892A4;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
    }
    .kpi-value {
        font-size: 32px;
        font-weight: 800;
        color: #1B2A4A;
        line-height: 1;
        margin-bottom: 4px;
    }
    .kpi-sub {
        font-size: 12px;
        color: #8892A4;
    }

    /* 섹션 제목 */
    .section-title {
        font-size: 16px;
        font-weight: 700;
        color: #1B2A4A;
        margin: 0 0 16px;
        padding-bottom: 10px;
        border-bottom: 2px solid #E8ECF2;
    }

    /* 리뷰 카드 */
    .review-card {
        background: white;
        border-radius: 10px;
        padding: 16px 20px;
        margin-bottom: 10px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        border: 1px solid #E8ECF2;
    }
    .review-meta {
        display: flex;
        gap: 12px;
        margin-bottom: 8px;
        align-items: center;
        flex-wrap: wrap;
    }
    .review-score {
        font-weight: 700;
        color: #1B2A4A;
    }
    .review-date {
        font-size: 12px;
        color: #8892A4;
    }
    .review-badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 20px;
        font-weight: 600;
    }
    .badge-repurchase {
        background: #E8F5E9;
        color: #2E7D32;
    }
    .badge-skin {
        background: #E3F2FD;
        color: #1565C0;
    }
    .review-content {
        font-size: 14px;
        color: #3D4A5C;
        line-height: 1.6;
    }

    /* 데이터프레임 커스텀 */
    .stDataFrame { border-radius: 10px; overflow: hidden; }

    /* 섹션 카드 래퍼 */
    .section-card {
        background: white;
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        margin-bottom: 24px;
    }

    /* Streamlit 기본 요소 스타일 오버라이드 */
    div[data-testid="metric-container"] {
        background: white;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }

    /* 구분선 */
    hr { border-color: #E8ECF2; margin: 8px 0; }

    /* selectbox */
    .stSelectbox label { font-weight: 600; color: #1B2A4A; }

    /* slider */
    .stSlider label { font-weight: 600; color: #1B2A4A; }

    /* 하단 여백 */
    .footer {
        text-align: center;
        color: #B0BAC9;
        font-size: 12px;
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #E8ECF2;
    }
</style>
""", unsafe_allow_html=True)


def query(sql, params=None):
    with psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def stars(score):
    if not score:
        return ""
    return "★" * score + "☆" * (5 - score)


# ── 데이터 로드
total_reviews = query("SELECT COUNT(*) AS cnt FROM reviews")[0]["cnt"]
total_products = query("SELECT COUNT(*) AS cnt FROM products")[0]["cnt"]
avg_score_row = query("SELECT ROUND(AVG(score)::numeric, 2) AS avg FROM reviews")[0]["avg"]
avg_score = float(avg_score_row) if avg_score_row else 0

new_today = query("SELECT COUNT(*) AS cnt FROM reviews WHERE collected_at::date = CURRENT_DATE")[0]["cnt"]
new_7d = query("SELECT COUNT(*) AS cnt FROM reviews WHERE collected_at >= CURRENT_DATE - INTERVAL '7 days'")[0]["cnt"]

five_star = query("SELECT COUNT(*) AS cnt FROM reviews WHERE score = 5")[0]["cnt"]
five_star_pct = round(five_star / total_reviews * 100, 1) if total_reviews > 0 else 0

repurchase_cnt = query("SELECT COUNT(*) AS cnt FROM reviews WHERE is_repurchase = TRUE")[0]["cnt"]
repurchase_pct = round(repurchase_cnt / total_reviews * 100, 1) if total_reviews > 0 else 0

last_collected = query("SELECT MAX(collected_at) AS ts FROM reviews")[0]["ts"]
if last_collected:
    last_collected_str = last_collected.strftime("%Y.%m.%d %H:%M")
else:
    last_collected_str = "-"

# ── 헤더
st.markdown(f"""
<div class="dashboard-header">
    <h1>💊 셀퓨전씨 올리브영 리뷰 인텔리전스</h1>
    <p>마지막 업데이트: {last_collected_str} &nbsp;·&nbsp; 매일 오전 6시 자동 수집 &nbsp;·&nbsp; 올리브영 공식 브랜드관 기준</p>
</div>
""", unsafe_allow_html=True)

# ── KPI 행
c1, c2, c3, c4, c5 = st.columns(5)

with c1:
    st.markdown(f"""
    <div class="kpi-card" style="border-color: #3B82F6;">
        <div class="kpi-label">총 누적 리뷰</div>
        <div class="kpi-value">{total_reviews:,}</div>
        <div class="kpi-sub">전체 {total_products}개 상품</div>
    </div>
    """, unsafe_allow_html=True)

with c2:
    st.markdown(f"""
    <div class="kpi-card" style="border-color: #10B981;">
        <div class="kpi-label">전체 평균 평점</div>
        <div class="kpi-value">{avg_score:.1f}</div>
        <div class="kpi-sub">{"★" * int(avg_score)}{"☆" * (5 - int(avg_score))} / 5.0</div>
    </div>
    """, unsafe_allow_html=True)

with c3:
    st.markdown(f"""
    <div class="kpi-card" style="border-color: #F59E0B;">
        <div class="kpi-label">5점 비율</div>
        <div class="kpi-value">{five_star_pct}%</div>
        <div class="kpi-sub">{five_star:,}개 리뷰</div>
    </div>
    """, unsafe_allow_html=True)

with c4:
    st.markdown(f"""
    <div class="kpi-card" style="border-color: #8B5CF6;">
        <div class="kpi-label">재구매 의향</div>
        <div class="kpi-value">{repurchase_pct}%</div>
        <div class="kpi-sub">{repurchase_cnt:,}명 재구매 의향</div>
    </div>
    """, unsafe_allow_html=True)

with c5:
    st.markdown(f"""
    <div class="kpi-card" style="border-color: #EF4444;">
        <div class="kpi-label">최근 7일 신규</div>
        <div class="kpi-value">{new_7d:,}</div>
        <div class="kpi-sub">오늘 {new_today:,}개 수집</div>
    </div>
    """, unsafe_allow_html=True)

st.markdown("<br>", unsafe_allow_html=True)

# ── 차트 행
left_col, right_col = st.columns([3, 2])

with left_col:
    st.markdown('<div class="section-card">', unsafe_allow_html=True)
    st.markdown('<p class="section-title">📈 일별 리뷰 추이 (최근 30일, 작성일 기준)</p>', unsafe_allow_html=True)

    trend = query("""
        SELECT created_at AS date, COUNT(*) AS cnt
        FROM reviews
        WHERE created_at >= TO_CHAR(CURRENT_DATE - INTERVAL '30 days', 'YYYY.MM.DD')
        GROUP BY created_at
        ORDER BY created_at
    """)

    if trend:
        df_trend = pd.DataFrame(trend)
        df_trend.columns = ["날짜", "리뷰 수"]
        fig = px.bar(
            df_trend, x="날짜", y="리뷰 수",
            color_discrete_sequence=["#3B82F6"],
        )
        fig.update_layout(
            margin=dict(l=0, r=0, t=10, b=0),
            plot_bgcolor="white",
            paper_bgcolor="white",
            xaxis=dict(showgrid=False, tickfont=dict(size=11)),
            yaxis=dict(gridcolor="#F0F2F5", tickfont=dict(size=11)),
            font=dict(family="sans-serif"),
            height=260,
        )
        fig.update_traces(marker_line_width=0)
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("최근 30일 데이터가 없습니다.")
    st.markdown('</div>', unsafe_allow_html=True)

with right_col:
    st.markdown('<div class="section-card">', unsafe_allow_html=True)
    st.markdown('<p class="section-title">⭐ 평점 분포</p>', unsafe_allow_html=True)

    score_dist = query("""
        SELECT score, COUNT(*) AS cnt
        FROM reviews WHERE score IS NOT NULL
        GROUP BY score ORDER BY score DESC
    """)

    if score_dist:
        df_score = pd.DataFrame(score_dist)
        df_score.columns = ["평점", "리뷰 수"]
        total = df_score["리뷰 수"].sum()
        df_score["비율"] = (df_score["리뷰 수"] / total * 100).round(1)
        df_score["평점명"] = df_score["평점"].apply(lambda x: f"★{x}점")

        colors = ["#10B981", "#34D399", "#6EE7B7", "#FCD34D", "#F87171"]
        fig2 = go.Figure(go.Bar(
            x=df_score["리뷰 수"],
            y=df_score["평점명"],
            orientation="h",
            marker_color=colors,
            text=df_score["비율"].apply(lambda x: f"{x}%"),
            textposition="outside",
        ))
        fig2.update_layout(
            margin=dict(l=0, r=40, t=10, b=0),
            plot_bgcolor="white",
            paper_bgcolor="white",
            xaxis=dict(showgrid=False, showticklabels=False),
            yaxis=dict(showgrid=False, tickfont=dict(size=13, color="#1B2A4A")),
            font=dict(family="sans-serif"),
            height=260,
            showlegend=False,
        )
        fig2.update_traces(marker_line_width=0)
        st.plotly_chart(fig2, use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)

# ── 상품별 현황 테이블
st.markdown('<div class="section-card">', unsafe_allow_html=True)
st.markdown('<p class="section-title">📦 상품별 현황</p>', unsafe_allow_html=True)

product_stats = query("""
    SELECT
        p.goods_name,
        COUNT(r.review_id)               AS review_cnt,
        ROUND(AVG(r.score)::numeric, 2)  AS avg_score,
        SUM(CASE WHEN r.is_repurchase THEN 1 ELSE 0 END)  AS repurchase_cnt,
        ROUND(
            SUM(CASE WHEN r.is_repurchase THEN 1 ELSE 0 END)::numeric /
            NULLIF(COUNT(r.review_id), 0) * 100, 1
        )                                AS repurchase_pct,
        SUM(CASE WHEN r.score = 5 THEN 1 ELSE 0 END) AS five_star_cnt
    FROM products p
    LEFT JOIN reviews r ON p.goods_no = r.goods_no
    GROUP BY p.goods_name
    ORDER BY review_cnt DESC
""")

if product_stats:
    df_p = pd.DataFrame(product_stats)
    df_p.columns = ["상품명", "리뷰 수", "평균 평점", "재구매 수", "재구매율(%)", "5점 수"]
    df_p["평균 평점"] = df_p["평균 평점"].apply(lambda x: f"{x:.2f}" if x else "-")
    df_p["재구매율(%)"] = df_p["재구매율(%)"].apply(lambda x: f"{x}%" if x else "-")

    st.dataframe(
        df_p,
        use_container_width=True,
        hide_index=True,
        column_config={
            "상품명": st.column_config.TextColumn("상품명", width="large"),
            "리뷰 수": st.column_config.NumberColumn("리뷰 수", format="%d"),
            "5점 수": st.column_config.NumberColumn("5점 ★★★★★", format="%d"),
        }
    )
st.markdown('</div>', unsafe_allow_html=True)

# ── 상품별 리뷰 탐색
st.markdown('<div class="section-card">', unsafe_allow_html=True)
st.markdown('<p class="section-title">🔍 상품별 리뷰 탐색</p>', unsafe_allow_html=True)

products_list = query("SELECT goods_no, goods_name FROM products ORDER BY goods_name")
product_map = {p["goods_name"]: p["goods_no"] for p in products_list}

col_sel, col_filter = st.columns([3, 1])
with col_sel:
    selected = st.selectbox("상품 선택", list(product_map.keys()), label_visibility="collapsed")
with col_filter:
    score_filter = st.select_slider(
        "평점 필터",
        options=[1, 2, 3, 4, 5],
        value=(1, 5),
        label_visibility="collapsed",
    )

if selected:
    reviews = query("""
        SELECT score, content, skin_type, skin_trouble, is_repurchase, created_at
        FROM reviews
        WHERE goods_no = %s
          AND score BETWEEN %s AND %s
        ORDER BY created_at DESC
        LIMIT 100
    """, (product_map[selected], score_filter[0], score_filter[1]))

    if reviews:
        st.caption(f"**{selected}** — 평점 {score_filter[0]}~{score_filter[1]}점 리뷰 **{len(reviews)}건** (최대 100건)")
        st.markdown("<br>", unsafe_allow_html=True)

        for r in reviews:
            score = r["score"] or 0
            score_color = "#10B981" if score >= 4 else ("#F59E0B" if score == 3 else "#EF4444")
            repurchase_badge = '<span class="review-badge badge-repurchase">🔁 재구매</span>' if r["is_repurchase"] else ""
            skin_badge = f'<span class="review-badge badge-skin">🌿 {r["skin_type"]}</span>' if r["skin_type"] else ""
            content = r["content"] or "(내용 없음)"

            st.markdown(f"""
            <div class="review-card">
                <div class="review-meta">
                    <span class="review-score" style="color:{score_color};">{"★" * score}{"☆" * (5 - score)}</span>
                    <span class="review-date">{r["created_at"]}</span>
                    {repurchase_badge}
                    {skin_badge}
                </div>
                <div class="review-content">{content}</div>
            </div>
            """, unsafe_allow_html=True)
    else:
        st.info("해당 조건의 리뷰가 없습니다.")

st.markdown('</div>', unsafe_allow_html=True)

# ── 피부 타입별 분포
st.markdown('<div class="section-card">', unsafe_allow_html=True)
st.markdown('<p class="section-title">🌿 피부 타입별 리뷰어 분포</p>', unsafe_allow_html=True)

skin_dist = query("""
    SELECT skin_type, COUNT(*) AS cnt
    FROM reviews
    WHERE skin_type IS NOT NULL AND skin_type != ''
    GROUP BY skin_type
    ORDER BY cnt DESC
    LIMIT 10
""")

if skin_dist:
    df_skin = pd.DataFrame(skin_dist)
    df_skin.columns = ["피부 타입", "리뷰 수"]
    fig3 = px.bar(
        df_skin, x="피부 타입", y="리뷰 수",
        color="리뷰 수",
        color_continuous_scale=["#BFDBFE", "#1D4ED8"],
    )
    fig3.update_layout(
        margin=dict(l=0, r=0, t=10, b=0),
        plot_bgcolor="white",
        paper_bgcolor="white",
        xaxis=dict(showgrid=False, tickfont=dict(size=12)),
        yaxis=dict(gridcolor="#F0F2F5", tickfont=dict(size=11)),
        coloraxis_showscale=False,
        height=240,
        font=dict(family="sans-serif"),
    )
    fig3.update_traces(marker_line_width=0)
    st.plotly_chart(fig3, use_container_width=True)
else:
    st.info("피부 타입 데이터가 없습니다.")
st.markdown('</div>', unsafe_allow_html=True)

# ── 푸터
st.markdown(f"""
<div class="footer">
    CellFusionC Review Intelligence &nbsp;·&nbsp; Powered by Oliveyoung × Supabase × GitHub Actions &nbsp;·&nbsp; {datetime.now().strftime("%Y")}
</div>
""", unsafe_allow_html=True)
