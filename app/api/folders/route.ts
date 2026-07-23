import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders, folderVideos } from "@/lib/schema";
import { eq, desc, count } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const allFolders = await db.select().from(folders).orderBy(desc(folders.updatedAt));

  const result = await Promise.all(
    allFolders.map(async (f) => {
      const [{ value: videoCount }] = await db
        .select({ value: count() })
        .from(folderVideos)
        .where(eq(folderVideos.folderId, f.id));
      return { ...f, videoCount };
    }),
  );

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const body = await request.json();
  const { name, description, color } = body as { name: string; description?: string; color?: string };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const [result] = await db
    .insert(folders)
    .values({
      name: name.trim(),
      description: description?.trim() || null,
      color: color || "bg-accent",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return NextResponse.json(result, { status: 201 });
}
