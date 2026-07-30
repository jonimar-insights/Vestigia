import { auth } from "@/auth";
import { NextResponse } from "next/server";

const handler = auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  const isPublic =
    nextUrl.pathname.startsWith("/shared/") ||
    nextUrl.pathname.startsWith("/api/shared/") ||
    nextUrl.pathname === "/signin" ||
    nextUrl.pathname.startsWith("/api/auth/");

  if (isPublic) return NextResponse.next();
  if (!isLoggedIn) return NextResponse.redirect(new URL("/signin", nextUrl));
  return NextResponse.next();
});

export default handler;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
