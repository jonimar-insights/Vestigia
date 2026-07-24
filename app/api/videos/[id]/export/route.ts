import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { annotations, videos } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { formatTimestamp } from "@/lib/youtube";
import { auth } from "@/auth";

export async function GET(
  request: NextRequest,
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
  const video = videoRows[0];

  const videoAnnotations = await db
    .select()
    .from(annotations)
    .where(eq(annotations.videoId, videoId))
    .orderBy(annotations.timestampStart);

  const format = request.nextUrl.searchParams.get("format") ?? "chapters";

  let output: string;
  switch (format) {
    case "json":
      output = JSON.stringify(
        videoAnnotations.map((a) => ({
          timestamp: formatTimestamp(a.timestampStart),
          timestampStart: a.timestampStart,
          label: a.label,
          tags: a.tags,
          note: a.note,
        })),
        null,
        2,
      );
      break;
    case "timestamps":
      output = videoAnnotations
        .map((a) => `${formatTimestamp(a.timestampStart)} - ${a.label}`)
        .join("\n");
      break;
    case "chapters":
    default:
      output = videoAnnotations
        .map((a) => `${formatTimestamp(a.timestampStart)} ${a.label}`)
        .join("\n");
      break;
  }

  return NextResponse.json({
    videoId: video.youtubeId,
    title: video.title,
    output,
    annotationCount: videoAnnotations.length,
  });
}
