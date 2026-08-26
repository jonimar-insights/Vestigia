import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { encode } from "@auth/core/jwt";
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
interface VideoRow { id: number }
interface VideoResponse { id: number; title?: string | null }
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const salt = "authjs.session-token";
  const secret = process.env.AUTH_SECRET!;
  const token = await encode({ token: { sub: "google-jonimar@gmail.com", email: "jonimar@gmail.com", name: "Jonimar Marcal" }, secret, salt, maxAge: 60 * 60 });
  const exists = await sql.query<VideoRow>("SELECT id FROM videos WHERE youtube_id = $1 AND user_id = $2", ["vimeo:76979871", "google-jonimar@gmail.com"]);
  let videoId: number;
  if (exists.length > 0) {
    videoId = exists[0].id;
    console.log("vimeo video already exists:", videoId);
  } else {
    const r = await fetch("http://localhost:3000/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `authjs.session-token=${token}` },
      body: JSON.stringify({ url: "https://vimeo.com/76979871" }),
    });
    const j = await r.json() as VideoResponse;
    videoId = j.id;
    console.log("created vimeo video:", videoId, j.title);
  }
  console.log("TOKEN=" + token);
  console.log("VIDEO_ID=" + videoId);
}
main();
