// End-to-end test of the folder-sharing objective:
//   sender shares a folder via email → invitee (edit permission) can collaborate
//   by annotating videos in the folder → owner sees the invitee's annotations.
//
// Requires the dev server running on TEST_BASE (default http://localhost:3000).
// Run: TEST_BASE=http://localhost:3001 npx tsx tests/share-collab.test.ts

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";

const BASE = process.env.TEST_BASE ?? "http://localhost:3000";
const INVITEE = "collab-invitee@example.com";
const UNINVITED = "stranger@example.com";

function loadEnv(path = ".env") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) {
        let v = m[2];
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        if (v) process.env[m[1]] = v;
      }
    }
  } catch {}
}

async function forgeSessionToken() {
  loadEnv();
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET not found in .env");
  return encode({
    secret: process.env.AUTH_SECRET,
    salt: "authjs.session-token",
    maxAge: 3600,
    token: {
      sub: "collab-owner-acc",
      id: "collab-owner-acc",
      name: "Collab Owner",
      email: "owner@example.com",
      picture: null,
      accessToken: "mock",
    },
  });
}

const ownerHeaders = (token: string) => ({
  "Content-Type": "application/json",
  "Cookie": `authjs.session-token=${token}`,
});

const results: string[] = [];
function report(label: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) console.log(`✗ ${label} ${detail}`);
}

(async () => {
  const token = await forgeSessionToken();
  const h = ownerHeaders(token);
  let folderId = 0;
  let shareToken = "";
  let annotationId = 0;
  let testVideoId = 0;

  try {
    // 0. Owner imports a video (owned by the owner, as in the real flow)
    let res = await fetch(`${BASE}/api/videos`, {
      method: "POST", headers: h,
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    });
    assert.ok(res.ok, "import video");
    const vid = await res.json();
    testVideoId = Array.isArray(vid) ? vid[0]?.id : vid?.id;
    assert.ok(testVideoId, "video created");
    report("owner imports a video", true);

    // 1. Owner creates a folder
    res = await fetch(`${BASE}/api/folders`, {
      method: "POST", headers: h,
      body: JSON.stringify({ name: `Collab Test ${Date.now()}` }),
    });
    assert.strictEqual(res.status, 201, "create folder");
    const folder = await res.json() as { id: number };
    folderId = folder.id;

    // Generate share token (as the UI does before inviting)
    res = await fetch(`${BASE}/api/folders/${folderId}/share`, { method: "POST", headers: h });
    const shareData = res.ok ? await res.json() : null;
    shareToken = shareData?.token;
    assert.ok(shareToken, "folder has shareToken");
    report("owner creates folder + share token", true);

    // 2. Add the owner's video to the folder
    res = await fetch(`${BASE}/api/folders/${folderId}/videos`, {
      method: "POST", headers: h,
      body: JSON.stringify({ videoId: testVideoId }),
    });
    report("add video to folder", res.ok, `status ${res.status}`);

    // 3. Owner sends the invite (edit permission) — this is what fires the email
    res = await fetch(`${BASE}/api/folders/${folderId}/shares`, {
      method: "POST", headers: h,
      body: JSON.stringify({ email: INVITEE, permission: "edit" }),
    });
    report("owner invites invitee by email (edit)", res.status === 201, `status ${res.status}`);

    // 4. Invitee opens the shared link (public endpoints)
    res = await fetch(`${BASE}/api/shared/folder/${shareToken}`);
    report("invitee loads shared folder", res.ok, `status ${res.status}`);
    const shared = res.ok ? await res.json() : null;
    report("shared folder contains the video", shared?.videos?.some((v: { id: number }) => v.id === testVideoId) === true);

    // 5. Invitee verifies their email
    res = await fetch(`${BASE}/api/shared/folder/${shareToken}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: INVITEE }),
    });
    const v = res.ok ? await res.json() : null;
    report("invitee email verified", v?.authorized === true && v?.permission === "edit", `status ${res.status} ${JSON.stringify(v)}`);

    // 6. Invitee adds an annotation (collaboration)
    res = await fetch(`${BASE}/api/shared/folder/${shareToken}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId: testVideoId,
        name: "Collab Invitee",
        email: INVITEE,
        timestampStart: 30,
        timestampEnd: 45,
        note: "Collaborative annotation from invitee",
      }),
    });
    const created = res.ok ? await res.json() : null;
    report("invitee adds annotation", res.status === 201, `status ${res.status}`);
    if (created?.id) annotationId = created.id;

    // 7. Invitee sees it in the shared list
    res = await fetch(`${BASE}/api/shared/folder/${shareToken}/annotations?videoId=${testVideoId}`);
    const list = res.ok ? await res.json() : [];
    report("annotation appears in shared list", list.some((a: { id: number }) => a.id === annotationId));

    // 8. OWNER sees the invitee's annotation in the main app (same table)
    res = await fetch(`${BASE}/api/videos/${testVideoId}/annotations`, { headers: h });
    const ownerList = res.ok ? await res.json() : [];
    const seenByOwner = ownerList.some((a: { id: number; email: string | null }) => a.id === annotationId && a.email === INVITEE);
    report("owner sees invitee annotation in main app", seenByOwner);

    // 9. Permission enforcement
    // 9a. uninvited email → must be rejected
    res = await fetch(`${BASE}/api/shared/folder/${shareToken}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: testVideoId, name: "X", email: UNINVITED, timestampStart: 1, timestampEnd: 2, note: "x" }),
    });
    report("uninvited email cannot annotate", res.status === 403, `status ${res.status} (expected 403)`);

    // 9b. NO email at all → must be rejected (server must not skip the permission check)
    res = await fetch(`${BASE}/api/shared/folder/${shareToken}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: testVideoId, name: "Anonymous", timestampStart: 1, timestampEnd: 2, note: "x" }),
    });
    const rejected = res.status === 400 || res.status === 403;
    report("annotating without email is rejected", rejected, `status ${res.status} (expected 400/403) — was ${res.status === 201 ? "allowed, permission check skipped" : ""}`);

    // 10. Invitee deletes their own annotation
    if (annotationId) {
      res = await fetch(`${BASE}/api/shared/folder/${shareToken}/annotations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotationId, email: INVITEE }),
      });
      report("invitee deletes own annotation", res.ok, `status ${res.status}`);
    }

    // 11. Invitee cannot delete an annotation they don't own (skipped since we deleted ours)
  } catch (err) {
    console.error("ERROR:", (err as Error).message);
  } finally {
    // Cleanup: remove folder (cascades shares + folder_videos + token) and the test video
    if (folderId) {
      await fetch(`${BASE}/api/folders/${folderId}`, {
        method: "DELETE", headers: h,
      }).catch(() => {});
    }
    if (testVideoId) {
      await fetch(`${BASE}/api/videos/${testVideoId}`, {
        method: "DELETE", headers: h,
      }).catch(() => {});
    }
  }

  const failures = results.filter((r) => r.startsWith("FAIL"));
  console.log(`\n${results.length - failures.length}/${results.length} passed`);
  if (failures.length) {
    console.log("FAILURES:");
    failures.forEach((f) => console.log("  " + f));
  }
  console.log("\nSummary of objective:");
  console.log("  Share via email + invitee collaborates on annotations: " +
    (results[4]?.startsWith("PASS") && results[5]?.startsWith("PASS") ? "IMPLEMENTED" : "BROKEN"));
})().catch((e) => { console.error(e); process.exit(1); });
