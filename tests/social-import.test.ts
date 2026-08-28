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
  loadEnv();
  const ownerToken = await forgeToken("jonimar@gmail.com", "Joao");
  const cookieName = BASE.startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
  const ownerHeaders = { "Cookie": `${cookieName}=${ownerToken}`, ...jsonHeaders };

  const importUrl = async (url: string) =>
    fetch(`${BASE}/api/videos`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ url }),
    });

  let vimeoToCleanup: unknown = null;

  // ── Vimeo is now supported: imports successfully, plays via Player SDK ──
  const vimeoUrl = "https://vimeo.com/76979871";
  const vimRes = await importUrl(vimeoUrl);
  assert.ok(vimRes.status === 200 || vimRes.status === 201, `vimeo status ${vimRes.status}`);
  const vim = await vimRes.json();
  assert.equal(vim.created || vim.existing || vim.platform, "vimeo", "vimeo response shape");
  assert.ok(String(vim.youtubeId).startsWith("vimeo:"), `vimeo storage id ${vim.youtubeId}`);
  assert.ok(vim.title, "vimeo title populated from oEmbed");
  assert.ok(vim.thumbnailUrl, "vimeo thumbnail populated");
  if (vimRes.status === 201) vimeoToCleanup = vim.id;
  console.log(`vimeo imported: id=${vim.id} title="${vim.title}" thumbnail=${vim.thumbnailUrl}`);

  // idempotent — second import returns the same row (200) and no duplicate
  const vim2 = await importUrl(vimeoUrl);
  assert.equal(vim2.status, 200, `vimeo idempotent should be 200, got ${vim2.status}`);
  const vim2b = await vim2.json();
  assert.equal(vim2b.id, vim.id, "vimeo idempotent");
  console.log("vimeo idempotent: ok");

  // ── Other social networks remain rejected ──
  for (const [label, url] of [
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

  // ── existing social videos still render (playback untouched) ──
  const list = await fetch(`${BASE}/api/videos`, { headers: { "Cookie": `${cookieName}=${ownerToken}` } });
  assert.ok(list.ok);
  console.log("video list ok");

  console.log("ALL PASS — cleaning up");
  if (vimeoToCleanup) {
    await fetch(`${BASE}/api/videos/${vimeoToCleanup}`, { method: "DELETE", headers: ownerHeaders });
    console.log(`cleaned up vimeo id ${vimeoToCleanup}`);
  }
  await fetch(`${BASE}/api/videos/${yv.id}`, { method: "DELETE", headers: ownerHeaders });
  console.log("cleanup done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
