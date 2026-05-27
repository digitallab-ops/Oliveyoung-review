# 🌿 CellFusionC · 올리브영 인사이트 대시보드

> 올리브영 공식 브랜드관의 **실구매 리뷰 · 카테고리 랭킹 · 프로모션 입점 현황**을 매일 자동으로 수집하고,  
> Claude AI 분석을 통해 브랜드 운영에 필요한 인사이트를 한눈에 제공하는 내부 모니터링 시스템입니다.

<div align="center">

[![Live Dashboard](https://img.shields.io/badge/🔗_대시보드_바로가기-oliveyoungreview.vercel.app-22c55e?style=for-the-badge)](https://oliveyoungreview.vercel.app)

![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?style=flat-square&logo=vercel)
![Claude](https://img.shields.io/badge/Claude-AI_Insights-D97706?style=flat-square)

</div>

---

## 📌 주요 기능

| 탭 | 내용 |
|---|---|
| **오늘 현황** | AI 일일 브리핑 · 부정 리뷰 급증 알람 · 프로모션 입점 현황 · 시간별 랭킹 타임라인 |
| **리뷰 분석** | 신제품 리뷰 동향 · 긍정/부정 키워드 · AI 리뷰 인사이트 · 월별 트렌드 차트 |
| **시장 랭킹** | 카테고리별 Top 100 · 경쟁사 위치 · AI 시장 분석 · 일자별 최고/일평균/주간 추이 |
| **올영픽** | 월 기획전 입점 상품 · 카테고리별 분류 · 월별 이력 |
| **오특** | 오늘의 특가 입점 여부 · 날짜별 이력 조회 |
| **이력** | 리뷰 스냅샷 · 지표 변화 추적 |

---

## 🏗 시스템 구조

```
┌─────────────────────────────────────────────────────────┐
│                  Windows Task Scheduler                 │
│                                                         │
│  리뷰 수집   06:00 / 07:10 / 16:00 / 17:10 (매일)       │
│  랭킹 수집   매시간 정각                                  │
│  프로모 수집  08:00 / 09:10 (매일)                       │
└─────────┬───────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────┐       ┌─────────────────────────┐
│   collector/        │  →    │   Supabase PostgreSQL   │
│                     │       │                         │
│  pipeline.py        │       │  reviews                │
│  rank_collector.py  │       │  products               │
│  promo_collector.py │       │  market_rankings        │
│  summarizer.py      │       │  product_rankings       │
└─────────────────────┘       │  promo_items            │
                               │  insights_snapshots     │
                               └────────────┬────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                               │   Next.js 15 (Vercel)   │
                               │                         │
                               │  Server Components      │
                               │  + Claude AI Insights   │
                               │  + Recharts             │
                               │                         │
                               │  oliveyoungreview       │
                               │       .vercel.app       │
                               └─────────────────────────┘
```

---

## 🛠 기술 스택

### 수집기 (Python)
- **`curl_cffi`** — Cloudflare 우회 (chrome120 impersonate)
- **`BeautifulSoup4`** — HTML 파싱
- **`psycopg2`** — PostgreSQL 연결
- **`python-dotenv`** — 환경변수 관리

### 대시보드 (Next.js)
- **Next.js 15** + React 19 + TypeScript
- **Tailwind CSS** — 스타일링
- **Recharts** — 차트 시각화
- **`@anthropic-ai/sdk`** — Claude AI 인사이트 생성
- **`pg`** — Supabase 직접 쿼리

### 인프라
- **Supabase** — PostgreSQL 호스팅
- **Vercel** — Next.js 배포 (ISR + On-demand Revalidation)
- **Windows Task Scheduler** — 수집 자동화
- **Swit 웹훅** — 수집 오류 알림

---

## 📂 디렉토리 구조

```
.
├── collector/
│   ├── pipeline.py          # 리뷰 수집 (브랜드 상품 + 신규 리뷰)
│   ├── rank_collector.py    # 카테고리 랭킹 수집 (시장 전체 Top 100)
│   ├── promo_collector.py   # 올영픽 + 오늘의 특가 수집
│   └── summarizer.py        # AI 상품 요약 생성
├── db/
│   └── schema.py            # DB 초기화 · 공통 쿼리
├── web/                     # Next.js 대시보드
│   ├── app/
│   │   ├── page.tsx         # 메인 페이지 (SSR + AI 인사이트)
│   │   └── api/             # API 라우트 (리뷰 조회, 캐시 재검증 등)
│   ├── components/          # UI 컴포넌트
│   └── lib/
│       ├── db.ts            # DB 쿼리 함수
│       ├── ai.ts            # Claude AI 호출
│       └── types.ts         # TypeScript 타입 정의
├── scripts/
│   ├── run_review_collector.ps1
│   ├── run_rank_collector.ps1
│   └── run_promo_collector.ps1
├── .env.example
└── requirements.txt
```

---

## ⚙️ 환경 설정

### 1. Python 환경

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 2. 환경변수 설정

`.env.example`을 복사해 `.env` 생성:

```env
DATABASE_URL=postgresql://...@supabase.com:5432/postgres
BRAND_CODE=A001854
ANTHROPIC_API_KEY=sk-ant-...
SWIT_WEBHOOK_URL=https://hook.swit.io/...   # 수집 오류 알림 (선택)
APP_URL=https://oliveyoungreview.vercel.app  # 수집 완료 후 캐시 초기화
```

### 3. Next.js 대시보드

```bash
cd web
npm install
npm run dev   # 로컬 실행 (http://localhost:3000)
```

Vercel 배포 환경변수:
- `DATABASE_URL`
- `ANTHROPIC_API_KEY`

---

## 🕐 수집 스케줄

| 작업 | 실행 시각 | 설명 |
|---|---|---|
| 리뷰 수집 (main) | 06:00, 16:00 | 신규 리뷰 + 상품 목록 업데이트 |
| 리뷰 수집 (retry) | 07:10, 17:10 | 실패 보험용 재실행 |
| 랭킹 수집 | 매시간 정각 | 카테고리별 Top 100 전수 저장 |
| 프로모 수집 (main) | 08:00 | 올영픽 + 오늘의 특가 |
| 프로모 수집 (retry) | 09:10 | 실패 보험용 재실행 |

> 수집 완료 시 `/api/revalidate` 호출 → Vercel 캐시 즉시 초기화

---

## 📊 DB 스키마 (주요 테이블)

| 테이블 | 설명 |
|---|---|
| `reviews` | 리뷰 원문 · 별점 · 피부 타입 · 재구매 여부 |
| `products` | 브랜드 상품 목록 |
| `market_rankings` | 시간별 카테고리 랭킹 전체 (rank_date + rank_hour) |
| `product_rankings` | 자사 상품 일별 랭킹 (마지막 수집값) |
| `promo_items` | 올영픽 / 오늘의 특가 수집 이력 |
| `product_summaries` | AI 생성 상품별 장단점 요약 |
| `insights_snapshots` | 일별 리뷰 지표 스냅샷 |

---

## 🔔 알림 체계

수집 중 이상 감지 시 **Swit 웹훅**으로 즉시 알림:
- 세션 차단 (Cloudflare 403)
- 올영픽 상품 0건 (URL 변경 의심)
- 오특 수집 오류
- 리뷰 수집 예외 발생

---

## 📝 수동 실행

```powershell
# 리뷰 수집
$env:PYTHONUTF8="1"; python collector/pipeline.py

# 랭킹 수집
$env:PYTHONUTF8="1"; python collector/rank_collector.py

# 프로모 수집
$env:PYTHONUTF8="1"; python collector/promo_collector.py
```

---

<div align="center">
  <sub>CellFusionC Review Intelligence · 올리브영 공식 브랜드관 실구매 리뷰 기준</sub>
</div>
