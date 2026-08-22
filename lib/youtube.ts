export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type NoteToken =
  | { kind: "text"; value: string }
  | { kind: "link"; href: string; display: string };

const NOTE_LINK_RE = /\[([^\]\n]+)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

export function normalizeHref(url: string): string {
  return /^www\./i.test(url) ? `https://${url}` : url;
}

export function tokenizeNoteLinks(text: string): NoteToken[] {
  const tokens: NoteToken[] = [];
  let last = 0;
  for (const match of text.matchAll(NOTE_LINK_RE)) {
    const idx = match.index;
    if (idx > last) tokens.push({ kind: "text", value: text.slice(last, idx) });
    if (match[2] !== undefined) {
      tokens.push({ kind: "link", href: normalizeHref(match[2]), display: match[1] });
      last = idx + match[0].length;
    } else {
      let url = match[3].replace(/[.,;:!?]+$/, "");
      if (url.endsWith(")") && !url.slice(0, -1).includes("(")) {
        url = url.slice(0, -1).replace(/[.,;:!?]+$/, "");
      }
      if (!url) {
        tokens.push({ kind: "text", value: match[0] });
        last = idx + match[0].length;
        continue;
      }
      tokens.push({ kind: "link", href: normalizeHref(url), display: url });
      last = idx + url.length;
    }
  }
  if (last < text.length) tokens.push({ kind: "text", value: text.slice(last) });
  return tokens;
}

export function parseYouTubeChaptersUrl(url: string): string | null {
  try {
    const id = extractYouTubeId(url);
    if (!id) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  } catch {
    return null;
  }
}
