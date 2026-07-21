import { NextResponse, NextRequest } from "next/server";
import { Auth } from "@auth/core";
import Google from "next-auth/providers/google";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const signInUrl = new URL("/api/auth/signin/google", request.url);
  const processedReq = new NextRequest(signInUrl.toString(), {
    method: "GET",
    headers: new Headers({
      host: request.nextUrl.host,
      cookie: request.headers.get("cookie") || "",
    }),
  });

  const config: any = {
    providers: [
      Google({
        clientId: process.env.AUTH_GOOGLE_ID!,
        clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      }),
    ],
    secret: process.env.AUTH_SECRET,
    trustHost: true,
    session: { strategy: "jwt" as const },
    pages: { signIn: "/signin" },
    basePath: "/api/auth",
    logger: {
      error(error: any) {
        console.error("[AUTH DEBUG ERROR]", error.name, error.message, error.stack?.substring(0, 1000));
      },
      debug(code: any, metadata: any) {
        console.log("[AUTH DEBUG]", code, JSON.stringify(metadata)?.substring(0, 500));
      },
    },
  };

  try {
    const response: any = await Auth(processedReq, config);
    const headers: Record<string, string> = {};
    if (response?.headers?.forEach) {
      response.headers.forEach((v: any, k: any) => { headers[k] = v; });
    }
    return NextResponse.json({
      status: response?.status,
      location: headers.location || response?.headers?.get?.("Location"),
      redirect: response?.redirect,
      url: response?.url,
    });
  } catch (e: any) {
    return NextResponse.json({
      error: e.message,
      name: e.name,
      stack: e.stack?.substring(0, 3000),
    }, { status: 500 });
  }
}
