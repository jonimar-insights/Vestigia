import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, transcripts, annotations, scenes, keyMoments, folders, folderVideos } from "@/lib/schema";
import { extractYouTubeId } from "@/lib/youtube";
import { eq, count, notInArray, and } from "drizzle-orm";
import { auth } from "@/auth";
import { fetchTranscriptWithFallback } from "@/lib/transcript";
import { extractYouTubeChapters, extractTranscriptKeyMoments, extractAIKeyMoments } from "@/lib/key-moments";
import { getDecryptedSettings } from "@/lib/user-settings";

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
  const db = getDb();
  const body = await request.json();
  const { url, title: clientTitle, thumbnailUrl: clientThumbnail, extractKeyMoments } = body as {
    url: string;
    title?: string;
    thumbnailUrl?: string;
    extractKeyMoments?: boolean;
  };

  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  const youtubeId = extractYouTubeId(url);
  if (!youtubeId) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  // Check if this user already imported this video
  const existingRows = await db
    .select()
    .from(videos)
    .where(and(eq(videos.youtubeId, youtubeId), eq(videos.userId, session.user.id as string)))
    .limit(1);
  if (existingRows[0]) {
    return NextResponse.json(existingRows[0]);
  }

  let title: string | null = clientTitle ?? null;
  let thumbnailUrl: string | null = clientThumbnail ?? null;
  let durationSeconds: number | null = null;

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
        duration?: number;
      };
      title = title ?? oembedData.title ?? null;
      thumbnailUrl = thumbnailUrl ?? oembedData.thumbnail_url ?? null;
      if (oembedData.duration && typeof oembedData.duration === "number") {
        durationSeconds = oembedData.duration;
      }
    }
  } catch {}

  // Fallback: scrape page for duration if oEmbed didn't provide it
  if (durationSeconds === null) {
    try {
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${youtubeId}`);
      const html = await pageRes.text();
      const dataMatch = html.match(/var ytInitialData = ([\s\S]*?);<\/script>/);
      if (dataMatch) {
        const data = JSON.parse(dataMatch[1]);
        const len = data?.videoDetails?.lengthSeconds;
        if (len) durationSeconds = parseInt(len);
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

      if (extractKeyMoments) {
        runKeyMomentsExtraction(video.id, video.youtubeId, session?.user?.id as string, transcript.segments, durationSeconds);
      }
    } else if (extractKeyMoments) {
      runKeyMomentsExtraction(video.id, video.youtubeId, session?.user?.id as string, [], durationSeconds);
    }
  }).catch((e) => {
    console.error("[transcript fetch]", e);
    if (extractKeyMoments) {
      runKeyMomentsExtraction(video.id, video.youtubeId, session?.user?.id as string, [], durationSeconds);
    }
  });

  return NextResponse.json(video, { status: 201 });
}

async function runKeyMomentsExtraction(
  videoId: number,
  youtubeId: string,
  userId: string,
  transcriptSegments: { start: number; duration: number; text: string }[],
  durationSeconds: number | null,
) {
  try {
    const actualDuration = durationSeconds ?? null;

    if (transcriptSegments.length > 0 && !actualDuration) {
      const lastSeg = transcriptSegments[transcriptSegments.length - 1];
      const transcriptDuration = lastSeg.start + lastSeg.duration;
      if (transcriptDuration > 0) {
        const db = getDb();
        await db.update(videos).set({ durationSeconds: Math.round(transcriptDuration) }).where(eq(videos.id, videoId));
      }
    }

    const db = getDb();
    const dedupThreshold = 3;

    const chapters = await extractYouTubeChapters(youtubeId);
    const allMoments = [];
    for (const ch of chapters) {
      const ts = actualDuration ? Math.min(ch.timestamp, actualDuration) : ch.timestamp;
      const [inserted] = await db.insert(keyMoments).values({
        videoId, timestamp: ts, title: ch.title, description: ch.description, source: "chapter", confidence: ch.confidence,
      }).returning();
      allMoments.push(inserted);
    }

    if (transcriptSegments.length > 0) {
      const lastSeg = transcriptSegments[transcriptSegments.length - 1];
      const effectiveDuration = actualDuration ?? (lastSeg.start + lastSeg.duration);
      const transcriptMoments = await extractTranscriptKeyMoments(youtubeId, transcriptSegments);
      for (const tm of transcriptMoments) {
        const tooClose = allMoments.some((m) => Math.abs(m.timestamp - tm.timestamp) < dedupThreshold);
        if (!tooClose) {
          const ts = effectiveDuration ? Math.min(tm.timestamp, effectiveDuration) : tm.timestamp;
          const [inserted] = await db.insert(keyMoments).values({
            videoId, timestamp: ts, title: tm.title, description: tm.description, source: "transcript", confidence: tm.confidence,
          }).returning();
          allMoments.push(inserted);
        }
      }
    }

    let userKeys: Record<string, string> | undefined;
    let preferred: string | null = null;
    if (userId) {
      const settings = await getDecryptedSettings(userId);
      userKeys = Object.keys(settings.aiKeys).length > 0 ? settings.aiKeys : undefined;
      preferred = settings.preferredProvider ?? null;
    }

    const aiMoments = await extractAIKeyMoments(youtubeId, transcriptSegments, userKeys, preferred, "normal", actualDuration);
    for (const am of aiMoments) {
      const tooClose = allMoments.some((m) => Math.abs(m.timestamp - am.timestamp) < dedupThreshold);
      if (!tooClose) {
        const ts = actualDuration ? Math.min(am.timestamp, actualDuration) : am.timestamp;
        const [inserted] = await db.insert(keyMoments).values({
          videoId, timestamp: ts, title: am.title, description: am.description, source: "ai", confidence: am.confidence,
        }).returning();
        allMoments.push(inserted);
      }
    }

    allMoments.sort((a, b) => a.timestamp - b.timestamp);
    console.log(`[key-moments auto] video ${videoId}: extracted ${allMoments.length} moments (${chapters.length}ch + ${allMoments.filter((m) => m.source === "transcript").length}tr + ${allMoments.filter((m) => m.source === "ai").length}ai)`);
  } catch (e) {
    console.error(`[key-moments auto] video ${videoId} failed:`, e);
  }
}
