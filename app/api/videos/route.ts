import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, transcripts, annotations, scenes, keyMoments } from "@/lib/schema";
import { eq, count, desc, and, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { createVideo } from "@/lib/import-video";

export async function getVideoCounts(db: ReturnType<typeof getDb>, videoId: number) {
  const [annotation, scene, moment, transcript] = await Promise.allSettled([
    db
      .select({ value: count() })
      .from(annotations)
      .where(eq(annotations.videoId, videoId)),
    db
      .select({ value: count() })
      .from(scenes)
      .where(eq(scenes.videoId, videoId)),
    db
      .select({ value: count() })
      .from(keyMoments)
      .where(eq(keyMoments.videoId, videoId)),
    db
      .select()
      .from(transcripts)
      .where(eq(transcripts.videoId, videoId))
      .limit(1),
  ]);

  const annotationCount =
    annotation.status === "fulfilled" ? Number(annotation.value[0]?.value ?? 0) : 0;
  const sceneCount = scene.status === "fulfilled" ? Number(scene.value[0]?.value ?? 0) : 0;
  const momentCount = moment.status === "fulfilled" ? Number(moment.value[0]?.value ?? 0) : 0;
  const hasTranscript = transcript.status === "fulfilled" ? transcript.value.length > 0 : false;

  return { annotationCount, sceneCount, momentCount, hasTranscript };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const userId = session.user.id as string;

  // The main dashboard shows ALL of the user's videos (including foldered
  // ones). Videos live in folders as references, so hiding them here made the
  // main view appear empty once everything was filed away.
  const allVideos = await db
    .select()
    .from(videos)
    .where(and(eq(videos.userId, userId), isNull(videos.deletedAt)))
    .orderBy(desc(videos.createdAt));

  const enriched = await Promise.all(
    allVideos.map(async (v) => {
      const counts = await getVideoCounts(db, v.id);
      return { ...v, ...counts };
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
  const { url, title, thumbnailUrl, extractKeyMoments, durationSeconds, year, channel } = body as {
    url: string;
    title?: string;
    thumbnailUrl?: string;
    extractKeyMoments?: boolean;
    durationSeconds?: number | null;
    year?: number | null;
    channel?: string | null;
  };

  const result = await createVideo({
    url,
    title,
    thumbnailUrl,
    extractKeyMoments,
    durationSeconds,
    year,
    channel,
    userId: session?.user?.id as string | null,
    userName: session?.user?.name,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.video, { status: result.existing ? 200 : 201 });
}
