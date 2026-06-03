<div align="center">

# Oliveyoung Insight Dashboard

**올리브영 브랜드 모니터링 자동화 시스템**

뷰티 브랜드 마케터의 반복 업무를 자동화하고,<br/>
AI가 매일 아침 즉시 활용 가능한 전략 인사이트를 생성합니다.

[![Live Demo](https://img.shields.io/badge/Live_Demo-oliveyoung--review.vercel.app-22c55e?style=for-the-badge&logo=vercel)](https://oliveyoung-review.vercel.app)

![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?style=flat-square&logo=vercel)
![Claude](https://img.shields.io/badge/Claude-Anthropic-D97706?style=flat-square)
![GPT-4o](https://img.shields.io/badge/GPT--4o_mini-OpenAI-412991?style=flat-square)

</div>

---

## What I Built

뷰티 브랜드 마케터가 매일 아침 올리브영을 직접 들어가 순위를 확인하고, 리뷰를 읽고, 경쟁사를 체크하는 반복 업무를 자동화한 프로젝트입니다.

데이터 수집부터 AI 분석, 웹 대시보드 배포까지 전 파이프라인을 설계하고 구현했으며, 현재 실제 브랜드 운영팀에서 사용 중입니다.

---

## Architecture

```
Windows Server (Task Scheduler)
  ├── 리뷰 수집       06:00 / 16:00   (BeautifulSoup + curl_cffi)
  ├── 순위 수집       매시 정각        (변화 감지 시만 저장)
  └── 프로모 수집     08:00
          │
          ▼  psycopg2
  Supabase PostgreSQL (서울 리전)
          │
          ▼  ISR + On-demand Revalidation
  Next.js 15 App Router (Vercel)
    ├── Claude API      → 대시보드 AI 분석 / 데일리 브리핑
    └── GPT-4o-mini    → 인터랙티브 챗봇
```

---

## Key Features

### 오늘 현황
매일 아침 AI가 랭킹·리뷰·프로모션 데이터를 종합해 "오늘 마케터가 10초 안에 파악해야 할 것"을 자동 요약합니다. 부정 리뷰가 임계치 이상 급증한 상품은 즉시 알림으로 감지되고, 시간대별 순위 타임라인으로 하루 동안의 흐름을 한눈에 확인할 수 있습니다.

### 시장 랭킹
올리브영 8개 카테고리 Top 100을 매시간 수집해 자사 제품의 포지션과 경쟁사 움직임을 추적합니다. 단순 순위 나열이 아닌 "왜 이 시점에 이 브랜드가 올랐는지", 계절·트렌드 맥락과 함께 Claude가 해석합니다.

### 리뷰 분석
실구매 리뷰에서 긍/부정 키워드를 추출하고 피부 타입별 분포를 시각화합니다. 수천 건의 리뷰를 읽고 제품팀이 다음 분기 액션을 결정할 수 있는 인사이트를 생성합니다. 상품별 구매 동기·사용 시점·함께 언급된 제품도 자동 분류됩니다.

### AI 챗봇
GPT-4o-mini 기반 챗봇이 DB에 직접 연결되어 "선케어 시장에서 우리 포지션 어때?", "부정 리뷰 급증한 상품 있어?" 같은 자연어 질문에 실시간 데이터를 조회해 답합니다. OpenAI function calling 루프로 최대 3회 도구 체이닝을 구현했습니다.

### 올영픽 / 오늘의 특가
월별 올영픽 큐레이션과 오늘의 특가 상품을 자동 수집합니다. Claude가 이달 기획 컨셉 태그, 프로모션 방향 요약, 자사 대응 액션 포인트를 JSON으로 구조화해 제공합니다.

---

## Technical Challenges

### 안정적인 데이터 수집 환경 구성
일반적인 HTTP 클라이언트로는 상용 이커머스 플랫폼의 자동 수집 방지 정책에 의해 정상적인 응답을 받기 어렵습니다. `curl_cffi`를 활용해 실제 브라우저와 동일한 TLS fingerprint 및 헤더 구조를 재현하고, 요청 간격을 랜덤화해 안정적인 수집 환경을 구축했습니다. 이 접근으로 HTTP 403 오류 없이 8개 카테고리를 매시간 수집 중입니다.

### UTC / KST 시간대 불일치
Vercel과 Supabase는 UTC 기준, Windows 수집기는 KST 기준으로 동작합니다. `rank_hour`를 UTC로 통일해 저장하고 프론트엔드에서 `(utcHour + 9) % 24`로 변환합니다. 더 미묘한 문제는 AI 분석 캐싱 시 날짜 기준입니다. `new Date().toLocaleDateString()` 같은 로컬 함수는 Vercel에서 UTC 날짜를 반환하기 때문에, KST 오전 9시 이전에는 어제 날짜로 조회해 전날 분석이 그대로 표시되는 버그가 생깁니다. `Date.now() + 9 * 3600 * 1000`으로 KST 날짜를 직접 계산해 해결했습니다.

### 중복 수집 방지로 DB 효율화
올리브영 랭킹은 약 3시간 주기로 갱신되지만 수집기는 매시간 실행됩니다. 신규 수집 데이터를 DB의 직전 스냅샷과 goods_no 순서로 비교해, 변화가 없으면 저장을 스킵하는 방식으로 불필요한 행을 약 66% 절감했습니다. 과거 데이터는 장기 패턴 분석 목적으로 전량 보존합니다.

### AI 응답 캐싱 전략
Claude API 호출은 응답 생성에 수 초가 걸리기 때문에 매 페이지 렌더링마다 호출하면 사용자 경험이 나빠집니다. 분석 결과를 DB에 KST 날짜 + 시간대(오전/오후) 기준으로 캐싱합니다. 수집기가 완료될 때마다 `/api/revalidate`를 호출하는데, 이 엔드포인트에서 ISR 캐시 초기화와 AI 캐시 워밍업을 함께 처리합니다. 페이지가 실제로 열리기 전에 DB에 결과가 이미 준비되어 있어 즉시 응답이 가능합니다.

### 카테고리 코드 역엔지니어링
플랫폼의 카테고리 필터링은 내부 코드값으로 동작합니다. 처음에는 잘못된 코드를 사용해 전혀 다른 카테고리 상품이 수집되는 문제가 있었습니다. 실제 페이지 HTML을 파싱해 올바른 카테고리 코드를 특정하고 수정했습니다.

---

## Stack

| 분류 | 기술 |
|---|---|
| 수집기 | Python 3.12, curl_cffi, BeautifulSoup4, psycopg2 |
| 데이터베이스 | Supabase PostgreSQL (서울 리전) |
| 프론트엔드 | Next.js 15 App Router, React 19, TypeScript 5 |
| 스타일링 | Tailwind CSS v4, Framer Motion |
| 차트 | Recharts |
| 배포 | Vercel (ISR + On-demand Revalidation) |
| 스케줄러 | Windows Task Scheduler |
| AI | Claude (대시보드 분석), GPT-4o-mini (챗봇 + function calling) |

---

## Project Structure

```
├── collector/
│   ├── pipeline.py            # 리뷰 수집 및 전처리
│   ├── rank_collector.py      # 카테고리 순위 수집 (중복 감지 포함)
│   └── promo_collector.py     # 올영픽 · 오늘의 특가 수집
├── web/
│   ├── app/
│   │   ├── page.tsx           # 메인 대시보드 (Server Component)
│   │   └── api/
│   │       ├── chat/          # GPT-4o-mini 챗봇 API (function calling)
│   │       └── revalidate/    # ISR 초기화 + AI 캐시 워밍업
│   ├── components/            # 탭별 UI 컴포넌트
│   └── lib/
│       ├── db.ts              # DB 쿼리 함수 모음
│       ├── ai.ts              # Claude AI 호출 + KST 캐싱
│       └── types.ts           # 공유 타입 정의
└── db/
    └── schema.py              # Supabase 테이블 스키마
```

---

<div align="center">
  <sub>Python · Next.js · Supabase · Vercel · Claude · GPT-4o-mini</sub>
</div>
