import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";
import { isAppPath } from "@/lib/nav";

export function proxy(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    const nextPath = pathname.replace(/^\/dashboard/, "") || "/constructor";
    return NextResponse.redirect(new URL(nextPath, request.url));
  }

  if (isAppPath(pathname) && !session) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if ((pathname === "/" || pathname === "/login") && session) {
    return NextResponse.redirect(new URL("/constructor", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/dashboard",
    "/dashboard/:path*",
    "/constructor",
    "/constructor/:path*",
    "/queue",
    "/queue/:path*",
    "/users",
    "/users/:path*",
    "/stats",
    "/stats/:path*",
    "/templates",
    "/templates/:path*",
    "/settings",
    "/settings/:path*",
    "/profile",
    "/profile/:path*",
  ],
};
