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
  _muted: boolean;
  _mutedHistory: boolean[];
}

function makeFakePlayer() {
  const handlers = new Map<string, Array<(data?: unknown) => void>>();
  let readyResolve: (() => void) | null = null;
  // loadVideo is deferred so tests can play with the pendingPlay/auto-resume
  // settle race deterministically.
  const loadQueue: Array<{ id: number; h?: string; resolve: () => void; reject: (e?: unknown) => void }> = [];
  const mutedHistory: boolean[] = [];
  const player: FakePlayer = {
    _muted: false,
    _mutedHistory: mutedHistory,
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
    async setMuted(m: boolean) { mutedHistory.push(m); (player as unknown as { _muted: boolean })._muted = m; },
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

  // ── 11. autoplay-policy fallback: when unmuted play is silently blocked, the
  //       watchdog mutes to coax the browser into allowing playback, then
  //       UNMUTES as soon as real progress is detected ──
  const p11 = makeFakePlayer();
  const a11 = new VimeoAdapter(p11);
  p11.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  let plays11 = 0;
  p11.play = async () => { plays11++; p11.emit("play"); };
  const mutedHistory = p11._mutedHistory;
  mutedHistory.length = 0; // ignore the initial per-load unmute (no load here)
  a11.playVideo(); // beginPlay, target 0
  // Stall long enough to cross MUTED_FALLBACK_AFTER_MS (500ms ticks, 1.5s floor)
  await new Promise((r) => setTimeout(r, 2100));
  assert.ok(mutedHistory.includes(true), `watchdog mutes after blocked stall (history=${mutedHistory.join(",")})`);
  assert.ok(plays11 >= 1, `watchdog re-issues play during blocked autoplay (got ${plays11})`);
  const mutedBefore = p11._muted;
  assert.ok(mutedBefore, "player is muted during fallback");
  // Now media actually progresses → watchdog must unmute and stop
  p11.emit("timeupdate", { seconds: 2.5, duration: 62 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(p11._muted, false, "auto-unmute once playback makes progress");
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(p11._muted, false, "stays unmuted after progress");
  // A manual pause must also keep the clip unmuted (fallback not sticky)
  p11.emit("pause");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(p11._muted, false, "manual pause does not re-mute");

  // ── 12. same-video fast path: a video the player ALREADY has loaded (the
  //       seeded ?api=1 iframe of the first Vimeo clip, or a previous explicit
  //       load) is NOT reloaded — loadVideoById() seeks and plays directly —
  //       while a DIFFERENT video still issues loadVideo, and the fast path is
  //       DISABLED while another video is mid-load (so a stale in-flight load
  //       can never swap the video out from under the requested seek) ──
  const p12 = makeFakePlayer();
  const a12 = new VimeoAdapter(p12, "62514288"); // iframe was seeded with this video
  p12.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  const q12 = (p12 as unknown as { _loadQueue: typeof loadQueue6 })._loadQueue;
  let plays12 = 0;
  p12.play = async () => { plays12++; p12.emit("play"); };
  // same video as the seed → must NOT trigger a second bootstrap
  a12.loadVideoById("62514288", 12);
  assert.equal(q12.length, 0, "seeded video is not reloaded");
  a12.playVideo();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(plays12 > 0, "playback starts without reloading the seeded video");
  // a DIFFERENT video is loaded normally
  a12.loadVideoById("12133658", 0);
  assert.equal(q12.length, 1, "different video issues loadVideo");
  q12[0].resolve();
  await new Promise((r) => setTimeout(r, 20));
  // and once explicitly loaded, the same video again is also seek-only
  a12.loadVideoById("12133658", 30);
  assert.equal(q12.length, 1, "explicitly-loaded video is not reloaded either");
  assert.equal(a12.getCurrentTime(), 30, "same-video fast path seeks the cached time");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a12.getCurrentTime(), 30, "same-video seek lands");
  // fast path is DISABLED while a DIFFERENT video is still loading
  const beforeLen = q12.length; // 1
  a12.loadVideoById("77777", 5); // push #2 → loading = true
  a12.loadVideoById("12133658", 40); // loadedSpec matches, but a load IS in flight
  assert.equal(q12.length, beforeLen + 2, "fast path disabled while another load is in flight");
  assert.equal(a12.getCurrentTime(), 40, "full-load path still caches the target time");
  q12[beforeLen].resolve(); // 77777 resolves → stale generation, must be ignored
  q12[beforeLen + 1].resolve(); // 12133658 reload resolves → authoritative
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(a12.getCurrentTime(), 40, "reloaded target video wins over the stale load");
  assert.equal(q12.length, beforeLen + 2, "no extra loadVideo after the reload completed");
  // fast path is re-enabled once the load finished
  a12.loadVideoById("12133658", 50);
  assert.equal(q12.length, beforeLen + 2, "fast path re-enabled after the reload completed");
  assert.equal(a12.getCurrentTime(), 50, "same-video fast path works after reloading");

// ── 13. loadVideo() REJECT must NOT abandon a skipped clip: the queued play
//       intent is delivered to the watchdog immediately (so play is re-issued
//       and the muted fallback can engage) and a bounded reload re-issues
//       loadVideo() to bring the right video in ──
  const p13 = makeFakePlayer();
  const a13 = new VimeoAdapter(p13);
  p13.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  let plays13 = 0;
  p13.play = async () => { plays13++; p13.emit("play"); };
  const q13 = (p13 as unknown as { _loadQueue: typeof loadQueue6 })._loadQueue;
  a13.loadVideoById("99999", 0); // full load
  a13.playVideo();               // play queues behind the load
  assert.equal(q13.length, 1, "load issued");
  q13[0].reject(new Error("embed busy")); // load REJECTS mid-swap
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(plays13 > 0, "play attempts continue after load rejection (clip is not abandoned)");
  assert.equal(q13.length, 1, "no immediate double load before the backoff");
  await new Promise((r) => setTimeout(r, 700)); // > LOAD_RETRY_DELAY_MS
  assert.ok(q13.length >= 2, "retry re-issues loadVideo after a rejected load");
  q13[1].resolve(); // retried load succeeds
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(plays13 >= 2, "playback resumes after the retried load resolves");
  assert.equal(q13.length, 2, "no further redundant loads after a successful retry");

  // ── 14. loadVideo() HANG (never resolves nor rejects) must not freeze the
  //       skipped clip forever: after the configurable stall timeout the
  //       queued play is delivered and a bounded reload is scheduled ──
  const p14 = makeFakePlayer();
  const a14 = new VimeoAdapter(p14, undefined, { loadResolveTimeoutMs: 120 });
  p14.resolveReady();
  await new Promise((r) => setTimeout(r, 10));
  let plays14 = 0;
  p14.play = async () => { plays14++; p14.emit("play"); };
  const q14 = (p14 as unknown as { _loadQueue: typeof loadQueue6 })._loadQueue;
  a14.loadVideoById("55555", 0);
  a14.playVideo();
  assert.equal(q14.length, 1, "load issued");
  // leave the load promise pending — it never settles
  await new Promise((r) => setTimeout(r, 300)); // > 120ms stall timeout
  assert.ok(plays14 > 0, "queued play is delivered after the load stall timeout");
  await new Promise((r) => setTimeout(r, 700)); // > LOAD_RETRY_DELAY_MS
  assert.ok(q14.length >= 2, "stalled load is retried");
  q14[1].resolve();
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(plays14 >= 2, "playback resumes after the retried load resolves");

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
