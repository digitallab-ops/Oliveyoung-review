# CellFusionC · 올리브영 인사이트 대시보드

> 올리브영 공식 브랜드관의 **실구매 리뷰 · 카테고리 랭킹 · 프로모션 입점 현황**을 매일 자동으로 수집하고,
> AI 분석을 통해 브랜드 운영에 필요한 인사이트를 한눈에 제공하는 내부 모니터링 시스템입니다.

<div align="center">

[![Live Dashboard](https://img.shields.io/badge/대시보드_바로가기-oliveyoung--review.vercel.app-22c55e?style=for-the-badge)](https://oliveyoung-review.vercel.app)

![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?style=flat-square&logo=vercel)

</div>

---

## 주요 기능

| 탭 | 내용 |
|---|---|
| **오늘 현황** | AI 일일 브리핑 · 부정 리뷰 급증 알람 · 프로모션 입점 현황 · 시간별 랭킹 타임라인 |
| **리뷰 분석** | 신제품 리뷰 동향 · 긍정/부정 키워드 · AI 리뷰 인사이트 · 월별 트렌드 차트 |
| **시장 랭킹** | 카테고리별 Top 100 · 경쟁사 위치 · AI 시장 분석 · 일자별 최고/일평균/주간 추이 |
| **올영픽** | 월 기획전 입점 상품 · 카테고리별 분류 · 월별 이력 · AI 컨셉 분석 |
| **오특** | 오늘의 특가 입점 여부 · 날짜별 이력 조회 |
| **이력** | 리뷰 스냅샷 · 지표 변화 추적 |

---

## 시스템 구조

```
┌─────────────────────────────────────────────────────────┐
│              Windows Task Scheduler (서버 상시 가동)      │
│                                                         │
│  리뷰 수집   06:00 / 07:10 / 16:00 / 17:10 (매일)       │
│  랭킹 수집   매시간 정각                                  │
│  프로모 수집  08:00 / 09:10 (매일)                       │
└─────────┬───────────────────────────────────────────────┘
          │ Python 수집기 (scripts/*.ps1 → collector/*.py)
          ▼
┌─────────────────────┐       ┌─────────────────────────┐
│   collector/        │  →    │   Supabase PostgreSQL   │
│                     │       │                         │
│  pipeline.py        │       │  reviews                │
│  rank_collector.py  │       │  products               │
│  promo_collector.py │       │  market_rankings        │
│  summarizer.py      │       │  product_rankings       │
└─────────────────────┘       │  promo_items            │
          │                   │  insights_snapshots     │
          │ /api/revalidate   │  daily_briefs           │
          │ (수집 완료 후      │  market_insights        │
          │  캐시 초기화)      └────────────┬────────────┘
          │                                │ pg Pool (직접 쿼리)
          ▼                                ▼
┌─────────────────────────────────────────────────────────┐
│                Next.js 15 (Vercel)                      │
│                                                         │
│  page.tsx — Server Component, 1시간 ISR 캐시            │
│  lib/db.ts — 모든 DB 쿼리 함수 (getStats, getMarket...) │
│  lib/ai.ts — Anthropic Claude 인사이트 생성 + DB 캐시   │
│  app/api/chat — GPT-4o-mini 챗봇 (tool_use 루프)        │
│                                                         │
│  oliveyoung-review.vercel.app                          │
└─────────────────────────────────────────────────────────┘
```

---

## 인수인계 핵심 포인트

새로 담당하는 분이 빠르게 파악해야 할 설계 결정 사항들입니다.

### 1. 수집 서버는 Windows 워크스테이션 (상시 가동 필수)
- 수집기는 Vercel/Render가 아닌 **사내 Windows 서버**에서 Task Scheduler로 실행됩니다.
- 서버가 꺼지면 수집이 중단됩니다. 서버 재시작 후 Task Scheduler 작업이 살아있는지 확인하세요.
- 스케줄 스크립트 위치: `scripts/run_*.ps1`
- 로그 위치: `logs/` 폴더 (날짜별 자동 생성)

### 2. 타임존 주의 (UTC vs KST)
- Supabase DB와 Vercel은 **UTC 기준**으로 동작합니다.
- 수집기(Windows)는 **KST 기준**으로 실행됩니다.
- `rank_collector.py`는 `datetime.now(timezone.utc).hour`로 UTC 시각을 DB에 저장합니다.
- `lib/ai.ts`의 날짜 계산은 `Date.now() + 9h`로 KST 기준 날짜를 사용합니다.
- UTC/KST를 섞으면 "아침에 분석이 어제 것으로 나오는" 버그가 재발합니다.

### 3. 올리브영 봇 차단 (HTTP 403)
- 올리브영은 짧은 간격 반복 요청에 403을 반환합니다. 특히 오전 6~8시 트래픽 피크 시간대에 심합니다.
- `curl_cffi` 라이브러리로 Chrome 브라우저를 흉내내 우회하고 있습니다 (`impersonate="chrome120"`).
- 요청 간격은 4~8초 랜덤 딜레이입니다. 403이 다시 잦아지면 딜레이를 더 늘리세요 (`rank_collector.py` 마지막 줄).
- 403 오류는 수집 실패이지만 DB의 기존 데이터는 유지됩니다 — 다음 시간에 재수집됩니다.

### 4. 랭킹 데이터 구조
- `market_rankings`: 카테고리별 Top 100 전체를 **시간별**로 저장. 경쟁사 포함.
- `product_rankings`: 자사 상품만 **일별**로 저장 (당일 마지막 수집값).
- 대시보드의 "추이 그래프"는 `product_rankings` 기준입니다. 자사 제품이 Top 100에 없으면 해당 날짜는 그래프에 공백이 생깁니다.
- 특정 카테고리에서 자사 제품이 갑자기 "집계 안됨"처럼 보이면, 실제로 Top 100 밖으로 밀려난 것입니다.

### 5. AI 인사이트 캐싱
- 대시보드의 AI 분석 텍스트(일일 브리핑, 시장 분석, 리뷰 인사이트)는 Anthropic Claude로 생성하고 **DB에 하루 1회 캐시**합니다.
- `daily_briefs`, `market_insights`, `review_insights` 테이블에 저장됩니다.
- 분석이 이상하거나 강제로 재생성하려면 해당 테이블에서 오늘 날짜 row를 삭제하면 됩니다.
- AI 분석은 `ANTHROPIC_API_KEY`가 필요합니다. Vercel 환경변수에 없으면 분석 영역이 비어 보입니다.

### 6. 챗봇 (AI 인사이트 위젯)
- 오른쪽 하단 플로팅 버튼: GPT-4o-mini 기반, `app/api/chat/route.ts`
- DB 쿼리 도구 8개를 tool_use로 등록해 자연어 질문에 데이터를 조회합니다.
- `OPENAI_API_KEY` 환경변수가 필요합니다 (Anthropic과 별개).
- 대화 이력은 클라이언트 메모리에만 저장됩니다 (새로고침 시 초기화).

### 7. 새 제품 추가
- 올리브영에서 신규 출시 제품이 생기면 자동으로 수집됩니다.
- `pipeline.py`가 브랜드관 전체 상품 목록을 긁어 `products` 테이블에 추가하는 구조입니다.
- 브랜드 코드: `A001854` (`.env`의 `BRAND_CODE`)

---

## 기술 스택

### 수집기 (Python 3.12)
- **`curl_cffi`** — Cloudflare/봇 차단 우회 (chrome120 impersonate)
- **`BeautifulSoup4`** — HTML 파싱
- **`psycopg2`** — PostgreSQL 연결
- **`python-dotenv`** — 환경변수 관리

### 대시보드 (Next.js 15)
- **React 19** + TypeScript + Tailwind CSS
- **Recharts** — 차트 시각화
- **`@anthropic-ai/sdk`** — Claude AI 인사이트 생성 (대시보드 분석)
- **`openai`** — GPT-4o-mini 챗봇
- **`pg`** — Supabase 직접 쿼리

### 인프라
- **Supabase** — PostgreSQL 호스팅 (ap-northeast-2 / 서울 리전)
- **Vercel** — Next.js 배포 (ISR 1시간 + On-demand Revalidation)
- **Windows Task Scheduler** — 수집 자동화 (사내 서버)
- **Swit 웹훅** — 수집 오류 알림

---

## 디렉토리 구조

```
.
├── collector/
│   ├── pipeline.py          # 리뷰 수집 (브랜드 상품 목록 + 신규 리뷰)
│   ├── rank_collector.py    # 카테고리 랭킹 수집 (시장 전체 Top 100, 매시간)
│   ├── promo_collector.py   # 올영픽 + 오늘의 특가 수집
│   └── summarizer.py        # AI 상품 요약 생성 (상품별 리뷰 요약)
├── db/
│   └── schema.py            # DB 초기화 · 테이블 생성 · 공통 연결 함수
├── web/                     # Next.js 대시보드
│   ├── app/
│   │   ├── page.tsx         # 메인 페이지 (Server Component, ISR)
│   │   └── api/
│   │       ├── chat/        # GPT-4o-mini 챗봇 API
│   │       └── revalidate/  # 수집기 호출 → Vercel 캐시 초기화
│   ├── components/          # UI 컴포넌트 (탭, 차트, 챗봇 위젯 등)
│   └── lib/
│       ├── db.ts            # 모든 DB 쿼리 함수
│       ├── ai.ts            # Claude AI 호출 + DB 캐시 로직
│       └── types.ts         # TypeScript 타입 정의
├── scripts/
│   ├── _common.ps1                # 공통 변수 (경로, Python 위치)
│   ├── run_review_collector.ps1
│   ├── run_rank_collector.ps1
│   └── run_promo_collector.ps1
├── .env                     # 실제 환경변수 (git 제외)
├── .env.example             # 환경변수 템플릿
└── requirements.txt
```

---

## 환경 설정

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
ANTHROPIC_API_KEY=sk-ant-...        # 대시보드 AI 분석용
SWIT_WEBHOOK_URL=https://hook.swit.io/...   # 수집 오류 알림 (선택)
APP_URL=https://oliveyoung-review.vercel.app  # 수집 완료 후 캐시 초기화
```

### 3. Next.js 대시보드

```bash
cd web
npm install
npm run dev   # 로컬 실행 (http://localhost:3000)
```

Vercel 환경변수 (대시보드 설정에서 추가):
- `DATABASE_URL`
- `ANTHROPIC_API_KEY` — AI 분석 (Claude)
- `OPENAI_API_KEY` — 챗봇 (GPT-4o-mini)
- `BRAND_CODE` — `A001854`
- `APP_URL` — 배포 URL

---

## 수집 스케줄

| 작업 | 실행 시각 | 설명 |
|---|---|---|
| 리뷰 수집 (main) | 06:00, 16:00 | 신규 리뷰 + 상품 목록 업데이트 |
| 리뷰 수집 (retry) | 07:10, 17:10 | 실패 보험용 재실행 |
| 랭킹 수집 | 매시간 정각 | 카테고리별 Top 100 전수 저장 |
| 프로모 수집 (main) | 08:00 | 올영픽 + 오늘의 특가 |
| 프로모 수집 (retry) | 09:10 | 실패 보험용 재실행 |

수집 완료 시 `APP_URL/api/revalidate` 호출 → Vercel 캐시 즉시 초기화

---

## DB 스키마 (주요 테이블)

| 테이블 | 설명 |
|---|---|
| `reviews` | 리뷰 원문 · 별점 · 피부 타입 · 재구매 여부 |
| `products` | 브랜드 상품 목록 (goods_no 기준) |
| `market_rankings` | 시간별 카테고리 랭킹 전체 (rank_date + rank_hour, UTC 기준) |
| `product_rankings` | 자사 상품 일별 랭킹 (당일 마지막 수집값) |
| `promo_items` | 올영픽 / 오늘의 특가 수집 이력 |
| `product_summaries` | AI 생성 상품별 장단점 요약 |
| `insights_snapshots` | 일별 리뷰 지표 스냅샷 |
| `daily_briefs` | AI 일일 브리핑 캐시 (KST 날짜 기준, 1일 1회 생성) |
| `market_insights` | AI 시장 분석 캐시 (KST 날짜 + am/pm 슬롯) |
| `review_insights` | AI 리뷰 인사이트 캐시 (KST 날짜 기준) |

---

## 알림 체계

수집 중 이상 감지 시 **Swit 웹훅**으로 즉시 알림:
- 세션 차단 (Cloudflare 403 반복)
- 올영픽 상품 0건 (URL 변경 의심)
- 오특 수집 오류
- 리뷰 수집 예외 발생

---

## 수동 실행

```powershell
# 리뷰 수집
$env:PYTHONUTF8="1"; python -m collector.pipeline

# 랭킹 수집
$env:PYTHONUTF8="1"; python -m collector.rank_collector

# 프로모 수집
$env:PYTHONUTF8="1"; python -m collector.promo_collector
```

로그 확인:
```powershell
Get-Content logs\collector_rank_collector_20260529.log -Encoding UTF8
```

---

## 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| 대시보드 AI 분석이 비어있음 | `ANTHROPIC_API_KEY` 없거나 8초 타임아웃 초과 | Vercel 환경변수 확인, DB에서 오늘 날짜 캐시 row 삭제 후 재접속 |
| 챗봇이 응답 안 함 | `OPENAI_API_KEY` 없음 | Vercel 환경변수에 추가 |
| 랭킹 수집 403 오류 | 올리브영 봇 차단 | 다음 시간 재수집 대기, 딜레이 증가 검토 |
| 특정 카테고리 자사 제품 미표시 | 실제 Top 100 밖으로 이탈 | 올리브영에서 실제 순위 직접 확인 |
| 분석이 항상 어제 것으로 나옴 | UTC/KST 날짜 혼용 버그 재발 | `lib/ai.ts`의 `getKSTDateStr()` 함수 확인 |
| 수집이 아예 안 됨 | 서버 재시작 후 Task Scheduler 비활성 | Task Scheduler에서 작업 상태 확인 및 활성화 |

---

<div align="center">
  <sub>CellFusionC Review Intelligence · 올리브영 공식 브랜드관 실구매 리뷰 기준</sub>
</div>
