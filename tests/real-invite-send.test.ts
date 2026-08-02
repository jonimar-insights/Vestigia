import assert from "node:assert";
import { readFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";

const BASE = process.env.TEST_BASE ?? "http://localhost:3000";
const COOKIE = BASE.startsWith("https")
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";
const SENDER = "jonimar@gmail.com";

function loadEnv() {
  try {
    const path = process.env.PWD + "/.env";
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

async function forgeSessionToken(email: string) {
  loadEnv();
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET not found");
  return encode({
    secret: process.env.AUTH_SECRET,
    salt: COOKIE,
    maxAge: 60 * 60,
    token: {
      sub: `google-${email}`,
      id: `google-${email}`,
      name: "Joao Marçal",
      email,
      picture: null,
      accessToken: "mock-access-token",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  });
}

async function authedPost(pathname: string, body: unknown, token: string) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `${COOKIE}=${token}`,
    },
    body: JSON.stringify(body),
  });
  return { res, body: await res.json().catch(() => ({})) };
}

(async () => {
  try {
    const token = await forgeSessionToken(SENDER);
    const h = { "Cookie": `${COOKIE}=${token}` };

    const folderRes = await fetch(`${BASE}/api/folders`, {
      method: "POST", headers: { "Content-Type": "application/json", ...h },
      body: JSON.stringify({ name: `Real Invite Test ${Date.now()}` }),
    });
    assert.strictEqual(folderRes.status, 201, `create folder: ${folderRes.status}`);
    const folder = (await folderRes.json()) as { id: number };
    console.log("folder created:", folder.id);

    await fetch(`${BASE}/api/folders/${folder.id}/share`, { method: "POST", headers: h });

    const { res, body } = await authedPost(
      `/api/folders/${folder.id}/shares`,
      { email: "notasdevideo@gmail.com", permission: "edit" },
      token
    );
    console.log("invite POST:", res.status);
    console.log("response:", JSON.stringify(body));

    const listRes = await fetch(`${BASE}/api/folders/${folder.id}/shares`, { headers: h });
    const shares = (await listRes.json()) as Array<{ email: string; permission: string }>;
    console.log("shares:", JSON.stringify(shares));

    console.log("\nCHECK notasdevideo@gmail.com inbox for the invite email.");
  } catch (err) {
    console.error("FAILED:", err);
    process.exit(1);
  }
})();
