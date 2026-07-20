import { NextResponse } from "next/server";

export const runtime = "nodejs";

const INNERTUBE_API_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

export async function GET() {
  const youtubeId = "GtOGurrUPmQ";
  const results: Record<string, unknown> = {};

  // Test 1: InnerTube API with WEB client
  try {
    const resp = await fetch(INNERTUBE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: "2.20241001.00.00" } },
        videoId: youtubeId,
      }),
    });
    const data = await resp.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    results.webClient = { status: resp.status, trackCount: Array.isArray(tracks) ? tracks.length : 0 };
    if (tracks?.[0]) {
      results.firstTrack = { lang: tracks[0].languageCode, url: tracks[0].baseUrl?.slice(0, 80) };
      const trackResp = await fetch(tracks[0].baseUrl);
      if (trackResp.ok) {
        const xml = await trackResp.text();
        results.xmlLength = xml.length;
        const matches = xml.match(/<text start="[^"]*" dur="[^"]*">[^<]*<\/text>/g);
        results.segmentCount = matches?.length ?? 0;
        results.xmlSample = xml.slice(0, 200);
      }
    }
  } catch (e: unknown) {
    results.webClient = { error: e instanceof Error ? e.message : String(e) };
  }

  // Test 2: library
  try {
    const { fetchTranscript } = await import("youtube-transcript");
    const r = await fetchTranscript(youtubeId);
    results.library = { ok: true, segments: r.length };
  } catch (e: unknown) {
    results.library = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results);
}
