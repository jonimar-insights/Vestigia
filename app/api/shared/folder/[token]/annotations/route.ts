import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders, folderVideos, videos, annotations, folderShares } from "@/lib/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
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

  // Check that the user has edit permission
  if (email) {
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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
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
