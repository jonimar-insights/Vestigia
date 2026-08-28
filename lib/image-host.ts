/**
 * next/image enforces `images.remotePatterns` and THROWS at render time for any
 * host not listed there — an unlisted cover/thumbnail URL would blank the whole
 * page. User-provided cover pictures may live on any host, so renders fall back
 * to `unoptimized` (plain <img>, no optimizer fetch / no SSRF) whenever the host
 * is not in the allowlist. Keep in sync with `images.remotePatterns` in
 * next.config.ts.
 */
const ALLOWED_HOSTS: Array<{ host: string; subdomains: boolean }> = [
  { host: "i.ytimg.com", subdomains: false },
  { host: "i.vimeocdn.com", subdomains: false },
  { host: "pbs.twimg.com", subdomains: false },
  { host: "p16-sign-va.tiktokcdn.com", subdomains: false },
  { host: "cdninstagram.com", subdomains: true },
  { host: "fbcdn.net", subdomains: true },
  { host: "public.blob.vercel-storage.com", subdomains: true },
  { host: "lh3.googleusercontent.com", subdomains: false },
  { host: "drive.google.com", subdomains: false },
];

/** True when src may be passed to the optimizer; false → render `unoptimized`. */
export function isTrustedImageUrl(src?: string | null): boolean {
  if (!src) return true;
  try {
    const u = new URL(src);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some(({ host: h, subdomains }) =>
      subdomains ? host === h || host.endsWith(`.${h}`) : host === h,
    );
  } catch {
    return false;
  }
}