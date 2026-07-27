import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, keyMoments, transcripts } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import {
  extractYouTubeChapters,
  extractTranscriptKeyMoments,
  extractAIKeyMoments,
} from "@/lib/key-moments";
import { fetchTranscriptWithFallback } from "@/lib/transcript";
import { auth } from "@/auth";
import { getDecryptedSettings } from "@/lib/user-settings";

export const maxDuration = 300;

const TRANSCRIPT_TIMEOUT_MS = 30_000;

function fetchWithTimeout(
  youtubeId: string,
  accessToken?: string,
): Promise<Awaited<ReturnType<typeof fetchTranscriptWithFallback>>> {
  return Promise.race([
    fetchTranscriptWithFallback(youtubeId, accessToken),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), TRANSCRIPT_TIMEOUT_MS),
    ),
  ]);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const videoId = parseInt(id);

  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const videoRows = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, videoId), eq(videos.userId, session.user.id as string)))
    .limit(1);
  if (!videoRows[0]) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  const video = videoRows[0];

  const existing = await db
    .select()
    .from(keyMoments)
    .where(eq(keyMoments.videoId, videoId));

  const url = new URL(request.url);
  const regenerate = url.searchParams.get("regenerate") === "true";
  const skipTranscript = url.searchParams.get("skipTranscript") === "true";
  const depthParam = url.searchParams.get("depth");
  const effectiveDepth = depthParam === "deep" || depthParam === "shallow" || depthParam === "ultra" ? depthParam : "normal";
  // When regenerating, default to ultra for maximum extraction
  const depth = regenerate && !depthParam ? "ultra" : effectiveDepth;
  const dedupThreshold = regenerate ? 2 : 3;

  if (existing.length > 0 && !regenerate) {
    return NextResponse.json({
      message: "Key moments already extracted",
      moments: existing,
    });
  }

  if (existing.length > 0 && regenerate) {
    await db.delete(keyMoments).where(eq(keyMoments.videoId, videoId));
  }

  // Determine actual video duration: DB > transcript last segment > null
  const actualDuration = video.durationSeconds ?? null;

  const allMoments = [];

  const chapters = await extractYouTubeChapters(video.youtubeId);
  for (const ch of chapters) {
    const ts = actualDuration ? Math.min(ch.timestamp, actualDuration) : ch.timestamp;
    const [inserted] = await db
      .insert(keyMoments)
      .values({
        videoId,
        timestamp: ts,
        title: ch.title,
        description: ch.description,
        source: "chapter",
        confidence: ch.confidence,
      })
      .returning();
    allMoments.push(inserted);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accessToken = (session as any)?.accessToken;

  let transcriptSegments: { start: number; duration: number; text: string }[] = [];

  if (!skipTranscript) {
    const existingTranscript = await db
      .select()
      .from(transcripts)
      .where(eq(transcripts.videoId, videoId))
      .limit(1);

    if (existingTranscript[0]) {
      transcriptSegments = JSON.parse(existingTranscript[0].segments);
    } else {
      const fetched = await fetchWithTimeout(video.youtubeId, accessToken);
      if (fetched) {
        await db.insert(transcripts).values({
          videoId,
          segments: JSON.stringify(fetched.segments),
          language: fetched.language,
          source: fetched.source,
        });
        transcriptSegments = fetched.segments;
      }
    }
  }

  if (transcriptSegments.length > 0) {
    // Derive actual duration from transcript if DB doesn't have it
    const lastSeg = transcriptSegments[transcriptSegments.length - 1];
    const transcriptDuration = lastSeg.start + lastSeg.duration;
    const effectiveDuration = actualDuration ?? transcriptDuration;

    // Backfill durationSeconds if DB row was missing it
    if (!video.durationSeconds && transcriptDuration > 0) {
      await db
        .update(videos)
        .set({ durationSeconds: Math.round(transcriptDuration) })
        .where(eq(videos.id, videoId));
    }

    const transcriptMoments = await extractTranscriptKeyMoments(video.youtubeId, transcriptSegments);
    for (const tm of transcriptMoments) {
      const tooClose = allMoments.some(
        (m) => Math.abs(m.timestamp - tm.timestamp) < dedupThreshold,
      );
      if (!tooClose) {
        const ts = effectiveDuration ? Math.min(tm.timestamp, effectiveDuration) : tm.timestamp;
        const [inserted] = await db
          .insert(keyMoments)
          .values({
            videoId,
            timestamp: ts,
            title: tm.title,
            description: tm.description,
            source: "transcript",
            confidence: tm.confidence,
          })
          .returning();
        allMoments.push(inserted);
      }
    }
  }

  let userKeys: Record<string, string> | undefined;
  let preferred: string | null = null;
  if (session?.user?.id) {
    const settings = await getDecryptedSettings(session.user.id);
    userKeys = Object.keys(settings.aiKeys).length > 0 ? settings.aiKeys : undefined;
    preferred = settings.preferredProvider ?? null;
  }

  const aiMoments = await extractAIKeyMoments(video.youtubeId, transcriptSegments, userKeys, preferred, depth, actualDuration);
  for (const am of aiMoments) {
    const tooClose = allMoments.some(
      (m) => Math.abs(m.timestamp - am.timestamp) < dedupThreshold,
    );
    if (!tooClose) {
      const ts = actualDuration ? Math.min(am.timestamp, actualDuration) : am.timestamp;
      const [inserted] = await db
        .insert(keyMoments)
        .values({
          videoId,
          timestamp: ts,
          title: am.title,
          description: am.description,
          source: "ai",
          confidence: am.confidence,
        })
        .returning();
      allMoments.push(inserted);
    }
  }

  allMoments.sort((a, b) => a.timestamp - b.timestamp);

  return NextResponse.json({
    message: regenerate
      ? `Regenerated ${allMoments.length} key moments`
      : `Extracted ${allMoments.length} key moments`,
    moments: allMoments,
    sources: {
      chapters: chapters.length,
      transcript: allMoments.filter((m) => m.source === "transcript").length,
      ai: allMoments.filter((m) => m.source === "ai").length,
    },
    depth,
    regenerate,
    transcriptStored: transcriptSegments.length > 0 && !skipTranscript,
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const videoId = parseInt(id);

  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const videoRows = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, videoId), eq(videos.userId, session.user.id as string)))
    .limit(1);
  if (!videoRows[0]) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const moments = await db
    .select()
    .from(keyMoments)
    .where(eq(keyMoments.videoId, videoId));

  return NextResponse.json(moments);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const videoId = parseInt(id);

  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const videoRows = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, videoId), eq(videos.userId, session.user.id as string)))
    .limit(1);
  if (!videoRows[0]) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const { source } = body as { source?: string };

  if (source) {
    await db.delete(keyMoments)
      .where(
        and(eq(keyMoments.videoId, videoId), eq(keyMoments.source, source)),
      );
  } else {
    await db.delete(keyMoments).where(eq(keyMoments.videoId, videoId));
  }

  return NextResponse.json({ success: true });
}
