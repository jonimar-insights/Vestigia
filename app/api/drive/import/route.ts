import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/auth";
import { createVideo } from "@/lib/import-video";

export const runtime = "nodejs";

const DRIVE_FILE_GET = "https://www.googleapis.com/drive/v3/files";

/**
 * Copy-mode Google Drive import: download the selected Drive file (using the
 * token obtained from the Google Picker), store it in Vercel Blob (like the
 * former local-file upload), then register it as a self-hosted video.
 *
 * Body: { fileId, accessToken, name?, mimeType? }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = String(session.user.id);
  const userName = session.user.name ?? undefined;

  let body: { fileId?: string; accessToken?: string; name?: string; mimeType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { fileId, accessToken, name, mimeType } = body;
  if (!fileId || !accessToken) {
    return NextResponse.json(
      { error: "fileId and accessToken are required" },
      { status: 400 },
    );
  }

  const mediaUrl = `${DRIVE_FILE_GET}/${encodeURIComponent(fileId)}?alt=media`;
  let mediaRes: Response;
  try {
    mediaRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "follow",
    });
  } catch (e) {
    console.error("[drive] media fetch failed:", e);
    return NextResponse.json(
      { error: "Could not reach Google Drive. Is the file still accessible?" },
      { status: 502 },
    );
  }
  if (!mediaRes.ok) {
    return NextResponse.json(
      { error: `Google Drive returned ${mediaRes.status}. Re-auth with the picker and try again.` },
      { status: 502 },
    );
  }

  const media = await mediaRes.arrayBuffer();
  const bytes = Buffer.from(media);
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "The selected file is empty" }, { status: 400 });
  }

  const safeName = (name || "drive-video").trim().replace(/[^\w.\- ]+/g, "_");
  const ext = safeName.includes(".") ? safeName.split(".").pop()!.toLowerCase() : "mp4";
  const filename = `${safeName.replace(/\.[^.]+$/, "")}.${ext}`;
  const contentType = mimeType && mimeType.startsWith("video/") ? mimeType : "video/mp4";

  let blob;
  try {
    blob = await put(`drive-imports/${Date.now()}-${filename}`, bytes, {
      access: "public",
      contentType,
      addRandomSuffix: true,
    });
  } catch (e) {
    console.error("[drive] blob put failed:", e);
    return NextResponse.json({ error: "Failed to store the video file" }, { status: 500 });
  }

  const result = await createVideo({
    url: blob.url,
    title: safeName.replace(/\.[^.]+$/, ""),
    userId,
    userName,
  });
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ video: result.video, existing: result.existing }, { status: 201 });
}
