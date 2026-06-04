@echo off
chcp 65001 > nul
cd /d "c:\oliveyounginsight\Ollive0-CellFusionC-Review"

set PYTHONIOENCODING=utf-8
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set DT=%%I
set LOG_FILE=logs\coupang_rank_%DT:~0,8%.txt
if not exist logs mkdir logs

echo [%date% %time%] coupang rank start >> %LOG_FILE%
"C:\Program Files\Python312\python.exe" -u -m collector.coupang_rank >> %LOG_FILE% 2>&1
echo [%date% %time%] coupang rank done >> %LOG_FILE%
