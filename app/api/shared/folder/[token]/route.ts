import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders, folderVideos, videos, annotations, folderShares } from "@/lib/schema";
import { eq, inArray, and, isNull } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = rateLimit(_request, { max: 60, windowMs: 60_000 });
  if (limited) return limited;

  const db = getDb();
  const { token } = await params;

  const rows = await db
    .select()
    .from(folders)
    .where(eq(folders.shareToken, token))
    .limit(1);

  if (!rows[0]) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }
  const folder = rows[0];

  const fv = await db
    .select()
    .from(folderVideos)
    .where(eq(folderVideos.folderId, folder.id));

  if (fv.length === 0) {
    // Fetch the list of authorized users
    const emptyShares = await db
      .select({
        email: folderShares.email,
        permission: folderShares.permission,
      })
      .from(folderShares)
      .where(eq(folderShares.folderId, folder.id));
    return NextResponse.json({ ...folder, videos: [], shares: emptyShares });
  }

  const videoIds = fv.map((v) => v.videoId);

  const videoRows = await db
    .select({
      id: videos.id,
      youtubeUrl: videos.youtubeUrl,
      youtubeId: videos.youtubeId,
      title: videos.title,
      thumbnailUrl: videos.thumbnailUrl,
      durationSeconds: videos.durationSeconds,
      platform: videos.platform,
      year: videos.year,
      channel: videos.channel,
      mediaType: videos.mediaType,
    })
    .from(videos)
    .where(and(inArray(videos.id, videoIds), isNull(videos.deletedAt)));

  const annotationCounts = await db
    .select({
      videoId: annotations.videoId,
      count: annotations.id,
    })
    .from(annotations)
    .where(inArray(annotations.videoId, videoIds));

  const countMap = new Map<number, number>();
  for (const a of annotationCounts) {
    countMap.set(a.videoId, (countMap.get(a.videoId) ?? 0) + 1);
  }

  const videosWithCounts = videoRows.map((v) => ({
    ...v,
    annotationCount: countMap.get(v.id) ?? 0,
  }));

  // Fetch the list of authorized users
  const shares = await db
    .select({
      email: folderShares.email,
      permission: folderShares.permission,
    })
    .from(folderShares)
    .where(eq(folderShares.folderId, folder.id));

  return NextResponse.json({
    ...folder,
    videos: videosWithCounts,
    shares,
  });
}
