$REPO    = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
$PYTHON  = "$REPO\venv\Scripts\python.exe"
$LOG_DIR = "$REPO\logs"

$env:PYTHONUTF8       = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 이번 실행에서 실패한 수집기 수. Invoke-Collector 가 올리고, 스크립트 끝의
# Exit-Collector 가 이 값을 종료 코드로 바꾼다.
#
# 왜 필요한가: powershell -File 은 스크립트가 exit 하지 않으면 무조건 0 을 돌려준다.
# 그래서 수집기가 traceback 으로 죽어도 작업 스케줄러에는 0x0(성공)으로 남았다.
# 2026-11-03 에 FAILED 가 23 건이었는데 기록은 전부 성공이었다.
$global:OY_FAILED = 0

function Exit-Collector {
    if ($global:OY_FAILED -gt 0) {
        Write-Host "[EXIT] 실패 $($global:OY_FAILED)건 — exit 1"
        exit 1
    }
    exit 0
}

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

    # 임시 파일 이름이 고정이면 동시에 도는 수집기들이 같은 파일을 쓰고 서로 지운다.
    # 02:10 의 Rank 가 02:00 의 Price 와 겹쳐 로그가 섞이고 "다른 프로세스가 사용 중"
    # 오류가 실제로 났다. 모듈명과 PID 로 분리한다.
    $slug   = $module.Replace('.', '_')
    $stdout = "$LOG_DIR\_stdout_${slug}_$PID.tmp"
    $stderr = "$LOG_DIR\_stderr_${slug}_$PID.tmp"

    $argList = "-m $module"
    if ($extraArgs) { $argList = "$argList $extraArgs" }
    $proc = Start-Process -FilePath $PYTHON `
        -ArgumentList $argList `
        -WorkingDirectory $REPO `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError  $stderr `
        -NoNewWindow -PassThru

    # .NET 은 Handle 을 한 번 잡아 둬야 종료 후에도 ExitCode 를 돌려준다.
    $null = $proc.Handle

    # -Wait 는 무기한 대기라 timeoutMin 이 그동안 죽은 인자였다. 멈춘 수집기를
    # 끊지 못해 작업 스케줄러 한도로 조용히 사라졌다.
    $timedOut = $false
    if (-not $proc.WaitForExit($timeoutMin * 60 * 1000)) {
        $timedOut = $true
        "[TIMEOUT] ${timeoutMin}분 초과 — 프로세스 트리를 종료한다" |
            Out-File -Append -Encoding UTF8 $logFile
        & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null
        $proc.WaitForExit(10000) | Out-Null
    }

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
    if ($timedOut) { $code = 124 }   # 강제 종료된 프로세스의 코드는 믿을 수 없다

    if ($code -ne 0) {
        $global:OY_FAILED++
        if ($timedOut) {
            Send-Slack "❌❌❌ [OY] $label 시간 초과❌❌❌`n$end`n${timeoutMin}분을 넘겨 강제 종료했다"
            "[$end] FAILED (timeout ${timeoutMin}m)" | Out-File -Append -Encoding UTF8 $logFile
            return
        }
        "[$end] FAILED (exit=$code)" | Out-File -Append -Encoding UTF8 $logFile
        $logLines = Get-Content $logFile -Encoding UTF8
        # 파수꾼은 '어느 점검이' 깨졌는지가 전부다. 실패 항목을 그대로 보낸다.
        # 이게 없으면 슬랙에는 'FAILED (exit=1)'만 가고 로그를 열어야 알 수 있다.
        $failed = $logLines | Where-Object { $_ -match '^\s*❌' } | Select-Object -First 5
        if ($failed) {
            $errLine = ($failed | ForEach-Object { $_.Trim() }) -join "`n"
        } else {
            $errLine = $logLines |
                Where-Object { $_ -match 'Error:|Exception:|FAILED' -and $_ -notmatch '^\s+File ' } |
                Select-Object -Last 1
        }
        Send-Slack "❌❌❌ [OY] $label 실패❌❌❌`n$end`n$errLine"
    } else {
        "[$end] OK" | Out-File -Append -Encoding UTF8 $logFile
        $summary = Get-Summary $outLines
        Send-Slack "[OY] OK  $label 완료 | $end`n$('=' * 20)`n$summary"

        # exit 0이어도 데이터가 비었을 수 있다 — 파수꾼이 결과를 검증하고 이상 시 자체 알림
        Invoke-Sentinel $sentinelStage $logFile
    }

    # *.log 만 지우고 있어서 .transcript 5,200여 개와 .txt 600여 개가 한 번도
    # 정리되지 않았다. 대부분은 800바이트짜리 빈 껍데기다.
    # 삭제 실패(사용 중 등)로 수집기 전체가 죽지 않도록 오류는 무시한다.
    # 경로 끝에 \* 가 없으면 -Include 는 아무것도 못 잡는다(조용히 0건).
    Get-ChildItem "$LOG_DIR\*" -Include "*.log", "*.txt", "*.transcript" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
        Remove-Item -Force -ErrorAction SilentlyContinue

    # 비정상 종료로 남은 임시 파일 (하루 지난 것만)
    Get-ChildItem $LOG_DIR -Filter "_std*.tmp" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}
