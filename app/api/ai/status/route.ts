import { NextResponse } from "next/server";
import { getProviderStatus } from "@/lib/ai";
import { auth } from "@/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = getProviderStatus();
  return NextResponse.json({ providers: status });
}
