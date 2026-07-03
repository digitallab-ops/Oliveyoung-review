$REPO    = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
$PYTHON  = "$REPO\venv\Scripts\python.exe"
$LOG_DIR = "$REPO\logs"

$env:PYTHONUTF8       = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-Webhook {
    $line = Get-Content "$REPO\.env" -Encoding UTF8 |
            Where-Object { $_ -match "^SWIT_WEBHOOK_URL\s*=" } |
            Select-Object -First 1
    if ($line) { return ($line -split "=", 2)[1].Trim() }
    return ""
}

function Send-Swit([string]$text) {
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

function Invoke-Collector([string]$module, [string]$label, [int]$timeoutMin = 20, [string]$extraArgs = "") {
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
        Send-Swit "❌❌❌ [OY] $label 실패❌❌❌`n$end`n$errLine"
    } else {
        "[$end] OK" | Out-File -Append -Encoding UTF8 $logFile
        $summary = Get-Summary $outLines
        Send-Swit "[OY] OK  $label 완료 | $end`n$('=' * 20)`n$summary"
    }

    Get-ChildItem $LOG_DIR -Filter "*.log" |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
        Remove-Item -Force
}
