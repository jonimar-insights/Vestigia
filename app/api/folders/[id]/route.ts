import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders, folderVideos, videos } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folderId = parseInt(id);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const db = getDb();
  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const items = await db
    .select({ video: videos, addedAt: folderVideos.addedAt })
    .from(folderVideos)
    .innerJoin(videos, eq(folderVideos.videoId, videos.id))
    .where(eq(folderVideos.folderId, folderId))
    .orderBy(desc(folderVideos.addedAt));

  return NextResponse.json({
    ...folder,
    videos: items.map((i) => ({ ...i.video, addedAt: i.addedAt })),
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folderId = parseInt(id);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const db = getDb();
  const body = await request.json();
  const { name, description, color } = body as { name?: string; description?: string; color?: string };

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (color !== undefined) updates.color = color;

  await db.update(folders).set(updates).where(eq(folders.id, folderId));
  const [updated] = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folderId = parseInt(id);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const db = getDb();
  await db.delete(folders).where(eq(folders.id, folderId));

  return NextResponse.json({ ok: true });
}
