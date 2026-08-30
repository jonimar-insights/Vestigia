/**
 * Adapts the Vimeo Player SDK (promise-based) to the synchronous
 * YouTube-IFrame-style interface used by the video page.
 * Time/duration/state are cached from SDK events so reads stay synchronous.
 */
import { parseVimeoSpec } from "@/lib/social";

export interface MinimalVimeoPlayer {
  on(event: string, cb: (data?: unknown) => void): void;
  ready(): Promise<unknown>;
  getCurrentTime(): Promise<number>;
  getDuration(): Promise<number>;
  setCurrentTime(seconds: number): Promise<unknown>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Swap another video into the same embed (SDK supports id or {id,h}). */
  loadVideo?(spec: { id: number; h?: string }): Promise<unknown>;
  setPlaybackRate?(rate: number): Promise<unknown>;
  setMuted?(muted: boolean): Promise<unknown>;
  destroy?(): Promise<void> | void;
}

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

// YT player state codes used by the app: 1 = playing
export class VimeoAdapter implements SyncPlayerInterface {
  private p: MinimalVimeoPlayer;
  private time = 0;
  private durationSec = 0;
  private state = 2; // paused
  private playStateCb: ((playing: boolean) => void) | null = null;
  private readyCbs: Array<() => void> = [];
  private readyFired = false;
  private destroyed = false;
  private loading = false;
  private pendingPlay = false;
  // Vimeo auto-play is unreliable: calling play() before the first frame
  // buffers can make Vimeo report state=1 (playing) while currentTime never
  // advances — a silent stall. Rather than trust state, we drive auto-play
  // with a PROGRESS watchdog: while we intend to play (intendPlay) and the
  // cached time hasn't advanced past playTarget (where playback began), keep
  // re-issuing play() until currentTime actually moves (real playback), the
  // clip ends, or the watchdog window elapses. Any manual pause (pauseVideo)
  // clears intendPlay so we never fight the user.
  private intendPlay = false;
  private playTarget = -1;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private watchdogBudget = 0;

  private clearResumeTimer() {
    if (this.resumeTimer) { clearTimeout(this.resumeTimer); this.resumeTimer = null; }
  }

  private clearWatchdog() {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
  }

  private stopAutoPlay() {
    this.intendPlay = false;
    this.clearResumeTimer();
    this.clearWatchdog();
  }

  private progressed() {
    return this.time > this.playTarget;
  }

  /** Start (or continue) auto-play with progress verification. */
  private beginPlay() {
    this.intendPlay = true;
    this.playTarget = this.time;
    this.clearResumeTimer();
    this.watchdogBudget = 16; // ~8s @500ms
    this.issuePlay();
    this.clearWatchdog();
    this.watchdog = setInterval(() => {
      if (this.destroyed || !this.intendPlay) { this.stopAutoPlay(); return; }
      if (this.state === 0) { this.stopAutoPlay(); return; }
      if (this.progressed()) { this.stopAutoPlay(); return; }
      if (--this.watchdogBudget <= 0) { this.stopAutoPlay(); return; }
      this.issuePlay();
    }, 500);
  }

  private issuePlay() {
    this.p.play().catch(() => {});
  }

