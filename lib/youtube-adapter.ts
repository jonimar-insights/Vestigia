/**
 * Vestigia YouTube IFrame Player adapter
 *
 * Responsibilities:
 * - Normalize the YouTube IFrame API behind the player interface used
 *   by VideoPlaylistPlayer.
 * - Provide synchronous playback/time/state access.
 * - Provide first-class YouTube 360° / spherical-video support.
 * - Expose spherical camera properties for diagnostics and future controls.
 * - Apply safe bounds to seeking and spherical camera values.
 *
 * IMPORTANT:
 * YouTube itself performs the 360° projection/rendering.
 * Vestigia must NOT convert the video to HTML5 or attempt to render
 * the equirectangular source itself.
 *
 * YouTube's IFrame API exposes:
 *   getSphericalProperties()
 *   setSphericalProperties()
 *
 * getSphericalProperties() is populated for 360° videos and returns
 * an empty object for non-360 videos or unsupported devices.
 */

export type YouTubePlayerState =
  | -1 // unstarted
  | 0  // ended
  | 1  // playing
  | 2  // paused
  | 3  // buffering
  | 5; // video cued

export interface YouTubeSphericalProperties {
  yaw?: number;
  pitch?: number;
  roll?: number;
  fov?: number;
  enableOrientationSensor?: boolean;
}

/**
 * The subset of the official YouTube IFrame API used by Vestigia.
 *
 * We deliberately keep this interface local instead of depending on
 * @types/youtube so the adapter remains stable if the application does
 * not install those typings.
 */
export interface YouTubeIFramePlayer {
  getCurrentTime(): number;
  getDuration(): number;

  seekTo(
    seconds: number,
    allowSeekAhead: boolean
  ): void;

  playVideo(): void;
  pauseVideo(): void;

  getPlayerState(): number;

  loadVideoById(
    videoId: string,
    startSeconds?: number
  ): void;

  cueVideoById(
    videoId: string,
    startSeconds?: number
  ): void;

  setPlaybackRate?(
    suggestedRate: number
  ): void;

  mute?(): void;
  unMute?(): void;

  getSphericalProperties?():
    YouTubeSphericalProperties;

  setSphericalProperties?(
    properties: YouTubeSphericalProperties
  ): void;

  getVideoUrl?(): string;

  getVideoData?(): {
    video_id?: string;
    title?: string;
    author?: string;
  };

  destroy?(): void;
}

/**
 * Interface consumed by VideoPlaylistPlayer.
 *
 * Keep this compatible with the existing player abstraction so Vimeo,
 * HTML5 and YouTube can continue to be controlled by the same playlist
 * controls.
 */
export interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;

  seekTo(
    seconds: number,
    allowSeekAhead: boolean
  ): void;

  playVideo(): void;
  pauseVideo(): void;

  getPlayerState(): number;

  loadVideoById(
    videoId: string,
    startSeconds: number
  ): void;

  cueVideoById(
    videoId: string,
    startSeconds: number
  ): void;

  setPlaybackRate?(
    rate: number
  ): void;

  mute?(): void;
  unMute?(): void;

  /**
   * True when the current YouTube video is being exposed by the
   * IFrame API as a spherical/360° video.
   */
  is360(): boolean;

  /**
   * Current viewer orientation/FOV.
   *
   * Returns null when the current video is not spherical or the
   * browser/device does not expose spherical properties.
   */
  getSphericalProperties():
    YouTubeSphericalProperties | null;

  /**
   * Change the viewer perspective for a spherical video.
   *
   * This is a no-op for ordinary rectangular videos.
   */
  setSphericalProperties(
    properties: YouTubeSphericalProperties
  ): void;

  /**
   * Toggle the device-orientation sensor for spherical videos.
   *
   * Supported mobile browsers use gyroscope data to steer the
   * viewpoint; desktop devices simply ignore it. No-op for
   * ordinary rectangular videos.
   */
  enableOrientationSensor(
    enabled: boolean
  ): void;

  /**
   * Return the underlying YouTube URL when available.
   */
  getVideoUrl(): string | null;

  /**
   * Return the current YouTube video ID when available.
   */
  getVideoId(): string | null;

  /**
   * Cleanly destroy the underlying YouTube player.
   */
  destroy(): void;
}

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function finiteOrNull(
  value: unknown
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

function normalizeSphericalProperties(
  input: YouTubeSphericalProperties
): YouTubeSphericalProperties {
  const output: YouTubeSphericalProperties = {};

  const yaw = finiteOrNull(input.yaw);
  if (yaw !== null) {
    /*
     * YouTube documents yaw as [0, 360).
     */
    output.yaw =
      ((yaw % 360) + 360) % 360;
  }

  const pitch = finiteOrNull(input.pitch);
  if (pitch !== null) {
    output.pitch =
      clamp(pitch, -90, 90);
  }

  const roll = finiteOrNull(input.roll);
  if (roll !== null) {
    output.roll =
      clamp(roll, -180, 180);
  }

  const fov = finiteOrNull(input.fov);
  if (fov !== null) {
    output.fov =
      clamp(fov, 30, 120);
  }

  if (
    typeof input.enableOrientationSensor ===
    "boolean"
  ) {
    output.enableOrientationSensor =
      input.enableOrientationSensor;
  }

  return output;
}

function isNonEmptyObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

/**
 * Normalize a YouTube video ID.
 *
 * The player API ultimately needs the 11-character ID.
 */
export function normalizeYouTubeVideoId(
  value: string
): string | null {
  const input = value.trim();

  if (
    /^[A-Za-z0-9_-]{11}$/.test(input)
  ) {
    return input;
  }

  try {
    const url = new URL(input);
    const host =
      url.hostname.toLowerCase();

    if (host === "youtu.be") {
      const id = url.pathname
        .split("/")
        .filter(Boolean)[0];

      return id &&
        /^[A-Za-z0-9_-]{11}$/.test(id)
        ? id
        : null;
    }

    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com"
    ) {
      const queryId =
        url.searchParams.get("v");

      if (
        queryId &&
        /^[A-Za-z0-9_-]{11}$/.test(queryId)
      ) {
        return queryId;
      }

      const parts = url.pathname
        .split("/")
        .filter(Boolean);

      if (
        parts.length >= 2 &&
        (
          parts[0] === "embed" ||
          parts[0] === "v" ||
          parts[0] === "shorts" ||
          parts[0] === "live"
        )
      ) {
        const id = parts[1];

        return /^[A-Za-z0-9_-]{11}$/.test(id)
          ? id
          : null;
      }
    }
  } catch {
    // Invalid URL — return null below.
  }

  return null;
}

