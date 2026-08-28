import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, transcripts, annotations, scenes, keyMoments, folderVideos } from "@/lib/schema";
import { eq, and, isNull } from "drizzle-orm";
import { auth } from "@/auth";

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
    .where(and(eq(videos.id, videoId), eq(videos.userId, session.user.id as string), isNull(videos.deletedAt)))
    .limit(1);
  if (!videoRows[0]) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  const video = videoRows[0];

  const transcriptRows = await db.select().from(transcripts).where(eq(transcripts.videoId, videoId)).limit(1);
  const transcript = transcriptRows[0] ?? null;

  const videoAnnotations = await db.select().from(annotations).where(eq(annotations.videoId, videoId));
  const videoScenes = await db.select().from(scenes).where(eq(scenes.videoId, videoId));
  const videoKeyMoments = await db.select().from(keyMoments).where(eq(keyMoments.videoId, videoId));

  const folderRow = await db
    .select({ folderId: folderVideos.folderId })
    .from(folderVideos)
    .where(eq(folderVideos.videoId, videoId))
    .limit(1);

  return NextResponse.json({
    ...video,
    folderId: folderRow[0]?.folderId ?? null,
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

  // Verify ownership before delete
  const videoRows = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, videoId), eq(videos.userId, session.user.id as string)))
    .limit(1);
  if (!videoRows[0]) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  // Soft delete by default: keep the row + all dependents (folder links,
  // annotations, key moments,…) so it can be recovered from the Trash.
  // Pass ?permanent=true to hard-delete (purges children + the row itself).
  const permanent = request.nextUrl.searchParams.get("permanent") === "true";

  if (permanent) {
    // Remove from folders first, then delete cascade-safe children, then the video itself
    await db.delete(folderVideos).where(eq(folderVideos.videoId, videoId));
    await db.delete(annotations).where(eq(annotations.videoId, videoId));
    await db.delete(keyMoments).where(eq(keyMoments.videoId, videoId));
    await db.delete(scenes).where(eq(scenes.videoId, videoId));
    await db.delete(transcripts).where(eq(transcripts.videoId, videoId));
    await db.delete(videos).where(eq(videos.id, videoId));

    return NextResponse.json({ success: true, permanent: true });
  }

  await db
    .update(videos)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(videos.id, videoId));

  return NextResponse.json({ success: true, softDeleted: true });
}

export async function PATCH(
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
    .where(and(eq(videos.id, videoId), eq(videos.userId, session.user.id as string), isNull(videos.deletedAt)))
    .limit(1);
  if (!videoRows[0]) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (body.year !== undefined) updates.year = body.year === null ? null : Number(body.year) || null;
  if (body.title !== undefined) updates.title = body.title || null;
  if (body.channel !== undefined) updates.channel = body.channel === null ? null : String(body.channel).trim() || null;
  if (body.thumbnailUrl !== undefined) {
    const t = body.thumbnailUrl;
    updates.thumbnailUrl = typeof t === "string" && t.trim() ? t.trim() : null;
  }
  if (body.mediaType !== undefined) {
    const m = typeof body.mediaType === "string" ? body.mediaType.toLowerCase() : null;
    updates.mediaType = m === "audio" || m === "video" ? m : null;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(videos).set(updates).where(eq(videos.id, videoId));
  }

  const updated = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  return NextResponse.json(updated[0]);
}
