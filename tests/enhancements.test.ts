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
  const ownerToken = await forgeToken("jonimar@gmail.com", "Joao");
  const ownerHeaders = { "Cookie": `authjs.session-token=${ownerToken}` };

  // ── 1. Atomic add-video-to-folder endpoint ──
  const folderRes = await fetch(`${BASE}/api/folders`, {
    method: "POST",
    headers: { ...ownerHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Atomic Test ${Date.now()}` }),
  });
  assert.equal(folderRes.status, 201);
  const folder = await folderRes.json();
  console.log("created folder:", folder.id);

  const url = "https://www.youtube.com/watch?v=9bZkp7q19f0";
  const atomic = await fetch(`${BASE}/api/folders/${folder.id}/videos`, {
    method: "POST",
    headers: { ...ownerHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  assert.equal(atomic.status, 201);
  const atomicData = await atomic.json();
  assert.ok(atomicData.videoId);
  console.log("atomic add: 201 videoId", atomicData.videoId, "created", atomicData.created);

  const folderGet = await fetch(`${BASE}/api/folders/${folder.id}`, { headers: ownerHeaders });
  const folderData = await folderGet.json();
  assert.ok(folderData.videos.some((v: { id: number }) => v.id === atomicData.videoId));
  console.log("video present in folder: ok");

  const again = await fetch(`${BASE}/api/folders/${folder.id}/videos`, {
    method: "POST",
    headers: { ...ownerHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  assert.equal(again.status, 200);
  const againData = await again.json();
  assert.equal(againData.message, "Already in folder");
  console.log("atomic idempotent: ok");

  // bad url
  const bad = await fetch(`${BASE}/api/folders/${folder.id}/videos`, {
    method: "POST",
    headers: { ...ownerHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/notyoutube" }),
  });
  assert.equal(bad.status, 400);
  console.log("atomic invalid url: 400");

  // ── 2. Edit annotation via shared folder (as invitee with edit permission) ──
  const shareRes = await fetch(`${BASE}/api/folders/${folder.id}/share`, {
    method: "POST",
    headers: { ...ownerHeaders, "Content-Type": "application/json" },
  });
  assert.equal(shareRes.status, 200);
  const SHARE_TOKEN = (await shareRes.json()).token;
  assert.ok(SHARE_TOKEN, "share token missing");

  // Video must be in the folder for shared annotations; the caller does not
  // own video 904, so this links a fresh duplicate row we clean up below.
  const linkRes = await fetch(`${BASE}/api/folders/${folder.id}/videos`, {
    method: "POST",
    headers: { ...ownerHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
  });
  assert.equal(linkRes.status, 201);
  const linked = await linkRes.json();
  const linkedVideoId = linked.videoId as number;

  // Invite the collaborator with edit permission (invite email send may fail
  // locally — the folderShares row is what matters for authorization).
  await fetch(`${BASE}/api/folders/${folder.id}/shares`, {
    method: "POST",
    headers: { ...ownerHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "notasdevideo@gmail.com", permission: "edit" }),
  }).catch(() => {});

  const collabToken = await forgeToken("notasdevideo@gmail.com", "Notas");
  const collabHeaders = { "Cookie": `authjs.session-token=${collabToken}` };
  const jsonHeaders = { "Content-Type": "application/json" };

  const created = await fetch(`${BASE}/api/shared/folder/${SHARE_TOKEN}/annotations`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ videoId: linkedVideoId, name: "Notas", email: "notasdevideo@gmail.com", timestampStart: 5, timestampEnd: 8, note: "first note" }),
  });
  assert.equal(created.status, 201);
  const ann = await created.json();
  console.log("created annotation:", ann.id);

  const edited = await fetch(`${BASE}/api/shared/folder/${SHARE_TOKEN}/annotations`, {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify({ annotationId: ann.id, email: "notasdevideo@gmail.com", timestampStart: 20, timestampEnd: 25, note: "edited note" }),
  });
  assert.equal(edited.status, 200);
  const editedAnn = await edited.json();
  assert.equal(editedAnn.timestampStart, 20);
  assert.equal(editedAnn.note, "edited note");
  console.log("edit own annotation: ok");

  const otherEdit = await fetch(`${BASE}/api/shared/folder/${SHARE_TOKEN}/annotations`, {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify({ annotationId: ann.id, email: "jonimar@gmail.com", timestampStart: 0, timestampEnd: 1, note: "hijack" }),
  });
  assert.equal(otherEdit.status, 403);
  console.log("edit someone else's annotation: 403");

  const editedGet = await fetch(`${BASE}/api/shared/folder/${SHARE_TOKEN}/annotations?videoId=${linkedVideoId}`, { headers: collabHeaders });
  const list = await editedGet.json();
  const found = list.find((a: { id: number }) => a.id === ann.id);
  assert.equal(found.timestampStart, 20);
  assert.equal(found.note, "edited note");
  assert.ok(found.updatedAt);
  console.log("poll GET reflects edit (updatedAt present): ok");

  const del = await fetch(`${BASE}/api/shared/folder/${SHARE_TOKEN}/annotations`, {
    method: "DELETE",
    headers: jsonHeaders,
    body: JSON.stringify({ annotationId: ann.id, email: "notasdevideo@gmail.com" }),
  });
  assert.equal(del.status, 200);
  console.log("cleanup delete: ok");

  // cleanup folder (and the videos only if these requests created them)
  await fetch(`${BASE}/api/folders/${folder.id}`, { method: "DELETE", headers: ownerHeaders });
  if (atomicData.created) {
    await fetch(`${BASE}/api/videos/${atomicData.videoId}`, { method: "DELETE", headers: ownerHeaders });
  }
  if (linked.created) {
    await fetch(`${BASE}/api/videos/${linkedVideoId}`, { method: "DELETE", headers: ownerHeaders });
  }
  console.log("cleanup: ok");
  console.log("ALL PASS");
}
main().catch((e) => { console.error(e); process.exit(1); });
