import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  // 인증 불필요: NextAuth 라우트, MCP 엔드포인트
  if (pathname.startsWith("/api/auth") || pathname.startsWith("/api/mcp")) {
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"],
}
