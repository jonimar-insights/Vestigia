import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID ? `${process.env.AUTH_GOOGLE_ID.slice(0, 10)}...` : "MISSING",
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET ? "SET" : "MISSING",
    AUTH_SECRET: process.env.AUTH_SECRET ? "SET" : "MISSING",
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || "MISSING",
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? "SET" : "MISSING",
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? "SET" : "MISSING",
  });
}
