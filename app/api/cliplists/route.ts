import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cliplists, clipItems } from "@/lib/schema";
import { eq, desc, and } from "drizzle-orm";

export async function GET() {
  const lists = db
    .select()
    .from(cliplists)
    .orderBy(desc(cliplists.updatedAt))
    .all();

  // Attach item count to each list
  const result = lists.map((list) => {
    const count = db
      .select({ id: clipItems.id })
      .from(clipItems)
      .where(eq(clipItems.cliplistId, list.id))
      .all().length;
    return { ...list, itemCount: count };
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description } = body;

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const result = db
    .insert(cliplists)
    .values({
      name: name.trim(),
      description: description?.trim() || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return NextResponse.json(result, { status: 201 });
}