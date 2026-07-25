import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, transcripts, annotations, scenes, keyMoments, folders, folderVideos } from "@/lib/schema";
import { extractYouTubeId } from "@/lib/youtube";
import { eq, count, notInArray, and } from "drizzle-orm";
import { auth } from "@/auth";
import { fetchTranscriptWithFallback } from "@/lib/transcript";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();

  const folderedVideoIds = db
    .select({ videoId: folderVideos.videoId })
    .from(folderVideos)
    .innerJoin(folders, eq(folders.id, folderVideos.folderId))
    .where(eq(folders.userId, session.user.id as string));

  const allVideos = await db
    .select()
    .from(videos)
    .where(
      and(
        notInArray(videos.id, folderedVideoIds),
        eq(videos.userId, session.user.id as string),
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
  const db = getDb();
  const body = await request.json();
  const { url, title: clientTitle, thumbnailUrl: clientThumbnail } = body as { url: string; title?: string; thumbnailUrl?: string };

  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  const youtubeId = extractYouTubeId(url);
  if (!youtubeId) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  // Check across all users — unique constraint on youtube_id was dropped to allow
  // multiple users to import the same video
  const existingRows = await db
    .select()
    .from(videos)
    .where(eq(videos.youtubeId, youtubeId))
    .limit(1);
  if (existingRows[0]) {
    return NextResponse.json(existingRows[0]);
  }

  let title: string | null = clientTitle ?? null;
  let thumbnailUrl: string | null = clientThumbnail ?? null;
  const durationSeconds: number | null = null;

  if (!title || !thumbnailUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${youtubeId}&format=json`;
      const oembedRes = await fetch(oembedUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (oembedRes.ok) {
        const oembedData = (await oembedRes.json()) as {
          title?: string;
          thumbnail_url?: string;
        };
        title = title ?? oembedData.title ?? null;
        thumbnailUrl = thumbnailUrl ?? oembedData.thumbnail_url ?? null;
      }
    } catch {}
  }

  let video;
  try {
    [video] = await db
      .insert(videos)
      .values({
        youtubeUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
        youtubeId,
        title,
        thumbnailUrl,
        durationSeconds,
        createdBy: session?.user?.name ?? "anonymous",
        userId: session?.user?.id ?? null,
      })
      .returning();
  } catch (e: unknown) {
    console.error("[video insert]", e);
    const msg = e instanceof Error ? e.message : "Insert failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  fetchTranscriptWithFallback(youtubeId).then((transcript) => {
    if (transcript && transcript.segments.length > 0) {
      db.insert(transcripts).values({
        videoId: video.id,
        segments: JSON.stringify(transcript.segments),
        language: transcript.language,
        source: transcript.source,
      }).catch((e) => console.error("[transcript insert]", e));
    }
  }).catch((e) => console.error("[transcript fetch]", e));

  return NextResponse.json(video, { status: 201 });
}
