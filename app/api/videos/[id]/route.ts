import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videos, transcripts, annotations, scenes, keyMoments } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET(
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

  const transcript = db
    .select()
    .from(transcripts)
    .where(eq(transcripts.videoId, videoId))
    .get();

  const videoAnnotations = db
    .select()
    .from(annotations)
    .where(eq(annotations.videoId, videoId))
    .all();

  const videoScenes = db
    .select()
    .from(scenes)
    .where(eq(scenes.videoId, videoId))
    .all();

  const videoKeyMoments = db
    .select()
    .from(keyMoments)
    .where(eq(keyMoments.videoId, videoId))
    .all();

  return NextResponse.json({
    ...video,
    transcript: transcript
      ? { ...transcript, segments: JSON.parse(transcript.segments) }
      : null,
    annotations: videoAnnotations.map((a) => ({
      ...a,
      tags: a.tags ? JSON.parse(a.tags) : [],
    })),
    scenes: videoScenes.map((s) => ({
      ...s,
      aiTags: s.aiTags ? JSON.parse(s.aiTags) : [],
    })),
    keyMoments: videoKeyMoments,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const videoId = parseInt(id);

  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  db.delete(annotations).where(eq(annotations.videoId, videoId)).run();
  db.delete(keyMoments).where(eq(keyMoments.videoId, videoId)).run();
  db.delete(scenes).where(eq(scenes.videoId, videoId)).run();
  db.delete(transcripts).where(eq(transcripts.videoId, videoId)).run();
  db.delete(videos).where(eq(videos.id, videoId)).run();

  return NextResponse.json({ success: true });
}
