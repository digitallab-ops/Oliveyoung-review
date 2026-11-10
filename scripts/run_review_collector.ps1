$REPO = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
$LOG_DIR = "$REPO\logs"
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }
$transcript = "$LOG_DIR\run_review_collector_$(Get-Date -Format 'yyyyMMdd_HHmmss').transcript"
Start-Transcript -Path $transcript -Append -Force | Out-Null
try {
    . "$REPO\scripts\_common.ps1"
    # timeoutMin 은 원래 받기만 하고 쓰이지 않아서, 40분 걸려도 그냥 돌았다.
    # 실제로 적용되게 고친 뒤 30분이 정상 실행(23~36분)을 자르기 시작했다.
    # 평소보다 확실히 오래 걸릴 때만 끊기도록 여유를 둔다.
    # 작업 자체의 제한은 45분(OY_ReviewCollector)이라 그 안에 들어가야 한다 —
    # 뒤의 순위 수집까지 포함해 36+5 = 41분.
    Invoke-Collector -module "collector.pipeline"       -label "Pipeline"      -timeoutMin 36 -sentinelStage "review"
    Invoke-Collector -module "collector.rank_collector" -label "RankCollector" -timeoutMin 5  -sentinelStage "rank"
} catch {
    Write-Host "FATAL: $_"
    $global:OY_FAILED = [int]$global:OY_FAILED + 1
} finally {
    Stop-Transcript | Out-Null
}

# powershell -File 은 exit 를 안 쓰면 무조건 0 을 돌려준다.
# 그래서 수집기가 죽어도 작업 스케줄러에는 0x0(성공)으로 남았다.
# 실패가 있으면 비0 으로 끝내야 스케줄러·외부 감시가 장애를 본다.
if ([int]$global:OY_FAILED -gt 0) { exit 1 }
exit 0
