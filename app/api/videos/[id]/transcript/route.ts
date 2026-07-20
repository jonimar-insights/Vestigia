import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videos, transcripts } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { fetchTranscriptWithFallback } from "@/lib/transcript";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const videoId = parseInt(id);

  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const video = db.select().from(videos).where(eq(videos.id, videoId)).get();
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const existing = db
    .select()
    .from(transcripts)
    .where(eq(transcripts.videoId, videoId))
    .get();
  if (existing) {
    return NextResponse.json({
      message: "Transcript already exists",
      source: existing.source,
    });
  }

  const transcript = await fetchTranscriptWithFallback(video.youtubeId);

  if (!transcript || transcript.segments.length === 0) {
    return NextResponse.json(
      { error: "No transcript available for this video" },
      { status: 404 },
    );
  }

  db.insert(transcripts)
    .values({
      videoId,
      segments: JSON.stringify(transcript.segments),
      language: transcript.language,
      source: transcript.source,
    })
    .run();

  return NextResponse.json({
    source: transcript.source,
    segmentCount: transcript.segments.length,
  });
}
