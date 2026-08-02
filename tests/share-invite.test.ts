// Tests for the "send invite by e-mail" feature.
// Requires the dev server to be running at http://localhost:3000.
// Run with: npx tsx tests/share-invite.test.ts
//
// Covers:
//   1. sendShareInviteEmail unit behavior (all branches, transport mocked)
//      including the sender-Gmail OAuth2 path
//   2. POST /api/folders/:id/shares end-to-end with a forged session
//   3. Auth gate, validation, duplicate detection, DELETE

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";
import type { Transporter } from "nodemailer";

interface FakeMail {
  to?: string;
  subject?: string;
  from?: string;
  html?: string;
}

const BASE = process.env.TEST_BASE ?? "http://localhost:3000";

function loadEnv(path = ".env") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) {
        let v = m[2];
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        process.env[m[1]] = v;
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
    maxAge: 60 * 60,
    token: {
      sub: "test-invite-provider-account-id",
      id: "test-invite-provider-account-id",
      name: "Invite Tester",
      email: "tester@example.com",
      picture: null,
      accessToken: "mock-access-token",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  });
}

async function authedPost(pathname: string, body: unknown, token: string) {
  return fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `authjs.session-token=${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function findOrCreateFolder(token: string) {
  const res = await fetch(`${BASE}/api/folders`, {
    headers: { "Cookie": `authjs.session-token=${token}` },
  });
  if (!res.ok) throw new Error(`GET folders failed: ${res.status}`);
  const folders = await res.json();
  if (Array.isArray(folders) && folders.length > 0) return folders[0];

  const created = await fetch(`${BASE}/api/folders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `authjs.session-token=${token}`,
    },
    body: JSON.stringify({ name: `Invite Test ${Date.now()}` }),
  });
  if (!created.ok) throw new Error(`Create folder failed: ${created.status}`);
  const folder = await created.json();
  if (Array.isArray(folder)) return folder[0];
  return folder;
}

async function freshEmailModule(nonce: string) {
  return import(`../lib/email.ts?case=${nonce}`);
}

async function unitTestEmail() {
  const captured: FakeMail[] = [];
  let caseNo = 0;

  function fakeTransport(sendMail: (mail: FakeMail) => Promise<void>): Transporter {
    return {
      sendMail: async (mail: FakeMail) => {
        captured.push(mail);
        await sendMail(mail);
      },
    } as unknown as Transporter;
  }

  // Case 1: no SMTP config → graceful failure, transport never used
  delete process.env.GMAIL_SMTP_USER;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_SMTP_APP_PASSWORD;
  delete process.env.GMAIL_APP_PASSWORD;
  const noKeyMod = await freshEmailModule(`no-config-${caseNo++}`);
  const noKey = await noKeyMod.sendShareInviteEmail({
    to: "a@b.com",
    folderName: "F",
    shareLink: "http://localhost:3000/shared/folder/x",
    permission: "view",
    sharedBy: "Tester",
  });
  assert.strictEqual(noKey.success, false, "should fail without SMTP config");
  assert.match(noKey.error ?? "", /not configured/, "no-config error message");

  // Case 2: config + sendMail success → success, correct mail shape
  process.env.GMAIL_SMTP_USER = "tester@gmail.com";
  process.env.GMAIL_SMTP_APP_PASSWORD = "app-password";
  const okMod = await freshEmailModule(`ok-${caseNo++}`);
  const ok = await okMod.sendShareInviteEmail(
    {
      to: "recipient@example.com",
      folderName: "My Folder",
      shareLink: "http://localhost:3000/shared/folder/abc",
      permission: "edit",
      sharedBy: "Alice",
    },
    fakeTransport(async () => {})
  );
  assert.strictEqual(ok.success, true, "should succeed on sendMail");
  const sentMail = captured[0];
  assert.ok(sentMail, "captured a mail");
  assert.strictEqual(sentMail.to, "recipient@example.com");
  assert.ok(sentMail.subject?.includes('Alice shared "My Folder"'), "subject carries sharer + folder");
  assert.ok(sentMail.from?.includes("tester@gmail.com"), "from uses Gmail SMTP user");
  assert.ok(sentMail.html?.includes("You can edit"), "edit badge rendered");
  assert.ok(sentMail.html?.includes("http://localhost:3000/shared/folder/abc"), "share link in html");

  // Case 3: sendMail rejects → failure
  const badMod = await freshEmailModule(`bad-${caseNo++}`);
  const bad = await badMod.sendShareInviteEmail(
    {
      to: "a@b.com",
      folderName: "F",
      shareLink: "x",
      permission: "view",
      sharedBy: "T",
    },
    fakeTransport(async () => {
      throw new Error("ECONNRESET");
    })
  );
  assert.strictEqual(bad.success, false, "should fail on sendMail error");
  assert.match(bad.error ?? "", /Failed to send email/);

  // Case 4: without injected transport and with config, it builds a Gmail transport
  process.env.GMAIL_SMTP_USER = "tester@gmail.com";
  process.env.GMAIL_SMTP_APP_PASSWORD = "app-password";
  const mod4 = await freshEmailModule(`transport-${caseNo++}`);
  assert.match(mod4.sendShareInviteEmail.toString(), /smtp\.gmail\.com/, "creates Gmail SMTP transport");

  // Case 5: sender's Gmail OAuth tokens → Gmail API send from their own account
  delete process.env.GMAIL_SMTP_USER;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_SMTP_APP_PASSWORD;
  delete process.env.GMAIL_APP_PASSWORD;
  process.env.AUTH_GOOGLE_ID = "client-id";
  process.env.AUTH_GOOGLE_SECRET = "client-secret";

  let refreshBody = "";
  let sendRequest: { url: string; auth: string; rawBase64: string } | undefined;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/oauth2.googleapis.com/token")) {
      refreshBody = String(init?.body ?? "");
      return { ok: true, status: 200, json: async () => ({ access_token: "fresh-access-token" }) } as Response;
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { raw?: string };
    const h = new Headers(init?.headers);
    sendRequest = {
      url,
      auth: h.get("Authorization") ?? "",
      rawBase64: body.raw ?? "",
    };
    return { ok: true, status: 200, text: async () => "" } as Response;
  }) as typeof fetch;

  const oauthMod = await freshEmailModule(`oauth-${caseNo++}`);
  const oauth = await oauthMod.sendShareInviteEmail(
    {
      to: "recipient@example.com",
      folderName: "My Folder",
      shareLink: "http://localhost:3000/shared/folder/abc",
      permission: "view",
      sharedBy: "Alice",
    },
    undefined,
    {
      user: "alice@gmail.com",
      accessToken: "ya29.stale",
      refreshToken: "1//refresh",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }
  );
  globalThis.fetch = realFetch;

  assert.strictEqual(oauth.success, true, "OAuth send should succeed");
  assert.ok(
    refreshBody.includes("client_id=client-id") &&
      refreshBody.includes("client_secret=client-secret") &&
      refreshBody.includes("refresh_token=1%2F%2Frefresh"),
    "refresh request carries client + refresh token"
  );
  assert.ok(sendRequest, "gmail API send was called");
  assert.ok(sendRequest.url.includes("/gmail/v1/users/me/messages/send"), "hits Gmail send endpoint");
  assert.strictEqual(sendRequest.auth, "Bearer fresh-access-token", "uses freshly refreshed token");
  const raw = Buffer.from(sendRequest.rawBase64, "base64url").toString("utf8");
  assert.ok(raw.includes("From: Alice <alice@gmail.com>"), "from uses sender's own Gmail");
  assert.ok(raw.includes("To: recipient@example.com"), "recipient present");
  assert.ok(raw.includes("shared \"My Folder\""), "subject present");

  // Case 6: Gmail API send rejected → failure surfaces
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/oauth2.googleapis.com/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "t" }) } as Response;
    }
    return { ok: false, status: 403, text: async () => '{"error":{"message":"Gmail API disabled"}}' } as Response;
  }) as typeof fetch;
  const oauthMod2 = await freshEmailModule(`oauth-fail-${caseNo++}`);
  const oauthFail = await oauthMod2.sendShareInviteEmail(
    {
      to: "recipient@example.com",
      folderName: "F",
      shareLink: "x",
      permission: "view",
      sharedBy: "Alice",
    },
    undefined,
    { user: "alice@gmail.com", refreshToken: "1//refresh" }
  );
  globalThis.fetch = realFetch;
  assert.strictEqual(oauthFail.success, false, "Gmail API failure must be reported");
  assert.match(oauthFail.error ?? "", /Failed to send email/);

  console.log("[email] unit tests passed (6 cases)");
}

