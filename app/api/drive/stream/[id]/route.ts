import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRIVE_DOWNLOAD = "https://drive.usercontent.google.com/download";

function isHtml(res: Response): boolean {
  const ct = res.headers.get("content-type") ?? "";
  return /text\/html/i.test(ct);
}

/**
 * Google serves an HTML "virus scan" confirmation page for files over ~25MB
 * (well, for files that exceed its scan threshold) instead of the raw bytes.
 * The page embeds a hidden `confirm` token that must be echoed back via a
 * `confirm` query param to get the actual media. Extract it from the form.
 */
function extractConfirmToken(html: string): string | null {
  // <input type="hidden" name="confirm" value="t" />  (token is usually like "t", "AxqQ...")
  const re = /name=["']confirm["'][^>]*value=["']([A-Za-z0-9_-]+)["']/i;
  const m = html.match(re);
  if (m?.[1]) return m[1];
  const m2 = html.match(/confirm=["']?([A-Za-z0-9_-]+)/i);
  return m2?.[1] ?? null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  let target = `${DRIVE_DOWNLOAD}?id=${encodeURIComponent(id)}&export=download`;

  const upstreamHeaders: Record<string, string> = {};
  const range = request.headers.get("range");
  if (range) upstreamHeaders["Range"] = range;
  upstreamHeaders["Accept"] = "*/*";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: upstreamHeaders,
      redirect: "follow",
      cache: "no-store",
    });
  } catch (e) {
    console.error("[drive/stream] upstream fetch failed:", e);
    return new Response("Upstream error", { status: 502 });
  }

  // Google returns an HTML virus-scan page for larger files. Detect it, grab the
  // confirm token, and re-request with that token (still honoring Range).
  if (upstream.ok && (upstream.status === 200 || upstream.status === 206) && isHtml(upstream)) {
    const html = await upstream.text();
    const confirm = extractConfirmToken(html);
    if (!confirm) {
      // Fall back to the HTML itself so the caller sees something rather than hang.
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    target = `${DRIVE_DOWNLOAD}?id=${encodeURIComponent(id)}&export=download&confirm=${encodeURIComponent(
      confirm,
    )}`;
    try {
      const retryHeaders: Record<string, string> = { Accept: "*/*" };
      if (range) retryHeaders["Range"] = range;
      const retry = await fetch(target, {
        headers: retryHeaders,
        redirect: "follow",
        cache: "no-store",
      });
      if (retry.ok || retry.status === 206) {
        upstream = retry;
      } else {
        return new Response("Upstream error", { status: retry.status });
      }
    } catch (e) {
      console.error("[drive/stream] confirm retry failed:", e);
      return new Response("Upstream error", { status: 502 });
    }
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Upstream error", { status: upstream.status });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("content-range", contentRange);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) headers.set("accept-ranges", acceptRanges);
  headers.set("cross-origin-resource-policy", "cross-origin");
  headers.set("access-control-allow-origin", "*");
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
