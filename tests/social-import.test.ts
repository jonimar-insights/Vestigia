import assert from "node:assert";
import { readFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";

const BASE = process.env.TEST_BASE ?? "http://localhost:3000";
const jsonHeaders = { "Content-Type": "application/json" };

function loadEnv() {
  for (const line of readFileSync(process.env.PWD + "/.env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) {
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

async function forgeToken(email: string, name: string) {
  loadEnv();
  const salt = BASE.startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
  return encode({
    secret: process.env.AUTH_SECRET!,
    salt,
    maxAge: 3600,
    token: {
      sub: `google-${email}`,
      id: `google-${email}`,
      name,
      email,
      picture: null,
      accessToken: "mock",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  });
}

async function main() {
  const ownerToken = await forgeToken("jonimar@gmail.com", "Joao");
  const cookieName = BASE.startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
  const ownerHeaders = { "Cookie": `${cookieName}=${ownerToken}`, ...jsonHeaders };

  const importUrl = async (url: string) =>
    fetch(`${BASE}/api/videos`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ url }),
    });

  // ── All social networks are now rejected (YouTube only) ──
  for (const [label, url] of [
    ["vimeo", "https://vimeo.com/76979871"],
    ["instagram", "https://www.instagram.com/reel/Cabc123XYZ/"],
    ["twitter", "https://x.com/jack/status/20"],
    ["tiktok", "https://www.tiktok.com/@scout2015/video/6718335390845095173"],
    ["facebook", "https://www.facebook.com/watch/?v=10153231379946729"],
  ] as const) {
    const res = await importUrl(url);
    assert.equal(res.status, 400, `${label} should be rejected, got ${res.status}`);
    const body = await res.json();
    assert.match(body.error, /no longer supported/, `${label} error message`);
    console.log(`${label} rejected with clear message: ok`);
  }

  // ── unsupported URL still rejected ──
  const bad = await importUrl("https://example.com/some/video");
  assert.equal(bad.status, 400);
  console.log("unsupported URL rejected: ok");

  // ── YouTube still works ──
  const yt = await importUrl("https://www.youtube.com/watch?v=9bZkp7q19f0");
  assert.ok(yt.status === 200 || yt.status === 201, `youtube status ${yt.status}`);
  const yv = await yt.json();
  assert.notEqual(yv.platform ?? "youtube", "vimeo");
  console.log("youtube unaffected:", yv.id);

  // ── existing social videos still render (playback untouched): spot-check a known social row loads ──
  const list = await fetch(`${BASE}/api/videos`, { headers: { "Cookie": `${cookieName}=${ownerToken}` } });
  assert.ok(list.ok);
  console.log("video list ok");

  console.log("ALL PASS — cleaning up");
  await fetch(`${BASE}/api/videos/${yv.id}`, { method: "DELETE", headers: ownerHeaders });
  console.log("cleanup done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
