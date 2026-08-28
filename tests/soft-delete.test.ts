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
  const token = await forgeToken("softdelete.test@gmail.com", "SoftDelete");
  const headers = { "Cookie": `authjs.session-token=${token}` };
  const jsonHeaders = { "Content-Type": "application/json" };

  // ── Seed a video (and grab "stale id" for 404 checks) ──
  const url = "https://www.youtube.com/watch?v=9bZkp7q19f0";
  const created = await fetch(`${BASE}/api/videos`, {
    method: "POST",
    headers: { ...headers, ...jsonHeaders },
    body: JSON.stringify({ url }),
  });
  assert.equal(created.status, 201);
  const video = await created.json();
  const videoId = video.id as number;
  assert.ok(videoId, "video id missing");
  console.log("created video", videoId);

  // ── 1. Soft delete hides it everywhere ──
  const beforeList = await fetch(`${BASE}/api/videos`, { headers });
  const beforeIds = (await beforeList.json()).map((v: { id: number }) => v.id);
  assert.ok(beforeIds.includes(videoId), "video not visible before delete");

  const soft = await fetch(`${BASE}/api/videos/${videoId}`, { method: "DELETE", headers });
  assert.equal(soft.status, 200);
  assert.equal((await soft.json()).softDeleted, true);
  console.log("soft delete: ok");

  const list = await fetch(`${BASE}/api/videos`, { headers });
  const ids = (await list.json()).map((v: { id: number }) => v.id);
  assert.ok(!ids.includes(videoId), "video still visible after soft delete");
  console.log("hidden from /api/videos: ok");

  const get = await fetch(`${BASE}/api/videos/${videoId}`, { headers });
  assert.equal(get.status, 404);
  console.log("GET /api/videos/[id] soft-deleted: 404");

  const trash = await fetch(`${BASE}/api/videos/trash`, { headers });
  assert.equal(trash.status, 200);
  const trashList = await trash.json();
  const tv = trashList.find((v: { id: number }) => v.id === videoId);
  assert.ok(tv, "video not in trash");
  assert.ok(tv.deletedAt, "trash item missing deletedAt");
  console.log("trash listing: ok (deletedAt", tv.deletedAt, ")");

  // ── 2. Restore brings it back (with folder membership preserved) ──
  const folderRes = await fetch(`${BASE}/api/folders`, {
    method: "POST",
    headers: { ...headers, ...jsonHeaders },
    body: JSON.stringify({ name: `SoftDelete Fold ${Date.now()}` }),
  });
  assert.equal(folderRes.status, 201);
  const folder = await folderRes.json();
  await fetch(`${BASE}/api/folders/${folder.id}/videos`, {
    method: "POST",
    headers: { ...headers, ...jsonHeaders },
    body: JSON.stringify({ url }),
  });
  // seed restores the video if it wasn't already soft-deleted; delete it again
  await fetch(`${BASE}/api/videos/${videoId}`, { method: "DELETE", headers });

  const inFolderGone = await fetch(`${BASE}/api/folders/${folder.id}`, { headers });
  assert.ok(!(await inFolderGone.json()).videos.some((v: { id: number }) => v.id === videoId));
  console.log("soft-deleted video hidden from folder: ok");

  const restore = await fetch(`${BASE}/api/videos/${videoId}/restore`, { method: "POST", headers });
  assert.equal(restore.status, 200);
  console.log("restore endpoint: ok");

  const trashAfter = await fetch(`${BASE}/api/videos/trash`, { headers });
  assert.ok(!(await trashAfter.json()).some((v: { id: number }) => v.id === videoId));
  const listAfter = await fetch(`${BASE}/api/videos`, { headers });
  assert.ok((await listAfter.json()).some((v: { id: number }) => v.id === videoId));
  console.log("back in /api/videos + out of trash: ok");

  const inFolderBack = await fetch(`${BASE}/api/folders/${folder.id}`, { headers });
  assert.ok((await inFolderBack.json()).videos.some((v: { id: number }) => v.id === videoId));
  console.log("folder membership restored: ok");

  // already-live restore is idempotent
  const restoreAgain = await fetch(`${BASE}/api/videos/${videoId}/restore`, { method: "POST", headers });
  assert.equal(restoreAgain.status, 200);
  assert.equal((await restoreAgain.json()).alreadyLive, true);
  console.log("restore idempotent: ok");

  // ── 3. Re-importing a soft-deleted video auto-restores it ──
  await fetch(`${BASE}/api/videos/${videoId}`, { method: "DELETE", headers });
  const reimport = await fetch(`${BASE}/api/videos`, {
    method: "POST",
    headers: { ...headers, ...jsonHeaders },
    body: JSON.stringify({ url }),
  });
  assert.equal(reimport.status, 200, "re-import should be idempotent 200");
  const reimportData = await reimport.json();
  assert.equal(reimportData.id, videoId, "re-import should reuse the same row");
  console.log("re-import auto-restores: ok");

  // ── 4. Permanent delete purges for good ──
  await fetch(`${BASE}/api/videos/${videoId}`, { method: "DELETE", headers });
  const perm = await fetch(`${BASE}/api/videos/${videoId}?permanent=true`, { method: "DELETE", headers });
  assert.equal(perm.status, 200);
  assert.equal((await perm.json()).permanent, true);

  const trashEmpty = await fetch(`${BASE}/api/videos/trash`, { headers });
  assert.ok(!(await trashEmpty.json()).some((v: { id: number }) => v.id === videoId));
  const gone = await fetch(`${BASE}/api/videos/${videoId}`, { headers });
  assert.equal(gone.status, 404);
  console.log("permanent delete purges: ok");

  // ── 5. Error paths ──
  const permGone = await fetch(`${BASE}/api/videos/999999?permanent=true`, { method: "DELETE", headers });
  assert.equal(permGone.status, 404);
  const restoreGone = await fetch(`${BASE}/api/videos/999999/restore`, { method: "POST", headers });
  assert.equal(restoreGone.status, 404);
  console.log("error paths: ok");

  // cleanup folder (soft-deleted video already hard-deleted in section 4)
  await fetch(`${BASE}/api/folders/${folder.id}`, { method: "DELETE", headers });
  console.log("cleanup: ok");
  console.log("ALL PASS");
}
main().catch((e) => { console.error(e); process.exit(1); });