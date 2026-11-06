$REPO = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
$LOG_DIR = "$REPO\logs"
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }
$transcript = "$LOG_DIR\run_daily_brief_$(Get-Date -Format 'yyyyMMdd_HHmmss').transcript"
Start-Transcript -Path $transcript -Append -Force | Out-Null
try {
    # 이 스크립트는 원래 .env 를 직접 파싱하고 python 만 실행했다. 로그도, 슬랙도,
    # 종료 코드도 없어서 실패하면 아무 흔적이 남지 않았다(logs\ 에 기록 자체가 없었다).
    # 파이썬 쪽이 load_dotenv() 를 하므로 수동 파싱은 필요 없다.
    . "$REPO\scripts\_common.ps1"
    Invoke-Collector -module "collector.daily_brief_generator" -label "DailyBrief" -timeoutMin 4
} catch {
    Write-Host "FATAL: $_"
    $global:OY_FAILED = [int]$global:OY_FAILED + 1
} finally {
    Stop-Transcript | Out-Null
}

# powershell -File 은 exit 를 안 쓰면 무조건 0 을 돌려준다.
if ([int]$global:OY_FAILED -gt 0) { exit 1 }
exit 0
