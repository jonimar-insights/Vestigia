export type SocialPlatform = "tiktok" | "instagram" | "twitter" | "facebook" | "vimeo";

export interface SocialMatch {
  platform: SocialPlatform;
  platformId: string;
}

export function detectSocialPlatform(url: string): SocialMatch | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname;

  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const m = path.match(/\/video\/(\d+)/);
    if (m) return { platform: "tiktok", platformId: m[1] };
  }

  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const m = path.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    if (m) return { platform: "instagram", platformId: m[1] };
  }

  if (host === "x.com" || host === "twitter.com") {
    const m = path.match(/\/status\/(\d+)/);
    if (m) return { platform: "twitter", platformId: m[1] };
  }

  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") {
    const watchV = u.searchParams.get("v");
    if (path.includes("/watch") && watchV && /^\d+$/.test(watchV)) {
      return { platform: "facebook", platformId: watchV };
    }
    const mv = path.match(/\/(?:videos|reel)\/(\d+)/);
    if (mv) return { platform: "facebook", platformId: mv[1] };
  }

  if (host === "vimeo.com" || host.endsWith(".vimeo.com")) {
    // Canonical: https://vimeo.com/<id> or https://vimeo.com/video/<id>.
    // Prefer the id after /video/, otherwise take the LAST numeric path segment
    // (for URLs like /album/<albumId>/video/<videoId>). Stop at ? or #.
    const withoutQuery = path.split(/[?#]/)[0];
    let platformId: string | null = null;
    const videoSeg = withoutQuery.match(/\/video\/(\d{5,})/);
    if (videoSeg) platformId = videoSeg[1];
    else {
      const nums = withoutQuery.match(/(?:^|\/)(\d{5,})$/);
      if (nums) platformId = nums[1];
    }
    if (!platformId) return null;
    // Unlisted/privacy-restricted videos need the ?h= hash in the embed URL.
    // Fold it into the platformId so it survives storage + dedup.
    const h = u.searchParams.get("h");
    return { platform: "vimeo", platformId: h ? `${platformId}?h=${h}` : platformId };
  }

  return null;
}

/**
 * Split a Vimeo spec string ("<id>?h=<hash>" or "<id>") into an id + optional
 * privacy hash. Used by the Player SDK, which needs `loadVideo({id, h})` /
 * a URL including the hash for unlisted videos.
 */
export function parseVimeoSpec(spec: string): { id: string; hash?: string } {
  const q = spec.indexOf("?");
  if (q === -1) return { id: spec };
  const id = spec.slice(0, q);
  const params = new URLSearchParams(spec.slice(q + 1));
  const hash = params.get("h") ?? undefined;
  return { id, hash };
}

/** Build the full playable player.vimeo.com URL (with api=1 + privacy hash). */
export function vimeoEmbedUrl(platformId: string): string {
  const { id, hash } = parseVimeoSpec(platformId);
  const base = `https://player.vimeo.com/video/${id}`;
  const separator = hash ? "&" : "?";
  const query = hash ? `?h=${hash}` : "";
  return `${base}${query}${separator}api=1`;
}

export function isSocialUrl(url: string): boolean {
  return detectSocialPlatform(url) !== null;
}

/** Storage key for the videos.youtube_id column (prefixed to avoid collisions). */
export function socialStorageId(match: SocialMatch): string {
  return `${match.platform}:${match.platformId}`;
}

export function parseSocialStorageId(youtubeId: string): SocialMatch | null {
  const idx = youtubeId.indexOf(":");
  if (idx <= 0) return null;
  const platform = youtubeId.slice(0, idx) as SocialPlatform;
  const known: SocialPlatform[] = ["tiktok", "instagram", "twitter", "facebook", "vimeo"];
  if (!known.includes(platform)) return null;
  return { platform, platformId: youtubeId.slice(idx + 1) };
}

export function socialEmbedUrl(
  platform: SocialPlatform,
  platformId: string,
  canonicalUrl: string
): string {
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/embed/v2/${platformId}`;
    case "instagram":
      return /\/reel/.test(canonicalUrl)
        ? `https://www.instagram.com/reel/${platformId}/embed`
        : `https://www.instagram.com/p/${platformId}/embed`;
    case "twitter":
      return `https://platform.twitter.com/embed/Tweet.html?id=${platformId}`;
    case "facebook":
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonicalUrl)}&show_text=false`;
    case "vimeo":
      return `https://player.vimeo.com/video/${platformId}`;
  }
}

export interface SocialMeta {
  title: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
}

function stripEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchWithTimeout(url: string, ms = 5000): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

function ogMeta(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`,
    "i"
  );
  const m = html.match(re);
  const raw = m?.[1] ?? m?.[2];
  return raw ? stripEntities(raw) : null;
}

export async function fetchSocialMeta(url: string, match: SocialMatch): Promise<SocialMeta> {
  let title: string | null = null;
  let thumbnailUrl: string | null = null;
  let durationSeconds: number | null = null;

  // Public oEmbed APIs where available
  if (match.platform === "tiktok") {
    const res = await fetchWithTimeout(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (res) {
      try {
        const data = (await res.json()) as { title?: string; thumbnail_url?: string };
        title = data.title ?? null;
        thumbnailUrl = data.thumbnail_url ?? null;
      } catch {}
    }
  } else if (match.platform === "vimeo") {
    const res = await fetchWithTimeout(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
    if (res) {
      try {
        const data = (await res.json()) as {
          title?: string;
          thumbnail_url?: string;
          duration?: number;
        };
        title = data.title ?? null;
        thumbnailUrl = data.thumbnail_url ?? null;
        if (typeof data.duration === "number") durationSeconds = data.duration;
      } catch {}
    }
  }

  // Fallback / supplement: scrape Open Graph tags from the page itself
  if (!title || !thumbnailUrl) {
    const pageRes = await fetchWithTimeout(url);
    if (pageRes) {
      try {
        const html = (await pageRes.text()).slice(0, 500_000);
        title = title ?? ogMeta(html, "og:title");
        thumbnailUrl = thumbnailUrl ?? ogMeta(html, "og:image");
        if (!title) title = ogMeta(html, "twitter:title");
        if (!thumbnailUrl) thumbnailUrl = ogMeta(html, "twitter:image");
      } catch {}
    }
  }

  return {
    title: title?.trim() || null,
    thumbnailUrl: thumbnailUrl?.trim() || null,
    durationSeconds,
  };
}
