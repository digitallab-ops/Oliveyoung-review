$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$root = "C:\oliveyounginsight\Ollive0-CellFusionC-Review"
Set-Location $root
Get-Content "$root\.env" | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim())
    }
}
& "$root\venv\Scripts\python.exe" -m collector.daily_brief_generator
