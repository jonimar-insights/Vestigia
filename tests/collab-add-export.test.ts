import assert from "node:assert";
import { readFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";

const BASE = "http://localhost:3000";
const EDIT_EMAIL = "notasdevideo@gmail.com";
const VIEW_EMAIL = "viewer-collab@example.com";
const OWNER_EMAIL = "jonimar@gmail.com";

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
  const ownerToken = await forgeToken(OWNER_EMAIL, "Joao");
  const ownerHeaders = { "Cookie": `authjs.session-token=${ownerToken}` };

  // ── Setup: fresh folder + shares (edit + view) ──
  const folderRes = await fetch(`${BASE}/api/folders`, {
    method: "POST",
    headers: { ...ownerHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Collab Add/Export Test ${Date.now()}` }),
  });
  assert.equal(folderRes.status, 201);
  const folder = await folderRes.json();

  // Share token is generated (not returned) on creation — enable sharing explicitly
  const shareRes = await fetch(`${BASE}/api/folders/${folder.id}/share`, {
    method: "POST",
    headers: ownerHeaders,
  });
  assert.equal(shareRes.status, 200);
  const shareData = await shareRes.json();
  assert.ok(shareData.token);
  const shareToken = shareData.token;
  console.log("created folder:", folder.id, "token:", shareToken);

  const addShare = (email: string, permission: string) =>
    fetch(`${BASE}/api/folders/${folder.id}/shares`, {
      method: "POST",
      headers: { ...ownerHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ email, permission }),
    });

  assert.equal((await addShare(EDIT_EMAIL, "edit")).status, 201);
  assert.equal((await addShare(VIEW_EMAIL, "view")).status, 201);
  console.log("shares added: edit + view");

  const sharedBase = `${BASE}/api/shared/folder/${shareToken}`;
  const jsonHeaders = { "Content-Type": "application/json" };

  // ── 1. Edit collaborator can add a video ──
  const url = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
  const add = await fetch(`${sharedBase}/videos`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: EDIT_EMAIL, name: "Notas", url }),
  });
  assert.equal(add.status, 201);
  const addData = await add.json();
  assert.ok(addData.videoId);
  console.log("collab add video: 201 videoId", addData.videoId, "created", addData.created);

  const folderGet = await fetch(`${sharedBase}`);
  const folderData = await folderGet.json();
  assert.ok(folderData.videos.some((v: { id: number }) => v.id === addData.videoId));
  console.log("video visible in shared folder: ok");

  // idempotent
  const again = await fetch(`${sharedBase}/videos`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: EDIT_EMAIL, name: "Notas", url }),
  });
  assert.equal(again.status, 200);
  const againData = await again.json();
  assert.equal(againData.message, "Already in folder");
  console.log("collab add idempotent: ok");

  // invalid url
  const bad = await fetch(`${sharedBase}/videos`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: EDIT_EMAIL, name: "Notas", url: "https://example.com/nope" }),
  });
  assert.equal(bad.status, 400);
  console.log("collab add invalid url: 400");

  // view-only collaborator cannot add
  const viewAdd = await fetch(`${sharedBase}/videos`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: VIEW_EMAIL, name: "Viewer", url }),
  });
  assert.equal(viewAdd.status, 403);
  console.log("view-only add: 403");

  // uninvited email cannot add
  const strangerAdd = await fetch(`${sharedBase}/videos`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: "stranger@example.com", name: "X", url }),
  });
  assert.equal(strangerAdd.status, 403);
  console.log("stranger add: 403");

  // missing url
  const noUrl = await fetch(`${sharedBase}/videos`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: EDIT_EMAIL, name: "Notas" }),
  });
  assert.equal(noUrl.status, 400);
  console.log("collab add missing url: 400");

  // ── 2. Annotation export ──
  // seed an annotation so export has content
  const ann = await fetch(`${sharedBase}/annotations`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ videoId: addData.videoId, name: "Notas", email: EDIT_EMAIL, timestampStart: 2, timestampEnd: 5, note: "export me, with, comma" }),
  });
  assert.equal(ann.status, 201);
  const annData = await ann.json();
  console.log("seeded annotation:", annData.id);

  const expJson = await fetch(`${sharedBase}/export?email=${EDIT_EMAIL}&format=json`);
  assert.equal(expJson.status, 200);
  const expData = await expJson.json();
  assert.equal(expData.count, 1);
  assert.equal(expData.annotations[0].note, "export me, with, comma");
  assert.ok(expData.annotations[0].videoTitle);
  console.log("export json: ok");

  const expCsv = await fetch(`${sharedBase}/export?email=${EDIT_EMAIL}&format=csv`);
  assert.equal(expCsv.status, 200);
  const csvText = await expCsv.text();
  assert.match(csvText, /^video_id,video_title,youtube_id,start,end,note,author,email,created_at,updated_at/);
  assert.match(csvText, /"export me, with, comma"/);
  console.log("export csv: ok");

  // view-only collaborator can export
  const expView = await fetch(`${sharedBase}/export?email=${VIEW_EMAIL}&format=json`);
  assert.equal(expView.status, 200);
  console.log("view-only export: 200");

  // uninvited email cannot export
  const expStranger = await fetch(`${sharedBase}/export?email=stranger@example.com&format=json`);
  assert.equal(expStranger.status, 403);
  console.log("stranger export: 403");

  // missing email
  const expNoEmail = await fetch(`${sharedBase}/export?format=json`);
  assert.equal(expNoEmail.status, 400);
  console.log("export missing email: 400");

  // ── Cleanup ──
  await fetch(`${BASE}/api/folders/${folder.id}`, { method: "DELETE", headers: ownerHeaders });
  if (addData.created) {
    await fetch(`${BASE}/api/videos/${addData.videoId}`, { method: "DELETE", headers: ownerHeaders });
  }
  console.log("cleanup: ok");
  console.log("ALL PASS");
}
main().catch((e) => { console.error(e); process.exit(1); });
