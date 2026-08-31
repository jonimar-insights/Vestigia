import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { cliplists, clipItems, videos } from "@/lib/schema";
import { eq, desc, asc } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const db = getDb();
  const { token } = await params;

  const rows = await db
    .select()
    .from(cliplists)
    .where(eq(cliplists.shareToken, token))
    .limit(1);

  if (!rows[0]) {
    return NextResponse.json({ error: "Cliplist not found" }, { status: 404 });
  }
  const list = rows[0];

  const items = await db
    .select()
    .from(clipItems)
    .where(eq(clipItems.cliplistId, list.id))
    .orderBy(asc(clipItems.position), desc(clipItems.createdAt));

  const videoIds = [...new Set(items.map((i) => i.videoId))];
  const videoMap = new Map<
    number,
    {
      title: string | null;
      thumbnailUrl: string | null;
      youtubeId: string | null;
      platform: string | null;
      youtubeUrl: string | null;
    }
  >();
  for (const vid of videoIds) {
    const vRows = await db
      .select({
        title: videos.title,
        thumbnailUrl: videos.thumbnailUrl,
        youtubeId: videos.youtubeId,
        platform: videos.platform,
        youtubeUrl: videos.youtubeUrl,
      })
      .from(videos)
      .where(eq(videos.id, vid))
      .limit(1);
    if (vRows[0]) videoMap.set(vid, vRows[0]);
  }

  const itemsWithVideo = items.map((item) => {
    const v = videoMap.get(item.videoId);
    const raw = String(v?.youtubeId ?? "");
    const ytOk = /^[A-Za-z0-9_-]{11}$/.test(raw);
    const isHtml5 = v?.platform === "drive" || v?.platform === "upload";
    return {
      ...item,
      tags: item.tags ? JSON.parse(item.tags) : [],
      videoTitle: v?.title ?? null,
      videoThumbnail: v?.thumbnailUrl ?? null,
      youtubeId: v?.youtubeId ?? null,
      _youtubeId: ytOk ? raw : "",
      _vimeoId: !ytOk && raw.startsWith("vimeo:") ? raw.slice("vimeo:".length) : "",
      _html5Src: isHtml5 && typeof v?.youtubeUrl === "string" ? (v as { youtubeUrl: string }).youtubeUrl : "",
    };
  });

  return NextResponse.json({ ...list, items: itemsWithVideo });
}
