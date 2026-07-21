import { NextResponse } from "next/server";
import { getProviderStatus } from "@/lib/ai";

export const runtime = "nodejs";

export async function GET() {
  const status = getProviderStatus();
  return NextResponse.json({ providers: status });
}
