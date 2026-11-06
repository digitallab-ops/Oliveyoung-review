$REPO = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
$LOG_DIR = "$REPO\logs"
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }
$transcript = "$LOG_DIR\run_spool_$(Get-Date -Format 'yyyyMMdd_HHmmss').transcript"
Start-Transcript -Path $transcript -Append -Force | Out-Null

# DB 가 죽어 있는 동안 순위·프로모션을 로컬에 쌓는다.
# 순위는 시계열이라 그 시각을 놓치면 영영 못 받는다. DB 복구를 기다리는
# 동안에도 구멍이 안 생기게 하려는 것이다.
# DB 가 돌아오면: python -m collector.spool flush 로 밀어 넣고 이 작업은 끈다.
try {
    . "$REPO\scripts\_common.ps1"
    Invoke-Collector -module "collector.spool" -label "로컬 보관 수집" -timeoutMin 25 -extraArgs "collect"
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
