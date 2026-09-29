$REPO    = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
$PYTHON  = "$REPO\venv\Scripts\python.exe"
$LOG_DIR = "$REPO\logs"

$env:PYTHONUTF8       = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-Webhook {
    $line = Get-Content "$REPO\.env" -Encoding UTF8 |
            Where-Object { $_ -match "^SLACK_WEBHOOK_URL\s*=" } |
            Select-Object -First 1
    if ($line) { return ($line -split "=", 2)[1].Trim() }
    return ""
}

function Send-Slack([string]$text) {
    $url = Get-Webhook
    if (-not $url) { return }
    try {
        $body = [System.Text.Encoding]::UTF8.GetBytes(
            (ConvertTo-Json @{ text = $text } -Compress)
        )
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Method      = "POST"
        $req.ContentType = "application/json; charset=utf-8"
        $req.Timeout     = 10000
        $stream = $req.GetRequestStream()
        $stream.Write($body, 0, $body.Length)
        $stream.Close()
        $req.GetResponse().Close()
    } catch {}
}

function Get-Summary([string[]]$lines) {
    $result = $lines | Where-Object {
        $_ -match '자사 상품|자사 미입점|자사 입점|총\s+\d+|신규\s*\d+|완료 -|스냅샷|기존\s+\d+|경쟁사 시딩'
    } | Where-Object {
        $_ -notmatch '^\s+\(\d+/\d+\)' -and $_ -notmatch 'Top 100 없음'
    } | ForEach-Object {
        $line = $_.Trim()
        # 자사 순위 상세 줄은 앞부분만 (80자 초과 시 잘라냄)
        if ($line.Length -gt 80) { $line = $line.Substring(0, 77) + "..." }
        "  " + $line
    } | Select-Object -First 6
    return ($result -join "`n")
}

# 파수꾼 — 수집기가 exit 0으로 끝나도 결과 데이터가 비었는지 확인한다.
# 올영픽이 2026-08~09 두 달간 "성공적으로 0건 수집"하며 조용히 죽었던 사례 때문.
function Invoke-Sentinel([string]$stage, [string]$logFile) {
    if (-not $stage) { return }
    Push-Location $REPO
    try {
        $out = & $PYTHON -m collector.sentinel $stage --quiet
        "[SENTINEL:$stage]" | Out-File -Append -Encoding UTF8 $logFile
        $out | Out-File -Append -Encoding UTF8 $logFile
    } catch {
        "[SENTINEL:$stage] 점검 실패: $_" | Out-File -Append -Encoding UTF8 $logFile
    } finally {
        Pop-Location
    }
}

function Invoke-Collector([string]$module, [string]$label, [int]$timeoutMin = 20, [string]$extraArgs = "", [string]$sentinelStage = "") {
    if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }

    $dateStr = Get-Date -Format "yyyyMMdd"
    $logFile = "$LOG_DIR\$($module.Replace('.','_'))_${dateStr}.log"
    $stamp   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    "[$stamp] ===== START: $label =====" | Out-File -Append -Encoding UTF8 $logFile

    $stdout = "$LOG_DIR\_stdout.tmp"
    $stderr = "$LOG_DIR\_stderr.tmp"

    $argList = "-m $module"
    if ($extraArgs) { $argList = "$argList $extraArgs" }
    $proc = Start-Process -FilePath $PYTHON `
        -ArgumentList $argList `
        -WorkingDirectory $REPO `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError  $stderr `
        -NoNewWindow -PassThru -Wait

    $outLines = @()
    if (Test-Path $stdout) {
        $outLines = Get-Content $stdout -Encoding UTF8
        $outLines | Out-File -Append -Encoding UTF8 $logFile
        Remove-Item $stdout -Force
    }
    if (Test-Path $stderr) {
        $errText = (Get-Content $stderr -Encoding UTF8 -Raw)
        if ($errText -and $errText.Trim()) {
            "[STDERR]" | Out-File -Append -Encoding UTF8 $logFile
            $errText   | Out-File -Append -Encoding UTF8 $logFile
        }
        Remove-Item $stderr -Force
    }

    $end  = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $code = $proc.ExitCode

    if ($code -ne 0) {
        "[$end] FAILED (exit=$code)" | Out-File -Append -Encoding UTF8 $logFile
        $errLine = (Get-Content $logFile -Encoding UTF8) |
            Where-Object { $_ -match 'Error:|Exception:|FAILED' -and $_ -notmatch '^\s+File ' } |
            Select-Object -Last 1
        Send-Slack "❌❌❌ [OY] $label 실패❌❌❌`n$end`n$errLine"
    } else {
        "[$end] OK" | Out-File -Append -Encoding UTF8 $logFile
        $summary = Get-Summary $outLines
        Send-Slack "[OY] OK  $label 완료 | $end`n$('=' * 20)`n$summary"

        # exit 0이어도 데이터가 비었을 수 있다 — 파수꾼이 결과를 검증하고 이상 시 자체 알림
        Invoke-Sentinel $sentinelStage $logFile
    }

    Get-ChildItem $LOG_DIR -Filter "*.log" |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
        Remove-Item -Force
}
