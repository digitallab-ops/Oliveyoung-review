<div align="center">

# Oliveyoung Insight Dashboard

**셀퓨전씨 멀티플랫폼 브랜드 모니터링 자동화 시스템**

올리브영 · 쿠팡 · 네이버 세 플랫폼의 데이터를 자동 수집하고,<br/>
AI가 매일 아침 즉시 활용 가능한 전략 인사이트를 생성합니다.

<sub>실제 서비스는 사내 계정(`@cms-lab.co.kr`) 인증이 필요합니다 —<br/>
브랜드 전략·경쟁사 분석 데이터가 포함되어 외부 공개하지 않습니다.</sub>

![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?style=flat-square&logo=vercel)
![Claude](https://img.shields.io/badge/Claude_Haiku_4.5-Anthropic-D97706?style=flat-square)
![OpenAI](https://img.shields.io/badge/GPT--5.4_mini-OpenAI-412991?style=flat-square&logo=openai&logoColor=white)

</div>

---

> **운영·유지보수 담당자는 [HANDOVER.md](HANDOVER.md)를 보세요.**
> 스케줄 구성, 파수꾼 경보 대응, 자주 깨지는 지점과 그 해결법을 정리해 두었습니다.

---

## What I Built

뷰티 브랜드 마케터가 매일 아침 올리브영·쿠팡·네이버를 직접 들어가 순위를 확인하고, 리뷰를 읽고, 경쟁사를 체크하는 반복 업무를 자동화한 프로젝트입니다.

데이터 수집부터 AI 분석, 웹 대시보드 배포, MCP 서버 연동까지 전 파이프라인을 설계하고 구현했으며, 현재 실제 브랜드 운영팀에서 사용 중입니다.

---

## Architecture

```
Windows Server (Task Scheduler)
  ├── 올리브영 리뷰 수집    06:00 / 16:00   (BeautifulSoup + curl_cffi)
  ├── 올리브영 순위 수집    매시 정각        (변화 감지 시만 저장)
  ├── 올리브영 프로모 수집  08:00           (올영픽 월 교체 감지 포함)
  ├── 상세·가격·전성분 수집  02:00           (자사 우선, rate limit 대응)
  ├── 쿠팡 리뷰·순위 수집   06:00 / 18:00
  └── 네이버 트렌드·검색 수집 06:00
          │
          ├── 각 단계 직후 ▸ Sentinel (파수꾼)
          │     결과 데이터 17개 항목 검증 → 이상 시 Slack
          │     "exit 0이어도 0건이면 파이프라인은 죽은 것"
          │
          ▼  psycopg2 + Slack Webhook 알림
  Supabase PostgreSQL (서울 리전)
    ├── oliveyoung 스키마   (리뷰, 순위, 프로모, 상품, 가격이력, 전성분)
    ├── coupang 스키마      (리뷰, 순위, 상품)
    └── naver 스키마        (트렌드, 검색순위, 시장)
          │
          ▼  ISR + On-demand Revalidation
  Next.js 15 App Router (Vercel)
    ├── Google OAuth (NextAuth v5)  @cms-lab.co.kr 도메인 제한
    ├── 올리브영 대시보드   의사결정 기준 5탭 (오늘·기획·경쟁사·프로모·리뷰)
    ├── 쿠팡 Beta           KPI·리뷰·검색순위·AI 인사이트
    ├── 네이버 Beta         검색 트렌드·노출 순위·경쟁사 시장
    ├── GA4                 탭·플랫폼 전환 이벤트 추적
    └── AI                  대시보드 분석 + 인터랙티브 챗봇
          │
          ▼  MCP (Model Context Protocol)
  Claude Desktop / 외부 AI 클라이언트
    ├── TypeScript MCP 서버  /api/mcp  (Streamable HTTP)
    └── Python MCP 서버      mcp-server/server.py  (FastMCP / SSE)
```

---

## Key Features

### 의사결정 기준 탭 구조

탭을 데이터 출처(시장랭킹·올영픽·오특·이력)가 아니라 **"무엇을 결정하려는가"** 로 나눴습니다. 하나의 판단을 위해 여러 탭을 오가야 하던 문제를 해소하고, 마케팅팀 외 타 부서도 어느 탭을 열어야 할지 바로 알 수 있게 했습니다.

| 탭 | 답하는 질문 | 핵심 구성 |
|---|---|---|
| **오늘** | 뭐가 달라졌나 | AI 브리핑 · 부정리뷰 경고 · 프로모 현황 · 시간별 순위 |
| **제품 기획** | 다음에 뭘 낼까 | 용량당 단가 비교 · 신제품 반응 · 시장 랭킹 |
| **경쟁사** | 누가 치고 오나 | 가격 변동 · 경쟁사 AI 분석 · 브랜드 이벤트 타임라인 |
| **프로모션** | 올영픽·오특에 뭘 넣을까 | 월별 큐레이션 분석 · 특가 이력 |
| **리뷰·CS** | 뭐가 불만인가 | 리뷰 추이 · 키워드 · 부정 이슈 · 상품별 요약 |

### 용량당 단가 비교

같은 카테고리라도 800ml 수딩젤과 35ml 앰플을 원/ml로 비교하면 대용량이 무조건 이겨 의미가 없습니다. 자사 제품마다 **같은 카테고리·같은 단위이면서 용량이 0.5~2배 범위인 경쟁사만** 비교군으로 삼아 실질 가격 경쟁력을 계산합니다. 경쟁사보다 비싼데 순위권 밖인 제품은 상단에 경고로 띄워 가격 저항을 먼저 의심하게 합니다.

### 오늘 현황 (올리브영)
매일 아침 AI가 랭킹·리뷰·프로모션 데이터를 종합해 "오늘 마케터가 10초 안에 파악해야 할 것"을 자동 요약합니다. 부정 리뷰가 전주 대비 50% 이상 급증한 상품은 즉시 경고로 감지되고, 시간대별 순위 타임라인으로 하루 동안의 흐름을 한눈에 확인할 수 있습니다.

### 리뷰 트렌드 (월간 / 주간)
리뷰 추이를 월간 또는 주간 단위로 전환해 볼 수 있습니다. 주간 모드에서는 ISO 주 기준 범위 피커로 원하는 기간을 직접 선택할 수 있어, 특정 프로모션 기간 전후의 리뷰 변화를 정밀하게 비교할 수 있습니다.

### 자사 순위 추적
올리브영 카테고리별 자사 상품 순위를 일별 최고·일평균·주간 3가지 모드로 시각화합니다. 21개 상품 전부 고유 색상으로 구분되며, 평균 순위 기준 상위 5개 상품이 기본 선택됩니다. 상품 선택·해제 시 다른 상품의 색상이 밀리지 않습니다.

### 쿠팡 Beta
수집된 실구매 리뷰의 평점·부정 비율·신규 리뷰 속도를 KPI 카드로 집약합니다. 검색순위와 카테고리 베스트셀러 노출 현황을 추적하며, Claude가 소비자 반응을 핵심 칭찬·아쉬운 점·마케팅 인사이트로 구조화합니다.

### 네이버 Beta
DataLab 검색 트렌드(8주 추이), 쇼핑 키워드별 검색 노출 순위, 경쟁사 가격 분포를 한 화면에 제공합니다. 자사 상품 × 검색 키워드 매트릭스로 "어떤 키워드에서 노출되는지, 어디서 빠지는지"를 즉시 파악할 수 있습니다. 브랜드 전용 키워드(자사 상품 점유율 80% 이상)를 자동 필터링해 경쟁 키워드만 분석 대상으로 남깁니다.

### AI 챗봇 (멀티플랫폼)
Claude Sonnet 4.6 기반 챗봇이 세 플랫폼 DB에 모두 연결됩니다. 현재 보고 있는 탭에 관계없이 "쿠팡이랑 올리브영 비교해줘" 같은 크로스 플랫폼 질문도 처리하며, 도구 호출 결과를 스트리밍으로 반환해 첫 글자부터 즉시 표시됩니다.

- 20개 도구 (올리브영 12 · 쿠팡 5 · 네이버 4) 항상 전체 제공
- 병렬 도구 실행: `Promise.all()`로 다중 DB 조회 동시 처리
- 프롬프트 캐싱: 시스템 프롬프트 + 도구 정의 5분 캐시 (입력 토큰 90% 절감)
- DB 결과 인메모리 TTL 캐시 (2~10분) — 반복 질문 즉시 응답

### MCP 서버 (이중 구성)
`/api/mcp` 엔드포인트(TypeScript, Streamable HTTP)와 `mcp-server/server.py`(Python, FastMCP SSE) 두 가지 MCP 서버를 제공합니다. Claude Desktop 등 MCP 호환 클라이언트를 연결하면 대시보드 없이 자연어로 DB를 직접 조회할 수 있습니다.

| 도구 | 설명 |
|---|---|
| `get_stats` / `get_product_stats` | 전체 KPI 및 상품별 통계 |
| `get_timeseries` | 월간·주간 리뷰 추이 |
| `get_reviews_by_date` | 특정 날짜 리뷰 목록 |
| `get_review_content` | 리뷰 원문 (상품·날짜·필터 조건) |
| `get_weekly_delta` | 전주 대비 이번 주 변화량 |
| `get_product_summary` | 상품별 통계·키워드·최근 리뷰·순위 통합 조회 |
| `get_ranking_history` / `get_market_ranking` | 자사·시장 순위 |
| `get_insights` / `get_daily_brief` | AI 생성 인사이트 |
| `get_promo_status` | 올영픽·오늘의 특가 입점 현황 |

### 올영픽 / 오늘의 특가
월별 올영픽 큐레이션과 오늘의 특가 상품을 자동 수집합니다. Claude가 이달 기획 컨셉 태그, 프로모션 방향 요약, 자사 대응 액션 포인트를 구조화해 제공합니다. 매월 1일에는 전월 대비 신규 입점·제외 상품 변동 내역을 자동으로 Swit 알림으로 발송합니다.

### 접근 제어 (Google OAuth)
NextAuth v5 기반 Google OAuth 2.0 인증을 적용했습니다. `@cms-lab.co.kr` 도메인 계정만 로그인이 허용되며, MCP 엔드포인트(`/api/mcp`)는 별도 API 키 방식으로 분리되어 인증 없이 접근 가능합니다.

### Swit 파이프라인 알림
파이프라인 실행 결과를 Swit Webhook으로 실시간 수신합니다. 실패 시 에러 한 줄 요약과 ❌ 강조, 성공 시 수집 건수·자사 입점 여부 등 핵심 지표만 발송합니다.

---

## Technical Challenges

### 조용히 죽는 파이프라인 — 결과를 검증하는 파수꾼(Sentinel)

올영픽 수집이 **두 달간 멈춰 있었는데 아무도 몰랐습니다.** 올리브영이 `dispCatNo` 형식에 영문 접미사를 붙이면서 정규식 `\d+`가 값을 잘라먹었고, 수집기는 0건을 받고도 **정상 종료(exit 0)** 했기 때문입니다. 기존 알림은 종료 코드만 봤기에 실패로 잡히지 않았습니다.

종료 코드가 아니라 **결과 데이터를 검증**하는 파수꾼을 만들어 각 수집 단계 뒤에 붙였습니다.

```
✅ 올영픽 오늘 수집: 251개        (기준 50개 미만이면 실패)
✅ 올영픽 이탈 감지 신선도: 0일    (기준 10일 초과면 실패)
✅ 카테고리별 수집 끊김: 0일       (한 카테고리만 죽어도 감지)
✅ 자사 전성분 누락: 11개
```

- `count`(최소 건수)와 `freshness`(최신성) 2종 점검, 총 **17개 항목**
- `Invoke-Collector`에 `-sentinelStage` 훅을 넣어 스크립트 수정 없이 각 단계에 배치
- 임계값은 정상치의 절반 수준으로 잡아 자연 변동에 의한 거짓 경보를 피함

도입 직후 **맨즈에딧 카테고리가 13일째 0건**이라는 사실을 잡아냈습니다. 전체 행수(7,100행)만 보던 첫 버전은 다른 카테고리가 채워줘서 통과했고, 그래서 카테고리별 점검을 추가했습니다. 원인은 올리브영이 필터 코드를 `10000010007` → `10000060002`로 바꾸고 속성명도 `fltDispCatNo` → `data-ref-dispCatNo`로 변경한 것이었습니다.

### 하드코딩된 목록은 반드시 낡는다 — 자기 감시하는 분류 체계

상품명을 효능·제형·프로모션 3축으로 분류하는 데 키워드 매칭을 씁니다. 문제는 **새 트렌드 용어가 나오면 조용히 미분류로 빠진다**는 점입니다. 실제로 `PDRN`이 78회 등장하는데 목록에 없었습니다.

해법을 AI 분류로 잡지 않았습니다. 그러면 왜 그렇게 분류됐는지 따질 수 없기 때문입니다. 대신 **키워드는 투명하게 두되, 목록이 낡는 것을 감지**하게 했습니다.

- `discover()` — 어느 축에도 안 걸리는 빈출어를 발굴. 상품명 `[대괄호]` 안은 브랜드가 직접 붙인 포지셔닝이라 신호 가치가 높음
- 브랜드명은 상품명 첫 토큰에서 자동 수집해 제외 (목록 관리 불필요)
- 파수꾼이 **커버리지 하락**과 **미등록 빈출어 누적**을 감시

도구가 곧바로 `피디알엔`(33회)을 잡아냈습니다. 영문 `PDRN`만 등록했는데 한글 표기가 따로 돌고 있었고, 사람이 알아채기 어려운 종류의 누락이었습니다.

만들면서 **직접 낸 버그**도 이 방식으로 드러났습니다. `파우더` 키워드에 `'포'`를 넣었더니 "**포**스트 알파", "아쿠아**포**린"이 걸려 자사 파우더가 17개로 집계됐습니다. 1글자 키워드는 토큰 완전일치를 요구하도록 구조적으로 막되, 한국어 복합어(`기획세트`)를 위해 2글자부터는 부분매칭을 허용했습니다.

### 자사 데이터가 비어 있던 이유

경쟁사는 가격 1,936개·전성분 1,515개를 갖고 있는데 **자사는 용량·전성분이 0개**였습니다. 가격·용량·성분 비교가 구조적으로 불가능한 상태였습니다.

원인은 수집기 3종이 모두 `WHERE is_competitor = true`로 **자사 46개를 대상에서 제외**하고 있던 것이었습니다. "경쟁사 상세 수집기"로 출발한 코드가 그대로 굳은 경우였습니다.

- 필터를 제거하고 `ORDER BY is_competitor`로 **자사를 먼저** 처리 (46개뿐이고 비교의 기준값)
- 용량·기획구성은 상품명 정규식이라 웹 요청 없이 백필 — 자사 43개, 경쟁사 1,207개 즉시 확보
- 결과: 자사 46개 중 **35개가 가격·용량 모두 보유**해 단가 비교가 가능해짐

데이터가 채워지자 패턴이 드러났습니다. 선케어 35~40ml 라인이 경쟁사 대비 **+19~52% 비쌌고**, 스틱 타입(19~20g)은 **-14~18% 저렴한데 전부 순위권 밖**이었습니다. 후자는 가격 문제가 아니라 노출 문제라는 뜻입니다.

### 안정적인 데이터 수집 환경 구성
일반적인 HTTP 클라이언트로는 상용 이커머스 플랫폼의 자동 수집 방지 정책에 의해 정상적인 응답을 받기 어렵습니다. `curl_cffi`를 활용해 실제 브라우저와 동일한 TLS fingerprint 및 헤더 구조를 재현하고, 요청 간격을 랜덤화해 안정적인 수집 환경을 구축했습니다.

### UTC / KST 시간대 불일치
Vercel과 Supabase는 UTC 기준, Windows 수집기는 KST 기준으로 동작합니다. `rank_hour`를 UTC로 통일해 저장하고 프론트엔드에서 `(utcHour + 9) % 24`로 변환합니다. AI 분석 캐싱에서도 `new Date().toLocaleDateString()`은 Vercel에서 UTC 날짜를 반환하기 때문에 `Date.now() + 9 * 3600 * 1000`으로 KST 날짜를 직접 계산해 해결했습니다.

### 중복 수집 방지로 DB 효율화
올리브영 랭킹은 약 3시간 주기로 갱신되지만 수집기는 매시간 실행됩니다. 신규 수집 데이터를 DB의 직전 스냅샷과 `goods_no` 순서로 비교해 변화가 없으면 저장을 스킵하는 방식으로 불필요한 행을 약 66% 절감했습니다. 리뷰 중복 방지는 `review_id` 기반 UNIQUE INDEX와 `ON CONFLICT DO NOTHING`으로 처리하며, 초기 적재 시 발생한 445건 중복 데이터를 일괄 정리했습니다.

### 브랜드 키워드 노이즈 필터링
네이버 검색 노출 분석에서 "셀퓨전씨" 같은 브랜드 전용 키워드는 자사 상품만 노출되어 경쟁 분석이 의미 없습니다. 키워드별 자사 상품 점유율이 80% 이상인 경우를 브랜드 키워드로 자동 판별해 경쟁 매트릭스에서 제외하고, 경쟁이 실제로 발생하는 키워드만 분석 대상으로 남깁니다.

### 챗봇 응답 지연 해소 (스트리밍 + 3중 최적화)
도구 호출이 포함된 질문은 DB 조회와 Claude 재호출이 겹쳐 20초 이상 걸리는 문제가 있었습니다. 세 가지를 동시에 적용해 해결했습니다.

1. **스트리밍**: `client.messages.stream()`으로 텍스트 청크를 생성 즉시 전송 — 도구 실행 중엔 로딩 표시, 응답 시작과 동시에 타이핑 효과
2. **병렬 도구 실행**: Claude가 한 라운드에 여러 도구를 요청할 때 `Promise.all()`로 DB를 동시 조회 — 2개 도구 기준 처리 시간 절반 단축
3. **프롬프트 캐싱**: 시스템 프롬프트(~2,000토큰)와 20개 도구 정의에 `cache_control: ephemeral` 적용 — 반복 요청 시 입력 처리 비용 90% 절감

### AI 응답 캐싱 전략
Claude API 호출은 응답 생성에 수 초가 걸립니다. 분석 결과를 DB에 KST 날짜 + 시간대(오전/오후) 기준으로 캐싱하고, 수집기 완료 시 `/api/revalidate`로 ISR 캐시 초기화와 AI 캐시 워밍업을 동시에 처리합니다. 페이지가 열리기 전에 결과가 이미 준비되어 있어 즉시 응답이 가능합니다.

### 파이프라인 안정성 (스키마 마이그레이션 race condition)
여러 파이프라인이 동시에 실행될 때 `DROP INDEX + CREATE INDEX` 패턴에서 race condition이 발생했습니다. `CREATE UNIQUE INDEX IF NOT EXISTS`만 남기고 DROP을 제거해 멱등성을 확보했습니다. 리뷰 unique constraint 위반은 `ON CONFLICT (review_id) DO NOTHING` → `ON CONFLICT DO NOTHING`으로 수정해 해결했습니다.

---

## 화면 구성

> 실제 서비스는 브랜드 전략·경쟁사 분석 데이터를 포함해 사내 계정(`@cms-lab.co.kr`) 인증이 필요합니다.

| 화면 | 담당하는 판단 | 핵심 구성 |
|---|---|---|
| **오늘** | 뭐가 달라졌나 | AI 일일 브리핑 · 부정리뷰 급증 경고 · 프로모션 입점 현황 · 시간대별 순위 타임라인 |
| **제품 기획** | 다음에 뭘 낼까 | 용량당 단가 비교(비싼데 순위권 밖 경고) · 신제품 리뷰 반응 · 카테고리 Top 100 |
| **경쟁사** | 누가 치고 오나 | 최근 가격 변동 · 경쟁사 긍부정 키워드 비교 · 브랜드 이벤트 타임라인 |
| **프로모션** | 올영픽·오특에 뭘 넣을까 | 월별 큐레이션 컨셉 분석 · 자사 대응 액션 포인트 · 특가 이력 |
| **리뷰·CS** | 뭐가 불만인가 | 리뷰 추이(월간/주간) · 상품별 키워드 · 부정 이슈 · AI 상품 요약 |

이 외에 **멀티플랫폼 AI 챗봇**(올리브영·쿠팡·네이버 교차 질의, 스트리밍 응답)과
**파수꾼 Slack 경보**(수집 이상 자동 감지)가 상시 동작합니다.

---

## Stack

| 분류 | 기술 |
|---|---|
| 수집기 | Python 3.12, curl_cffi, BeautifulSoup4, psycopg2 |
| 데이터베이스 | Supabase PostgreSQL (서울 리전) |
| 프론트엔드 | Next.js 15 App Router, React 19, TypeScript 5 |
| 인증 | NextAuth v5 (Auth.js), Google OAuth 2.0 |
| 스타일링 | Tailwind CSS v4, Framer Motion |
| 차트 | Recharts |
| 배포 | Vercel (ISR + On-demand Revalidation) |
| 스케줄러 | Windows Task Scheduler + PowerShell |
| 알림 | Slack Incoming Webhook (수집 결과 + 파수꾼 경보) |
| 분석 | Google Analytics 4 (탭·플랫폼 전환 이벤트) |
| AI — 웹 | OpenAI `gpt-5.4-mini` (대시보드 인사이트 + 챗봇) |
| AI — 브리핑 | OpenAI `gpt-4o` (일 1회, 품질 우선) |
| AI — 요약 | Anthropic `claude-haiku-4.5` (쿠팡·네이버 리뷰 요약) |

---

## Project Structure

```
├── collector/
│   ├── sentinel.py            # ★ 파수꾼 — 결과 데이터 17개 항목 검증 + Slack 경보
│   ├── taxonomy.py            # ★ 효능·제형·프로모션 3축 분류 + 목록 노후화 발굴
│   ├── pipeline.py            # 올리브영 리뷰 수집 및 전처리
│   ├── rank_collector.py      # 카테고리 순위 수집 (중복 감지 포함)
│   ├── promo_collector.py     # 올영픽 · 오늘의 특가 수집 (월 교체 감지)
│   ├── event_detector.py      # 올영픽 입점·이탈, 순위 급등 자동 감지
│   ├── price_collector.py     # 가격 수집 (자사 우선, rate limit 대응)
│   ├── ingredient_collector.py# 전성분 수집 (curl_cffi)
│   ├── product_detail_collector.py # 용량 · 기획구성 (상품명 정규식)
│   ├── summarizer.py          # 상품별 AI 요약 생성
│   ├── coupang_pipeline.py    # 쿠팡 리뷰 수집
│   ├── coupang_rank.py        # 쿠팡 검색순위 · 카테고리 순위 수집
│   └── naver_collector.py     # 네이버 트렌드 · 검색 노출 · 시장 데이터 수집
├── mcp-server/
│   └── server.py              # Python MCP 서버 (FastMCP / SSE)
├── scripts/
│   ├── _common.ps1            # 공통 유틸 (Swit 알림, 로그, 타임아웃)
│   ├── run_review_collector.ps1
│   ├── run_rank_collector.ps1
│   └── run_promo_collector.ps1
├── web/
│   ├── auth.ts                # NextAuth v5 설정 (@cms-lab.co.kr 제한)
│   ├── middleware.ts          # 인증 미들웨어 (MCP 엔드포인트 제외)
│   ├── app/
│   │   ├── login/page.tsx     # Google 로그인 페이지
│   │   ├── page.tsx           # 메인 대시보드 (Server Component)
│   │   └── api/
│   │       ├── auth/          # NextAuth 핸들러
│   │       ├── chat/          # Claude Sonnet 4.6 챗봇 (스트리밍 + 병렬 도구)
│   │       ├── mcp/           # TypeScript MCP 서버 (Streamable HTTP)
│   │       ├── reviews/trends/# 주간 리뷰 추이 API
│   │       └── revalidate/    # ISR 초기화 + AI 캐시 워밍업
│   ├── components/
│   │   ├── DashboardTabs.tsx      # 의사결정 기준 5탭 구조
│   │   ├── UnitPriceSection.tsx   # ★ 용량당 단가 비교 (용량대 매칭)
│   │   ├── PriceChangeSection.tsx # ★ 최근 가격 변동 (14일 · 5% 이상)
│   │   ├── RankingSection.tsx     # 자사 순위 차트 (21색 팔레트 · 평균순위 기본선택)
│   │   ├── TimeSeriesChart.tsx    # 리뷰 추이 (월간/주간 전환 · 기간 선택)
│   │   ├── CoupangDashboard.tsx   # 쿠팡 Beta 대시보드
│   │   ├── NaverDashboard.tsx     # 네이버 Beta 대시보드
│   │   └── ChatWidget.tsx         # 멀티플랫폼 AI 챗봇 위젯
│   └── lib/
│       ├── db.ts              # DB 쿼리 함수 모음 (전 플랫폼)
│       ├── ai.ts              # AI 호출 + KST 캐싱 + 월별 동적 시즌 컨텍스트
│       ├── analytics.ts       # GA4 이벤트 (탭·플랫폼 전환)
│       └── types.ts           # 공유 타입 정의
└── db/
    ├── schema.py              # 올리브영 테이블 스키마
    ├── coupang_schema.py      # 쿠팡 테이블 스키마
    └── naver_schema.py        # 네이버 테이블 스키마
```

---

## Update History

### 2026-09 (v1.4) — 파이프라인 신뢰성 · 가격 분석

**파이프라인이 조용히 죽는 문제 해결**
- **파수꾼(Sentinel) 도입**: 종료 코드가 아닌 결과 데이터를 검증하는 17개 항목 점검기. `Invoke-Collector`에 훅을 넣어 각 수집 단계 뒤에 배치, 이상 시 Slack 경보
- **올영픽 2개월 누락 복구**: `dispCatNo` 정규식 `\d+` → `[A-Za-z0-9]+` (형식에 영문 접미사 추가됨)
- **올영픽 이탈 감지 부활**: 비교 기준을 달력상 직전 달 → *데이터가 있는* 가장 최근 달로 변경. 8월 공백 때문에 빈 집합과 비교해 이탈이 영원히 0건이던 문제. 월 내 중복 발행도 억제 (같은 입점을 29번 재발행하던 것)
- **맨즈에딧 13일 누락 복구**: 필터 코드 `10000010007` → `10000060002` 변경 대응
- **Vercel revalidate 401 수정**: 미들웨어가 인증 없는 모든 `/api/`를 차단하던 것을 우회 + 시크릿·세션 이중 허용

**자사 데이터 공백 해소**
- 수집기 3종(`ingredient`·`price`·`product_detail`)이 `is_competitor = true`로 자사를 제외하던 문제 수정, 자사 우선 정렬로 변경
- 자사 용량 0 → 43개, 전성분 0 → 35개, 가격 26 → 38개

**분석 기능**
- **용량당 단가 비교**: 같은 카테고리·단위·용량 0.5~2배 범위 경쟁사와 비교. "비싼데 순위권 밖" 제품 경고
- **가격 변동 알림**: 84일치 가격 이력을 활용해 14일 내 5% 이상 변동 감지
- **3축 분류 체계**(`taxonomy.py`): 효능·제형·프로모션. 미등록 빈출어 자동 발굴로 목록 노후화 감지

**UX · 운영**
- **탭 재편 7 → 5**: 데이터 출처 기준 → 의사결정 기준(오늘·제품기획·경쟁사·프로모션·리뷰CS)
- **GA4 도입**: 탭·플랫폼 전환 이벤트 추적 (SPA라 page_view로 안 잡히던 것)
- **AI 시즌 컨텍스트 동적화**: "지금은 초여름" 하드코딩 → 월별 계산 (9월에 여름 기준으로 분석하던 문제)
- **브리핑 프롬프트 개선**: 섹션 번호·마크다운 기호 금지 강화, 해설 문장 배제
- **MCP `get_ingredients` 추가**: Vercel 데이터센터 IP가 차단되어 실시간 스크래핑이 불가능 → 로컬 수집 후 DB 캐시를 읽는 방식으로 전환

### 2026-07 (v1.3)
- **순위 차트 개선**: COLORS 팔레트 7→21개로 확장, 색상 고정 (선택 변경 시 색 밀림 없음), 기본 선택 평균 순위 기준 상위 5개로 변경
- **올영픽 월 교체 감지**: 매월 1일 전월 대비 신규 입점·제외·유지 상품 변동을 Swit으로 자동 발송

### 2026-06 (v1.2)
- **Google OAuth 도입**: NextAuth v5 기반 @cms-lab.co.kr 도메인 제한, `/login` 페이지, 미들웨어 보호
- **주간 차트 뷰**: 리뷰 추이 월간/주간 토글, ISO 주 기준 범위 피커 추가
- **MCP 서버 강화**: 4개 도구 신규 추가 — `get_reviews_by_date`, `get_review_content`, `get_weekly_delta`, `get_product_summary` (TypeScript + Python 동시 적용)
- **AI 챗봇 개선**: 신규 4개 도구 연동, 하드코딩 응답 문구 제거, DB 필드 접근 오류 수정
- **Python MCP 서버**: `mcp-server/server.py` FastMCP 기반 SSE 서버 구축
- **DB 중복 정리**: 리뷰 445건 중복 제거, `UNIQUE INDEX` 추가, `ON CONFLICT DO NOTHING` 적용
- **파이프라인 안정화**: 스키마 마이그레이션 race condition 수정 (`DROP INDEX` 제거), unique constraint 위반 수정
- **Swit 파이프라인 알림**: 실패 시 에러 한 줄 + ❌ 강조, 성공 시 핵심 지표 요약 발송

### 2026-05 (v1.0)
- 최초 구축: 올리브영 리뷰·순위·프로모 수집, 쿠팡·네이버 Beta, 메인 대시보드, AI 챗봇, MCP 서버, Windows Task Scheduler 자동화

---

<div align="center">
  <sub>Python · Next.js · Supabase · Vercel · OpenAI · Claude · MCP</sub>
</div>
