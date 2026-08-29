import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/schema";
import { eq, and, isNull } from "drizzle-orm";
import { auth } from "@/auth";

export const runtime = "nodejs";

const MAX_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

/**
 * Upload a picture file used as an audio/video cover. Stores the image in
 * Vercel Blob (public) and returns the URL for the Cover editor to save.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const videoId = parseInt(id);
  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .select({ id: videos.id })
    .from(videos)
    .where(and(eq(videos.id, videoId), eq(videos.userId, session.user.id as string), isNull(videos.deletedAt)))
    .limit(1);
  if (!rows[0]) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {}
  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large (max 6 MB)" }, { status: 400 });
  }

  try {
    const ext = file.type.split("/")[1];
    const blob = await put(
      `covers/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
      file,
      { access: "public", contentType: file.type, addRandomSuffix: false },
    );
    return NextResponse.json({ url: blob.url });
  } catch (error) {
    console.error("[cover upload] failed:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}