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
  // loadVideo is deferred so tests can play with the pendingPlay/auto-resume
  // settle race deterministically.
  const loadQueue: Array<{ id: number; h?: string; resolve: () => void; reject: (e?: unknown) => void }> = [];
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
    async loadVideo(spec: { id: number; h?: string }) {
      return new Promise<void>((resolve, reject) => { loadQueue.push({ id: spec.id, h: spec.h, resolve, reject }); });
    },
    emit(event, data) { for (const cb of handlers.get(event) ?? []) cb(data); },
    resolveReady() { readyResolve?.(); },
  };
  // expose helpers for tests
  (player as unknown as { _loadQueue: typeof loadQueue })._loadQueue = loadQueue;
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

  // ── 5b. queued play before ready should start when the SDK becomes ready ──
  const p5b = makeFakePlayer();
  const a5b = new VimeoAdapter(p5b);
  let readyPlayCount = 0;
  p5b.play = async () => { readyPlayCount += 1; p5b.emit("play"); };
  a5b.playVideo();
  assert.equal(readyPlayCount, 0, "play is queued while the SDK is not ready");
  p5b.resolveReady();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(readyPlayCount > 0, "queued play begins once the SDK is ready");

  // ── 6. loadVideoById + playVideo: play queued behind the load, and the
  //      settle race (Vimeo fires play → pause) is auto-resumed ──
  const p6 = makeFakePlayer();
  const a6 = new VimeoAdapter(p6);
  p6.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  const loadQueue6 = (p6 as unknown as { _loadQueue: { id: number; h?: string; resolve: () => void; reject: (e?: unknown) => void }[] })._loadQueue;
  const p6events: string[] = [];
  p6.play = async () => { p6events.push("play"); p6.emit("play"); };
  // emulate the transition: loadVideoById + playVideo (play queues behind load)
  a6.loadVideoById("12345", 0);
  a6.playVideo();
  assert.equal(loadQueue6.length, 1, "loadVideo called once");
  assert.equal(a6.getPlayerState(), 2, "paused while load is in flight");
  // resolve the load: queued play fires
  loadQueue6[0].resolve();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(p6events.includes("play"), "queued play fires after load resolves");
  // now Vimeo auto-pauses during settle (the bug): auto-resume should re-play
  const before = p6events.length;
  p6.emit("pause");
  await new Promise((r) => setTimeout(r, 450));
  assert.ok(p6events.length > before, "auto-resume re-issues play after settle pause");

  // ── 7. auto-resume never fights a manual pauseVideo ──
  const p7 = makeFakePlayer();
  const a7 = new VimeoAdapter(p7);
  p7.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  let p7plays = 0;
  p7.play = async () => { p7plays++; p7.emit("play"); };
  a7.playVideo();
  a7.pauseVideo(); // user pause clears the resume budget and watchdog
  const q7 = (p7 as unknown as { _loadQueue: typeof loadQueue6 })._loadQueue;
  a7.loadVideoById("999", 0);
  q7[0].reject(new Error("no load")); // loadVideo fails → loading reset
  // playVideo was called while paused intent; but the earlier play already
  // armed resume; a pause now must NOT auto-resume because pauseVideo cleared it
  p7.emit("pause");
  const before7 = p7plays;
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(p7plays, before7, "no auto-resume after manual pauseVideo");

  // ── 10. progress-based watchdog: keeps re-issuing play while the media
  //       silently stalls (state=playing but time never advances), and stops
  //       the moment currentTime actually advances past the play target ──
  const p10 = makeFakePlayer();
  const a10 = new VimeoAdapter(p10);
  p10.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  let plays10 = 0;
  p10.play = async () => { plays10++; p10.emit("play"); };
  a10.playVideo(); // beginPlay: intends to play, target = current time (0)
  await new Promise((r) => setTimeout(r, 1150)); // ~2 watchdog ticks elapse
  assert.ok(plays10 >= 2, `watchdog re-issues play while stalled (got ${plays10})`);
  // media finally progresses past the target → watchdog must stop
  p10.emit("timeupdate", { seconds: 1.2, duration: 62 });
  const stoppedAt = plays10;
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(plays10, stoppedAt, "watchdog stops once time advances past target");
  // and a subsequent Vimeo auto-pause must NOT re-play now (no longer intended)
  p10.emit("pause");
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(plays10, stoppedAt, "no re-play after progress achieved + pause");

  // ── 8. loadVideoById with a privacy hash passes {id, h} to the SDK ──
  const p8 = makeFakePlayer();
  const a8 = new VimeoAdapter(p8);
  p8.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  const q8 = (p8 as unknown as { _loadQueue: typeof loadQueue6 })._loadQueue;
  a8.loadVideoById("76979871?h=8272103f6e", 0);
  assert.equal(q8.length, 1, "loadVideo called once for hashed spec");
  assert.deepEqual(
    { id: q8[0].id, h: q8[0].h },
    { id: 76979871, h: "8272103f6e" },
    "hash spec passed through to SDK loadVideo"
  );
  // bare-id spec (public video) omits h
  const p8b = makeFakePlayer();
  const a8b = new VimeoAdapter(p8b);
  p8b.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  const q8b = (p8b as unknown as { _loadQueue: typeof loadQueue6 })._loadQueue;
  a8b.loadVideoById("12133658", 0);
  assert.deepEqual({ id: q8b[0].id, h: q8b[0].h }, { id: 12133658, h: undefined }, "bare id omits h");
  q8[0].resolve();

  // ── 9. social helpers: detect hash, build embed URL, parse spec ──
  const { detectSocialPlatform, vimeoEmbedUrl, parseVimeoSpec } = await import("../lib/social");
  const m = detectSocialPlatform("https://player.vimeo.com/video/12133658?h=bfdbe1c46f");
  assert.deepEqual(m, { platform: "vimeo", platformId: "12133658?h=bfdbe1c46f" }, "hash captured in platformId");
  assert.deepEqual(detectSocialPlatform("https://vimeo.com/12133658"), { platform: "vimeo", platformId: "12133658" }, "no hash for public video");
  assert.equal(
    vimeoEmbedUrl("12133658?h=bfdbe1c46f"),
    "https://player.vimeo.com/video/12133658?h=bfdbe1c46f&api=1",
    "embed url includes hash + api with a valid query separator"
  );
  assert.deepEqual(parseVimeoSpec("76979871?h=8272103f6e"), { id: "76979871", hash: "8272103f6e" }, "spec parse");
  const bare = parseVimeoSpec("12133658");
  assert.equal(bare.id, "12133658", "spec parse bare id");
  assert.equal(bare.hash, undefined, "spec parse bare no hash");

  console.log("ALL VIMEO ADAPTER TESTS PASS");
}

main().catch((e) => { console.error(e); process.exit(1); });
