import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { cliplists, clipItems, videos } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";

export async function POST(
  _request: NextRequest,
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

  const rows = await db
    .select()
    .from(cliplists)
    .where(eq(cliplists.id, listId))
    .limit(1);
  if (!rows[0]) {
    return NextResponse.json({ error: "Cliplist not found" }, { status: 404 });
  }

  let token = rows[0].shareToken;
  if (!token) {
    token = crypto.randomUUID();
    await db
      .update(cliplists)
      .set({ shareToken: token, updatedAt: new Date().toISOString() })
      .where(eq(cliplists.id, listId));
  }

  const origin = _request.headers.get("origin") ?? "https://vestigia.vercel.app";
  return NextResponse.json({ token, url: `${origin}/shared/cliplist/${token}` });
}

export async function DELETE(
  _request: NextRequest,
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

  await db
    .update(cliplists)
    .set({ shareToken: null, updatedAt: new Date().toISOString() })
    .where(eq(cliplists.id, listId));

  return NextResponse.json({ success: true });
}
