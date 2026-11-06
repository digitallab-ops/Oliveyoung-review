import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  // 인증 불필요: NextAuth 라우트, MCP 엔드포인트, 캐시 revalidate
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/mcp") ||
    pathname.startsWith("/api/revalidate")
  ) {
    return NextResponse.next()
  }

  if (!isLoggedIn) {
    if (pathname.startsWith("/api/")) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (pathname !== "/login") {
      return NextResponse.redirect(new URL("/login", req.nextUrl))
    }
  }

  if (isLoggedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.nextUrl))
  }

  return NextResponse.next()
})

// manifest.webmanifest 와 sw.js 를 뺀 이유:
//   <link rel="manifest"> 는 기본적으로 쿠키 없이 요청된다. 그래서 미들웨어가
//   로그인 안 된 요청으로 보고 /login HTML 로 307 리다이렉트했고, 브라우저는
//   그 HTML 을 JSON 으로 파싱하다 "Manifest: Line 1 syntax error" 를 냈다.
//   둘 다 공개 정적 파일이라 인증을 걸 이유가 없다.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico$|manifest\\.webmanifest$|sw\\.js$|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)",
  ],
}
