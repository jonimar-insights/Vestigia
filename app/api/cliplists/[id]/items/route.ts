import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { clipItems, cliplists } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { auth } from "@/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const listId = parseInt(id, 10);
  if (isNaN(listId)) {
    return NextResponse.json({ error: "Invalid cliplist ID" }, { status: 400 });
  }

  const listRows = await db
    .select()
    .from(cliplists)
    .where(eq(cliplists.id, listId))
    .limit(1);
  if (!listRows[0]) {
    return NextResponse.json({ error: "Cliplist not found" }, { status: 404 });
  }

  const body = await request.json();
  const { itemId, title, detail, endTimestamp, order } = body;

  // Reorder mode: body { order: number[] } — full list of item ids in the
  // desired playback order. Items not included keep their old position.
  if (order !== undefined) {
    if (!Array.isArray(order) || order.length === 0 || order.some((id: unknown) => !Number.isInteger(id))) {
      return NextResponse.json({ error: "order must be a non-empty array of item ids" }, { status: 400 });
    }
    const owned = await db
      .select({ id: clipItems.id })
      .from(clipItems)
      .where(eq(clipItems.cliplistId, listId));
    const ownedSet = new Set(owned.map((r) => r.id));
    if (!order.every((id: number) => ownedSet.has(id))) {
      return NextResponse.json({ error: "order contains items that are not in this cliplist" }, { status: 400 });
    }
    for (let i = 0; i < order.length; i++) {
      await db
        .update(clipItems)
        .set({ position: i })
        .where(and(eq(clipItems.id, order[i]), eq(clipItems.cliplistId, listId)));
    }
    await db.update(cliplists)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(cliplists.id, listId));
    return NextResponse.json({ success: true });
  }

  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title.trim();
  if (detail !== undefined) updateData.detail = detail || null;
  if (endTimestamp !== undefined) updateData.endTimestamp = endTimestamp;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db
    .update(clipItems)
    .set(updateData)
    .where(and(eq(clipItems.id, itemId), eq(clipItems.cliplistId, listId)));

  await db.update(cliplists)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(cliplists.id, listId));

  const [updated] = await db
    .select()
    .from(clipItems)
    .where(and(eq(clipItems.id, itemId), eq(clipItems.cliplistId, listId)))
    .limit(1);

  return NextResponse.json(updated ?? { success: true });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const listId = parseInt(id, 10);
  if (isNaN(listId)) {
    return NextResponse.json({ error: "Invalid cliplist ID" }, { status: 400 });
  }

  const listRows = await db
    .select()
    .from(cliplists)
    .where(eq(cliplists.id, listId))
    .limit(1);
  if (!listRows[0]) {
    return NextResponse.json({ error: "Cliplist not found" }, { status: 404 });
  }

  const body = await request.json();
  const { type, videoId, timestamp, endTimestamp, title, detail, tags } = body;

  if (!type || !title) {
    return NextResponse.json({ error: "Missing required fields: type, title" }, { status: 400 });
  }

  // New items are appended at the end of the playback order
  const [maxRow] = await db
    .select({ maxPos: sql<number>`coalesce(max(${clipItems.position}), -1)` })
    .from(clipItems)
    .where(eq(clipItems.cliplistId, listId));
  const nextPosition = Number(maxRow?.maxPos ?? -1) + 1;

  // Slides don't need videoId/timestamp — they're inter-title cards
  if (type === "slide") {
    const [result] = await db
      .insert(clipItems)
      .values({
        cliplistId: listId,
        type,
        videoId: 0,
        timestamp: 0,
        endTimestamp: null,
        title,
        detail: detail || null,
        tags: tags ? JSON.stringify(tags) : null,
        position: nextPosition,
      })
      .returning();

    await db.update(cliplists)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(cliplists.id, listId));

    return NextResponse.json(result, { status: 201 });
  }

  if (videoId === undefined || timestamp === undefined) {
    return NextResponse.json({ error: "Missing required fields: videoId, timestamp" }, { status: 400 });
  }

  const [result] = await db
    .insert(clipItems)
    .values({
      cliplistId: listId,
      type,
      videoId,
      timestamp,
      endTimestamp: endTimestamp ?? null,
      title,
      detail: detail || null,
      tags: tags ? JSON.stringify(tags) : null,
      position: nextPosition,
    })
    .returning();

  await db.update(cliplists)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(cliplists.id, listId));

  return NextResponse.json(result, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const listId = parseInt(id, 10);
  if (isNaN(listId)) {
    return NextResponse.json({ error: "Invalid cliplist ID" }, { status: 400 });
  }

  const listRows = await db
    .select()
    .from(cliplists)
    .where(eq(cliplists.id, listId))
    .limit(1);
  if (!listRows[0]) {
    return NextResponse.json({ error: "Cliplist not found" }, { status: 404 });
  }

  const body = await request.json();
  const { itemId } = body;

  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  await db.delete(clipItems)
    .where(and(eq(clipItems.id, itemId), eq(clipItems.cliplistId, listId)));

  await db.update(cliplists)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(cliplists.id, listId));

  return NextResponse.json({ success: true });
}
