import { readFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const salt = "authjs.session-token";
const token = await encode({ token: { sub: "google-jonimar@gmail.com", email: "jonimar@gmail.com", name: "Jonimar Marcal" }, secret: process.env.AUTH_SECRET!, salt, maxAge: 3600 });
async function ensure(url: string): Promise<number> {
  const r = await fetch("http://localhost:3000/api/videos", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: `authjs.session-token=${token}` },
    body: JSON.stringify({ url }),
  });
  const j = await r.json();
  return j.id;
}
console.log("TOKEN=" + token);
console.log("TW_ID=" + await ensure("https://x.com/SpaceX/status/1732824684683784516"));
