import assert from "node:assert";
import { readFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";

const BASE = process.env.TEST_BASE ?? "http://localhost:3000";

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
  // prod signs the session cookie with __Secure-authjs.session-token (HTTPS)
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

const jsonHeaders = { "Content-Type": "application/json" };

async function main() {
  const ownerToken = await forgeToken("jonimar@gmail.com", "Joao");
  const cookieName = BASE.startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
  const ownerHeaders = { "Cookie": `${cookieName}=${ownerToken}`, ...jsonHeaders };

  // create list
  const createdList = await fetch(`${BASE}/api/cliplists`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ name: `Reorder Test ${Date.now()}` }),
  });
  assert.equal(createdList.status, 201);
  const list = await createdList.json();
  console.log("created cliplist:", list.id);

  try {
    const addItem = async (title: string) => {
      const res = await fetch(`${BASE}/api/cliplists/${list.id}/items`, {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({ type: "annotation", videoId: 904, timestamp: 5, title }),
      });
      assert.equal(res.status, 201);
      return res.json();
    };

    const a = await addItem("first");
    const b = await addItem("second");

    const getItems = async () => {
      const res = await fetch(`${BASE}/api/cliplists/${list.id}`, { headers: ownerHeaders });
      assert.equal(res.status, 200);
      return (await res.json()).items;
    };

    let items = await getItems();
    assert.deepEqual(items.map((i: { title: string }) => i.title), ["first", "second"]);
    console.log("initial order (append at end): ok");

    // reorder
    const reorder = await fetch(`${BASE}/api/cliplists/${list.id}/items`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ order: [b.id, a.id] }),
    });
    assert.equal(reorder.status, 200);
    items = await getItems();
    assert.deepEqual(items.map((i: { id: number }) => i.id), [b.id, a.id]);
    console.log("reorder applied: ok");

    // new item appends after reordered items
    const c = await addItem("third");
    items = await getItems();
    assert.deepEqual(items.map((i: { id: number }) => i.id), [b.id, a.id, c.id]);
    console.log("append respects position: ok");

    // order with an item from another list -> 400
    const otherList = await fetch(`${BASE}/api/cliplists`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ name: `Reorder Other ${Date.now()}` }),
    });
    assert.equal(otherList.status, 201);
    const other = await otherList.json();
    try {
      const badOrder = await fetch(`${BASE}/api/cliplists/${list.id}/items`, {
        method: "PATCH",
        headers: ownerHeaders,
        body: JSON.stringify({ order: [a.id, b.id, c.id] }),
      });
      assert.equal(badOrder.status, 200);
      const foreign = await fetch(`${BASE}/api/cliplists/${other.id}/items`, {
        method: "PATCH",
        headers: ownerHeaders,
        body: JSON.stringify({ order: [a.id] }),
      });
      assert.equal(foreign.status, 400);
      console.log("foreign item rejected: ok");
    } finally {
      await fetch(`${BASE}/api/cliplists/${other.id}`, { method: "DELETE", headers: ownerHeaders });
    }

    // malformed order -> 400
    const malformed = await fetch(`${BASE}/api/cliplists/${list.id}/items`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ order: "nope" }),
    });
    assert.equal(malformed.status, 400);
    console.log("malformed order rejected: ok");

    console.log("ALL PASS");
  } finally {
    await fetch(`${BASE}/api/cliplists/${list.id}`, { method: "DELETE", headers: ownerHeaders });
    console.log("cleanup done");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