  constructor(player: MinimalVimeoPlayer) {
    this.p = player;
    player.on("timeupdate", (data) => {
      const d = data as { seconds?: number; duration?: number } | undefined;
      if (typeof d?.seconds === "number") {
        this.time = d.seconds;
        if (this.intendPlay && this.progressed()) this.stopAutoPlay();
      }
      if (typeof d?.duration === "number") this.durationSec = d.duration;
    });
    player.on("seeked", (data) => {
      const d = data as { seconds?: number; duration?: number } | undefined;
      if (typeof d?.seconds === "number") this.time = d.seconds;
    });
    player.on("durationchange", (data) => {
      const d = data as { duration?: number } | undefined;
      if (typeof d?.duration === "number") this.durationSec = d.duration;
    });
    player.on("play", () => {
      this.state = 1;
      this.playStateCb?.(true);
    });
    player.on("pause", () => {
      this.state = 2;
      this.playStateCb?.(false);
      // If we intend to play but Vimeo auto-paused (the settle race or a
      // buffer stall), re-issue play shortly instead of sitting stuck paused.
      // The watchdog continues to verify actual progress.
      if (this.intendPlay && this.watchdogBudget > 0) {
        this.clearResumeTimer();
        this.resumeTimer = setTimeout(() => {
          this.resumeTimer = null;
          if (this.destroyed || !this.intendPlay) return;
          if (this.state === 2 && !this.progressed()) this.issuePlay();
        }, 350);
      }
    });
    player.on("ended", () => {
      this.state = 0;
      this.playStateCb?.(false);
      this.stopAutoPlay();
    });
    player.ready().then(() => {
      if (this.destroyed) return;
      const finish = () => {
        if (this.destroyed || this.readyFired) return;
        this.readyFired = true;
        for (const cb of this.readyCbs) cb();
        this.readyCbs = [];
      };
      player.getDuration()
        .then((d) => { this.durationSec = d; finish(); })
        .catch(finish);
    }).catch(() => {});
  }

  /** Invoke cb once the SDK reports ready (immediately if already ready). */
  onReady(cb: () => void) {
    if (this.readyFired) cb();
    else this.readyCbs.push(cb);
  }

  onPlayState(cb: (playing: boolean) => void) {
    this.playStateCb = cb;
  }

  /** Pull the current time from the SDK into the synchronous cache. */
  refreshTime() {
    this.p.getCurrentTime().then((t) => { this.time = t; }).catch(() => {});
  }

  getCurrentTime(): number {
    return this.time;
  }

  getDuration(): number {
    return this.durationSec;
  }

  seekTo(seconds: number, _allowSeekAhead: boolean): void {
    this.time = seconds;
    this.p.setCurrentTime(seconds).catch(() => {});
  }

  playVideo(): void {
    // While a loadVideo swap is in flight the SDK swallows play() — queue it
    // so playback starts right after the load+seek settle.
    if (this.loading) {
      this.pendingPlay = true;
      this.intendPlay = true;
      return;
    }
    this.beginPlay();
  }

  pauseVideo(): void {
    this.stopAutoPlay();
    this.p.pause().catch(() => {});
  }

  getPlayerState(): number {
    return this.state;
  }

  loadVideoById(videoId: string, startSeconds: number): void {
    this.time = startSeconds;
    this.pendingPlay = false;
    this.stopAutoPlay();
    if (!this.p.loadVideo) return;
    this.loading = true;
    const { id, hash } = parseVimeoSpec(videoId);
    this.p
      .loadVideo({ id: Number(id), h: hash })
      .then(async () => {
        if (this.destroyed) return;
        if (startSeconds > 0) await this.p.setCurrentTime(startSeconds).catch(() => {});
        this.loading = false;
        this.time = startSeconds;
        if (this.pendingPlay) {
          this.pendingPlay = false;
          this.beginPlay();
        }
      })
      .catch(() => { this.loading = false; this.stopAutoPlay(); });
  }

  cueVideoById(videoId: string, startSeconds: number): void {
    // SDK has no cue-only mode; loading without play() is close enough —
    // callers that want playback invoke playVideo() right after.
    this.loadVideoById(videoId, startSeconds);
  }

  setPlaybackRate(rate: number): void {
    this.p.setPlaybackRate?.(rate)?.catch(() => {});
  }

  mute(): void {
    this.p.setMuted?.(true)?.catch(() => {});
  }

  unMute(): void {
    this.p.setMuted?.(false)?.catch(() => {});
  }

  destroy(): void {
    this.destroyed = true;
    this.stopAutoPlay();
    try { this.p.destroy?.(); } catch {}
  }
}
