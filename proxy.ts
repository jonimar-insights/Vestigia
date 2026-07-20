import { NextRequest } from "next/server";

const PUBLIC_FILE = /\.[\w]+$/;

export function proxy(request: NextRequest) {
  if (PUBLIC_FILE.test(request.nextUrl.pathname)) return;

  const session = request.cookies.get("authjs.session-token")
    ?? request.cookies.get("__Secure-authjs.session-token");

  if (!session && request.nextUrl.pathname !== "/signin") {
    const signInUrl = new URL("/signin", request.nextUrl.origin);
    return Response.redirect(signInUrl);
  }

  if (session && request.nextUrl.pathname === "/signin") {
    return Response.redirect(new URL("/", request.nextUrl.origin));
  }
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
