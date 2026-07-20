import fs from "fs";
import path from "path";

const THUMBNAILS_ROOT = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
  "thumbnails",
);

export function getThumbnailsDir(videoId: number): string {
  return path.join(THUMBNAILS_ROOT, String(videoId));
}

export function ensureThumbnailsDir(videoId: number): string {
  const dir = getThumbnailsDir(videoId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function persistThumbnails(
  videoId: number,
  tempThumbnailsDir: string,
): Map<string, string> {
  const destDir = ensureThumbnailsDir(videoId);
  const remap = new Map<string, string>();

  if (!fs.existsSync(tempThumbnailsDir)) return remap;

  const files = fs.readdirSync(tempThumbnailsDir);
  for (const file of files) {
    const src = path.join(tempThumbnailsDir, file);
    const dest = path.join(destDir, file);
    fs.copyFileSync(src, dest);
    remap.set(src, dest);
  }

  return remap;
}

export function cleanupThumbnailsDir(videoId: number): void {
  const dir = getThumbnailsDir(videoId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
