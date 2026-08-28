/**
 * Adapts a native HTML5 <video>/<audio> element to the synchronous
 * YouTube-IFrame-style interface used by the video pages.
 * Reads are synchronous — the element itself is the source of truth.
 */
import type { SyncPlayerInterface } from "@/lib/vimeo-adapter";

export class Html5Adapter implements SyncPlayerInterface {
  private el: HTMLMediaElement;
  private playStateCb: ((playing: boolean) => void) | null = null;
  private readyCbs: Array<() => void> = [];
  private readyFired = false;
  private destroyed = false;

  private onPlay = () => { if (!this.destroyed) this.playStateCb?.(true); };
  private onPause = () => { if (!this.destroyed) this.playStateCb?.(false); };
  private onEnded = () => { if (!this.destroyed) this.playStateCb?.(false); };
  private onLoadedMetadata = () => { this.finishReady(); };

  constructor(el: HTMLMediaElement) {
    this.el = el;
    el.addEventListener("play", this.onPlay);
    el.addEventListener("pause", this.onPause);
    el.addEventListener("ended", this.onEnded);
    el.addEventListener("loadedmetadata", this.onLoadedMetadata);
    if (el.readyState >= 1) this.finishReady();
  }

  private finishReady() {
    if (this.destroyed || this.readyFired) return;
    this.readyFired = true;
    for (const cb of this.readyCbs) cb();
    this.readyCbs = [];
  }

  /** Invoke cb once metadata is known (immediately if already ready). */
  onReady(cb: () => void) {
    if (this.readyFired) cb();
    else this.readyCbs.push(cb);
  }

  onPlayState(cb: (playing: boolean) => void) {
    this.playStateCb = cb;
  }

  getCurrentTime(): number {
    return this.el.currentTime;
  }

  getDuration(): number {
    const d = this.el.duration;
    return Number.isFinite(d) ? d : 0;
  }

  seekTo(seconds: number, _allowSeekAhead: boolean): void {
    try { this.el.currentTime = seconds; } catch {}
  }

  playVideo(): void {
    this.el.play().catch(() => {});
  }

  pauseVideo(): void {
    this.el.pause();
  }

  getPlayerState(): number {
    return this.el.paused ? 2 : 1;
  }

  loadVideoById(_videoId: string, _startSeconds: number): void {
    // not applicable — one uploaded file per element
  }

  cueVideoById(_videoId: string, _startSeconds: number): void {
    // not applicable
  }

  destroy(): void {
    this.destroyed = true;
    this.el.removeEventListener("play", this.onPlay);
    this.el.removeEventListener("pause", this.onPause);
    this.el.removeEventListener("ended", this.onEnded);
    this.el.removeEventListener("loadedmetadata", this.onLoadedMetadata);
  }
}
