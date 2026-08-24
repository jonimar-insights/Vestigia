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
  const { itemId, title, detail, endTimestamp, timestamp, order, color, imageUrl } = body;

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
  if (endTimestamp === null) {
    // Slides support "hold" mode: NULL means wait for manual advance.
    // Clips must keep a numeric window — a null end would corrupt playback bounds.
    const [item] = await db
      .select({ type: clipItems.type })
      .from(clipItems)
      .where(and(eq(clipItems.id, itemId), eq(clipItems.cliplistId, listId)))
      .limit(1);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    if (item.type !== "slide") {
      return NextResponse.json({ error: "endTimestamp can only be null for slides" }, { status: 400 });
    }
    updateData.endTimestamp = null;
  } else if (endTimestamp !== undefined) {
    const end = Number(endTimestamp);
    if (!Number.isFinite(end) || end < 0) {
      return NextResponse.json({ error: "endTimestamp must be a non-negative number or null" }, { status: 400 });
    }
    updateData.endTimestamp = end;
  }
  if (color !== undefined) {
    if (color !== null && (typeof color !== "string" || color.length > 32)) {
      return NextResponse.json({ error: "color must be a string of at most 32 characters or null" }, { status: 400 });
    }
    updateData.color = color || null;
  }
  if (imageUrl !== undefined) {
    if (imageUrl !== null && (typeof imageUrl !== "string" || imageUrl.length > 2048 || !/^https?:\/\//i.test(imageUrl))) {
      return NextResponse.json({ error: "imageUrl must be an http(s) URL or null" }, { status: 400 });
    }
    updateData.imageUrl = imageUrl || null;
  }
  if (timestamp !== undefined) {
    const start = Number(timestamp);
    if (!Number.isFinite(start) || start < 0) {
      return NextResponse.json({ error: "timestamp must be a non-negative number" }, { status: 400 });
    }
    updateData.timestamp = start;
  }
  if (
    typeof updateData.timestamp === "number" &&
    typeof updateData.endTimestamp === "number" &&
    updateData.endTimestamp <= updateData.timestamp
  ) {
    return NextResponse.json({ error: "endTimestamp must be greater than timestamp" }, { status: 400 });
  }

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
  const { type, videoId, timestamp, endTimestamp, title, detail, tags, position, color, imageUrl } = body;

  if (!type || !title) {
    return NextResponse.json({ error: "Missing required fields: type, title" }, { status: 400 });
  }

  if (color !== undefined && color !== null && (typeof color !== "string" || color.length > 32)) {
    return NextResponse.json({ error: "color must be a string of at most 32 characters or null" }, { status: 400 });
  }
  if (imageUrl !== undefined && imageUrl !== null &&
      (typeof imageUrl !== "string" || imageUrl.length > 2048 || !/^https?:\/\//i.test(imageUrl))) {
    return NextResponse.json({ error: "imageUrl must be an http(s) URL or null" }, { status: 400 });
  }

  // New items are appended at the end of the playback order, unless an
  // explicit insert position is requested (existing items shift down).
  const [maxRow] = await db
    .select({ maxPos: sql<number>`coalesce(max(${clipItems.position}), -1)` })
    .from(clipItems)
    .where(eq(clipItems.cliplistId, listId));
  const maxPos = Number(maxRow?.maxPos ?? -1);
  let nextPosition = maxPos + 1;
  if (Number.isInteger(position) && (position as number) >= 0 && (position as number) <= maxPos + 1) {
    nextPosition = position as number;
    if (nextPosition <= maxPos) {
      await db
        .update(clipItems)
        .set({ position: sql`${clipItems.position} + 1` })
        .where(and(eq(clipItems.cliplistId, listId), sql`${clipItems.position} >= ${nextPosition}`));
    }
  }

  const extraSlideFields = {
    color: color || null,
    imageUrl: imageUrl || null,
  };

  // Slides don't need videoId/timestamp — they're inter-title cards.
  // endTimestamp stores the display duration in seconds; null = hold.
  if (type === "slide") {
    let slideEnd: number | null = 5;
    if (endTimestamp === null) slideEnd = null;
    else if (endTimestamp !== undefined) {
      const d = Number(endTimestamp);
      if (!Number.isFinite(d) || d < 0 || d > 3600) {
        return NextResponse.json({ error: "slide duration must be between 0 and 3600 seconds or null" }, { status: 400 });
      }
      slideEnd = d;
    }
    const [result] = await db
      .insert(clipItems)
      .values({
        cliplistId: listId,
        type,
        videoId: 0,
        timestamp: 0,
        endTimestamp: slideEnd,
        title,
        detail: detail || null,
        tags: tags ? JSON.stringify(tags) : null,
        ...extraSlideFields,
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
