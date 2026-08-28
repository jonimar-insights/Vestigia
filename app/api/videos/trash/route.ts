import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, transcripts, annotations, scenes, keyMoments, folders, folderVideos } from "@/lib/schema";
import { eq, count, and, desc, isNotNull } from "drizzle-orm";
import { auth } from "@/auth";

// Trash listing: the user's soft-deleted videos (deleted_at set), newest-deleted first.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const userId = session.user.id as string;

  const rows = await db
    .select({
      id: videos.id,
      youtubeUrl: videos.youtubeUrl,
      youtubeId: videos.youtubeId,
      platform: videos.platform,
      title: videos.title,
      thumbnailUrl: videos.thumbnailUrl,
      durationSeconds: videos.durationSeconds,
      createdAt: videos.createdAt,
      createdBy: videos.createdBy,
      userId: videos.userId,
      year: videos.year,
      channel: videos.channel,
      deletedAt: videos.deletedAt,
    })
    .from(videos)
    .where(and(eq(videos.userId, userId), isNotNull(videos.deletedAt)))
    .orderBy(desc(videos.deletedAt));

  const folderAssocs = await db
    .select({ videoId: folderVideos.videoId, folderName: folders.name })
    .from(folderVideos)
    .innerJoin(folders, eq(folders.id, folderVideos.folderId))
    .where(eq(folders.userId, userId));
  const folderNameMap = new Map<number, string>();
  for (const fa of folderAssocs) {
    if (!folderNameMap.has(fa.videoId)) folderNameMap.set(fa.videoId, fa.folderName);
  }

  const ids = rows.map((v) => v.id);
  const enriched = await Promise.all(
    rows.map(async (v) => {
      const annotationCount =
        ids.length === 0
          ? 0
          : (await db.select({ value: count() }).from(annotations).where(eq(annotations.videoId, v.id)))[0]?.value ?? 0;
      const sceneCount =
        ids.length === 0
          ? 0
          : (await db.select({ value: count() }).from(scenes).where(eq(scenes.videoId, v.id)))[0]?.value ?? 0;
      const momentCount =
        ids.length === 0
          ? 0
          : (await db.select({ value: count() }).from(keyMoments).where(eq(keyMoments.videoId, v.id)))[0]?.value ?? 0;
      const hasTranscript =
        ids.length === 0 ? false : (await db.select().from(transcripts).where(eq(transcripts.videoId, v.id)).limit(1)).length > 0;
      return {
        ...v,
        folderName: folderNameMap.get(v.id) ?? null,
        annotationCount,
        sceneCount,
        momentCount,
        hasTranscript,
      };
    }),
  );

  return NextResponse.json(enriched);
}