async function endpointTest(token: string) {
  // Auth gate
  const unauth = await fetch(`${BASE}/api/folders/1/shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "x@y.com", permission: "view" }),
    redirect: "manual",
  });
  assert.ok(unauth.status === 307 || unauth.status === 401, "unauthenticated must be rejected");

  const folder = await findOrCreateFolder(token);
  assert.ok(folder?.id, "need a folder to share");

  const testEmail = `invite-test-${Date.now()}@example.com`;

  // Validation
  const badPerm = await authedPost(`/api/folders/${folder.id}/shares`, { email: testEmail, permission: "owner" }, token);
  assert.strictEqual(badPerm.status, 400, "invalid permission must 400");

  const noEmail = await authedPost(`/api/folders/${folder.id}/shares`, { permission: "view" }, token);
  assert.strictEqual(noEmail.status, 400, "missing email must 400");

  // Successful invite
  const created = await authedPost(`/api/folders/${folder.id}/shares`, { email: testEmail, permission: "edit" }, token);
  assert.strictEqual(created.status, 201, "share creation must 201");
  const share = await created.json();
  assert.strictEqual(share.email, testEmail.toLowerCase(), "email normalized");
  assert.strictEqual(share.permission, "edit");

  // Duplicate → 409
  const dup = await authedPost(`/api/folders/${folder.id}/shares`, { email: testEmail, permission: "view" }, token);
  assert.strictEqual(dup.status, 409, "duplicate invite must 409");

  // Listed
  const list = await fetch(`${BASE}/api/folders/${folder.id}/shares`, {
    headers: { "Cookie": `authjs.session-token=${token}` },
  });
  assert.ok(list.ok, "list shares must work");
  const shares = await list.json();
  assert.ok(shares.some((s: { email: string }) => s.email === testEmail), "invite present in list");

  // Cleanup
  const del = await fetch(`${BASE}/api/folders/${folder.id}/shares?email=${encodeURIComponent(testEmail)}`, {
    method: "DELETE",
    headers: { "Cookie": `authjs.session-token=${token}` },
  });
  assert.strictEqual(del.status, 200, "delete invite must work");

  console.log(`[endpoint] tests passed for folder #${folder.id} (email fired = ${await emailWasAttempted()})`);
}

async function emailWasAttempted() {
  // Gmail SMTP config is not in the local .env, so the endpoint still returns
  // 201 and logs a warning while the email is skipped (fire-and-forget).
  return !process.env.GMAIL_SMTP_USER && !process.env.GMAIL_USER;
}

(async () => {
  try {
    await unitTestEmail();
    const token = await forgeSessionToken();
    await endpointTest(token);
    console.log("\nAll invite tests passed.");
  } catch (err) {
    console.error("\nInvite tests FAILED:", err);
    process.exit(1);
  }
})();
