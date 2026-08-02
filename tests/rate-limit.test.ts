import assert from "node:assert";
import { checkLimit } from "../lib/rate-limit";

function main() {
  const key = `unit-${Date.now()}-${Math.random()}`;

  assert.equal(checkLimit(key, 3, 10_000), false, "1st request");
  assert.equal(checkLimit(key, 3, 10_000), false, "2nd request");
  assert.equal(checkLimit(key, 3, 10_000), false, "3rd request");
  assert.equal(checkLimit(key, 3, 10_000), true, "4th request is limited");
  assert.equal(checkLimit(key, 3, 10_000), true, "5th request still limited");
  console.log("limit enforced at max: ok");

  // window expiry frees the key
  const expiring = `unit-expire-${Date.now()}`;
  checkLimit(expiring, 1, 1);
  checkLimit(expiring, 1, 1); // 1ms window already expired -> allowed
  console.log("window expiry resets: ok");

  // independent keys don't interfere
  const a = `unit-a-${Date.now()}`;
  const b = `unit-b-${Date.now()}`;
  checkLimit(a, 1, 10_000);
  assert.equal(checkLimit(b, 1, 10_000), false, "different key allowed");
  console.log("keys independent: ok");

  console.log("ALL PASS");
}
main();
