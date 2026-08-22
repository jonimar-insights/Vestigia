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
    { title: string | null; thumbnailUrl: string | null; youtubeId: string | null }
  >();
  for (const vid of videoIds) {
    const vRows = await db
      .select({
        title: videos.title,
        thumbnailUrl: videos.thumbnailUrl,
        youtubeId: videos.youtubeId,
      })
      .from(videos)
      .where(eq(videos.id, vid))
      .limit(1);
    if (vRows[0]) videoMap.set(vid, vRows[0]);
  }

  const itemsWithVideo = items.map((item) => ({
    ...item,
    tags: item.tags ? JSON.parse(item.tags) : [],
    videoTitle: videoMap.get(item.videoId)?.title ?? null,
    videoThumbnail: videoMap.get(item.videoId)?.thumbnailUrl ?? null,
    youtubeId: videoMap.get(item.videoId)?.youtubeId ?? null,
  }));

  return NextResponse.json({ ...list, items: itemsWithVideo });
}