export class YouTubeAdapter
  implements YTPlayer {

  private readonly player: YouTubeIFramePlayer;

  private destroyed = false;

  private lastKnownVideoId: string | null = null;

  constructor(
    player: YouTubeIFramePlayer
  ) {
    this.player = player;

    this.lastKnownVideoId =
      this.readVideoId();
  }

  private ensureAlive(): boolean {
    return !this.destroyed;
  }

  private readVideoId(): string | null {
    try {
      const data =
        this.player.getVideoData?.();

      const id =
        typeof data?.video_id === "string"
          ? data.video_id
          : null;

      if (
        id &&
        /^[A-Za-z0-9_-]{11}$/.test(id)
      ) {
        return id;
      }
    } catch {
      // YouTube can throw while transitioning.
    }

    return this.lastKnownVideoId;
  }

  getCurrentTime(): number {
    if (!this.ensureAlive()) {
      return 0;
    }

    try {
      const value =
        this.player.getCurrentTime();

      return Number.isFinite(value)
        ? Math.max(0, value)
        : 0;
    } catch {
      return 0;
    }
  }

  getDuration(): number {
    if (!this.ensureAlive()) {
      return 0;
    }

    try {
      const value =
        this.player.getDuration();

      return Number.isFinite(value)
        ? Math.max(0, value)
        : 0;
    } catch {
      return 0;
    }
  }

  seekTo(
    seconds: number,
    allowSeekAhead: boolean
  ): void {
    if (!this.ensureAlive()) {
      return;
    }

    if (!Number.isFinite(seconds)) {
      return;
    }

    try {
      this.player.seekTo(
        Math.max(0, seconds),
        allowSeekAhead
      );
    } catch {
      // Ignore transient YouTube state errors.
    }
  }

  playVideo(): void {
    if (!this.ensureAlive()) {
      return;
    }

    try {
      this.player.playVideo();
    } catch {
      // Ignore transient YouTube state errors.
    }
  }

  pauseVideo(): void {
    if (!this.ensureAlive()) {
      return;
    }

    try {
      this.player.pauseVideo();
    } catch {
      // Ignore transient YouTube state errors.
    }
  }

  getPlayerState(): number {
    if (!this.ensureAlive()) {
      return -1;
    }

    try {
      return this.player.getPlayerState();
    } catch {
      return -1;
    }
  }

  loadVideoById(
    videoId: string,
    startSeconds = 0
  ): void {
    if (!this.ensureAlive()) {
      return;
    }

    const id =
      normalizeYouTubeVideoId(videoId);

    if (!id) {
      console.warn(
        "[YouTubeAdapter] Invalid video ID:",
        videoId
      );
      return;
    }

    const start =
      Number.isFinite(startSeconds)
        ? Math.max(0, startSeconds)
        : 0;

    this.lastKnownVideoId = id;

    try {
      /*
       * Keep the argument form here.
       *
       * Vestigia manages clip endTimestamp itself. Using YouTube's
       * endSeconds here would cause an ENDED event at every clip boundary
       * and would interfere with the playlist's own clip-window logic.
       */
      this.player.loadVideoById(
        id,
        start
      );
    } catch {
      // Ignore transient transition errors.
    }
  }

  cueVideoById(
    videoId: string,
    startSeconds = 0
  ): void {
    if (!this.ensureAlive()) {
      return;
    }

    const id =
      normalizeYouTubeVideoId(videoId);

    if (!id) {
      console.warn(
        "[YouTubeAdapter] Invalid video ID:",
        videoId
      );
      return;
    }

    const start =
      Number.isFinite(startSeconds)
        ? Math.max(0, startSeconds)
        : 0;

    this.lastKnownVideoId = id;

    try {
      this.player.cueVideoById(
        id,
        start
      );
    } catch {
      // Ignore transient transition errors.
    }
  }

  setPlaybackRate(
    rate: number
  ): void {
    if (!this.ensureAlive()) {
      return;
    }

    if (
      !Number.isFinite(rate) ||
      rate <= 0
    ) {
      return;
    }

    try {
      this.player.setPlaybackRate?.(
        rate
      );
    } catch {
      // YouTube may reject unsupported rates.
    }
  }

  mute(): void {
    if (!this.ensureAlive()) {
      return;
    }

    try {
      this.player.mute?.();
    } catch {
      // Ignore.
    }
  }

  unMute(): void {
    if (!this.ensureAlive()) {
      return;
    }

    try {
      this.player.unMute?.();
    } catch {
      // Ignore.
    }
  }

  /**
   * Returns the current spherical camera state.
   *
   * YouTube returns {} for:
   * - ordinary rectangular videos
   * - unsupported devices
   *
   * Therefore null is the clean Vestigia representation of
   * "not currently available as spherical".
   */
  getSphericalProperties():
    YouTubeSphericalProperties | null {
    if (!this.ensureAlive()) {
      return null;
    }

    try {
      const raw =
        this.player
          .getSphericalProperties?.();

      if (!isNonEmptyObject(raw)) {
        return null;
      }

      const normalized =
        normalizeSphericalProperties(
          raw as YouTubeSphericalProperties
        );

      return Object.keys(normalized).length > 0
        ? normalized
        : null;
    } catch {
      return null;
    }
  }

  /**
   * True when YouTube currently exposes spherical properties.
   */
  is360(): boolean {
    return (
      this.getSphericalProperties() !==
      null
    );
  }

  /**
   * Set viewer perspective.
   *
   * This does NOT convert a rectangular video into 360°.
   * YouTube simply ignores this for non-spherical videos.
   */
  setSphericalProperties(
    properties: YouTubeSphericalProperties
  ): void {
    if (!this.ensureAlive()) {
      return;
    }

    if (!this.player.setSphericalProperties) {
      return;
    }

    const normalized =
      normalizeSphericalProperties(
        properties
      );

    if (
      Object.keys(normalized).length === 0
    ) {
      return;
    }

    try {
      this.player.setSphericalProperties(
        normalized
      );
    } catch {
      // Ignore unsupported-device errors.
    }
  }

  /**
   * Toggle the device-orientation sensor.
   *
   * Delegates to setSphericalProperties, which the raw player
   * accepts for spherical videos on capable devices.
   */
  enableOrientationSensor(
    enabled: boolean
  ): void {
    this.setSphericalProperties({
      enableOrientationSensor: enabled,
    });
  }

  getVideoUrl(): string | null {
    if (!this.ensureAlive()) {
      return null;
    }

    try {
      const url =
        this.player.getVideoUrl?.();

      return typeof url === "string" &&
        url.length > 0
        ? url
        : null;
    } catch {
      return null;
    }
  }

  getVideoId(): string | null {
    if (!this.ensureAlive()) {
      return this.lastKnownVideoId;
    }

    const id =
      this.readVideoId();

    if (id) {
      this.lastKnownVideoId = id;
    }

    return this.lastKnownVideoId;
  }

  /**
   * Return the underlying raw YouTube player.
   *
   * Kept intentionally private from the normal playlist API, but useful
   * for future advanced YouTube-specific functionality.
   */
  getRawPlayer():
    YouTubeIFramePlayer | null {
    return this.ensureAlive()
      ? this.player
      : null;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    try {
      this.player.destroy?.();
    } catch {
      // Ignore destruction errors.
    }
  }
}
