# 운영 인수인계

올리브영 인사이트 대시보드를 넘겨받는 사람을 위한 문서입니다.
프로젝트 개요·아키텍처는 [README.md](README.md)를 먼저 읽고, 이 문서는 **운영**만 다룹니다.

> **가장 먼저 읽을 곳:** [자주 깨지는 지점](#자주-깨지는-지점).
> 이 시스템은 올리브영 화면 구조에 의존하므로, 저쪽이 바뀌면 조용히 멈춥니다.

---

## 1. 실행 환경

| 항목 | 값 |
|---|---|
| 서버 | Windows Server (사내) |
| 경로 | `C:\oliveyounginsight\Ollive0-CellFusionC-Review` |
| 파이썬 | `venv\Scripts\python.exe` (3.12) |
| 스케줄러 | Windows 작업 스케줄러 |
| DB | Supabase PostgreSQL (서울 리전), 스키마 `oliveyoung` / `coupang` / `naver` |
| 웹 | Vercel — https://oliveyoung-review.vercel.app |

### 환경 변수 (`.env`, git 추적 제외)

| 키 | 용도 | 없으면 |
|---|---|---|
| `DATABASE_URL` | Supabase 접속 | 전부 중단 |
| `BRAND_CODE` | 올리브영 브랜드 코드 (`A001854`) | 리뷰 수집 불가 |
| `OPENAI_API_KEY` | 웹 인사이트·챗봇·일일브리핑 | AI 영역 공백 |
| `ANTHROPIC_API_KEY` | 쿠팡·네이버 리뷰 요약 | 해당 요약 중단 |
| `SLACK_WEBHOOK_URL` | 수집 결과 + 파수꾼 경보 | **장애를 모르게 됨** |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | 슬랙 봇 (Socket Mode) | 봇 응답 불가 |
| `APP_URL` | Vercel 주소 | 캐시 초기화 실패 |
| `REVALIDATE_SECRET` | `/api/revalidate` 인증 | 401 (Vercel에도 동일 값 등록 필요) |
| `NAVER_CLIENT_ID` / `_SECRET` | 네이버 DataLab·쇼핑 API | 네이버 탭 공백 |

`.env.example`을 복사해 채우면 됩니다. **Vercel 환경변수는 별도**로, 대시보드에서 직접 등록합니다
(`DATABASE_URL`, `OPENAI_API_KEY`, `REVALIDATE_SECRET`, `NEXT_PUBLIC_GA_ID`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`).

---

## 2. 수집 스케줄

모든 태스크는 `scripts\*.ps1`을 부르고, 그 스크립트가 `_common.ps1`의 `Invoke-Collector`를 씁니다.
`Invoke-Collector`는 로그 기록 → 슬랙 발송 → **파수꾼 점검**까지 한 번에 처리합니다.

| 태스크 | 시각 | 스크립트 | 역할 |
|---|---|---|---|
| `OY_RankCollector` | 매시 10분 | `run_rank_collector.ps1` | 카테고리별 Top100 (변화 없으면 저장 생략) |
| `OY_ReviewCollector` | 06:00 / 16:00 | `run_review_collector.ps1` | 자사 리뷰 + 랭킹 |
| `OY_Review_Retry` | 07:10 / 17:10 | `run_review_collector.ps1` | 위 실패분 재시도 |
| `OY_PromoCollector` | 08:00 | `run_promo_collector.ps1` | 올영픽 · 오늘의 특가 |
| `OY_Promo_Retry` | 09:10 | `run_promo_collector.ps1` | 위 실패분 재시도 |
| `OY_EventDetector` | 07:00 | `run_event_detector.ps1` | 입점·이탈·순위급등 감지 |
| `OY_PriceCollector` | 02:00 | `run_price_collector.ps1` | 가격 (자사 우선, 1회 100개) |
| `OY_DailyBrief` | 09:00 | `run_daily_brief.ps1` | AI 일일 브리핑 |
| `OY_CompetitorAnalysis` | 08:00 (월) | `run_competitor_analysis.ps1` | 경쟁사 키워드 주간 분석 |
| `OY_MCPWarm` | 주기 | `ping_mcp.ps1` | MCP 콜드스타트 방지 |
| `Naver_Collector_AM/PM` | 09:00 / 21:00 | (직접 실행) | 네이버 트렌드·검색순위 |

### 아직 등록되지 않은 것

`scripts\run_sentinel.ps1`(파수꾼 **전체 스윕**)은 만들어져 있으나 태스크로 등록되지 않았습니다.
각 수집기 뒤에 붙은 단계별 점검은 동작하지만, 자사 데이터 완전성·AI 생성물 같은
**어느 수집기에도 속하지 않는 항목**은 이 스윕에서만 확인됩니다. 매일 10시쯤 등록을 권장합니다.

```powershell
$a = New-ScheduledTaskAction -Execute "powershell.exe" `
     -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\oliveyounginsight\Ollive0-CellFusionC-Review\scripts\run_sentinel.ps1"'
$t = New-ScheduledTaskTrigger -Daily -At 10:00
Register-ScheduledTask -TaskName "OY_Sentinel" -Action $a -Trigger $t -RunLevel Highest
```

---

## 3. 파수꾼 (Sentinel)

**이 시스템에서 가장 먼저 이해해야 할 부분입니다.**

수집기는 차단당하거나 페이지 구조가 바뀌어도 **0건을 받고 정상 종료(exit 0)** 합니다.
종료 코드만 보는 알림으로는 이걸 못 잡습니다. 실제로 올영픽이 **두 달간** 그렇게 죽어 있었습니다.

파수꾼은 종료 코드가 아니라 **결과 데이터**를 봅니다.

```powershell
cd C:\oliveyounginsight\Ollive0-CellFusionC-Review
venv\Scripts\python.exe -m collector.sentinel                # 전체 (17개 항목)
venv\Scripts\python.exe -m collector.sentinel olivepick      # 특정 단계만
venv\Scripts\python.exe -m collector.sentinel --no-notify    # 슬랙 발송 없이 확인만
```

점검 단계: `rank` · `olivepick` · `event` · `review` · `price` · `ours` · `ai` · `taxonomy`

### 경보가 오면

| 경보 | 먼저 볼 것 |
|---|---|
| `올영픽 오늘 수집` 미달 | 올리브영이 `dispCatNo`를 또 바꿨는지 → [아래 4-1](#4-1-올리브영이-카테고리필터-코드를-바꾼다) |
| `카테고리별 수집 끊김` | 특정 카테고리만 0건 → 필터 코드 변경. `logs\collector_rank_collector_*.log`에서 해당 카테고리 확인 |
| `올영픽 이탈 감지 신선도` | 비교 기준 달에 데이터가 있는지 확인. 공백이 있으면 이탈 계산이 죽음 |
| `가격 수집 신선도` | 차단(403) 가능성. `logs\collector_price_collector_*.log` 확인 |
| `자사 OO 누락` | 수집기가 자사를 대상에 포함하는지 → [아래 4-4](#4-4-수집기가-자사를-제외한다) |
| `미등록 빈출 포지셔닝어` | 새 트렌드 용어 등장 → `collector/taxonomy.py`에 추가 검토 |
| `일일 브리핑 신선도` | `OPENAI_API_KEY` 또는 페이지 미방문. `/api/revalidate` 호출로 강제 생성 가능 |

임계값은 **정상치의 절반** 수준으로 잡혀 있습니다(자연 변동에 의한 거짓 경보 방지).
정상인데 경보가 계속 오면 `collector/sentinel.py`의 `CHECKS`에서 `threshold`를 조정하세요.

---

## 4. 자주 깨지는 지점

> 여기 적힌 것은 전부 **실제로 발생했던** 장애입니다. 같은 유형이 반복됩니다.

### 4-1. 올리브영이 카테고리/필터 코드를 바꾼다

가장 흔합니다. 예고 없이 바뀌고, 수집기는 0건을 받고 정상 종료합니다.

**사례 1 — `dispCatNo` 형식 변경 (2026-08, 올영픽 2개월 누락)**
숫자만 있던 값에 영문 접미사가 붙었는데(`5000001000199` → `5000001000199QH`),
`promo_collector.py`의 정규식이 `\d+`라 뒷부분을 잘라먹었습니다.

```python
m = re.search(r'dispCatNo=([A-Za-z0-9]+)', urlInfo_el.get('value', ''))
```

**사례 2 — 맨즈에딧 필터 코드 변경 (2026-09, 13일 누락)**
`10000010007` → `10000060002`로 바뀌고, HTML 속성명도 `fltDispCatNo` → `data-ref-dispCatNo`로 변경.
`rank_collector.py`의 `CATEGORIES`를 수정했습니다.

**찾는 방법** — 베스트 페이지 HTML에서 탭 목록을 직접 확인합니다.

```python
r = sess.get('https://www.oliveyoung.co.kr/store/main/getBestList.do',
             params={'dispCatNo': '900000100100001'}, headers=HEADERS)
# '맨즈'·'선케어' 등 탭 이름 주변의 data-ref-dispCatNo / fltDispCatNo 값을 찾는다
```

후보 코드를 찾으면 `fltDispCatNo`로 넣어 상품이 100개 나오는지 확인한 뒤 반영합니다.
(`dispCatNo`에 직접 넣으면 0개가 나옵니다 — 파라미터 위치가 다릅니다.)

### 4-2. 스크래핑 차단 (HTTP 403 / 429)

일반 HTTP 클라이언트로는 막힙니다. `curl_cffi`로 실제 브라우저 TLS fingerprint를 재현합니다.

```python
from curl_cffi import requests as cf
sess = cf.Session(impersonate='chrome124')
```

- 요청 간격을 랜덤화하고(2~4초), 세션 워밍업(메인 페이지 1회 방문)을 먼저 합니다
- 403이 반복되면 **90초 이상 쉬었다가** 재시도합니다. 더 빠르게 두드리면 차단이 길어집니다
- 가격 수집은 1회 100개로 제한되어 있습니다. 늘리지 마세요

### 4-3. Vercel에서는 올리브영 스크래핑이 안 된다

Vercel 서버리스의 데이터센터 IP는 올리브영이 차단합니다. `fetch()`는 실패합니다.

따라서 **전성분처럼 스크래핑이 필요한 데이터는 웹에서 실시간 조회할 수 없습니다.**
로컬 수집기(`ingredient_collector.py`)가 DB에 저장하고, 웹·MCP는 **DB만 읽습니다.**
이 구조를 깨고 웹에서 직접 긁으려 하면 조용히 실패합니다.

### 4-4. 수집기가 자사를 제외한다

`ingredient_collector` · `price_collector` · `product_detail_collector`는 원래
"경쟁사 상세 수집기"로 출발해 `WHERE is_competitor = true` 필터가 있었습니다.
그 결과 **자사 46개의 용량·전성분이 0개**였고, 가격 비교가 구조적으로 불가능했습니다.

현재는 필터를 제거하고 `ORDER BY is_competitor`로 자사를 먼저 처리합니다.
새 수집기를 만들 때 이 필터를 습관적으로 넣지 마세요. 파수꾼의 `ours` 단계가 이를 감시합니다.

### 4-5. 웹 화면이 안 바뀐다

Vercel은 ISR(5분) + 온디맨드 재검증을 씁니다. 수집기가 `/api/revalidate`를 호출합니다.

- **401이 뜨면**: `middleware.ts`가 인증 없는 `/api/*`를 막습니다. `/api/revalidate`는 예외 처리되어 있고, 대신 `REVALIDATE_SECRET` 또는 로그인 세션으로 인증합니다. **Vercel 환경변수에도 같은 값이 있어야 합니다.**
- AI 인사이트는 **KST 날짜 기준으로 DB에 캐시**됩니다. 오늘 것을 다시 만들려면 해당 행을 지우세요.

```sql
DELETE FROM oliveyoung.daily_briefs    WHERE brief_date   = CURRENT_DATE;
DELETE FROM oliveyoung.market_insights WHERE insight_date = CURRENT_DATE;
DELETE FROM oliveyoung.review_insights WHERE insight_date = CURRENT_DATE;
```

### 4-6. 로컬 빌드는 DB에 붙지 않는다 (검증 착시)

`web/` 폴더에는 `.env` 계열 파일이 **없습니다.** 루트 `.env`는 파이썬 수집기용이고,
Next.js는 이를 읽지 않습니다. 따라서 로컬에서 `next build`를 돌리면:

- `DATABASE_URL`이 없어 `localhost:5432`로 접속 시도 → `AggregateError: ECONNREFUSED`
- `page.tsx`의 `safe()`가 전부 잡아내 **빈 데이터로 빌드가 성공**합니다
- 데이터가 비었으니 AI 생성도 건너뜁니다

**로컬 빌드가 통과했다고 프로덕션이 안전한 게 아닙니다.** 타입·문법 검증까지만 유효합니다.
DB가 붙은 상태로 확인하려면 `web\.env.local`에 `DATABASE_URL`과 `OPENAI_API_KEY`를 넣으세요
(이 파일은 `.gitignore` 대상인지 반드시 확인한 뒤 만드세요).

### 4-7. 홈 페이지 빌드 타임아웃 (60초)

`/`는 정적 생성 대상이고 Vercel의 페이지 export 제한은 **60초**입니다.
`page.tsx`는 DB 19개 쿼리 + AI 생성 3종을 수행하므로 여유가 많지 않습니다.

2026-10-01에 실제로 터졌습니다. AI 생성 3개가 **순차 `await`**였고 각 타임아웃이 25초라
최악 75초가 됐습니다. 평소에는 AI 결과가 KST 날짜 기준으로 DB에 캐시되어 즉시 반환되지만,
**날짜가 바뀐 직후 캐시가 비었을 때 배포하면** 세 호출이 모두 실제로 일어납니다.

현재는 `Promise.all`로 묶어 최악 20초입니다. 여기에 AI 생성을 추가할 때는
**반드시 같은 `Promise.all` 안에** 넣으세요. 순차로 붙이면 같은 방식으로 다시 터집니다.

DB 커넥션 풀은 `max: 2`입니다(서버리스 환경 고려). 쿼리를 늘리면 병렬이어도
풀에서 줄을 서므로 시간이 늘어납니다.

### 4-8. PowerShell 5.1은 BOM 없는 .ps1의 한글을 깨뜨린다

`.ps1` 파일에 한글 리터럴을 넣고 **BOM 없이** 저장하면 PS 5.1이 ANSI로 읽어
파싱 자체가 실패합니다(`The hash literal was incomplete` 같은 엉뚱한 오류가 납니다).

기존 `scripts\*.ps1`은 BOM이 있어 동작하지만, 새로 만들 때 BOM 없이 저장하면 깨집니다.
한글이 들어가는 실행 스크립트는 **파이썬으로 두는 편이 안전합니다**
(`collector/collect_sun_types.py`가 그 예입니다).

파이썬 쪽은 반대로 출력 인코딩을 먼저 잡아야 합니다.

```powershell
$env:PYTHONUTF8 = "1"; $env:PYTHONIOENCODING = "utf-8"
```

### 4-9. 단위를 혼동한다

같은 화면에 단위가 다른 값이 섞여 있습니다. 포맷 함수를 공유하면 값이 한 번 더 나눠집니다.

| 출처 | 단위 |
|---|---|
| 리뷰·순위 | 건수 |
| `products.price` | 원 |
| `price_history.price` | 원 |
| DART 공시 | 원 |

새 지표를 추가할 때 **원본 단위를 먼저 확인**하세요.

### 4-10. 한글 키워드 매칭의 함정

`collector/taxonomy.py`에서 짧은 키워드를 부분 문자열로 매칭하면 엉뚱한 데 걸립니다.
`파우더`에 `'포'`를 넣었더니 "**포**스트 알파", "아쿠아**포**린"이 잡혀 집계가 8배 부풀었습니다.

현재는 **1글자는 토큰 완전일치**를 요구하고, 한국어 복합어(`기획세트`)를 위해
2글자부터 부분매칭을 허용합니다. 키워드를 추가할 때 1~2글자는 특히 조심하세요.

### 4-11. 올리브영 상품 페이지가 React로 바뀌었다 (2026-10)

상품 상세 페이지가 React 템플릿으로 교체됐습니다. 전수 확인 결과:

| | 구형 `#tempHtml2` | 신형 React | `<a>` 탭 |
|---|---|---|---|
| 수집 성공 상품 | 있음 | 있음 | **없음** |
| 수집 실패 상품 | **없음** | 있음 | 없음 |

두 가지가 깨졌습니다.

**1) 상품설명 탭 클릭이 100% 실패하고 있었습니다.** 탭이 `<a>`에서 `button`/`li`로
바뀌었는데 `//a[contains(.,"상품설명")]`로 찾고 있었습니다. 그런데도 수집이 되길래
아무도 몰랐습니다 — `#tempHtml2`가 클릭 없이도 DOM에 들어 있었기 때문입니다.
**동작하는 것처럼 보이는 죽은 코드**였습니다.

**2) `#tempHtml2`가 아예 없는 상품이 12.7% 생겼습니다.** 그쪽은 0장으로 끝났습니다.

`collector/detail_page_collector.py`의 `fetch_image_urls()`에서 탭 셀렉터를 넓히고,
`#tempHtml2`가 없을 때 React 본문(`[class*=product-info-panel]`)에서 세로로 긴 이미지를
줍는 대체 경로를 뒀습니다. 추천 캐러셀·정사각 갤러리는 제외합니다.

대체 경로에는 **최소 장수(`FALLBACK_MIN = 5`)** 가 걸려 있습니다. 재시도해 보니 상세
내용이 없는 상품에서 배너 1~3장이 잡혔는데, 그대로 두면 `ok`로 저장돼 말뭉치가
오염됩니다. 실측상 정상 상세페이지의 최소 장수는 6장이고 5장 미만은 하나도 없었습니다.

구형 컨테이너가 사라지는 추세이므로 **실패율이 오르면 이 대체 경로부터 보세요.**
### 4-12. 비전 분석 비용이 조용히 샌다 (2026-10)

이 프로젝트에서 돈이 나가는 곳은 사실상 **상세페이지 비전 분석 한 군데**입니다.
상품 324개 = 패널 **6,979장**, 패널당 약 $0.0041, 전수 한 번에 **약 $29**입니다.
(전에 7,026장 / $0.0034 로 적혀 있었는데 둘 다 틀렸습니다 — 아래 참조.)

**이미 두 번 당한 실수 두 가지:**

1. **싼 모델로 내리면 더 비싸집니다.** `gpt-4o-mini`로 내려 같은 패널 8장을
   실측한 결과 입력 토큰이 **13.7배**(23,871 → 326,076) 늘었습니다. 세로로 긴
   패널을 잘게 타일링하기 때문입니다. 역할 분류 일치율도 66%로 떨어졌습니다.
   단가가 싸도 토큰이 13.7배면 집니다. **모델을 내려 절감하려 하지 마세요.**

2. **축을 하나 추가할 때마다 전수 재분석하면 전액을 다시 냅니다.**
   `certs` 축을 넣으면서 이미 끝난 74개를 통째로 다시 돌려 약 $5를 버렸습니다.

**그래서 들어간 장치 세 가지:**

- `detail_page_analyzer --estimate` — 돈을 쓰기 전에 예상 금액만 출력합니다.
  `estimate_panels()` 는 `build_panels()` 와 **같은 규칙**이어야 합니다. 긴 이미지의
  마지막 조각은 패널을 닫지 않고 열린 채 남아 다음 이미지를 흡수합니다. 전에 이걸
  닫힌 것으로 세어 상품 29개에서 47장을 과다 계산했습니다.
- **예산 게이트** — 예상 $1.00(`BUDGET_GATE`)을 넘으면 `--yes` 없이는 돌지 않습니다.
- **DELETE 와 INSERT 는 한 트랜잭션**입니다. `autocommit=True` 라서 전에는
  DELETE 가 즉시 확정됐고, 중간에 터지면 기존 분석이 사라진 채 남아 그 상품을
  다시 전액 주고 분석해야 했습니다.
- `detail_panels` 테이블 — 패널 **원문 응답**과 토큰 수를 보관합니다.
  `detail_sections`에는 그때 쓰기로 한 칸만 남아, 모델이 더 말해줬어도 버려집니다.
  원문이 있으면 글에서 뽑을 수 있는 축은 돈을 다시 안 내고 채웁니다.

**축을 늘릴 땐 `detail_page_axis`를 쓰세요.** 두 갈래로 갈립니다.

| 종류 | 이미지 | 13,826섹션 기준 실측 |
|---|---|---|
| `text` | 안 보냄 (40개씩 묶음) | **약 $0.52** |
| `vision` | 보냄 (역할로 패널 선별) | 약 $21.34 |
| 전수 재분석 | 전부 | 약 $28.8 |

글로 판정되는 축이면 **45배 쌉니다.** 먼저 `--estimate`로 금액을 보고,
`AXES[축]["roles"]`로 볼 패널을 좁힌 뒤에 `--yes`를 붙이세요.
기존 행은 `UPDATE`만 하고 절대 지우지 않으며, `{col} IS NULL` 인 칸만 채웁니다
(모델이 지어낸 id 가 이미 채운 값을 덮어쓰지 못하게).

**vision 축은 이미지가 바뀐 상품을 건너뜁니다.** `panel` 번호는 수집 당시의
이어붙이기 결과를 가리킵니다. 그 뒤 이미지가 늘거나 줄면 같은 번호가 다른
내용을 가리키고, 엉뚱한 그림에 붙은 라벨은 `NULL` 이 아니게 되어 **다시는
고쳐지지 않습니다.** 저장된 `scroll_pct` 와 지금 다시 계산한 위치를 비교해
`DRIFT_TOL`(0.2%p) 을 넘으면 돈 쓰기 전에 거릅니다.
### 4-13. 인증마크 필터가 진짜 마크를 지우고 있었다 (2026-10)

`detail_page_certs` 는 **노이즈 판정을 그룹 판정보다 먼저** 돌렸습니다.
그래서 노이즈 패턴이 조금만 넓으면 진짜 인증마크가 조용히 사라집니다.
실측으로 **324개 중 59개(18%)** 가 진짜 마크를 하나 이상 잃고 있었습니다.

| 패턴 | 삼켜버린 것 |
|---|---|
| `pick` | GLOWPICK 어워드 **전부** (45개 상품) |
| `추천` | `모든 피부 추천 저자극테스트 완료` — 피부 안전시험 인증입니다 |
| `^\d+시간` | `24시간 패치테스트 완료` |
| `지속력` | `24시간 톤업 지속력 인체적용시험 완료` |
| `신제품` | `hwahae awards 베스트 신제품 1위` — 어워드 **부문명**입니다 |

`GROUPS["수상·어워드"]` 에 `glowpick` 키워드가 있었지만 노이즈가 먼저
걸러서 **도달조차 못 하는 죽은 코드**였습니다.

**고친 방식 — 순서를 뒤집었습니다.** `keep()` 이 새 관문입니다.

```
어느 묶음에든 걸리면  → 마크다 (노이즈 패턴을 무시한다)
아무 데도 안 걸리면   → 그때만 노이즈 판정
```

그 결과 수상·어워드가 **104개(32%) → 108개(33%)** 로 돌아왔습니다.

**단, 뒤집으면 반대 사고가 납니다.** 묶음 키워드가 넓으면 이제 노이즈가
못 막습니다. 실제로 맨 `"올리브영"` 키워드가 `ONLY 올리브영 단독기획`
12개를 수상·어워드로 끌어왔습니다. **키워드를 추가할 땐 좁게 적으세요.**
점검 방법:

```python
# 노이즈인데 묶음이 이겨서 살아남은 이름 — 여기에 딱지류가 보이면 키워드가 넓다
[x for x in certs if is_noise(x) and group_of(x)]
```

같이 고친 충돌: `reef` 가 `12-FREE FORMULA`(norm 이 하이픈을 지워
`f|ree f|ormula` 가 됨)를, `barrier` 가 `TRIPLE BARRIER SCIENCE` 를,
`derma` 가 `BIODERMA`·`DERMAPRO` 를 잡고 있었습니다. `접근성` 묶음은
멤버 전원이 오탐이라 사라졌습니다.

---

### 4-14. 아티팩트는 jsdom 으로 전체를 띄워 보고 발행하세요 (2026-10)

생성기 스크립트는 **하나의 IIFE** 라서 어디든 한 줄이 터지면 그 아래가
전부 안 그려집니다. 실제로 payload 키를 `certs.groups` → `certs.meta` 로
바꾸면서 "주요 발견" 블록의 `CERT.groups[0]` 이 터졌고, **인증마크·문구
사전·실제 페이지가 통째로 빈 화면**으로 발행됐습니다.

블록만 떼서 돌리는 테스트는 이걸 못 잡습니다 — 터진 곳이 그 바깥이었습니다.
`scratchpad/pagetest.js` 가 빌드된 `generator.html` 을 **진짜 DOM 에 띄우고**
구역별 요소 수를 셉니다. 발행 전에 반드시 돌리세요.

```
node pagetest.js
  topline 5 · finds 5 · 인증 카드 10 · 제품군 선택지 13
  문구 사전 40줄 · 실제 페이지 4칸 → 전부 렌더됨
```

`claude` 전역은 아티팩트 런타임에만 있으므로 테스트가 가짜로 채웁니다.
그게 없으면 거기서 멈춰 **그 뒤의 진짜 오류를 못 봅니다.**
### 4-15. 상세페이지 탭은 iframe 입니다 (2026-10)

대시보드 `상세페이지` 탭의 알맹이는 React 가 아니라 **`web/public/detail/` 의
독립 페이지**이고, `DetailPageTab.tsx` 가 iframe 으로 끼웁니다.

**왜 iframe 인가.** 이 도구는 claude.ai 아티팩트에서 만들어졌고, 자체 CSS 가
`h1,h2,h3{...}`, `button,input,select,textarea{font:inherit}`, `*{box-sizing}`
같은 **엘리먼트 선택자**를 씁니다. 대시보드 안에 그대로 심으면 다른 탭의
글꼴과 여백까지 바뀝니다. iframe 이 그 경계를 공짜로 줍니다.

**자산을 만드는 법** — 발행된 아티팩트를 넷으로 가릅니다.

```
python -m collector.detail_page_webexport --src <발행본.html>

  index.html    27 KB   디자인 + 로더
  app.js        32 KB   화면 로직 (아티팩트가 만든 코드 그대로, 손대지 않음)
  data.json    623 KB   집계 결과 ← 2주 주기로 갈아끼우는 것은 이것뿐
  strips/      114개    상세페이지 썸네일 (3.05MB, 필요할 때만 받음)
```

발행본은 `아티팩트 read` 로 내려받습니다. 통짜 3.9MB 를 그대로 올리면
탭 하나가 3.9MB 가 되므로 반드시 가르세요.

**두 가지 함정.**

1. **`claude` 전역이 없습니다.** 아티팩트 안에서는 `claude.use('sample')` 로
   AI 문구를 뽑지만 대시보드엔 그 런타임이 없습니다. 그냥 두면
   `ReferenceError` 가 나고 **그 아래 스크립트가 통째로 죽습니다.**
   `index.html` 의 로더가 대역을 깝니다.
   - `sample` → `null` : AI 버튼이 스스로 숨습니다 (`body.no-ai`)
   - `downloads` → 진짜 Blob 저장 : 아티팩트와 달리 여기선 내려받기가 됩니다

   AI 문구가 필요하면 **내보내기 → Claude·GPT 프롬프트**를 복사해서 쓰세요.
   서버에 붙이면 누를 때마다 우리 돈이 나갑니다.

2. **iframe 은 높이를 스스로 못 맞춥니다.** 자식이 `postMessage` 로 높이를
   보내고 `DetailPageTab` 이 받아 늘립니다. 내용이 안 보이고 잘린다면
   그 통신부터 보세요.

**디자인을 고칠 때** — 진실의 출처는 **발행된 아티팩트**이지 로컬
`scratchpad/gen_tpl.html` 이 아닙니다. 그쪽은 옛 디자인이라 거기서 빌드하면
현재 디자인이 날아갑니다. 아티팩트를 고쳐 발행한 뒤 위 명령으로 다시 가르세요.

---



---



---



---

---

## 5. 자주 하는 작업

### 수동 수집

```powershell
cd C:\oliveyounginsight\Ollive0-CellFusionC-Review
$env:PYTHONUTF8=1; $env:PYTHONIOENCODING="utf-8"   # 한글 깨짐 방지, 항상 먼저

venv\Scripts\python.exe -m collector.rank_collector
venv\Scripts\python.exe -m collector.promo_collector
venv\Scripts\python.exe -m collector.event_detector
venv\Scripts\python.exe -m collector.price_collector
venv\Scripts\python.exe -m collector.ingredient_collector        # --force 로 전체 재수집
venv\Scripts\python.exe -m collector.product_detail_collector
```

스케줄러와 동일하게(로그 + 슬랙 + 파수꾼) 돌리려면 `.ps1`을 실행하세요.

### 로그 확인

`logs\collector_<모듈>_<YYYYMMDD>.log` — 30일 후 자동 삭제됩니다.

```powershell
Get-Content "logs\collector_rank_collector_$(Get-Date -f yyyyMMdd).log" -Tail 50
```

### 웹 배포

`master`에 푸시하면 Vercel이 자동 배포합니다.

```powershell
cd web
npx tsc --noEmit     # 타입 검사
npx next build       # 빌드 확인 후 푸시
```

### 원격 저장소 두 개

| 리모트 | 주소 | 용도 |
|---|---|---|
| `origin` | `digitallab-ops/Oliveyoung-review` | **업무용 · 인수인계** |
| `portfolio` | `lsmlub99/Ollive0-CellFusionC-Review` | 개인 포트폴리오 |

---

## 6. 주요 테이블

스키마 정의는 `db/schema.py`(올리브영), `db/coupang_schema.py`, `db/naver_schema.py`에 있습니다.

| 테이블 | 내용 | 비고 |
|---|---|---|
| `market_rankings` | 카테고리별 Top100 시계열 | 가장 큼(200만+). 변화 있을 때만 저장 |
| `reviews` | 자사·경쟁사 리뷰 | `review_id` UNIQUE |
| `products` | 상품 마스터 | `is_competitor`로 자사/경쟁사 구분 |
| `promo_items` | 올영픽 · 오늘의 특가 | `promo_type`으로 구분 |
| `brand_events` | 입점·이탈·순위급등 감지 | `rank_jump`가 대부분(하루 100~400건) |
| `price_history` | 가격 이력 | 용량당 단가·변동 감지의 원천 |
| `competitor_insights` | 경쟁사 키워드 주간 분석 | 매주 월요일 갱신 |
| `daily_briefs` / `market_insights` / `review_insights` | AI 생성물 | KST 날짜 기준 캐시 |

### 알아둘 점

- **스키마가 `public`이 아니라 `oliveyoung`입니다.** 쿼리 시 `search_path` 또는 스키마 명시 필요
- `brand_events`의 `rank_jump`는 임계값 15위라 하루 100~400건 나옵니다. 화면에 그대로 흘리면 노이즈입니다. 줄이려면 `event_detector.py`의 `RANK_JUMP_THRESHOLD`를 올리세요

---

## 7. 알려진 미해결 사항

| 항목 | 상태 |
|---|---|
| 파수꾼 전체 스윕 스케줄 미등록 | [2장](#아직-등록되지-않은-것)의 명령으로 등록 필요 |
| `rank_jump` 노이즈 | 임계값 15위 → 상향 검토 |
| 2026-08 올영픽 데이터 공백 | 복구 불가. 당시 페이지가 이미 교체됨 |
| 자사 가격 8개 · 전성분 11개 누락 | 연고·파우더 등 전성분 표기가 없는 품목 포함 |
| 시즌 추세 화면 | 분류 체계(`taxonomy.py`)는 완료, 화면 미구현 |
| 성분 비교 화면 | 데이터 확보 완료(자사 35 · 경쟁사 1,725), 화면 미구현 |
| 데이터 보존 기간 | 2026-05-18부터. 전년 동기 비교는 2027년부터 가능 |

---

<div align="center">
<sub>문서 기준일 2026-10-01 · 변경 시 이 문서도 함께 갱신해 주세요</sub>
</div>
