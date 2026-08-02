import assert from "node:assert";
import { readFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";

const BASE = "http://localhost:3000";

function loadEnv() {
  const path = process.env.PWD + "/.env";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) {
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

async function forgeToken(email: string) {
  loadEnv();
  return encode({
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 3600,
    token: {
      sub: `google-${email}`,
      id: `google-${email}`,
      name: "Joao",
      email,
      picture: null,
      accessToken: "mock",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  });
}

async function main() {
  const token = await forgeToken("jonimar@gmail.com");
  const headers = { "Cookie": `authjs.session-token=${token}` };
  const email = `future-${Date.now()}@gmail.com`;

  const g0 = await fetch(`${BASE}/api/users/saved-emails`, { headers });
  const before = await g0.json();
  console.log("initial:", before);

  const p1 = await fetch(`${BASE}/api/users/saved-emails`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(p1.status, 200);

  const g1 = await fetch(`${BASE}/api/users/saved-emails`, { headers });
  const after = await g1.json();
  console.log("after add:", after);
  assert.ok(after.includes(email));

  const p2 = await fetch(`${BASE}/api/users/saved-emails`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(p2.status, 200);
  const g2 = await fetch(`${BASE}/api/users/saved-emails`, { headers });
  assert.equal((await g2.json()).filter((e: string) => e === email).length, 1);
  console.log("dedupe: ok");

  const d1 = await fetch(`${BASE}/api/users/saved-emails?email=${encodeURIComponent(email)}`, {
    method: "DELETE", headers,
  });
  assert.equal(d1.status, 200);
  const g3 = await fetch(`${BASE}/api/users/saved-emails`, { headers });
  const afterDel = await g3.json();
  console.log("after delete:", afterDel);
  assert.ok(!afterDel.includes(email));

  const unauth = await fetch(`${BASE}/api/users/saved-emails`, { redirect: "manual" });
  assert.ok(unauth.status === 307 || unauth.status === 401);
  console.log("unauth (redirect/401): ok");
  console.log("ALL PASS");
}
main().catch((e) => { console.error(e); process.exit(1); });
