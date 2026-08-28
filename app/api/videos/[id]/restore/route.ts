import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const videoId = parseInt(id);

  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const videoRows = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, videoId), eq(videos.userId, session.user.id as string)))
    .limit(1);
  if (!videoRows[0]) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  if (videoRows[0].deletedAt == null) {
    return NextResponse.json({ ok: true, video: videoRows[0], alreadyLive: true });
  }

  const [video] = await db
    .update(videos)
    .set({ deletedAt: null })
    .where(eq(videos.id, videoId))
    .returning();

  return NextResponse.json({ ok: true, video });
}