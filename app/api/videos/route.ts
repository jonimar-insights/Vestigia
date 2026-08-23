import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, transcripts, annotations, scenes, keyMoments, folders, folderVideos } from "@/lib/schema";
import { eq, count, notInArray, and } from "drizzle-orm";
import { auth } from "@/auth";
import { createVideo } from "@/lib/import-video";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const userId = session.user.id as string;

  const folderedVideoIds = db
    .select({ videoId: folderVideos.videoId })
    .from(folderVideos)
    .innerJoin(folders, eq(folders.id, folderVideos.folderId))
    .where(eq(folders.userId, userId));

  const allVideos = await db
    .select()
    .from(videos)
    .where(
      and(
        notInArray(videos.id, folderedVideoIds),
        eq(videos.userId, userId),
      ),
    );

  const enriched = await Promise.all(
    allVideos.map(async (v) => {
      const annotationCount =
        (await db.select({ value: count() }).from(annotations).where(eq(annotations.videoId, v.id)))[0]?.value ?? 0;
      const sceneCount =
        (await db.select({ value: count() }).from(scenes).where(eq(scenes.videoId, v.id)))[0]?.value ?? 0;
      const momentCount =
        (await db.select({ value: count() }).from(keyMoments).where(eq(keyMoments.videoId, v.id)))[0]?.value ?? 0;
      const hasTranscript =
        (await db.select().from(transcripts).where(eq(transcripts.videoId, v.id)).limit(1)).length > 0;

      return { ...v, annotationCount, sceneCount, momentCount, hasTranscript };
    }),
  );

  return NextResponse.json(enriched);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const { url, title, thumbnailUrl, extractKeyMoments, durationSeconds } = body as {
    url: string;
    title?: string;
    thumbnailUrl?: string;
    extractKeyMoments?: boolean;
    durationSeconds?: number | null;
  };

  const result = await createVideo({
    url,
    title,
    thumbnailUrl,
    extractKeyMoments,
    durationSeconds,
    userId: session?.user?.id as string | null,
    userName: session?.user?.name,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.video, { status: result.existing ? 200 : 201 });
}
