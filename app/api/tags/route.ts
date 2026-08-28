import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, annotations } from "@/lib/schema";
import { eq, and, isNull } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const userId = session.user.id as string;

  const userAnnotations = await db
    .select({ tags: annotations.tags })
    .from(annotations)
    .innerJoin(videos, eq(videos.id, annotations.videoId))
    .where(and(eq(videos.userId, userId), isNull(videos.deletedAt)));

  const counts: Record<string, number> = {};

  for (const row of userAnnotations) {
    if (!row.tags) continue;
    try {
      const parsed: string[] = JSON.parse(row.tags);
      if (!Array.isArray(parsed)) continue;
      for (const tag of parsed) {
        const t = tag.trim().toLowerCase();
        if (t) counts[t] = (counts[t] ?? 0) + 1;
      }
    } catch {
      // skip malformed JSON
    }
  }

  const tags = Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ tags });
}
