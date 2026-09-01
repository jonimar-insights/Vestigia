/**
 * Vimeo Player Adapter
 *
 * Adapts the Vimeo Player SDK (promise-based) to the synchronous
 * YouTube-IFrame-style interface used by the video page.
 *
 * Design goals:
 * - Keep the public interface synchronous for the playlist player.
 * - Cache Vimeo state from SDK events.
 * - Never make readiness dependent on getDuration().
 * - Make autoplay resilient to browser/Vimeo startup stalls.
 * - Keep audio unmuted: the playlist never auto-mutes a Vimeo clip.
 * - Never let an asynchronous Vimeo operation block the playlist forever.
 * - Protect against stale async loadVideo() operations.
 * - Clean up every timer and callback on destroy().
 */

import { parseVimeoSpec } from "@/lib/social";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface MinimalVimeoPlayer {
  on(event: string, cb: (data?: unknown) => void): void;

  /**
   * Resolves when the Vimeo player SDK is ready.
   */
  ready(): Promise<unknown>;

  /**
   * Promise-based Vimeo getters.
   */
  getCurrentTime(): Promise<number>;
  getDuration(): Promise<number>;

  /**
   * Promise-based playback controls.
   */
  setCurrentTime(seconds: number): Promise<unknown>;
  play(): Promise<void>;
  pause(): Promise<void>;

  /**
   * Swap another video into the same Vimeo embed.
   *
   * Vimeo supports either an id or an object containing id/hash.
   * We use the object form because Vimeo private/unlisted videos
   * may require the hash.
   */
  loadVideo?(spec: { id: number; h?: string }): Promise<unknown>;

  setPlaybackRate?(rate: number): Promise<unknown>;
  setMuted?(muted: boolean): Promise<unknown>;

  destroy?(): Promise<void> | void;
}

/**
 * This intentionally mirrors the YouTube player interface consumed
 * by VideoPlaylistPlayer.tsx.
 */
export interface SyncPlayerInterface {
  getCurrentTime(): number;
  getDuration(): number;

  seekTo(seconds: number, allowSeekAhead: boolean): void;

  playVideo(): void;
  pauseVideo(): void;

  getPlayerState(): number;

  loadVideoById(videoId: string, startSeconds: number): void;
  cueVideoById(videoId: string, startSeconds: number): void;

  destroy(): void;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * YT-compatible player states used by the application.
 *
 * 0 = ended
 * 1 = playing
 * 2 = paused
 */
const PLAYER_ENDED = 0;
const PLAYER_PLAYING = 1;
const PLAYER_PAUSED = 2;

/**
 * Vimeo's ready promise should normally resolve very quickly.
 *
 * We deliberately do not fail the player at this point; the timeout
 * exists to make the failure observable rather than leaving the UI
 * permanently stuck on "Loading player...".
 */
const READY_TIMEOUT_MS = 8000;

/**
 * Autoplay watchdog checks every half second.
 */
const WATCHDOG_INTERVAL_MS = 500;

/**
 * Give Vimeo roughly 10 seconds to being actual playback.
 */
const WATCHDOG_MAX_ATTEMPTS = 20;

/**
 * When Vimeo emits pause during an intended autoplay operation,
 * wait briefly before attempting play again.
 */
const RESUME_DELAY_MS = 350;

/**
 * After this many ms without real playback progress, the watchdog
 * falls back to MUTED autoplay. The browser always permits silent
 * autoplay, so this coaxes a blocked (autoplay-policy) Vimeo video
 * into actually buffering — then it unmutes once progress is seen.
 *
 * Happens well before WATCHDOG_MAX_ATTEMPTS (10s) so there is time
 * left to detect progress and restore sound.
 */
const MUTED_FALLBACK_AFTER_MS = 1500;

/**
 * Do not consider extremely tiny floating-point changes meaningful
 * playback progress.
 */
const PROGRESS_EPSILON = 0.01;

/* -------------------------------------------------------------------------- */
/* Debugging                                                                  */
/* -------------------------------------------------------------------------- */

function dbg(...args: unknown[]) {
  if (
    typeof window !== "undefined" &&
    (window as { __VIMEO_DEBUG?: boolean }).__VIMEO_DEBUG
  ) {
    console.log("[VimeoAdapter]", ...args);
  }
}

function dbgWarn(...args: unknown[]) {
  if (
    typeof window !== "undefined" &&
    (window as { __VIMEO_DEBUG?: boolean }).__VIMEO_DEBUG
  ) {
    console.warn("[VimeoAdapter]", ...args);
  }
}

function dbgError(...args: unknown[]) {
  if (
    typeof window !== "undefined" &&
    (window as { __VIMEO_DEBUG?: boolean }).__VIMEO_DEBUG
  ) {
    console.error("[VimeoAdapter]", ...args);
  }
}

/* -------------------------------------------------------------------------- */
/* Adapter                                                                    */
/* -------------------------------------------------------------------------- */

export class VimeoAdapter implements SyncPlayerInterface {
  private readonly p: MinimalVimeoPlayer;

