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

export interface DriveProbe {
  contentType: string | null;
  fileName: string | null;
}

/**
 * Best-effort metadata probe of a public Drive file: asks Google for the first
 * byte and reads `content-type` + `Content-Disposition` filename. Used at import
 * time to detect audio files (probed as `audio/*`) so we can render an audio
 * player and offer a cover picture. Never throws — returns null on any failure.
 */
export async function probeDriveFile(
  fileId: string,
  timeoutMs = 5000,
): Promise<DriveProbe | null> {
  async function fetchOnce(extraParams = ""): Promise<Response | null> {
    try {
      return await fetch(
        `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
          fileId,
        )}&export=download${extraParams}`,
        {
          headers: { Range: "bytes=0-0", Accept: "*/*" },
          redirect: "follow",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch {
      return null;
    }
  }

  let res = await fetchOnce();
  if (!res) return null;

  // Google's HTML virus-scan page wraps files over its threshold. Re-request with
  // the embedded confirm token before trusting the response type.
  let html: string | undefined;
  if (/text\/html/i.test(res.headers.get("content-type") ?? "")) {
    try {
      html = await res.text();
    } catch {
      return null;
    }
    const confirm =
      html.match(/name=["']confirm["'][^>]*value=["']([A-Za-z0-9_-]+)["']/i)?.[1] ??
      html.match(/confirm=["']?([A-Za-z0-9_-]+)/i)?.[1];
    if (confirm) {
      res = (await fetchOnce(`&confirm=${encodeURIComponent(confirm)}`)) ?? res;
    }
  }

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim() || null;

  // Google encodes the real file name in Content-Disposition, e.g.
  // attachment; filename="song.mp3"; filename*=UTF-8''song.mp3
  let fileName: string | null = null;
  const cd = res.headers.get("content-disposition") ?? "";
  const enc = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (enc?.[1]) {
    try {
      fileName = decodeURIComponent(enc[1].replace(/["']/g, "")).trim();
    } catch {}
  }
  if (!fileName) {
    const plain = cd.match(/filename="?([^";]+)"?/i);
    if (plain?.[1]) fileName = plain[1].trim();
  }

  return { contentType, fileName };
}

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|wma|mka|weba)$/i;

/** True when a probe/browser-sniff flag a Drive file as audio. */
export function probeIsAudio(probe: DriveProbe | null): boolean {
  if (probe?.contentType?.startsWith("audio/")) return true;
  return probe?.fileName ? AUDIO_EXT.test(probe.fileName) : false;
}
