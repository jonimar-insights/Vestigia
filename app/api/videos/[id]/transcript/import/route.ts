import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { transcripts, videos } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";

export const runtime = "nodejs";

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

  const body = await request.json();
  const { segments, language = "en", source = "manual" } = body as {
    segments: { start: number; duration: number; text: string }[];
    language?: string;
    source?: string;
  };

  if (!segments?.length) {
    return NextResponse.json({ error: "segments array is required" }, { status: 400 });
  }

  const existing = await db.select().from(transcripts).where(eq(transcripts.videoId, videoId)).limit(1);

  if (existing[0]) {
    await db.update(transcripts).set({
      segments: JSON.stringify(segments),
      language,
      source,
    }).where(eq(transcripts.videoId, videoId));
  } else {
    await db.insert(transcripts).values({
      videoId,
      segments: JSON.stringify(segments),
      language,
      source,
    });
  }

  return NextResponse.json({ ok: true, segmentCount: segments.length, source });
}
