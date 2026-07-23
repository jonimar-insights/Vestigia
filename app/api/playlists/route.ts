import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { auth } from "@/auth";

const execFileAsync = promisify(execFile);

function extractPlaylistId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("list");
  } catch {
    const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return match?.[1] ?? null;
  }
}

interface PlaylistVideo {
  id: string;
  title: string;
  thumbnail: string;
  position: number;
}

async function fetchPlaylistViaYouTubeAPI(playlistId: string): Promise<PlaylistVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const videos: PlaylistVideo[] = [];
  let pageToken = "";

  for (let page = 0; page < 50; page++) {
    const pageUrl = `https://www.googleapis.com/youtube/v3/playlistItems?playlistId=${playlistId}&part=snippet&maxResults=50&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(pageUrl);
    if (!res.ok) break;

    const data = await res.json();
    const items = data.items ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      const snippet = item.snippet;
      if (!snippet?.resourceId?.videoId) continue;
      if (snippet.resourceId.kind !== "youtube#video") continue;
      videos.push({
        id: snippet.resourceId.videoId,
        title: snippet.title ?? "Untitled",
        thumbnail: snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? `https://i.ytimg.com/vi/${snippet.resourceId.videoId}/hqdefault.jpg`,
        position: videos.length,
      });
    }

    pageToken = data.nextPageToken ?? "";
    if (!pageToken) break;
  }

  return videos;
}

async function fetchPlaylistViaYtdlp(playlistUrl: string): Promise<PlaylistVideo[]> {
  try {
    const { stdout } = await execFileAsync("yt-dlp", [
      "--flat-playlist",
      "--print", "%(id)s|||%(title)s",
      "--no-warnings",
      "--no-check-certificates",
      playlistUrl,
    ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines.map((line, i) => {
      const [id, ...titleParts] = line.split("|||");
      return {
        id: id.trim(),
        title: titleParts.join("|||").trim() || "Untitled",
        thumbnail: `https://i.ytimg.com/vi/${id.trim()}/hqdefault.jpg`,
        position: i,
      };
    });
  } catch {
    return [];
  }
}

async function fetchPlaylistViaRSS(playlistId: string): Promise<PlaylistVideo[]> {
  const videos: PlaylistVideo[] = [];
  const seen = new Set<string>();
  let startIndex = 1;

  for (let page = 0; page < 40; page++) {
    const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}&start-index=${startIndex}`;
    const res = await fetch(url);
    if (!res.ok) break;

    const xml = await res.text();
    const entries = xml.split("<entry>").slice(1);
    if (entries.length === 0) break;

    let newCount = 0;
    for (const entry of entries) {
      const idMatch = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
      const titleMatch = entry.match(/<media:group>[\s\S]*?<media:title>(.*?)<\/media:title>/);
      const thumbMatch = entry.match(/<media:thumbnail url="(.*?)"/);

      if (idMatch && !seen.has(idMatch[1])) {
        seen.add(idMatch[1]);
        videos.push({
          id: idMatch[1],
          title: titleMatch?.[1]?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") ?? "Untitled",
          thumbnail: thumbMatch?.[1] ?? `https://i.ytimg.com/vi/${idMatch[1]}/hqdefault.jpg`,
          position: videos.length,
        });
        newCount++;
      }
    }

    if (newCount === 0) break;
    startIndex += entries.length;
  }

  return videos;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const { url } = body as { url: string };

  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    return NextResponse.json({ error: "Invalid YouTube playlist URL" }, { status: 400 });
  }

  // Primary: YouTube Data API v3 (complete pagination, 50 per page)
  let videos = await fetchPlaylistViaYouTubeAPI(playlistId);

  // Fallback 1: yt-dlp (works locally, fails on Vercel)
  if (videos.length === 0) {
    videos = await fetchPlaylistViaYtdlp(url);
  }

  // Fallback 2: RSS (loops on pagination, deduped)
  if (videos.length === 0) {
    videos = await fetchPlaylistViaRSS(playlistId);
  }

  if (videos.length === 0) {
    return NextResponse.json({ error: "Could not fetch playlist videos. The playlist may be private or empty." }, { status: 404 });
  }

  return NextResponse.json({ playlistId, videos });
}
