import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders, folderVideos, folderShares } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { createVideo } from "@/lib/import-video";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = rateLimit(request, { max: 20, windowMs: 60_000 });
  if (limited) return limited;

  const { token } = await params;
  const body = await request.json();
  const { email, name, url, title, thumbnailUrl, extractKeyMoments } = body as {
    email?: string;
    name?: string;
    url?: string;
    title?: string;
    thumbnailUrl?: string;
    extractKeyMoments?: boolean;
  };

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
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

  // The collaborator must be an invited email with edit permission
  const shareRows = await db
    .select()
    .from(folderShares)
    .where(
      and(
        eq(folderShares.folderId, folder.id),
        eq(folderShares.email, email.toLowerCase())
      )
    )
    .limit(1);
  if (!shareRows[0] || shareRows[0].permission !== "edit") {
    return NextResponse.json({ error: "Edit permission required" }, { status: 403 });
  }

  const result = await createVideo({
    url,
    title,
    thumbnailUrl,
    extractKeyMoments,
    userId: folder.userId ?? null,
    userName: name?.trim() || shareRows[0].email.split("@")[0],
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const video = result.video;

  // Link to the folder (idempotent)
  const [existing] = await db
    .select()
    .from(folderVideos)
    .where(
      and(eq(folderVideos.folderId, folder.id), eq(folderVideos.videoId, video.id))
    )
    .limit(1);

  if (existing) {
    return NextResponse.json({
      ok: true,
      message: "Already in folder",
      videoId: video.id,
      created: false,
    });
  }

  await db.insert(folderVideos).values({
    folderId: folder.id,
    videoId: video.id,
    addedAt: new Date().toISOString(),
  });

  await db
    .update(folders)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(folders.id, folder.id));

  return NextResponse.json({ ok: true, videoId: video.id, created: !result.existing }, { status: 201 });
}
