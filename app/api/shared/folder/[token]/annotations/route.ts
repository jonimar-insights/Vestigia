import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders, folderVideos, videos, annotations } from "@/lib/schema";
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
  const { videoId, name, timestampStart, timestampEnd, note } = body;

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
    })
    .returning();

  return NextResponse.json(result[0], { status: 201 });
}
