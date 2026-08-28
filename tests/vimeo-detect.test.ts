import assert from "node:assert";
import { detectSocialPlatform, parseSocialStorageId, socialStorageId } from "../lib/social";

function vimeoId(url: string): string | null {
  const r = detectSocialPlatform(url.trim());
  if (r && r.platform === "vimeo") return r.platformId;
  return null;
}

const cases: [string, string | null][] = [
  // canonical bare id
  ["https://vimeo.com/76979871", "76979871"],
  // /video/ prefixed id
  ["https://vimeo.com/video/76979871", "76979871"],
  // album URLs: must pick the /video/ id, NOT the (numeric) album id
  ["https://vimeo.com/album/1234567/video/23456789", "23456789"],
  // 5-digit legacy ids are valid
  ["https://vimeo.com/12345", "12345"],
  // whitespace is tolerated by callers that trim
  [" https://vimeo.com/76979871 ", "76979871"],
  // query/hash stripped
  ["https://vimeo.com/76979871?foo=bar", "76979871"],
  // non-canonical channel path still resolves to the trailing numeric id
  ["https://vimeo.com/channels/staffpicks/76979871", "76979871"],
  // www + subdomains
  ["https://www.vimeo.com/76979871", "76979871"],
  // negatives
  ["https://www.youtube.com/watch?v=9bZkp7q19f0", null],
  ["https://example.com/some/video", null],
  ["https://vimeo.com/channels/documentary", null],
  // 4-digit numeric should NOT match (vimeo ids are 5+ digits)
  ["https://vimeo.com/1234", null],
];

for (const [url, expected] of cases) {
  const got = vimeoId(url);
  assert.equal(got, expected, `vimeoId(${url}) = ${got}, expected ${expected}`);
  console.log(`PASS  detectSocialPlatform vimeo: ${url} -> ${got}`);
}

// storage id round trip
const id = vimeoId("https://vimeo.com/76979871")!;
const sid = socialStorageId({ platform: "vimeo", platformId: id });
assert.equal(sid, `vimeo:${id}`);
assert.deepEqual(parseSocialStorageId(sid), { platform: "vimeo", platformId: id });
console.log("PASS  storage id round trip:", sid);

console.log("ALL VIMEO SOCIAL TESTS PASS");
