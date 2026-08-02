import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders, folderVideos, videos, annotations, folderShares } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = rateLimit(request, { max: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { token } = await params;
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const db = getDb();

  const folderRows = await db
    .select()
    .from(folders)
    .where(eq(folders.shareToken, token))
    .limit(1);
  if (!folderRows[0]) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }
  const folder = folderRows[0];

  // Any authorized collaborator (view or edit) may export
  const shareRows = await db
    .select()
    .from(folderShares)
    .where(eq(folderShares.folderId, folder.id));
  if (!shareRows.some((s) => s.email.toLowerCase() === email)) {
    return NextResponse.json({ error: "Email not authorized" }, { status: 403 });
  }

  const fv = await db
    .select()
    .from(folderVideos)
    .where(eq(folderVideos.folderId, folder.id));
  const videoIds = fv.map((v) => v.videoId);

  const videoRows =
    videoIds.length > 0
      ? await db
          .select({ id: videos.id, title: videos.title, youtubeId: videos.youtubeId })
          .from(videos)
          .where(inArray(videos.id, videoIds))
      : [];
  const titleMap = new Map(videoRows.map((v) => [v.id, v.title]));
  const ytMap = new Map(videoRows.map((v) => [v.id, v.youtubeId]));

  const annRows =
    videoIds.length > 0
      ? await db
          .select()
          .from(annotations)
          .where(inArray(annotations.videoId, videoIds))
          .orderBy(desc(annotations.createdAt))
      : [];

  const items = annRows.map((a) => ({
    videoId: a.videoId,
    videoTitle: titleMap.get(a.videoId) ?? "Untitled",
    youtubeId: ytMap.get(a.videoId) ?? "",
    timestampStart: a.timestampStart,
    timestampEnd: a.timestampEnd,
    note: a.note ?? "",
    createdBy: a.createdBy,
    email: a.email ?? "",
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));

  if (format === "csv") {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "video_id",
      "video_title",
      "youtube_id",
      "start",
      "end",
      "note",
      "author",
      "email",
      "created_at",
      "updated_at",
    ];
    const rows = [
      header.join(","),
      ...items.map((i) =>
        [
          i.videoId,
          esc(i.videoTitle),
          esc(i.youtubeId),
          i.timestampStart,
          i.timestampEnd,
          esc(i.note),
          esc(i.createdBy),
          esc(i.email),
          i.createdAt,
          i.updatedAt,
        ].join(",")
      ),
    ];
    return new NextResponse(rows.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="annotations-${folder.id}.csv"`,
      },
    });
  }

  return NextResponse.json({
    folder: folder.name,
    count: items.length,
    annotations: items,
  });
}
