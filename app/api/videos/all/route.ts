import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, transcripts, annotations, scenes, keyMoments, folders, folderVideos } from "@/lib/schema";
import { eq, count, asc, desc, max, inArray } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const userId = session.user.id as string;
  const sort = request.nextUrl.searchParams.get("sort") ?? "newest";

  const folderNameSubquery = db
    .select({
      videoId: folderVideos.videoId,
      folderName: folders.name,
    })
    .from(folderVideos)
    .innerJoin(folders, eq(folders.id, folderVideos.folderId))
    .where(eq(folders.userId, userId))
    .as("folder_name_sub");

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
      folderName: folderNameSubquery.folderName,
    })
    .from(videos)
    .leftJoin(folderNameSubquery, eq(folderNameSubquery.videoId, videos.id))
    .where(eq(videos.userId, userId))
    .orderBy(
      sort === "oldest"
        ? asc(videos.createdAt)
        : sort === "az"
          ? asc(videos.title)
          : sort === "za"
            ? desc(videos.title)
            : desc(videos.createdAt),
    );

  const enriched = await Promise.all(
    rows.map(async (v) => {
      const annotationCount =
        (await db.select({ value: count() }).from(annotations).where(eq(annotations.videoId, v.id)))[0]?.value ?? 0;
      const sceneCount =
        (await db.select({ value: count() }).from(scenes).where(eq(scenes.videoId, v.id)))[0]?.value ?? 0;
      const momentCount =
        (await db.select({ value: count() }).from(keyMoments).where(eq(keyMoments.videoId, v.id)))[0]?.value ?? 0;
      const hasTranscript =
        (await db.select().from(transcripts).where(eq(transcripts.videoId, v.id)).limit(1)).length > 0;
      const latestAnnotationAt =
        (await db.select({ value: max(annotations.updatedAt) }).from(annotations).where(eq(annotations.videoId, v.id)))[0]?.value ?? null;

      return { ...v, annotationCount, sceneCount, momentCount, hasTranscript, latestAnnotationAt };
    }),
  );

  // Batch-fetch annotation labels for client-side search
  const allVidIds = rows.map((v) => v.id);
  const annoLabels = allVidIds.length > 0
    ? await db
        .select({ videoId: annotations.videoId, label: annotations.label, note: annotations.note })
        .from(annotations)
        .where(inArray(annotations.videoId, allVidIds))
    : [];
  const searchTextMap = new Map<number, string>();
  for (const a of annoLabels) {
    const existing = searchTextMap.get(a.videoId) || "";
    searchTextMap.set(a.videoId, `${existing} ${a.label ?? ""} ${a.note ?? ""}`.trim());
  }

  const withSearchText = enriched.map((v) => ({
    ...v,
    searchText: `${v.title ?? ""} ${searchTextMap.get(v.id) ?? ""}`.trim().toLowerCase(),
  }));

  if (sort === "annotated") {
    withSearchText.sort((a, b) => b.annotationCount - a.annotationCount);
  } else if (sort === "updated") {
    withSearchText.sort((a, b) => {
      if (a.latestAnnotationAt && b.latestAnnotationAt) return b.latestAnnotationAt > a.latestAnnotationAt ? 1 : b.latestAnnotationAt < a.latestAnnotationAt ? -1 : 0;
      if (a.latestAnnotationAt) return -1;
      if (b.latestAnnotationAt) return 1;
      return 0;
    });
  }

  return NextResponse.json(withSearchText);
}
