import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folderVideos, folders } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const folderId = parseInt(id);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const db = getDb();
  const body = await request.json();
  const { videoId } = body as { videoId: number };

  if (!videoId) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  // Check folder exists and belongs to user
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, session.user.id as string)))
    .limit(1);
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  // Check if already in folder
  const [existing] = await db
    .select()
    .from(folderVideos)
    .where(and(eq(folderVideos.folderId, folderId), eq(folderVideos.videoId, videoId)))
    .limit(1);

  if (existing) {
    return NextResponse.json({ ok: true, message: "Already in folder" });
  }

  await db.insert(folderVideos).values({
    folderId,
    videoId,
    addedAt: new Date().toISOString(),
  });

  // Update folder's updatedAt
  await db.update(folders).set({ updatedAt: new Date().toISOString() }).where(eq(folders.id, folderId));

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const folderId = parseInt(id);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const db = getDb();
  const body = await request.json();
  const { videoId } = body as { videoId: number };

  if (!videoId) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  // Verify folder belongs to user
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, session.user.id as string)))
    .limit(1);
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  await db
    .delete(folderVideos)
    .where(and(eq(folderVideos.folderId, folderId), eq(folderVideos.videoId, videoId)));

  // Update folder's updatedAt
  await db.update(folders).set({ updatedAt: new Date().toISOString() }).where(eq(folders.id, folderId));

  return NextResponse.json({ ok: true });
}
