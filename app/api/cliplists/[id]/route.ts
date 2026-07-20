import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cliplists, clipItems, videos } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const listId = parseInt(id, 10);
  if (isNaN(listId)) {
    return NextResponse.json({ error: "Invalid cliplist ID" }, { status: 400 });
  }

  const list = db.select().from(cliplists).where(eq(cliplists.id, listId)).get();
  if (!list) {
    return NextResponse.json({ error: "Cliplist not found" }, { status: 404 });
  }

  const items = db
    .select()
    .from(clipItems)
    .where(eq(clipItems.cliplistId, listId))
    .orderBy(desc(clipItems.createdAt))
    .all();

  // Attach video info to each item
  const videoIds = [...new Set(items.map((i) => i.videoId))];
  const videoMap = new Map<number, { title: string | null; thumbnailUrl: string | null }>();
  for (const vid of videoIds) {
    const v = db
      .select({ title: videos.title, thumbnailUrl: videos.thumbnailUrl })
      .from(videos)
      .where(eq(videos.id, vid))
      .get();
    if (v) videoMap.set(vid, v);
  }

  const itemsWithVideo = items.map((item) => ({
    ...item,
    tags: item.tags ? JSON.parse(item.tags) : [],
    videoTitle: videoMap.get(item.videoId)?.title ?? null,
    videoThumbnail: videoMap.get(item.videoId)?.thumbnailUrl ?? null,
  }));

  return NextResponse.json({ ...list, items: itemsWithVideo });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const listId = parseInt(id, 10);
  if (isNaN(listId)) {
    return NextResponse.json({ error: "Invalid cliplist ID" }, { status: 400 });
  }

  db.delete(cliplists).where(eq(cliplists.id, listId)).run();
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const listId = parseInt(id, 10);
  if (isNaN(listId)) {
    return NextResponse.json({ error: "Invalid cliplist ID" }, { status: 400 });
  }

  const body = await request.json();
  const { name, description } = body;

  const updateData: Record<string, string> = { updatedAt: new Date().toISOString() };
  if (name !== undefined) updateData.name = name.trim();
  if (description !== undefined) updateData.description = description?.trim() || null;

  db.update(cliplists).set(updateData).where(eq(cliplists.id, listId)).run();
  const updated = db.select().from(cliplists).where(eq(cliplists.id, listId)).get();
  return NextResponse.json(updated);
}