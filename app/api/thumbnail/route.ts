import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const THUMBNAILS_ROOT = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
  "thumbnails",
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "Path is required" }, { status: 400 });
  }

  let resolvedPath: string;
  try {
    resolvedPath = fs.realpathSync(path.resolve(filePath));
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(THUMBNAILS_ROOT);
  } catch {
    return NextResponse.json({ error: "Thumbnails directory not found" }, { status: 404 });
  }

  if (!resolvedPath.startsWith(realRoot + path.sep) && resolvedPath !== realRoot) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };

  const contentType = mimeTypes[ext] || "application/octet-stream";
  const fileBuffer = fs.readFileSync(resolvedPath);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
