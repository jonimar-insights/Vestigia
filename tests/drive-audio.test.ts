import assert from "node:assert";
import { readFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";

const BASE = "http://localhost:3000";

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
  return encode({
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
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
  const token = await forgeToken("drive.audio.test@gmail.com", "DriveAudio");
  const headers = { "Cookie": `authjs.session-token=${token}` };
  const jsonHeaders = { "Content-Type": "application/json" };

  const cleanup: number[] = [];

  // ── 1. Drive import: probe does NOT classify Google-hosted video as audio ──
  const driveUrl = "https://drive.google.com/file/d/1VID_EQ_SAMPLE_DRIVE_VIDEO/view";
  const driveRes = await fetch(`${BASE}/api/videos`, {
    method: "POST",
    headers: { ...headers, ...jsonHeaders },
    body: JSON.stringify({ url: driveUrl }),
  });
  assert.equal(driveRes.status, 201, `drive import: ${driveRes.status} ${await driveRes.clone().text()}`);
  const driveData = await driveRes.json();
  cleanup.push(driveData.id);
  assert.equal(driveData.platform, "drive");
  assert.equal(driveData.mediaType, null, "video probe should not be audio");

  // ── 2. PATCH mediaType=audio + cover -> persisted and visible everywhere ──
  const cover = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Example.svg/240px-Example.svg.png";
  const patched = await fetch(`${BASE}/api/videos/${driveData.id}`, {
    method: "PATCH",
    headers: { ...headers, ...jsonHeaders },
    body: JSON.stringify({ mediaType: "audio", thumbnailUrl: cover }),
  });
  assert.equal(patched.status, 200);
  const patchedData = await patched.json();
  assert.equal(patchedData.mediaType, "audio");
  assert.equal(patchedData.thumbnailUrl, cover);

  // ...and through the list/read endpoints
  const all = await (await fetch(`${BASE}/api/videos/all`, { headers })).json();
  const inAll = all.find((v: { id: number }) => v.id === driveData.id);
  assert.ok(inAll, "video not in /api/videos/all");
  assert.equal(inAll.mediaType, "audio");
  assert.equal(inAll.thumbnailUrl, cover);
  const one = await (await fetch(`${BASE}/api/videos/${driveData.id}`, { headers })).json();
  assert.equal(one.mediaType, "audio");
  assert.equal(one.thumbnailUrl, cover);

  // invalid mediaType rejected -> null
  const badPatch = await fetch(`${BASE}/api/videos/${driveData.id}`, {
    method: "PATCH",
    headers: { ...headers, ...jsonHeaders },
    body: JSON.stringify({ mediaType: "document" }),
  });
  assert.equal(badPatch.status, 200);
  assert.equal((await badPatch.json()).mediaType, null);

  // re-set to audio for later steps
  await fetch(`${BASE}/api/videos/${driveData.id}`, {
    method: "PATCH",
    headers: { ...headers, ...jsonHeaders },
    body: JSON.stringify({ mediaType: "audio" }),
  });

  // ── 3. Trash carries mediaType too ──
  await fetch(`${BASE}/api/videos/${driveData.id}`, { method: "DELETE", headers });
  const trash = await (await fetch(`${BASE}/api/videos/trash`, { headers })).json();
  const inTrash = trash.find((v: { id: number }) => v.id === driveData.id);
  assert.ok(inTrash, "video not in trash");
  assert.equal(inTrash.mediaType, "audio");

  // ── 4. Clear cover removes it ──
  await fetch(`${BASE}/api/videos/${driveData.id}/restore`, { method: "POST", headers });
  const cleared = await (await fetch(`${BASE}/api/videos/${driveData.id}`, {
    method: "PATCH",
    headers: { ...headers, ...jsonHeaders },
    body: JSON.stringify({ thumbnailUrl: null }),
  })).json();
  assert.equal(cleared.thumbnailUrl, null);

  // ── 5. Unit: probe / audio filename detection ──
  const { probeDriveFile, probeIsAudio } = await import("@/lib/drive");
  const audioProbe = await probeDriveFile("1AUDIO_SAMPLE_UNUSED", 1500).catch(() => null);
  if (audioProbe) {
    // Only meaningful when Google responds; otherwise skip assertions.
    console.log("probeDriveFile on fake id ->", audioProbe);
  }
  assert.equal(probeIsAudio({ contentType: "audio/mpeg", fileName: null }), true);
  assert.equal(probeIsAudio({ contentType: "application/octet-stream", fileName: "entrevista.mp3" }), true);
  assert.equal(probeIsAudio({ contentType: "video/mp4", fileName: "clip.mp4" }), false);
  assert.equal(probeIsAudio({ contentType: "text/html", fileName: null }), false);
  assert.equal(probeIsAudio(null), false);

  // ── Cleanup ──
  for (const id of cleanup) {
    await fetch(`${BASE}/api/videos/${id}?permanent=true`, { method: "DELETE", headers });
  }
  const gone = await fetch(`${BASE}/api/videos/${driveData.id}`, { headers });
  assert.equal(gone.status, 404, "permanent delete should 404 the row");

  console.log("drive-audio.test.ts: all assertions passed");
}

main().catch((e) => { console.error(e); process.exit(1); });