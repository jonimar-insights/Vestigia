import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { savedImages } from "@/lib/schema";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(savedImages)
    .where(eq(savedImages.userId, session.user.id as string))
    .orderBy(asc(savedImages.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const { url, label } = body;
  if (typeof url !== "string" || !url.trim() || !/^https?:\/\//i.test(url.trim())) {
    return NextResponse.json({ error: "Image URL must be an http(s) URL" }, { status: 400 });
  }
  const trimmed = url.trim();
  if (trimmed.length > 2048) {
    return NextResponse.json({ error: "Image URL is too long" }, { status: 400 });
  }
  const db = getDb();
  const inserted = await db
    .insert(savedImages)
    .values({
      userId: session.user.id as string,
      url: trimmed,
      label: typeof label === "string" && label.trim() ? label.trim() : null,
    })
    .onConflictDoNothing({
      target: [savedImages.userId, savedImages.url],
    })
    .returning();
  // onConflictDoNothing returns [] when the row already exists; re-fetch it.
  const row =
    inserted[0] ??
    (
      await db
        .select()
        .from(savedImages)
        .where(and(eq(savedImages.userId, session.user.id as string), eq(savedImages.url, trimmed)))
        .limit(1)
    )[0];
  if (!row) {
    return NextResponse.json({ error: "Could not save image" }, { status: 500 });
  }
  return NextResponse.json(row);
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "", 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid image id" }, { status: 400 });
  }
  const db = getDb();
  await db
    .delete(savedImages)
    .where(and(eq(savedImages.id, id), eq(savedImages.userId, session.user.id as string)));
  return NextResponse.json({ ok: true });
}