  /* Cached Vimeo state ----------------------------------------------------- */

  private time = 0;
  private durationSec = 0;
  private state = PLAYER_PAUSED;

  /* External callbacks ----------------------------------------------------- */

  private playStateCb: ((playing: boolean) => void) | null = null;
  private readyCbs: Array<() => void> = [];

  /* Lifecycle -------------------------------------------------------------- */

  private readyFired = false;
  private destroyed = false;

  /**
   * Indicates whether the Vimeo SDK has reported readiness.
   *
   * This is intentionally separate from readyFired so diagnostics can
   * distinguish SDK readiness from callback completion.
   */
  private sdkReady = false;

  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  /* Video loading ---------------------------------------------------------- */

  private loading = false;
  private pendingPlay = false;

  /**
   * The Vimeo spec ("<id>?h=<hash>" or "<id>") currently loaded in the
   * player, or null when nothing has been explicitly loaded yet.
   *
   * The playlist builds the player over an existing ?api=1 iframe that is
   * SEEDED with the first Vimeo clip's own embed URL, so the video is
   * already bootstrapping inside the player before the adapter exists. The
   * constructor accepts that spec as {@link initialSpec} so a redundant
   * loadVideo() (a second /config + CDN bootstrap) is never issued for the
   * very video the iframe already contains. Every explicit loadVideoById()
   * records the spec here on success, so consecutive clips of the SAME video
   * also seek instead of reloading.
   */
  private loadedSpec: string | null = null;

  /**
   * Incremented for every loadVideoById() request.
   *
   * If an old Vimeo load resolves after a newer one has started,
   * its completion handler is ignored.
   */
  private loadGeneration = 0;

  /* Autoplay watchdog ------------------------------------------------------ */

  private intendPlay = false;
  private playTarget = -1;

  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  private watchdogBudget = 0;
  private stalledMs = 0;

  /**
   * True when the user explicitly muted the player.
   *
   * The autoplay watchdog must never automatically unmute in this
   * situation.
   */
  private userMuted = false;

  /**
   * True when the autoplay watchdog silenced the player via its
   * muted-autoplay fallback (blocked unmuted autoplay).
   *
   * Unlike {@link userMuted}, this is never a user choice, so the
   * adapter is free to unmute as soon as playback makes progress.
   */
  private autoMuted = false;

  /* ------------------------------------------------------------------------ */
  /* Timer management                                                         */
  /* ------------------------------------------------------------------------ */

