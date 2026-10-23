$REPO = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
$LOG_DIR = "$REPO\logs"
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }
$transcript = "$LOG_DIR\run_detail_biweekly_$(Get-Date -Format 'yyyyMMdd_HHmmss').transcript"
Start-Transcript -Path $transcript -Append -Force | Out-Null

# 상세페이지 분석 2주 주기.
#
# 왜 2주인가: 상세페이지는 랭킹처럼 매일 바뀌지 않는다. 신규 상품이 쌓일
# 시간을 주고, 비전 호출(이 파이프라인의 유일한 큰 지출)을 아낀다.
#
# 비용: 신규 상품만 돌린다. 상품당 패널 약 22장 x $0.0041 = 약 $0.09.
# 사람이 --yes 를 눌러줄 수 없으므로 -maxCost 로 상한을 건다. 평소 신규분은
# 몇 달러면 끝나므로 상한을 넘으면 뭔가 잘못된 것이다(스키마 표식 초기화 등).
$maxCost = 5.0

try {
    . "$REPO\scripts\_common.ps1"

    # 1. 신규 상품의 상세 이미지 수집 (이미 받은 것은 건너뛴다)
    #
    # 랭킹 카테고리 8개 중 콘텐츠를 비교할 만한 5개만 돈다. '전체'는 다른
    # 카테고리와 겹치고, 맨즈에딧·바디케어는 상세페이지 문법이 달라 같은
    # 표본에 섞으면 통계가 흐려진다. 늘리려면 여기에 줄을 더하면 된다.
    $cats = @("선케어", "더모 코스메틱", "마스크팩", "스킨케어", "클렌징")
    foreach ($cat in $cats) {
        Invoke-Collector -module "collector.detail_page_collector" `
                         -label "상세 수집: $cat" -timeoutMin 60 `
                         -extraArgs "--category `"$cat`" --top 50"
    }

    # 2. 분석 — 현재 스키마로 아직 분석되지 않은 것만. 상한 초과면 스스로 멈춘다.
    Invoke-Collector -module "collector.detail_page_analyzer" `
                     -label "상세페이지 분석" -timeoutMin 180 `
                     -extraArgs "--all --max-cost $maxCost"

    # 3. 대시보드 탭 데이터 재생성 (data.json + strips/). 비용 0.
    Invoke-Collector -module "collector.detail_page_webdata" `
                     -label "탭 데이터 생성" -timeoutMin 30

    # 4. 분류 목록이 낡았는지 확인 — 새 상품이 들어오면 새 인증마크·소구어가 따라온다
    Invoke-Collector -module "collector.detail_page_certs" `
                     -label "미분류 인증마크" -timeoutMin 10 -extraArgs "--new"

    # web/public/detail/ 이 바뀌었으면 사람이 커밋해야 배포된다.
    # 자동 커밋/푸시는 하지 않는다 — 운영 레포에 무인 푸시를 넣고 싶지 않다.
    $changed = & git -C $REPO status --porcelain -- web/public/detail 2>$null
    if ($changed) {
        $n = ($changed | Measure-Object -Line).Lines
        Send-Slack "상세페이지 2주 주기 완료 — web/public/detail 에 변경 $n건.`n배포하려면 커밋/푸시가 필요합니다."
    } else {
        Send-Slack "상세페이지 2주 주기 완료 — 변경 없음(신규 상품 없음)."
    }
} catch {
    Write-Host "FATAL: $_"
    Send-Slack "상세페이지 2주 주기 실패: $_"
} finally {
    Stop-Transcript | Out-Null
}
