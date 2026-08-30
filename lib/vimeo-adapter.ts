/**
 * Adapts the Vimeo Player SDK (promise-based) to the synchronous
 * YouTube-IFrame-style interface used by the video page.
 * Time/duration/state are cached from SDK events so reads stay synchronous.
 */
export interface MinimalVimeoPlayer {
  on(event: string, cb: (data?: unknown) => void): void;
  ready(): Promise<unknown>;
  getCurrentTime(): Promise<number>;
  getDuration(): Promise<number>;
  setCurrentTime(seconds: number): Promise<unknown>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Swap another video into the same embed (SDK supports this). */
  loadVideo?(id: number): Promise<unknown>;
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
  // Vimeo can fire play then immediately pause while a loadVideo+seek
  // settles (the SDK or a slow buffer interrupts the initial play). When we
  // have asked to play (autoResume > 0) and Vimeo auto-pauses, re-issue play
  // a bounded number of times so the clip reliably starts. Any manual pause
  // (pauseVideo) clears the budget so we never fight the user.
  private autoResume = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  private clearResumeTimer() {
    if (this.resumeTimer) { clearTimeout(this.resumeTimer); this.resumeTimer = null; }
  }

  private armAutoResume() {
    this.autoResume = 3;
  }

  constructor(player: MinimalVimeoPlayer) {
    this.p = player;
    player.on("timeupdate", (data) => {
      const d = data as { seconds?: number; duration?: number } | undefined;
      if (typeof d?.seconds === "number") this.time = d.seconds;
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
      // If we intend to be playing but Vimeo auto-paused (the settle race),
      // retry play after a short delay instead of sitting stuck paused.
      if (this.autoResume > 0) this.scheduleResume();
    });
    player.on("ended", () => {
      this.state = 0;
      this.playStateCb?.(false);
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
      return;
    }
    this.armAutoResume();
    this.p.play().catch(() => {});
  }

  pauseVideo(): void {
    this.clearResumeTimer();
    this.autoResume = 0;
    this.p.pause().catch(() => {});
  }

  private scheduleResume() {
    if (this.resumeTimer || this.autoResume <= 0) return;
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (this.destroyed || this.autoResume <= 0) return;
      // Only resume if the player is actually paused and we haven't been told
      // to stop — re-predict play so the settle race never leaves us stuck.
      if (this.state === 2) {
        this.autoResume -= 1;
        this.p.play().catch(() => {});
      }
    }, 350);
  }

  getPlayerState(): number {
    return this.state;
  }

  loadVideoById(videoId: string, startSeconds: number): void {
    this.time = startSeconds;
    this.pendingPlay = false;
    if (!this.p.loadVideo) return;
    this.loading = true;
    this.p
      .loadVideo(Number(videoId))
      .then(async () => {
        if (this.destroyed) return;
        if (startSeconds > 0) await this.p.setCurrentTime(startSeconds).catch(() => {});
        this.loading = false;
        this.time = startSeconds;
        if (this.pendingPlay) {
          this.pendingPlay = false;
          this.armAutoResume();
          await this.p.play().catch(() => {});
        }
      })
      .catch(() => { this.loading = false; });
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
    try { this.p.destroy?.(); } catch {}
  }
}
