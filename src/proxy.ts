import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next.js 16 renamed the middleware file convention to proxy.
// See node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md

const SESSION_HINT_COOKIE = "mp_auth_hint";

const PUBLIC_PATHS = new Set(["/login", "/terms", "/privacy"]);

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/attendance/kiosk")) return true;
  return pathname.startsWith("/auth/");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionHint = Boolean(request.cookies.get(SESSION_HINT_COOKIE)?.value);

  if (!isPublicPath(pathname) && !hasSessionHint) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && hasSessionHint) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip API routes (they enforce their own auth), Next internals, and any
  // file with an extension (public assets such as /logo.png, /models/*, /favicon.ico).
  matcher: ["/((?!api|_next|.*\\..*).*)"]
};
