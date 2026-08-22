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

  // ── Vimeo (public oEmbed → title/thumbnail/duration) ──
  const vimeo = await importUrl("https://vimeo.com/76979871");
  assert.equal(vimeo.status, 201, `vimeo status ${vimeo.status}`);
  const v = await vimeo.json();
  assert.equal(v.platform, "vimeo");
  assert.equal(v.youtubeId, "vimeo:76979871");
  console.log("vimeo imported:", v.id, JSON.stringify({ title: v.title?.slice(0, 40), thumb: !!v.thumbnailUrl }));

  // idempotent for same user
  const vimeoAgain = await importUrl("https://vimeo.com/76979871");
  assert.equal(vimeoAgain.status, 200);
  const va = await vimeoAgain.json();
  assert.equal(va.id, v.id);
  console.log("vimeo idempotent: ok");

  // ── Instagram reel (metadata may be blocked; import must still succeed) ──
  const ig = await importUrl("https://www.instagram.com/reel/Cabc123XYZ/");
  assert.equal(ig.status, 201, `instagram status ${ig.status}`);
  const iv = await ig.json();
  assert.equal(iv.platform, "instagram");
  assert.equal(iv.youtubeId, "instagram:Cabc123XYZ");
  console.log("instagram imported:", iv.id);

  // ── X/Twitter ──
  const tw = await importUrl("https://x.com/jack/status/20");
  assert.equal(tw.status, 201, `twitter status ${tw.status}`);
  const tv = await tw.json();
  assert.equal(tv.platform, "twitter");
  assert.equal(tv.youtubeId, "twitter:20");
  console.log("twitter imported:", tv.id);

  // ── TikTok (oEmbed may be IP-blocked; import must still succeed) ──
  const tt = await importUrl("https://www.tiktok.com/@scout2015/video/6718335390845095173");
  assert.equal(tt.status, 201, `tiktok status ${tt.status}`);
  const tkv = await tt.json();
  assert.equal(tkv.platform, "tiktok");
  assert.equal(tkv.youtubeId, "tiktok:6718335390845095173");
  console.log("tiktok imported:", tkv.id);

  // ── Facebook ──
  const fb = await importUrl("https://www.facebook.com/watch/?v=10153231379946729");
  assert.equal(fb.status, 201, `facebook status ${fb.status}`);
  const fv = await fb.json();
  assert.equal(fv.platform, "facebook");
  assert.equal(fv.youtubeId, "facebook:10153231379946729");
  console.log("facebook imported:", fv.id);

  // ── unsupported URL still rejected ──
  const bad = await importUrl("https://example.com/some/video");
  assert.equal(bad.status, 400);
  console.log("unsupported URL rejected: ok");

  // ── YouTube still works ──
  const yt = await importUrl("https://www.youtube.com/watch?v=9bZkp7q19f0");
  assert.ok(yt.status === 200 || yt.status === 201, `youtube status ${yt.status}`);
  const yv = await yt.json();
  assert.equal(yv.platform ?? "youtube", "youtube");
  console.log("youtube unaffected: ok");

  console.log("ALL PASS — cleaning up");

  // cleanup social test videos
  for (const id of [v.id, iv.id, tv.id, tkv.id, fv.id]) {
    await fetch(`${BASE}/api/videos/${id}`, { method: "DELETE", headers: ownerHeaders });
  }
  console.log("cleanup done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
