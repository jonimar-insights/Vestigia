import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders, folderVideos, annotations, folderShares } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = rateLimit(_request, { max: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { token } = await params;
  const url = new URL(_request.url);
  const videoId = parseInt(url.searchParams.get("videoId") ?? "", 10);
  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  const db = getDb();

  const folderRows = await db
    .select()
    .from(folders)
    .where(eq(folders.shareToken, token))
    .limit(1);
  if (!folderRows[0]) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const inFolder = await db
    .select()
    .from(folderVideos)
    .where(
      and(
        eq(folderVideos.folderId, folderRows[0].id),
        eq(folderVideos.videoId, videoId)
      )
    )
    .limit(1);
  if (!inFolder[0]) {
    return NextResponse.json({ error: "Video not in folder" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(annotations)
    .where(eq(annotations.videoId, videoId))
    .orderBy(desc(annotations.createdAt));

  const items = rows.map((a) => ({
    ...a,
    tags: a.tags ? JSON.parse(a.tags) : [],
  }));

  return NextResponse.json(items);
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = rateLimit(_request, { max: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { token } = await params;
  const body = await _request.json();
  const { videoId, name, email, timestampStart, timestampEnd, note } = body;

  if (!videoId || !name || timestampStart === undefined || timestampEnd === undefined) {
    return NextResponse.json(
      { error: "Missing required fields: videoId, name, timestampStart, timestampEnd" },
      { status: 400 }
    );
  }

  const db = getDb();

  const folderRows = await db
    .select()
    .from(folders)
    .where(eq(folders.shareToken, token))
    .limit(1);
  if (!folderRows[0]) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const inFolder = await db
    .select()
    .from(folderVideos)
    .where(
      and(
        eq(folderVideos.folderId, folderRows[0].id),
        eq(folderVideos.videoId, videoId)
      )
    )
    .limit(1);
  if (!inFolder[0]) {
    return NextResponse.json({ error: "Video not in folder" }, { status: 404 });
  }

  // The collaborator must be an invited email with edit permission
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  const shareRows = await db
    .select()
    .from(folderShares)
    .where(
      and(
        eq(folderShares.folderId, folderRows[0].id),
        eq(folderShares.email, email.toLowerCase())
      )
    )
    .limit(1);
  if (!shareRows[0] || shareRows[0].permission !== "edit") {
    return NextResponse.json({ error: "Edit permission required" }, { status: 403 });
  }

  const result = await db
    .insert(annotations)
    .values({
      videoId,
      timestampStart,
      timestampEnd,
      label: "Note",
      tags: JSON.stringify([]),
      note: note || null,
      createdBy: name,
      email: email?.toLowerCase() || null,
    })
    .returning();

  return NextResponse.json(result[0], { status: 201 });
}

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = rateLimit(_request, { max: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { token } = await params;
  const body = await _request.json();
  const { annotationId, email, timestampStart, timestampEnd, note } = body;

  if (!annotationId || !email || timestampStart === undefined || timestampEnd === undefined) {
    return NextResponse.json(
      { error: "Missing required fields: annotationId, email, timestampStart, timestampEnd" },
      { status: 400 }
    );
  }

  const db = getDb();

  const folderRows = await db
    .select()
    .from(folders)
    .where(eq(folders.shareToken, token))
    .limit(1);
  if (!folderRows[0]) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  // The collaborator must be an invited email with edit permission
  const shareRows = await db
    .select()
    .from(folderShares)
    .where(
      and(
        eq(folderShares.folderId, folderRows[0].id),
        eq(folderShares.email, email.toLowerCase())
      )
    )
    .limit(1);
  if (!shareRows[0] || shareRows[0].permission !== "edit") {
    return NextResponse.json({ error: "Edit permission required" }, { status: 403 });
  }

  // Only the annotation author can edit it
  const annotationRows = await db
    .select()
    .from(annotations)
    .where(eq(annotations.id, annotationId))
    .limit(1);
  if (!annotationRows[0]) {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }
  if (annotationRows[0].email?.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "You can only edit your own annotations" }, { status: 403 });
  }

  const [updated] = await db
    .update(annotations)
    .set({
      timestampStart,
      timestampEnd,
      note: note ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(annotations.id, annotationId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = rateLimit(_request, { max: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { token } = await params;
  const body = await _request.json();
  const { annotationId, email } = body;

  if (!annotationId || !email) {
    return NextResponse.json(
      { error: "Missing required fields: annotationId, email" },
      { status: 400 }
    );
  }

  const db = getDb();

  const folderRows = await db
    .select()
    .from(folders)
    .where(eq(folders.shareToken, token))
    .limit(1);
  if (!folderRows[0]) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  // Check the annotation exists and belongs to the user
  const annotationRows = await db
    .select()
    .from(annotations)
    .where(eq(annotations.id, annotationId))
    .limit(1);
  if (!annotationRows[0]) {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }

  if (annotationRows[0].email?.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "You can only delete your own annotations" }, { status: 403 });
  }

  await db
    .delete(annotations)
    .where(eq(annotations.id, annotationId));

  return NextResponse.json({ success: true });
}
