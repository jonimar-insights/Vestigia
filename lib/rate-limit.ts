import { NextRequest, NextResponse } from "next/server";

// In-memory sliding-window rate limiter for public /api/shared/* endpoints.
// Defense-in-depth against abuse of a leaked share token. On serverless the
// buckets are per-instance, but this still meaningfully throttles naive spam.

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;

export function checkLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) buckets.clear();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return true; // limited
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

export function rateLimit(
  request: NextRequest,
  opts: { max: number; windowMs: number } = { max: 60, windowMs: 60_000 }
): NextResponse | null {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const path = new URL(request.url).pathname;
  if (checkLimit(`${ip}|${path}`, opts.max, opts.windowMs)) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(opts.windowMs / 1000)) },
      }
    );
  }
  return null;
}
