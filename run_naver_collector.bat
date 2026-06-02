@echo off
chcp 65001 > nul
cd /d "c:\oliveyounginsight\Ollive0-CellFusionC-Review"

set PYTHONIOENCODING=utf-8
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set DT=%%I
set LOG_FILE=logs\naver_collector_%DT:~0,8%.txt
if not exist logs mkdir logs

echo [%date% %time%] naver collector start >> %LOG_FILE%
"c:\oliveyounginsight\Ollive0-CellFusionC-Review\venv\Scripts\python.exe" -u -m collector.naver_collector >> %LOG_FILE% 2>&1
echo [%date% %time%] naver collector done >> %LOG_FILE%
