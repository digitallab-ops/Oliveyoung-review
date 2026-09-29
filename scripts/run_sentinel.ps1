$REPO = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
$LOG_DIR = "$REPO\logs"
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }
$transcript = "$LOG_DIR\run_sentinel_$(Get-Date -Format 'yyyyMMdd_HHmmss').transcript"
Start-Transcript -Path $transcript -Append -Force | Out-Null
try {
    . "$REPO\scripts\_common.ps1"
    # 전체 스윕 — 각 수집기에 붙은 단계별 점검이 놓치는 항목(자사 완전성, AI 생성물)까지 확인
    Invoke-Collector -module "collector.sentinel" -label "Sentinel" -timeoutMin 5
} catch {
    Write-Host "FATAL: $_"
} finally {
    Stop-Transcript | Out-Null
}
