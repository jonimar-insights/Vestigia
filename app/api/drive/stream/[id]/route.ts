import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin streaming proxy for Google Drive videos.
 *
 * Google's direct-download endpoint sets `Cross-Origin-Resource-Policy: same-site`,
 * which makes browsers BLOCK the cross-origin fetch inside a <video> element
 * (MEDIA_ERR_SRC_NOT_SUPPORTED / format error). Serving the bytes from our own
 * origin bypasses that, so we relay Range requests here and stream the response.
 *
 * The target file must be publicly shared ("anyone with the link can view").
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const target = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
    id,
  )}&export=download`;

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
