import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getDb } from "@/lib/db";
import { savedImages } from "@/lib/schema";
import { auth } from "@/auth";

export const runtime = "nodejs";

const MAX_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

/**
 * Upload a local image file into the user's saved-image pool. Stores the file
 * in Vercel Blob (public) and inserts a row so the slide picker can reuse it.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let file: File | null = null;
  let label = "";
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    const l = form.get("label");
    if (typeof l === "string") label = l.trim();
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

  const db = getDb();
  try {
    const ext = file.type.split("/")[1];
    const blob = await put(
      `saved-images/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
      file,
      { access: "public", contentType: file.type, addRandomSuffix: false },
    );
    const [row] = await db
      .insert(savedImages)
      .values({
        userId: session.user.id as string,
        url: blob.url,
        label: label || null,
      })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error("[saved-images upload] failed:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}