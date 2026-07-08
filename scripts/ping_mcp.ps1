# Vercel MCP 서버 warm-up ping
# OY_MCPWarm 태스크에서 5분마다 실행
$endpoints = @(
    "https://oliveyoung-review.vercel.app/api/mcp",
    "https://oliveyoung-review.vercel.app/"
)
foreach ($url in $endpoints) {
    try {
        Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop | Out-Null
    } catch {
        # cold start 중 오류는 정상 — 다음 요청은 warm 상태
    }
}
