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
    this.p.play().catch(() => {});
  }

  pauseVideo(): void {
    this.p.pause().catch(() => {});
  }

  getPlayerState(): number {
    return this.state;
  }

  loadVideoById(_videoId: string, _startSeconds: number): void {
    // not applicable — one Vimeo video per page load
  }

  cueVideoById(_videoId: string, _startSeconds: number): void {
    // not applicable
  }

  destroy(): void {
    this.destroyed = true;
  }
}
