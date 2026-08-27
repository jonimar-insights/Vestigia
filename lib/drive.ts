/** Helpers for importing videos stored on Google Drive. */

const DRIVE_HOSTS = [
  "drive.google.com",
  "drive.usercontent.google.com",
  "docs.google.com",
];

export function isGoogleDriveUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
  return DRIVE_HOSTS.includes(host);
}

/**
 * Extract a Drive file ID from a public Drive share URL.
 * Supports: /file/d/<ID>/view, /open?id=<ID>, /uc?id=<ID>,
 * drive.usercontent.google.com/download?id=<ID>.
 */
export function extractDriveFileId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const id = u.searchParams.get("id");
  if (id) return id;
  const m = u.pathname.match(/\/file\/d\/([^/]+)/);
  if (m) return m[1];
  return null;
}

/**
 * A playable src served through our same-origin streaming proxy.
 * Google's direct-download URL sets `Cross-Origin-Resource-Policy: same-site`,
 * so browsers refuse to load it inside a <video> element cross-origin; relaying
 * via /api/drive/stream/<id> (Range-aware) fixes playback. The relative path
 * works on both localhost and the deployed origin. File must be publicly shared.
 */
export function drivePlayableUrl(fileId: string): string {
  return `/api/drive/stream/${encodeURIComponent(fileId)}`;
}

/** Standard view URL for the browser (open in Drive). */
export function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}
