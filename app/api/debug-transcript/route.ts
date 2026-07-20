import { NextResponse } from "next/server";

export const runtime = "nodejs";

const YT_API_KEY = process.env.YOUTUBE_API_KEY || "";

export async function GET() {
  const youtubeId = "GtOGurrUPmQ";
  const results: Record<string, unknown> = {};
  results.apiKeySet = !!YT_API_KEY;

  // Method 1: YouTube Data API v3 - captions.list
  if (YT_API_KEY) {
    try {
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/captions?videoId=${youtubeId}&part=snippet&key=${YT_API_KEY}`
      );
      const data = await resp.json();
      results.captionsList = { status: resp.status, items: data.items?.length ?? 0, error: data.error?.message ?? null };
      if (data.items?.length > 0) {
        results.captionItems = data.items.map((c: Record<string, unknown>) => ({
          id: c.id,
          language: (c.snippet as Record<string, unknown>)?.language,
        }));
      }
    } catch (e: unknown) {
      results.captionsList = { error: e instanceof Error ? e.message : String(e) };
    }

    // Method 2: Try captions.download with API key (may fail - needs OAuth)
    try {
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/captions/${youtubeId}%3Aen&tfmt=srv3&key=${YT_API_KEY}`
      );
      const text = await resp.text();
      results.captionsDownload = { status: resp.status, len: text.length, sample: text.slice(0, 200) };
    } catch (e: unknown) {
      results.captionsDownload = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Method 3: Direct timedtext URL with consent cookie
  try {
    const pageResp = await fetch(`https://www.youtube.com/watch?v=${youtubeId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "CONSENT=PENDING+987; SOCS=CAESEwgDEgk2MjQ2NTg4ODMaAmVuIAEaBgiA_LyaBg",
      },
    });
    const html = await pageResp.html;
    results.hasCaptionsInPage = html.includes("captionTracks");
    const playMatch = html.match(/"playabilityStatus":\{[^}]*"status":"([^"]*)"/);
    results.playabilityStatus = playMatch?.[1] ?? "not found";
    const ttMatch = html.match(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]*)"/);
    if (ttMatch) {
      const url = ttMatch[1].replace(/\\u0026/g, "&");
      const r = await fetch(url);
      const xml = await r.text();
      results.timedtextFromPage = { status: r.status, segments: (xml.match(/<text start="[^"]*"/g))?.length ?? 0 };
    }
  } catch (e: unknown) {
    results.pageMethod = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results);
}
