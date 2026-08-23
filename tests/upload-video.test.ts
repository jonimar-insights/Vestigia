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

// Throwaway identity — the test cleans up every row it creates.
const TEST_USER = "upload-test-agent";

async function main() {
  loadEnv();
  const salt = BASE.startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
  const cookieName = BASE.startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
  const token = await encode({
    secret: process.env.AUTH_SECRET!,
    salt,
    maxAge: 3600,
    token: {
      sub: TEST_USER,
      id: TEST_USER,
      name: "Upload Test",
      email: "upload-test@example.com",
      picture: null,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  });
  const headers = { Cookie: `${cookieName}=${token}`, ...jsonHeaders };

  const blobUrl = `https://vestigia-uploads.public.blob.vercel-storage.com/test/upload-clip-${Date.now()}.mp4`;

  // ── Create upload video record ──
  const created = await fetch(`${BASE}/api/videos`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: blobUrl, title: "Upload Test Clip", durationSeconds: 62 }),
  });
  const createdBody = await created.json();
  assert.equal(created.status, 201, `create status ${created.status}: ${JSON.stringify(createdBody)}`);
  const v = createdBody;
  assert.equal(v.platform, "upload");
  assert.ok(String(v.youtubeId).startsWith("upload:"), `youtubeId ${v.youtubeId}`);
  assert.equal(v.durationSeconds, 62);
  assert.equal(v.title, "Upload Test Clip");
  console.log("upload record created:", v.id);

  try {
    // ── Idempotent ──
    const again = await fetch(`${BASE}/api/videos`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: blobUrl }),
    });
    assert.equal(again.status, 200);
    const va = await again.json();
    assert.equal(va.id, v.id);
    console.log("idempotent: ok");

    // ── Fetch by id ──
    const got = await fetch(`${BASE}/api/videos/${v.id}`, { headers });
    assert.equal(got.status, 200);
    const gv = await got.json();
    assert.equal(gv.platform, "upload");
    console.log("get by id: ok");

    // ── Non-blob URL must NOT be classified as upload ──
    const bad = await fetch(`${BASE}/api/videos`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://evil.example.com/fake.mp4" }),
    });
    assert.equal(bad.status, 400, `non-upload URL status ${bad.status}`);
    console.log("non-blob rejection: ok");
  } finally {
    // ── Cleanup ──
    const del = await fetch(`${BASE}/api/videos/${v.id}`, { method: "DELETE", headers });
    assert.ok([200, 204].includes(del.status), `delete status ${del.status}`);
    const gone = await fetch(`${BASE}/api/videos/${v.id}`, { headers });
    assert.ok([404].includes(gone.status), `post-delete status ${gone.status}`);
    console.log("cleanup: deleted", v.id);
  }

  console.log("ALL UPLOAD VIDEO TESTS PASS");
}

main().catch((e) => { console.error(e); process.exit(1); });
