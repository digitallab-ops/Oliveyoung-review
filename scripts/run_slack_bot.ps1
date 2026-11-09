# 슬랙 봇 상시 실행용.
#
# 봇은 소켓 모드라 한 번 띄우면 계속 떠 있어야 한다. 그런데 예약 작업에
# 안 걸려 있어서 2026-07-08 에 수동으로 띄운 프로세스가 그대로 돌고 있었고,
# 서버가 재부팅되면 아무도 모르게 죽어 있을 상태였다.
#
# 부팅 시 + 10분마다 실행한다. 이미 떠 있으면 아무것도 하지 않으므로
# 중복 실행이 생기지 않는다(소켓 모드는 중복 연결하면 메시지가 갈린다).
$REPO = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
$LOG  = "$REPO\logs\slackbot.log"

$running = Get-CimInstance Win32_Process -Filter "Name like '%python%'" |
    Where-Object { $_.CommandLine -like "*bot.py*" }
if ($running) {
    Write-Host "이미 실행 중 (PID $($running.ProcessId -join ', ')) — 그대로 둔다"
    exit 0
}

if (-not (Test-Path "$REPO\logs")) { New-Item -ItemType Directory -Path "$REPO\logs" | Out-Null }

Write-Host "슬랙 봇 시작"
Start-Process -FilePath "$REPOenv\Scripts\python.exe" `
    -ArgumentList "slack-bot/bot.py" `
    -WorkingDirectory $REPO `
    -RedirectStandardOutput $LOG `
    -RedirectStandardError "$LOG.err" `
    -WindowStyle Hidden

Start-Sleep -Seconds 10
$ok = Get-CimInstance Win32_Process -Filter "Name like '%python%'" |
    Where-Object { $_.CommandLine -like "*bot.py*" }
if ($ok) { Write-Host "기동 확인 (PID $($ok.ProcessId -join ', '))"; exit 0 }
Write-Host "기동 실패 — $LOG.err 확인"
exit 1
