$REPO = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
$LOG_DIR = "$REPO\logs"
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }
$transcript = "$LOG_DIR\run_price_collector_$(Get-Date -Format 'yyyyMMdd_HHmmss').transcript"
Start-Transcript -Path $transcript -Append -Force | Out-Null
try {
    . "$REPO\scripts\_common.ps1"
    Invoke-Collector -module "collector.price_collector" -label "PriceCollector" -timeoutMin 90 -sentinelStage "price"
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
