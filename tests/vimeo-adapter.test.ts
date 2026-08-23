/**
 * Unit tests for VimeoAdapter — verifies the promise-based Vimeo SDK is
 * correctly adapted to the synchronous YT-style interface (state caching,
 * event wiring, ready sequencing).
 * Run: npx tsx tests/vimeo-adapter.test.ts
 */
import assert from "node:assert";
import { VimeoAdapter, type MinimalVimeoPlayer } from "../lib/vimeo-adapter";

interface FakePlayer extends MinimalVimeoPlayer {
  emit(event: string, data?: unknown): void;
  resolveReady(): void;
}

function makeFakePlayer() {
  const handlers = new Map<string, Array<(data?: unknown) => void>>();
  let readyResolve: (() => void) | null = null;
  const player: FakePlayer = {
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(cb);
    },
    ready() {
      return new Promise((res) => { readyResolve = () => res(undefined); });
    },
    async getCurrentTime() { return (player as unknown as { _t?: number })._t ?? 0; },
    async getDuration() { return 62; },
    async setCurrentTime(seconds: number) {
      (player as unknown as { _t?: number })._t = seconds;
      player.emit("seeked", { seconds });
    },
    async play() { player.emit("play"); },
    async pause() { player.emit("pause"); },
    emit(event, data) {
      for (const cb of handlers.get(event) ?? []) cb(data);
    },
    resolveReady() { readyResolve?.(); },
  };
  return player;
}

async function main() {
  // ── 1. Ready callbacks fire only after getDuration resolves ──
  const p1 = makeFakePlayer();
  const a1 = new VimeoAdapter(p1);
  let readyFired = false;
  a1.onReady(() => { readyFired = true; });
  p1.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(readyFired, "ready callback fires after SDK ready + getDuration");
  assert.equal(a1.getDuration(), 62, "duration cached from getDuration");

  // late subscriber gets immediate call
  let lateFired = false;
  a1.onReady(() => { lateFired = true; });
  assert.ok(lateFired, "onReady after ready fires immediately");

  // ── 2. timeupdate / seeked events refresh the synchronous cache ──
  p1.emit("timeupdate", { seconds: 12.5, duration: 62 });
  assert.equal(a1.getCurrentTime(), 12.5, "timeupdate updates cached time");
  p1.emit("seeked", { seconds: 30 });
  assert.equal(a1.getCurrentTime(), 30, "seeked updates cached time");

  // ── 3. Play state events → getPlayerState + onPlayState callback ──
  const states: boolean[] = [];
  a1.onPlayState((playing) => states.push(playing));
  p1.emit("play");
  assert.equal(a1.getPlayerState(), 1, "play maps to YT state 1");
  p1.emit("pause");
  assert.equal(a1.getPlayerState(), 2, "pause maps to YT state 2");
  assert.deepEqual(states, [true, false], "play state callbacks in order");

  // ── 4. seekTo writes the cache synchronously and emits seeked ──
  const a2 = new VimeoAdapter(makeFakePlayer());
  (a2 as unknown as { p: FakePlayer }).p.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  a2.seekTo(45, true);
  assert.equal(a2.getCurrentTime(), 45, "seekTo caches time immediately");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a2.getCurrentTime(), 45, "seeked event confirms same value");

  // ── 5. playVideo/pauseVideo delegate ──
  const p5 = makeFakePlayer();
  const a5 = new VimeoAdapter(p5);
  p5.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  const seen: string[] = [];
  p5.play = async () => { seen.push("play"); };
  p5.pause = async () => { seen.push("pause"); };
  a5.playVideo();
  a5.pauseVideo();
  assert.deepEqual(seen, ["play", "pause"], "delegates to SDK play/pause");

  console.log("ALL VIMEO ADAPTER TESTS PASS");
}

main().catch((e) => { console.error(e); process.exit(1); });
