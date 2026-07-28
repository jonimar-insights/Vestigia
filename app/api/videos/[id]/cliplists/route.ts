import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { clipItems, cliplists } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const videoId = parseInt(id, 10);
  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const rows = await db
    .select({
      cliplistId: clipItems.cliplistId,
      cliplistName: cliplists.name,
      timestamp: clipItems.timestamp,
      endTimestamp: clipItems.endTimestamp,
      title: clipItems.title,
    })
    .from(clipItems)
    .innerJoin(cliplists, eq(clipItems.cliplistId, cliplists.id))
    .where(
      and(
        eq(clipItems.videoId, videoId),
        eq(cliplists.userId, session.user.id as string),
      ),
    );

  return NextResponse.json(rows);
}
