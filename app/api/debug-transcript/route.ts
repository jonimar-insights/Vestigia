import { NextResponse } from "next/server";
import { fetchTranscriptWithFallback, fetchYouTubeTranscript } from "@/lib/transcript";

export const runtime = "nodejs";

export async function GET() {
  const youtubeId = "GtOGurrUPmQ";
  const results: Record<string, unknown> = {};

  try {
    const yt = await fetchYouTubeTranscript(youtubeId);
    results.youtubeTranscript = yt
      ? { ok: true, segments: yt.segments.length, source: yt.source }
      : { ok: false, error: "returned null" };
  } catch (e: unknown) {
    results.youtubeTranscript = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results);
}
