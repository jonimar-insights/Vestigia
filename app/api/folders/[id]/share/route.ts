import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders } from "@/lib/schema";
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
  const folderId = parseInt(id, 10);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(folders)
    .where(eq(folders.id, folderId))
    .limit(1);
  if (!rows[0]) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  let token = rows[0].shareToken;
  if (!token) {
    token = crypto.randomUUID();
    await db
      .update(folders)
      .set({ shareToken: token, updatedAt: new Date().toISOString() })
      .where(eq(folders.id, folderId));
  }

  const origin = _request.headers.get("origin") ?? "https://vestigia-vercel.vercel.app";
  return NextResponse.json({ token, url: `${origin}/shared/folder/${token}` });
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
  const folderId = parseInt(id, 10);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  await db
    .update(folders)
    .set({ shareToken: null, updatedAt: new Date().toISOString() })
    .where(eq(folders.id, folderId));

  return NextResponse.json({ success: true });
}
