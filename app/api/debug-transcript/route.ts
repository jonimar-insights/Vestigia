import { NextResponse } from "next/server";

export const runtime = "nodejs";

const INNERTUBE_API_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

const CLIENTS = [
  { name: "WEB", context: { client: { clientName: "WEB", clientVersion: "2.20241001.00.00" } }, ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  { name: "ANDROID", context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } }, ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14)" },
  { name: "IOS", context: { client: { clientName: "IOS", clientVersion: "20.10.38" } }, ua: "com.google.ios.youtube/20.10.38 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X)" },
  { name: "MWEB", context: { client: { clientName: "MWEB", clientVersion: "2.20241001.00.00" } }, ua: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36" },
  { name: "TVHTML5_SIMPLY_EMBEDDED", context: { client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0" }, thirdParty: { embedUrl: "https://www.youtube.com" } }, ua: "Mozilla/5.0" },
];

export async function GET() {
  const youtubeId = "GtOGurrUPmQ";
  const results: Record<string, unknown> = {};

  for (const client of CLIENTS) {
    try {
      const resp = await fetch(INNERTUBE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": client.ua },
        body: JSON.stringify({ context: client.context, videoId: youtubeId }),
      });
      const data = await resp.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const trackCount = Array.isArray(tracks) ? tracks.length : 0;
      results[client.name] = { trackCount, status: data?.playabilityStatus?.status, firstLang: tracks?.[0]?.languageCode ?? null };
      if (trackCount > 0 && tracks[0].baseUrl) {
        const tr = await fetch(tracks[0].baseUrl);
        if (tr.ok) {
          const xml = await tr.text();
          const segs = xml.match(/<text start="[^"]*"/g);
          results[`${client.name}_segments`] = segs?.length ?? 0;
        }
      }
    } catch (e: unknown) {
      results[client.name] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json(results);
}