  private clearResumeTimer() {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  private clearWatchdog() {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  private clearReadyTimer() {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  /**
   * Stop all automatic playback attempts.
   *
   * Manual pauseVideo() calls this method so the watchdog never fights
   * the user's explicit pause action.
   */
  private stopAutoPlay() {
    this.intendPlay = false;

    this.clearResumeTimer();
    this.clearWatchdog();

    this.watchdogBudget = 0;
    this.stalledMs = 0;

    /**
     * If the muted-autoplay fallback had silenced the player, restore
     * sound now that automatic playback attempt has ended (e.g. the
     * user paused, the clip ended, or a new clip replaced it). A user
     * mute is untouched.
     */
    if (this.autoMuted && !this.userMuted) {
      this.autoMuted = false;
      this.p
        .setMuted?.(false)
        .catch((error: unknown) => {
          dbgWarn("auto-unmute after stop rejected", error);
        });
    } else {
      this.autoMuted = false;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Playback progress                                                        */
  /* ------------------------------------------------------------------------ */

  private progressed(): boolean {
    return this.time > this.playTarget + PROGRESS_EPSILON;
  }

  /**
   * Start autoplay with actual-progress verification.
   *
   * Vimeo can report "playing" while currentTime remains unchanged.
   * Therefore the adapter does not trust the play event alone.
   */
  private beginPlay() {
    if (this.destroyed) return;

    this.intendPlay = true;
    this.playTarget = this.time;
    this.stalledMs = 0;

    this.clearResumeTimer();
    this.clearWatchdog();

    this.watchdogBudget = WATCHDOG_MAX_ATTEMPTS;

    dbg("beginPlay", {
      time: this.time,
      target: this.playTarget,
    });

    this.issuePlay();

    this.watchdog = setInterval(() => {
      if (this.destroyed) {
        this.stopAutoPlay();
        return;
      }

      if (!this.intendPlay) {
        this.stopAutoPlay();
        return;
      }

      /**
       * If the video has ended, there is no reason to continue issuing
       * play commands.
       */
      if (this.state === PLAYER_ENDED) {
        this.stopAutoPlay();
        return;
      }

      /**
       * This is the important test.
       *
       * Do not trust Vimeo's "play" event. Trust actual currentTime
       * movement.
       */
      if (this.progressed()) {
        dbg("real playback progress detected", {
          time: this.time,
          target: this.playTarget,
        });

        /**
         * If the muted-autoplay fallback silenced this video, restore
         * sound as soon as playback is actually moving. Never do this
         * when the user muted.
         */
        if (this.autoMuted && !this.userMuted) {
          this.autoMuted = false;
          dbg("unmuting after muted-autoplay fallback produced progress");
          this.p
            .setMuted?.(false)
            .catch((error: unknown) => {
              dbgWarn("auto-unmute rejected", error);
            });
        }

        this.stopAutoPlay();
        return;
      }

      this.stalledMs += WATCHDOG_INTERVAL_MS;

      this.watchdogBudget -= 1;

      if (this.watchdogBudget <= 0) {
        dbgWarn("autoplay watchdog exhausted", {
          time: this.time,
          target: this.playTarget,
          state: this.state,
        });

        this.stopAutoPlay();
        return;
      }

      dbg("autoplay watchdog retry", {
        time: this.time,
        target: this.playTarget,
        state: this.state,
        stalledMs: this.stalledMs,
        budget: this.watchdogBudget,
      });

      /**
       * Unmuted autoplay may be blocked by the browser's autoplay
       * policy (the skipped-to clip has no user gesture). Once the
       * clip has been silent-stalled long enough, fall back to MUTED
       * autoplay — silent autoplay is always permitted — so the video
       * actually buffers. Progress detection above then unmutes it.
       *
       * Never mutes a video the user explicitly silenced.
       */
      if (
        !this.autoMuted &&
        !this.userMuted &&
        this.stalledMs >= MUTED_FALLBACK_AFTER_MS
      ) {
        this.autoMuted = true;
        dbgWarn("autoplay blocked; falling back to muted autoplay");
        this.p
          .setMuted?.(true)
          .catch((error: unknown) => {
            dbgWarn("auto-mute rejected", error);
          });
      }

      this.issuePlay();
    }, WATCHDOG_INTERVAL_MS);
  }

  /**
   * Issue a Vimeo play request without allowing a rejected promise to
   * break the watchdog.
   */
  private issuePlay() {
    if (this.destroyed) return;

    dbg("issuePlay()", {
      time: this.time,
      target: this.playTarget,
      state: this.state,
    });

    this.p
      .play()
      .then(() => {
        dbg("Vimeo play() resolved");
      })
      .catch((error) => {
        /**
         * Autoplay rejection is not fatal.
         *
         * The watchdog will retry and, if necessary, transition to
         * muted autoplay.
         */
        dbgWarn("Vimeo play() rejected", error);
      });
  }

  /* ------------------------------------------------------------------------ */
  /* Event binding                                                             */
  /* ------------------------------------------------------------------------ */

  private bindEvents() {
    /* Time updates ---------------------------------------------------------- */

    this.p.on("timeupdate", (data) => {
      if (this.destroyed) return;

      const d = data as
        | {
            seconds?: number;
            duration?: number;
          }
        | undefined;

      if (typeof d?.seconds === "number" && Number.isFinite(d.seconds)) {
        this.time = Math.max(0, d.seconds);

        if (this.intendPlay && this.progressed()) {
          this.stopAutoPlay();
        }
      }

      if (
        typeof d?.duration === "number" &&
        Number.isFinite(d.duration) &&
        d.duration > 0
      ) {
        this.durationSec = d.duration;
      }

      dbg("timeupdate", {
        seconds: d?.seconds,
        duration: d?.duration,
        intendPlay: this.intendPlay,
        target: this.playTarget,
        state: this.state,
      });
    });

    /* Seeked ---------------------------------------------------------------- */

    this.p.on("seeked", (data) => {
      if (this.destroyed) return;

      const d = data as
        | {
            seconds?: number;
            duration?: number;
          }
        | undefined;

      if (typeof d?.seconds === "number" && Number.isFinite(d.seconds)) {
        this.time = Math.max(0, d.seconds);
      }

      if (
        typeof d?.duration === "number" &&
        Number.isFinite(d.duration) &&
        d.duration > 0
      ) {
        this.durationSec = d.duration;
      }

      dbg("seeked", {
        seconds: d?.seconds,
        duration: d?.duration,
      });
    });

    /* Duration changes ------------------------------------------------------ */

    this.p.on("durationchange", (data) => {
      if (this.destroyed) return;

      const d = data as
        | {
            duration?: number;
          }
        | undefined;

      if (
        typeof d?.duration === "number" &&
        Number.isFinite(d.duration) &&
        d.duration > 0
      ) {
        this.durationSec = d.duration;
      }

      dbg("durationchange", d?.duration);
    });

    /* Play ------------------------------------------------------------------ */

    this.p.on("play", () => {
      if (this.destroyed) return;

      this.state = PLAYER_PLAYING;

      dbg("event: play", {
        intendPlay: this.intendPlay,
        time: this.time,
        target: this.playTarget,
      });

      this.playStateCb?.(true);
    });

    /* Playing ---------------------------------------------------------------- */

    this.p.on("playing", () => {
      if (this.destroyed) return;

      this.state = PLAYER_PLAYING;

      dbg("event: playing", {
        time: this.time,
        target: this.playTarget,
      });

      this.playStateCb?.(true);
    });

    /* Pause ----------------------------------------------------------------- */

    this.p.on("pause", () => {
      if (this.destroyed) return;

      this.state = PLAYER_PAUSED;

      dbg("event: pause", {
        intendPlay: this.intendPlay,
        time: this.time,
        target: this.playTarget,
        budget: this.watchdogBudget,
      });

      this.playStateCb?.(false);

      /**
       * Vimeo can auto-pause during the initial embed/load settle.
       *
       * If we explicitly intend to play, give Vimeo a short moment and
       * then retry.
       */
      if (
        this.intendPlay &&
        this.watchdogBudget > 0 &&
        !this.destroyed
      ) {
        this.clearResumeTimer();

        this.resumeTimer = setTimeout(() => {
          this.resumeTimer = null;

          if (this.destroyed || !this.intendPlay) return;

          if (
            this.state === PLAYER_PAUSED &&
            !this.progressed()
          ) {
            dbg("pause recovery: retrying play()");
            this.issuePlay();
          }
        }, RESUME_DELAY_MS);
      }
    });

    /* Ended ----------------------------------------------------------------- */

    this.p.on("ended", () => {
      if (this.destroyed) return;

      this.state = PLAYER_ENDED;

      dbg("event: ended");

      this.playStateCb?.(false);

      this.stopAutoPlay();
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Constructor / readiness                                                  */
  /* ------------------------------------------------------------------------ */

  constructor(player: MinimalVimeoPlayer, initialSpec?: string | null) {
    this.p = player;

    /**
     * When the player is created over an iframe whose src already boots a
     * specific video (the playlist's seeded first-Vimeo-clip iframe), that
     * video is effectively loaded — reloading it later would pay a second
     * full bootstrap. Seed the loaded-spec cache with it.
     */
    if (initialSpec) {
      this.loadedSpec = initialSpec;
      dbg("VimeoAdapter seeded with already-loaded spec", initialSpec);
    }

    this.bindEvents();

    dbg("VimeoAdapter created");

    /**
     * IMPORTANT:
     *
     * Vimeo readiness is determined solely by player.ready().
     *
     * We deliberately do NOT wait for getDuration().
     *
     * Previously, a hanging getDuration() promise could prevent
     * VideoPlaylistPlayer.tsx from ever receiving onReady(), leaving
     * the UI permanently at "Loading player...".
     */
    this.clearReadyTimer();

    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;

      if (this.destroyed || this.readyFired) return;

      dbgError(
        `Vimeo SDK did not become ready within ${READY_TIMEOUT_MS}ms`
      );
    }, READY_TIMEOUT_MS);

    player
      .ready()
      .then(() => {
        if (this.destroyed) return;

        this.sdkReady = true;
        this.clearReadyTimer();

        dbg("Vimeo SDK ready");

        /**
         * Fire application readiness immediately.
         *
         * Duration is fetched independently below.
         */
        this.fireReady();

        /**
         * Duration is useful metadata, but it must NEVER prevent
         * the player from becoming ready.
         */
        this.refreshDuration();
      })
      .catch((error) => {
        this.clearReadyTimer();

        if (this.destroyed) return;

        dbgError("Vimeo SDK ready() rejected", error);
      });
  }

  /**
   * Fire all pending readiness callbacks exactly once.
   */
  private fireReady() {
    if (this.destroyed || this.readyFired) return;

    this.readyFired = true;

    dbg("ready fired");

    if (this.pendingPlay) {
      this.pendingPlay = false;
      dbg("starting queued playback after Vimeo ready");
      this.beginPlay();
    }

    const callbacks = this.readyCbs;
    this.readyCbs = [];

    for (const cb of callbacks) {
      try {
        cb();
      } catch (error) {
        /**
         * Do not allow one consumer callback to prevent subsequent
         * readiness callbacks from running.
         */
        dbgError("Vimeo ready callback threw", error);
      }
    }
  }

  /**
   * Fetch duration independently of player readiness.
   */
  private refreshDuration() {
    if (this.destroyed) return;

    this.p
      .getDuration()
      .then((duration) => {
        if (this.destroyed) return;

        if (
          typeof duration === "number" &&
          Number.isFinite(duration) &&
          duration >= 0
        ) {
          this.durationSec = duration;

          dbg("duration loaded", duration);
        }
      })
      .catch((error) => {
        /**
         * Duration is non-critical metadata.
         *
         * Never turn a duration failure into a player initialization
         * failure.
         */
        dbgWarn("getDuration() failed", error);
      });
  }

  /**
   * Invoke cb once the Vimeo SDK is ready.
   *
   * If readiness already happened, invoke immediately.
   */
  onReady(cb: () => void) {
    if (this.destroyed) return;

    if (this.readyFired) {
      try {
        cb();
      } catch (error) {
        dbgError("Vimeo ready callback threw", error);
      }

      return;
    }

    this.readyCbs.push(cb);
  }

  /**
   * Register the playback-state callback used by the playlist.
   */
  onPlayState(cb: (playing: boolean) => void) {
    if (this.destroyed) return;

    this.playStateCb = cb;
  }

  /* ------------------------------------------------------------------------ */
  /* Synchronous cache API                                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * Pull the current time from Vimeo into our synchronous cache.
   *
   * This is intentionally fire-and-forget.
   */
  refreshTime() {
    if (this.destroyed) return;

    this.p
      .getCurrentTime()
      .then((time) => {
        if (this.destroyed) return;

        if (typeof time === "number" && Number.isFinite(time)) {
          this.time = Math.max(0, time);
        }
      })
      .catch((error) => {
        dbgWarn("getCurrentTime() failed", error);
      });
  }

  getCurrentTime(): number {
    return this.time;
  }

  getDuration(): number {
    return this.durationSec;
  }

  /* ------------------------------------------------------------------------ */
  /* Seeking                                                                   */
  /* ------------------------------------------------------------------------ */

  seekTo(seconds: number, _allowSeekAhead: boolean): void {
    if (this.destroyed) return;

    const target = Number.isFinite(seconds)
      ? Math.max(0, seconds)
      : 0;

    /**
     * Update the synchronous cache immediately.
     *
     * This keeps the playlist UI responsive while Vimeo completes
     * the asynchronous seek.
     */
    this.time = target;

    dbg("seekTo()", target);

    this.p
      .setCurrentTime(target)
      .then(() => {
        dbg("setCurrentTime() resolved", target);
      })
      .catch((error) => {
        dbgWarn("setCurrentTime() rejected", {
          target,
          error,
        });
      });
  }

  /* ------------------------------------------------------------------------ */
  /* Playback                                                                   */
  /* ------------------------------------------------------------------------ */

  playVideo(): void {
    if (this.destroyed) return;

    dbg("playVideo()", {
      loading: this.loading,
      pendingPlay: this.pendingPlay,
      sdkReady: this.sdkReady,
      readyFired: this.readyFired,
    });

    /**
     * Don't call Vimeo.play() while loadVideo() is replacing the video.
     *
     * Vimeo can silently swallow play() during this period.
     */
    if (this.loading) {
      this.pendingPlay = true;
      this.intendPlay = true;

      dbg("play queued because Vimeo video is loading");

      return;
    }

    /**
     * If the SDK has not reported readiness yet, queue playback.
     *
     * In normal operation VideoPlaylistPlayer calls play after onReady,
     * but this makes the adapter robust against callers getting ahead
     * of the SDK.
     */
    if (!this.readyFired) {
      this.pendingPlay = true;
      this.intendPlay = true;

      dbg("play queued because Vimeo SDK is not ready");

      return;
    }

    this.beginPlay();
  }

  pauseVideo(): void {
    if (this.destroyed) return;

    dbg("pauseVideo()");

    /**
     * A manual pause is authoritative.
     *
     * The autoplay watchdog must stop immediately.
     */
    this.pendingPlay = false;
    this.stopAutoPlay();

    this.p
      .pause()
      .then(() => {
        dbg("Vimeo pause() resolved");
      })
      .catch((error) => {
        dbgWarn("Vimeo pause() rejected", error);
      });
  }

  getPlayerState(): number {
    return this.state;
  }

  /* ------------------------------------------------------------------------ */
  /* Loading videos                                                             */
  /* ------------------------------------------------------------------------ */

  loadVideoById(videoId: string, startSeconds: number): void {
    if (this.destroyed) return;

    const generation = ++this.loadGeneration;

    const start = Number.isFinite(startSeconds)
      ? Math.max(0, startSeconds)
      : 0;

    dbg("loadVideoById()", {
      videoId,
      startSeconds: start,
      generation,
      ready: this.readyFired,
    });

    /**
     * Update the visible position immediately.
     */
    this.time = start;

    /**
     * A new load supersedes any previous autoplay attempt.
     */
    this.pendingPlay = false;
    this.stopAutoPlay();

    /**
     * Audio should always come back on when the playlist moves to the
     * next clip, unless the user explicitly muted. A previous clip's
     * stale mute must never silence the new video.
     */
    if (!this.userMuted) {
      this.p.setMuted?.(false).catch(() => {});
    }

    if (!this.p.loadVideo) {
      dbgError(
        "Vimeo SDK player does not expose loadVideo(); cannot swap videos",
        {
          videoId,
          startSeconds: start,
        }
      );

      return;
    }

    const { id, hash } = parseVimeoSpec(videoId);

    const numericId = Number(id);

    if (!Number.isFinite(numericId) || numericId <= 0) {
      dbgError("Invalid Vimeo video ID", {
        videoId,
        parsedId: id,
        hash,
      });

      return;
    }

    dbg("parsed Vimeo spec", {
      videoId,
      id: numericId,
      hash,
    });

    /**
     * Same-video fast path.
     *
     * The first Vimeo clip is loaded implicitly by the seeded ?api=1 iframe
     * (the player is created over it), so reloading it here would trigger a
     * SECOND /config + CDN bootstrap before the first frame — the visible
     * "this clip is slower than the others" stall. Consecutive clips of the
     * same video hit the same waste. When the target video is already the
     * loaded one, just seek to the clip window and let playback proceed.
     */
    if (this.loadedSpec === videoId && !this.loading) {
      dbg("loadVideoById(): video already loaded, seeking instead of reloading", {
        videoId,
        startSeconds: start,
      });

      if (start > 0) {
        this.p
          .setCurrentTime(start)
          .then(() => {
            dbg("same-video seek resolved", start);
          })
          .catch((error: unknown) => {
            dbgWarn("same-video seek rejected", {
              start,
              error,
            });
          });
      }

      /**
       * Playback queued (e.g. playVideo() raced the seek) is delivered now
       * the target video is confirmed loaded — but never before the SDK is
       * actually ready, which is the job of fireReady().
       */
      if (this.pendingPlay && this.readyFired) {
        this.pendingPlay = false;
        this.beginPlay();
      }

      return;
    }

    this.loading = true;

    const spec: { id: number; h?: string } = {
      id: numericId,
    };

    if (hash) {
      spec.h = hash;
    }

    this.p
      .loadVideo(spec)
      .then(() => {
        /**
         * Ignore completion from an old video load if a newer
         * loadVideoById() has already started.
         */
        if (this.destroyed) return;

        if (generation !== this.loadGeneration) {
          dbg("ignoring stale Vimeo load resolution", {
            generation,
            currentGeneration: this.loadGeneration,
          });

          return;
        }

        dbg("Vimeo loadVideo() resolved", {
          videoId,
          startSeconds: start,
          generation,
        });

        this.loading = false;

        /**
         * This video is now the one physically loaded in the player, so a
         * later loadVideoById() for the SAME spec can skip the reload.
         */
        this.loadedSpec = videoId;

        /**
         * Keep the synchronous cache aligned with the requested
         * clip start while Vimeo settles.
         */
        this.time = start;

        /**
         * Do NOT await this seek.
         *
         * Vimeo can leave setCurrentTime() pending immediately after
         * loadVideo(). Awaiting it can prevent queued playback from
         * ever starting.
         */
        if (start > 0) {
          this.p
            .setCurrentTime(start)
            .then(() => {
              if (this.destroyed) return;

              dbg("post-load Vimeo seek resolved", start);
            })
            .catch((error) => {
              dbgWarn("post-load Vimeo seek rejected", {
                start,
                error,
              });
            });
        }

        /**
         * If the playlist requested playback while the video was
         * loading, start the autoplay watchdog now.
         */
        if (this.pendingPlay) {
          this.pendingPlay = false;

          dbg("starting queued playback after Vimeo load");

          this.beginPlay();
        }
      })
      .catch((error) => {
        if (this.destroyed) return;

        if (generation !== this.loadGeneration) {
          dbg("ignoring stale Vimeo load rejection", {
            generation,
            currentGeneration: this.loadGeneration,
          });

          return;
        }

        this.loading = false;
        this.pendingPlay = false;

        dbgError("Vimeo loadVideo() rejected", {
          videoId,
          startSeconds: start,
          generation,
          error,
        });

        this.stopAutoPlay();
      });
  }

  cueVideoById(videoId: string, startSeconds: number): void {
    if (this.destroyed) return;

    /**
     * Vimeo's SDK doesn't expose the same cue-only behaviour as
     * YouTube.
     *
     * Loading without play is therefore the closest equivalent.
     */
    dbg("cueVideoById()", {
      videoId,
      startSeconds,
    });

    this.loadVideoById(videoId, startSeconds);
  }

  /* ------------------------------------------------------------------------ */
  /* Vimeo-specific controls                                                   */
  /* ------------------------------------------------------------------------ */

  setPlaybackRate(rate: number): void {
    if (this.destroyed) return;

    if (!this.p.setPlaybackRate) {
      dbgWarn("Vimeo setPlaybackRate() unavailable");
      return;
    }

    if (!Number.isFinite(rate) || rate <= 0) {
      dbgWarn("Invalid playback rate", rate);
      return;
    }

    this.p
      .setPlaybackRate(rate)
      .then(() => {
        dbg("Vimeo playback rate set", rate);
      })
      .catch((error) => {
        dbgWarn("Vimeo setPlaybackRate() rejected", {
          rate,
          error,
        });
      });
  }

  /**
   * Explicit user mute.
   *
   * Marking userMuted=true prevents the autoplay watchdog from
   * automatically unmuting later.
   */
  mute(): void {
    if (this.destroyed) return;

    this.userMuted = true;

    dbg("user mute");

    if (!this.p.setMuted) {
      dbgWarn("Vimeo setMuted() unavailable");
      return;
    }

    this.p
      .setMuted(true)
      .then(() => {
        dbg("Vimeo muted");
      })
      .catch((error) => {
        dbgWarn("Vimeo mute rejected", error);
      });
  }

  /**
   * Explicit user unmute.
   *
   * Once the user unmutes, the adapter is again allowed to use
   * its muted-autoplay strategy if required.
   */
  unMute(): void {
    if (this.destroyed) return;

    this.userMuted = false;

    dbg("user unmute");

    if (!this.p.setMuted) {
      dbgWarn("Vimeo setMuted() unavailable");
      return;
    }

    this.p
      .setMuted(false)
      .then(() => {
        dbg("Vimeo unmuted");
      })
      .catch((error) => {
        dbgWarn("Vimeo unmute rejected", error);
      });
  }

  /* ------------------------------------------------------------------------ */
  /* Destruction                                                               */
  /* ------------------------------------------------------------------------ */

  destroy(): void {
    if (this.destroyed) return;

    dbg("destroy()");

    this.destroyed = true;

    /**
     * Stop every automatic operation first.
     */
    this.stopAutoPlay();

    this.clearReadyTimer();

    this.pendingPlay = false;
    this.loading = false;

    /**
     * Release callbacks so no future consumer can accidentally be
     * retained by the adapter.
     */
    this.readyCbs = [];
    this.playStateCb = null;

    /**
     * Invalidate every outstanding loadVideo() operation.
     */
    this.loadGeneration += 1;

    try {
      const result = this.p.destroy?.();

      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((error) => {
          dbgWarn("Vimeo destroy() rejected", error);
        });
      }
    } catch (error) {
      dbgWarn("Vimeo destroy() threw", error);
    }

    dbg("destroy complete");
  }
}
