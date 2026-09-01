"use client";

import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import { sanitizeHtml, tokenizeNoteLinks } from "@/lib/youtube";
import { isTrustedImageUrl } from "@/lib/image-host";
import { VimeoAdapter } from "@/lib/vimeo-adapter";
import { vimeoEmbedUrl } from "@/lib/social";
import { Html5Adapter } from "@/lib/html5-adapter";
import {
  YouTubeAdapter,
  type YTPlayer,
  type YouTubeIFramePlayer,
  type YouTubeSphericalProperties,
} from "@/lib/youtube-adapter";

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId?: string;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: (event: {
              target: YouTubeIFramePlayer;
            }) => void;

            onStateChange?: (event: {
              target: YouTubeIFramePlayer;
              data: number;
            }) => void;

            onError?: (event: {
              target: YouTubeIFramePlayer;
              data: number;
            }) => void;
          };
        }
      ) => YouTubeIFramePlayer;
    };

    Vimeo?: {
      Player: new (
        element: HTMLElement,
        options?: Record<string, unknown>
      ) => unknown;
    };

    __VIMEO_DEBUG?: boolean;
  }
}

// Same rich-note rendering as the video page: highlighted hyperlinks,
// $math$, **bold**, *italic*, `code`, newlines.
function renderNoteHtml(text: string): string {
  const anchors: string[] = [];
  let s = "";
  for (const tok of tokenizeNoteLinks(text)) {
    if (tok.kind === "link") {
      anchors.push(
        `<a href="${sanitizeHtml(tok.href)}" target="_blank" rel="noopener noreferrer nofollow" class="text-accent hover:text-accent-hover underline decoration-accent/40 break-all">${sanitizeHtml(tok.display)}</a>`
      );
      s += `\u0000${anchors.length - 1}\u0000`;
    } else {
      s += tok.value;
    }
  }
  s = s
    .replace(/\$(.+?)\$/g, '<span class="text-accent font-mono">$1</span>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="bg-white/10 rounded px-1 font-mono text-[11px]">$1</code>')
    .replace(/\n/g, "<br>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => anchors[Number(i)] ?? "");
}

const SPEEDS = [1, 1.25, 1.5] as const;

function fmtRemaining(sec: number) {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.ceil((sec % 3600) / 60)} min left`;
  if (sec >= 60) return `${Math.ceil(sec / 60)} min left`;
  return `${Math.max(0, Math.floor(sec))} sec left`;
}

export interface ClipItem {
  id: number;
  cliplistId: number;
  type: string;
  videoId: number;
  timestamp: number;
  endTimestamp: number | null;
  title: string;
  detail: string | null;
  tags: string[];
  color?: string | null;
  imageUrl?: string | null;
  position: number;
  createdAt: string;
  videoTitle: string | null;
  videoThumbnail: string | null;
  _youtubeId?: string;
  _vimeoId?: string;
  _html5Src?: string;
}

export function formatTs(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function VideoPlaylistPlayer({ items, onClose, preclassified }: { items: ClipItem[]; onClose: () => void; preclassified?: boolean }) {
  // Nominal seconds a Drive stream may take to hand over metadata — used for
  // the loading countdown (the true wait is unknowable in advance).
  const LOAD_NOMINAL_MS = 8000;
  const [currentIdx, setCurrentIdx] = useState(0);
  const [ended, setEnded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<YTPlayer | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [youtubeIs360, setYoutubeIs360] = useState(false);
  // 360° camera interaction state (see the 360 layer below).
  // Device orientation only steers the view on gyro-capable devices; the
  // official API ignores enableOrientationSensor where there's no sensor.
  const [gyroCapable] = useState(() =>
    typeof window !== "undefined" &&
    "DeviceOrientationEvent" in window &&
    (navigator.maxTouchPoints > 0 || /(Android|iPhone|iPad|iPod)/i.test(navigator.userAgent))
  );
  // The embed starts with the sensor ON on supported devices (API default
  // true), so the UI reflects: capable -> on, otherwise no button at all.
  const [orientationSensor, setOrientationSensor] = useState(gyroCapable);
  // Mirror of orientationSensor that stays stable during a drag, since the
  // layer handlers run against the closure value of the render they were
  // created in (a drag is many moves before any re-render).
  const orientationSensorRef = useRef(gyroCapable);
  // Last applied/known spherical values so a drag is relative to the current
  // viewpoint instead of resetting to yaw=0/pitch=0 on every gesture.
  const lastSphericalRef = useRef<YouTubeSphericalProperties>({});
  const drag360Ref = useRef<{ pointerId: number; lastX: number; lastY: number; baseYaw: number; basePitch: number } | null>(null);
  const sphericalLayerRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadStartRef = useRef(0);

  const item = items[currentIdx];

  function seedMaps() {
    const yt = new Map<number, string>();
    const vim = new Map<number, string>();
    const h5 = new Map<number, string>();
    if (preclassified) {
      for (const it of items) {
        if (it.videoId <= 0) continue;
        if (it._youtubeId) yt.set(it.videoId, it._youtubeId);
        if (it._vimeoId) vim.set(it.videoId, it._vimeoId);
        if (it._html5Src) h5.set(it.videoId, it._html5Src);
      }
    }
    return { yt, vim, h5 };
  }

  const [videoIds, setVideoIds] = useState<Map<number, string>>(() => seedMaps().yt);
  const [vimeoIds, setVimeoIds] = useState<Map<number, string>>(() => seedMaps().vim);
  const videoIdsRef = useRef<Map<number, string>>(videoIds);
  useEffect(() => { videoIdsRef.current = videoIds; });
  const vimeoIdsRef = useRef<Map<number, string>>(vimeoIds);
  useEffect(() => { vimeoIdsRef.current = vimeoIds; });
  useEffect(() => {
    if (window.__VIMEO_DEBUG)
      console.log(
        "[playlist] vimeoIds changed → " +
          JSON.stringify([...vimeoIds].map(([k, v]) => `${typeof k}:${String(k)}=${v}`))
      );
  }, [vimeoIds]);
  const vimeoPlayerRef = useRef<VimeoAdapter | null>(null);
  const vimeoContainerRef = useRef<HTMLIFrameElement>(null);
  const [vimeoReady, setVimeoReady] = useState(false);
  const [vimeoInitError, setVimeoInitError] = useState<string | null>(null);
  const [html5SrcsState, setHtml5Srcs] = useState<Map<number, string>>(() => seedMaps().h5);
  const html5SrcsRef = useRef<Map<number, string>>(html5SrcsState);
  useEffect(() => { html5SrcsRef.current = html5SrcsState; });
  // Marks drive/upload videos that loaded a REAL video track (videoWidth>0).
  // Until confirmed, an html5 clip is assumed cover-image (audio-style) —
  // drive files are often probe-mistyped audio (mediaType "video").
  const [html5IsVideo, setHtml5IsVideo] = useState<Map<number, boolean>>(new Map());
  const html5PlayerRef = useRef<Html5Adapter | null>(null);
  const html5ElRef = useRef<HTMLVideoElement | null>(null);
  const [html5Ready, setHtml5Ready] = useState(false);
  const [html5Setup, setHtml5Setup] = useState(false);
  // True while an html5 (drive/upload) clip is waiting on its stream — Drive
  // headers can take seconds — drives the "Loading audio/video…" indicator.
  const [html5Loading, setHtml5Loading] = useState(false);
  // Ticks ~4x/sec while a drive stream buffers; elapsed loading seconds are
  // derived from loadStartRef so the countdown progresses without a reset race.
  const [loadNow, setLoadNow] = useState(0);
  const fetchedIdsRef = useRef<Set<number>>(new Set());
  const lastVideoIdRef = useRef<string | null>(null);
  const advancedRef = useRef(false);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Enhancement state ──
  const [speedIdx, setSpeedIdx] = useState(0);
  const speedRef = useRef(1);
  useEffect(() => { speedRef.current = SPEEDS[speedIdx]; }, [speedIdx]);
  const [muted, setMuted] = useState(false);
  const [loopOne, setLoopOne] = useState(false);
  const loopOneRef = useRef(false);
  useEffect(() => { loopOneRef.current = loopOne; }, [loopOne]);
  const currentIdxRef = useRef(0);
  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);
  const [filter, setFilter] = useState<string | null>(null);
  const [slideRemainingSec, setSlideRemainingSec] = useState<number | null>(null);
  const slideDeadlineRef = useRef<{ start: number; ms: number } | null>(null);
  const seekingRef = useRef(false);
  const sidebarRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const stripRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const stripScrollRef = useRef<HTMLDivElement>(null);

  // Latest-items mirror for effects that intentionally narrow their deps to
  // specific triggers (index/ready/map changes) but still need fresh values
  // when they run. Declared first so it updates before the effects below.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  useEffect(() => {
    const preclassifiedIds = new Set<number>();
    if (preclassified) {
      for (const it of items) {
        if (it.videoId > 0 && (it._youtubeId || it._vimeoId || it._html5Src)) {
          preclassifiedIds.add(it.videoId);
        }
      }
    }
    const uniqueIds = [...new Set(items.filter(i => i.videoId > 0).map((i) => i.videoId))];
    const missingIds = uniqueIds.filter((id) => !fetchedIdsRef.current.has(id) && !preclassifiedIds.has(id));
    if (missingIds.length === 0) return;
    missingIds.forEach((id) => fetchedIdsRef.current.add(id));
    Promise.all(
      missingIds.map(async (vid) => {
        try {
          const res = await fetch(`/api/videos/${vid}`);
          if (res.ok) {
            const data = await res.json();
            // Classify by youtubeId shape: 11-char = YouTube, "vimeo:<id>" =
            // Vimeo; drive/upload use a native HTML5 element (youtubeUrl src).
            const raw = String(data.youtubeId ?? "");
            const ytOk = /^[A-Za-z0-9_-]{11}$/.test(raw);
            const isHtml5 = data.platform === "drive" || data.platform === "upload";
            return {
              videoId: vid,
              youtubeId: ytOk ? raw : "",
              vimeoId: !ytOk && raw.startsWith("vimeo:") ? raw.slice("vimeo:".length) : "",
              html5Src: isHtml5 && typeof data.youtubeUrl === "string" ? data.youtubeUrl : "",
            };
          }
        } catch {}
        return null;
      })
    ).then((results) => {
      setVideoIds((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r) next.set(r.videoId, r.youtubeId);
        }
        return next;
      });
      setVimeoIds((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r) next.set(r.videoId, r.vimeoId);
        }
        return next;
      });
      setHtml5Srcs((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r && r.html5Src) next.set(r.videoId, r.html5Src);
        }
        return next;
      });
    });
  }, [items, preclassified]);

  useEffect(() => {
    const cur = itemsRef.current[currentIdx];
    if (cur?.type === "slide") {
      clearTimeInterval();
      // Hold mode: endTimestamp null = wait for manual advance (Next/arrows).
      if (cur.endTimestamp == null) {
        slideDeadlineRef.current = null;
        setSlideRemainingSec(null);
        return;
      }
      const ms = cur.endTimestamp * 1000;
      slideDeadlineRef.current = { start: Date.now(), ms };
      setSlideRemainingSec(ms / 1000);
      timeIntervalRef.current = setInterval(() => {
        const d = slideDeadlineRef.current;
        if (!d) return;
        const remain = Math.max(0, (d.ms - (Date.now() - d.start)) / 1000);
        setSlideRemainingSec(remain);
      }, 200);
      slideTimerRef.current = setTimeout(() => {
        // Advance during the slide; when it's the last item, hold it there
        // (no wrap-around to black/start) per the end-of-playlist behavior.
        const si = currentIdxRef.current;
        if (si < itemsRef.current.length - 1) {
          setCurrentIdx(si + 1);
        }
      }, ms);
      return () => { if (slideTimerRef.current) clearTimeout(slideTimerRef.current); };
    } else {
      slideDeadlineRef.current = null;
      setSlideRemainingSec(null);
    }
  }, [currentIdx, item?.type]);

  function clearTimeInterval() {
    if (timeIntervalRef.current) { clearInterval(timeIntervalRef.current); timeIntervalRef.current = null; }
  }

  // Loading-countdown clock: update `loadNow` ~4x/sec while a drive stream
  // buffers; elapsed is (loadNow - loadStartRef)/1000.
  function startLoaderTick() {
    clearLoaderTick();
    loadStartRef.current = Date.now();
    loadTickRef.current = setInterval(() => setLoadNow(Date.now()), 250);
  }
  function clearLoaderTick() {
    if (loadTickRef.current) { clearInterval(loadTickRef.current); loadTickRef.current = null; }
  }

  // The player backing the current clip (Vimeo adapter, YouTube iframe, or
  // native HTML5 for drive/upload). Returns null for slides and unplayable
  // items so controls never act on a hidden player from the previous clip.
  // YTPlayer is the lib's rich surface (360° helpers on YouTubeAdapter);
  // Vimeo/Html5 implement the same sync controls the playlist needs.
  function getActivePlayer(): YTPlayer | VimeoAdapter | Html5Adapter | null {
    const cur = itemsRef.current[currentIdxRef.current];
    if (!cur) return null;
    if (vimeoIdsRef.current.get(cur.videoId)) return vimeoPlayerRef.current;
    if (videoIdsRef.current.get(cur.videoId)) return playerRef.current;
    if (html5SrcsRef.current.get(cur.videoId)) return html5PlayerRef.current;
    return null;
  }

  // ── 360° camera layer ───────────────────────────────────────────
  // Vestigia drives the spherical camera (yaw/pitch via drag, FOV via
  // wheel). YouTube still decodes/renders the 360 stream; we only steer
  // the viewpoint through the official setSphericalProperties API.
  function syncSpherical(patch: YouTubeSphericalProperties) {
    const merged = { ...lastSphericalRef.current, ...patch };
    lastSphericalRef.current = merged;
    try {
      playerRef.current?.setSphericalProperties(merged);
      console.info("[Vestigia][YouTube]", { reason: "spherical-set", yaw: merged.yaw, pitch: merged.pitch, fov: merged.fov });
    } catch {}
  }

  function handle360PointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!youtubeIs360) return;
    e.preventDefault();
    const ap = playerRef.current;
    if (!ap) return;
    const current = ap.getSphericalProperties?.() ?? lastSphericalRef.current;
    lastSphericalRef.current = { ...lastSphericalRef.current, ...current };
    drag360Ref.current = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      baseYaw: lastSphericalRef.current.yaw ?? 0,
      basePitch: lastSphericalRef.current.pitch ?? 0,
    };
    try { (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId); } catch {}
  }

  function handle360PointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag360Ref.current;
    if (!d) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    if (dx === 0 && dy === 0) return;
    // First real move beats the orientation sensor: while the sensor is ON,
    // the API ignores explicit yaw/pitch on mobile (only the sensor steers),
    // so a drag must turn it off before taking over the viewpoint.
    if (orientationSensorRef.current) {
      orientationSensorRef.current = false;
      setOrientationSensor(false);
      syncSpherical({ enableOrientationSensor: false });
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    // Sensitivities chosen so a full drag ≈ multiple viewport rotations;
    // drag right/up = yaw+/pitch+. The adapter clamps/normalizes ranges.
    const yaw = d.baseYaw + dx * 0.35;
    const pitch = d.basePitch - dy * 0.25;
    syncSpherical({ yaw, pitch });
  }

  function handle360PointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag360Ref.current?.pointerId === e.pointerId) drag360Ref.current = null;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId); } catch {}
  }

  function toggleOrientationSensor() {
    const next = !orientationSensor;
    orientationSensorRef.current = next;
    setOrientationSensor(next);
    syncSpherical({ enableOrientationSensor: next });
  }

  // Pause both players whenever the current item can't play (slide, social,
  // self-hosted or still-fetching) — otherwise the previous clip's audio
  // keeps running underneath. setPlaying(false) directly because the hidden
  // players' state callbacks are guarded off for non-active items.
  useEffect(() => {
    const cur = itemsRef.current[currentIdx];
    if (!cur) return;
    if (videoIds.get(cur.videoId) || vimeoIds.get(cur.videoId) || html5SrcsState.get(cur.videoId)) return;
    try { playerRef.current?.pauseVideo(); } catch {}
    try { vimeoPlayerRef.current?.pauseVideo(); } catch {}
    try { html5PlayerRef.current?.pauseVideo(); } catch {}
    setPlaying(false);
  }, [currentIdx, item?.type, videoIds, vimeoIds, html5SrcsState]);

  function startTimePolling() {
    if (timeIntervalRef.current) clearInterval(timeIntervalRef.current);
    timeIntervalRef.current = setInterval(() => {
      try {
        const ap = getActivePlayer();
        if (ap && ap.getPlayerState() === 1) {
          if (ap instanceof VimeoAdapter) ap.refreshTime();
          setCurrentTime(ap.getCurrentTime());
        }
      } catch {}
    }, 250);
  }

  useEffect(() => {
    const cur = itemsRef.current[currentIdx];
    if (!playerReady || !playerRef.current || !cur || cur.type === "slide") return;
    const ytId = videoIds.get(cur.videoId);
    if (!ytId) return;

    advancedRef.current = false;
    clearTimeInterval();
    try { vimeoPlayerRef.current?.pauseVideo(); } catch {}
    try { html5PlayerRef.current?.pauseVideo(); } catch {}
    setCurrentTime(cur.timestamp);
    lastVideoIdRef.current = ytId;

    try {
      const player = playerRef.current;
      player.loadVideoById(ytId, cur.timestamp);
      if (speedRef.current !== 1) player.setPlaybackRate?.(speedRef.current);
      player.playVideo();
    } catch (error) {
      console.error("[Vestigia][YouTube] clip load failed:", {
        videoId: ytId,
        timestamp: cur.timestamp,
        error,
      });
    }
  }, [currentIdx, playerReady, item?.videoId, item?.timestamp, item?.type, videoIds]);

  // ─────────────────────────────────────────────────────────────
  // YouTube IFrame Player
  //
  // One shared YouTube player is used for all YouTube clips.
  // Vestigia swaps videoId + timestamp inside that player.
  //
  // 360° rendering is performed by YouTube itself. The adapter exposes
  // getSphericalProperties()/setSphericalProperties() so Vestigia can
  // detect and control the spherical camera when YouTube exposes it.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = playerContainerRef.current;

    if (!container || playerRef.current) {
      return;
    }

    // Create from the first YouTube item that is actually playable.
    const firstPlayable = itemsRef.current.find(
      (i) => i.videoId > 0 && videoIds.get(i.videoId)
    );

    const firstYtId = firstPlayable ? videoIds.get(firstPlayable.videoId) : undefined;

    if (!firstYtId) {
      return;
    }

    lastVideoIdRef.current = firstYtId;

    let destroyed = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    function applyIframePermissions(player: YouTubeIFramePlayer) {
      try {
        /*
         * The IFrame API replaces our mount <div> with an iframe.
         *
         * These permissions do not turn a rectangular video into 360°.
         * They allow YouTube's spherical player to use the capabilities
         * it needs when the video is actually 360°.
         */
        const el = container as HTMLDivElement | null;
        const iframe = el?.querySelector("iframe") as HTMLIFrameElement | null;

        if (!iframe) {
          return;
        }

        iframe.setAttribute(
          "allow",
          [
            "accelerometer",
            "autoplay",
            "clipboard-write",
            "encrypted-media",
            "gyroscope",
            "picture-in-picture",
            "web-share",
            "fullscreen",
          ].join("; ")
        );

        iframe.setAttribute("allowfullscreen", "");
        iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");

        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.border = "0";

        /*
         * Keep the raw player reference only long enough to apply the
         * iframe permissions. All subsequent playback operations go
         * through YouTubeAdapter.
         */
        void player;
      } catch {
        // DOM permissions are best-effort.
      }
    }

    function reportSphericalState(adapter: YouTubeAdapter, reason: string) {
      if (destroyed) {
        return;
      }

      const spherical = adapter.getSphericalProperties();
      const is360 = spherical !== null;

      setYoutubeIs360(is360);

      console.info(
        "[Vestigia][YouTube]",
        {
          reason,
          videoId: adapter.getVideoId(),
          is360,
          spherical,
        }
      );
    }

    function createPlayer() {
      if (destroyed || playerRef.current || !container || !window.YT?.Player) {
        return;
      }

      try {
        const rawPlayer = new window.YT.Player(
          container,
          {
            videoId: firstYtId,

            playerVars: {
              autoplay: 0,
              controls: 1,
              modestbranding: 1,
              rel: 0,
              enablejsapi: 1,
              playsinline: 1,

              /*
               * YouTube recommends supplying origin when using
               * enablejsapi. This also makes the embed safer.
               */
              origin: window.location.origin,
            },

            events: {
              onReady: (event) => {
                if (destroyed) {
                  return;
                }

                const adapter = new YouTubeAdapter(event.target);
                playerRef.current = adapter;

                /*
                 * The IFrame has now been inserted by YouTube.
                 */
                applyIframePermissions(event.target);
                setPlayerReady(true);

                /*
                 * This is the authoritative runtime 360° test.
                 *
                 * If this returns properties such as:
                 *   { yaw, pitch, roll, fov }
                 *
                 * YouTube is exposing the video as spherical.
                 */
                reportSphericalState(adapter, "onReady");
              },

              onStateChange: (event) => {
                if (destroyed) {
                  return;
                }

                const curItem = itemsRef.current[currentIdxRef.current];

                /*
                 * Ignore YouTube events while Vimeo or HTML5 is
                 * the active source.
                 */
                if (
                  curItem &&
                  (vimeoIdsRef.current.get(curItem.videoId) || html5SrcsRef.current.get(curItem.videoId))
                ) {
                  return;
                }

                const adapter = playerRef.current;
                const state = event.data;
                const isPlaying = state === 1;

                setPlaying(isPlaying);

                if (isPlaying) {
                  startTimePolling();
                } else {
                  clearTimeInterval();
                }

                /*
                 * A video may change from rectangular → spherical
                 * when loadVideoById swaps the active YouTube source,
                 * so inspect spherical state when playback starts.
                 */
                if (state === 1 && adapter instanceof YouTubeAdapter) {
                  reportSphericalState(adapter, "playing");
                }

                /*
                 * IMPORTANT:
                 *
                 * Normal Cliplist boundaries are handled by the
                 * currentTime/endTimestamp watchdog below.
                 *
                 * We only process YouTube's native ENDED event when
                 * the actual underlying YouTube video reaches its end.
                 */
                if (state === 0) {
                  if (loopOneRef.current) {
                    const it = itemsRef.current[currentIdxRef.current];
                    try {
                      adapter?.seekTo(it.timestamp, true);
                      adapter?.playVideo();
                    } catch {}
                  } else if (advancedRef.current) {
                    advancedRef.current = false;
                  } else {
                    advanceOrEnd();
                  }
                }
              },

              onError: (event) => {
                if (destroyed) {
                  return;
                }

                console.error(
                  "[Vestigia][YouTube] player error",
                  {
                    videoId: firstYtId,
                    code: event.data,
                  }
                );
              },
            },
          }
        );

        /*
         * The adapter is installed from onReady rather than immediately
         * because YouTube needs to finish constructing the iframe/player.
         */
        void rawPlayer;
      } catch (err) {
        console.error("[YT Player] createPlayer failed:", err);
      }
    }

    /*
     * API already available.
     */
    if (window.YT?.Player) {
      createPlayer();

      return () => {
        destroyed = true;

        if (poll) {
          clearInterval(poll);
          poll = null;
        }

        clearTimeInterval();

        try {
          playerRef.current?.destroy();
        } catch {}

        playerRef.current = null;
        setPlayerReady(false);
      };
    }

    /*
     * Load YouTube's IFrame API exactly once.
     */
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }

    /*
     * Poll until the global API has finished initializing.
     *
     * This preserves your existing behavior and avoids depending on
     * another component's onYouTubeIframeAPIReady handler.
     */
    poll = setInterval(() => {
      if (destroyed) {
        return;
      }

      if (window.YT?.Player) {
        if (poll) {
          clearInterval(poll);
          poll = null;
        }

        createPlayer();
      }
    }, 100);

    return () => {
      destroyed = true;

      if (poll) {
        clearInterval(poll);
        poll = null;
      }

      clearTimeInterval();

      try {
        playerRef.current?.destroy();
      } catch {}

      playerRef.current = null;
      setPlayerReady(false);
    };

    // Deliberately only recreate the YT player when the YouTube map
    // changes. currentIdx/timestamp are handled by the separate clip-load
    // effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoIds]);

  // Native wheel listener for the 360° layer: React's onWheel is passive,
  // so preventDefault (blocking page scroll while zooming the spherical
  // camera) needs a non-passive native listener.
  useEffect(() => {
    const el = sphericalLayerRef.current;
    if (!el || !youtubeIs360) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!youtubeIs360) return;
      const currentFov = lastSphericalRef.current.fov ?? 100;
      const fov = Math.min(120, Math.max(30, currentFov + (e.deltaY > 0 ? -5 : 5)));
      syncSpherical({ fov });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [youtubeIs360]);

  // Load the current clip into the Vimeo player when it's a Vimeo video.
  useEffect(() => {
    const cur = itemsRef.current[currentIdx];
    if (window.__VIMEO_DEBUG)
      console.log(
        "[playlist] vimeo clip-load effect " +
          JSON.stringify({
            currentIdx,
            vimeoReady,
            hasPlayer: !!vimeoPlayerRef.current,
            curVideoId: cur?.videoId,
            vmId: cur?.videoId != null ? (vimeoIds.get(cur.videoId) ?? null) : null,
            vmIdNum: cur?.videoId != null ? (vimeoIds.get(Number(cur.videoId)) ?? null) : null,
            entries: [...vimeoIds].map(([k, v]) => `${typeof k}:${String(k)}=${v}`),
          })
      );
    if (!vimeoReady || !vimeoPlayerRef.current || !cur || cur.type === "slide") return;
    setVimeoInitError(null);
    const vmId = vimeoIds.get(cur.videoId);
    if (!vmId) return;

    advancedRef.current = false;
    clearTimeInterval();
    setCurrentTime(cur.timestamp);
    if (window.__VIMEO_DEBUG) console.log("[playlist] vimeo clip-load: post-guards OK, about to try");

    try {
      if (window.__VIMEO_DEBUG)
        console.log("[playlist] playerRef info", {
          type: typeof playerRef.current,
          ctor: (playerRef.current as { constructor?: { name?: string } } | null)?.constructor?.name,
          keys: playerRef.current ? Object.keys(playerRef.current).slice(0, 12) : null,
        });
      // Pause the OTHER players before starting this clip. Each cross-player
      // pause is individually shielded: a half-initialized YT/HTML5 player
      // (e.g. one built for a later clip in the list) can throw, and it must
      // never abort the Vimeo load below.
      try { playerRef.current?.pauseVideo(); } catch {}
      try { html5PlayerRef.current?.pauseVideo(); } catch {}
      if (window.__VIMEO_DEBUG) console.log("[playlist] vimeo clip-load: loadVideoById", vmId, "ts", cur.timestamp, "then playVideo");
      vimeoPlayerRef.current.loadVideoById(vmId, cur.timestamp);
      vimeoPlayerRef.current.playVideo();
      if (speedRef.current !== 1) vimeoPlayerRef.current.setPlaybackRate(speedRef.current);
    } catch (e) {
      if (window.__VIMEO_DEBUG) console.log("[playlist] vimeo clip-load ERROR:", String(e), (e as Error)?.stack?.slice?.(0, 400));
    }
  }, [currentIdx, vimeoReady, item?.videoId, item?.timestamp, item?.type, vimeoIds]);

  // ── Vimeo Player SDK (created on demand from the first Vimeo clip) ──
  useEffect(() => {
    const container = vimeoContainerRef.current;
    if (!container || vimeoPlayerRef.current) return;
    const firstVmItem = itemsRef.current.find((i) => i.videoId > 0 && vimeoIds.get(i.videoId));
    if (!firstVmItem) return;
    let destroyed = false;
    setVimeoInitError(null);
    const timeout = window.setTimeout(() => {
      if (!destroyed && !vimeoReady) {
        setVimeoInitError("Vimeo player could not be initialized. Try again.");
      }
    }, 7000);

    function createVimeoPlayer() {
      if (destroyed || vimeoPlayerRef.current || !window.Vimeo?.Player || !container) return;
      try {
        // Build over the existing ?api=1 iframe (like the annotation player):
        // the lightweight app_id div-embed auto-play stalls silently.
        const p = new window.Vimeo.Player(container) as unknown as import("@/lib/vimeo-adapter").MinimalVimeoPlayer;
        const adapter = new VimeoAdapter(p);
        vimeoPlayerRef.current = adapter;
        adapter.onReady(() => {
          if (destroyed) return;
          setVimeoReady(true);
          setVimeoInitError(null);
          if (speedRef.current !== 1) adapter.setPlaybackRate(speedRef.current);
        });
        adapter.onPlayState((pl) => {
          if (destroyed) return;
          // Ignore events from the hidden player when a YouTube clip is active.
          const curItem = itemsRef.current[currentIdxRef.current];
          if (!curItem || !vimeoIdsRef.current.get(curItem.videoId)) return;
          setPlaying(pl);
          if (pl) startTimePolling();
          else clearTimeInterval();
          if (adapter.getPlayerState() === 0) {
            if (loopOneRef.current) {
              const it = itemsRef.current[currentIdxRef.current];
              try { adapter.seekTo(it.timestamp, true); adapter.playVideo(); } catch {}
            } else if (advancedRef.current) {
              advancedRef.current = false;
            } else {
              advanceOrEnd();
            }
          }
        });
      } catch (err) {
        console.error("[Vimeo Player] createVimeoPlayer failed:", err);
        setVimeoInitError("Vimeo player could not be initialized. Try again.");
      }
    }

    if (window.Vimeo?.Player) {
      createVimeoPlayer();
      return () => {
        destroyed = true;
        window.clearTimeout(timeout);
      };
    }

    if (!document.querySelector('script[src*="player.vimeo.com/api/player.js"]')) {
      const s = document.createElement("script");
      s.src = "https://player.vimeo.com/api/player.js";
      document.head.appendChild(s);
    }
    const poll = setInterval(() => {
      if (!destroyed && window.Vimeo?.Player) { clearInterval(poll); window.clearTimeout(timeout); createVimeoPlayer(); }
    }, 100);

    return () => {
      destroyed = true;
      clearInterval(poll);
      window.clearTimeout(timeout);
      if (vimeoPlayerRef.current) {
        try { vimeoPlayerRef.current.destroy(); } catch {}
        vimeoPlayerRef.current = null;
      }
    };
    // Same narrowing rationale as the YT creation effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vimeoIds]);

  // ── Native HTML5 player (Google Drive / upload) ──
  // Bind a reusable <video>/<audio> element once the playlist has a
  // drive/upload item; clip loading swaps `src` and seeks per item.
  useEffect(() => {
    const el = html5ElRef.current;
    if (!el || html5PlayerRef.current) return;
    const hasHtml5 = itemsRef.current.some((i) => i.videoId > 0 && html5SrcsRef.current.get(i.videoId));
    if (!hasHtml5) return;
    const adapter = new Html5Adapter(el);
    html5PlayerRef.current = adapter;
    let destroyed = false;
    adapter.onPlayState((pl) => {
      if (destroyed) return;
      const curItem = itemsRef.current[currentIdxRef.current];
      if (!curItem || !html5SrcsRef.current.get(curItem.videoId)) return;
      setPlaying(pl);
      if (pl) startTimePolling();
      else clearTimeInterval();
    });
    adapter.onReady(() => {
      if (destroyed) return;
      setHtml5Ready(true);
    });
    adapter.onEnd(() => {
      if (destroyed) return;
      const curItem = itemsRef.current[currentIdxRef.current];
      if (!curItem || !html5SrcsRef.current.get(curItem.videoId)) return;
      setPlaying(false);
      clearTimeInterval();
      // Hold-mode drive/upload clip hit its natural end: pause and don't
      // advance to the next clip.
      if (curItem.endTimestamp == null) {
        endHoldPlayer();
      } else if (loopOneRef.current) {
        try {
          html5PlayerRef.current?.seekTo(curItem.timestamp, true);
          html5PlayerRef.current?.playVideo();
        } catch {}
      } else if (advancedRef.current) {
        advancedRef.current = false;
      } else {
        advanceOrEnd();
      }
    });
    setHtml5Setup(true);
    return () => {
      destroyed = true;
      if (html5PlayerRef.current) {
        try { html5PlayerRef.current.destroy(); } catch {}
        html5PlayerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html5SrcsState]);

  // Load the current clip into the HTML5 element when it's a drive/upload
  // video: swap `${src}`, seek to the clip start, and play on metadata.
  useEffect(() => {
    const cur = itemsRef.current[currentIdx];
    if (!html5Setup || !html5ElRef.current || !cur || cur.type === "slide") return;
    const src = html5SrcsState.get(cur.videoId);
    if (!src) return;
    const el = html5ElRef.current;
    advancedRef.current = false;
    clearTimeInterval();
    try { playerRef.current?.pauseVideo(); } catch {}
    try { vimeoPlayerRef.current?.pauseVideo(); } catch {}
    setCurrentTime(cur.timestamp);
    setHtml5Loading(true);
    const onMeta = () => {
      if (!html5PlayerRef.current || !html5ElRef.current) return;
      setHtml5Loading(false);
      try { html5ElRef.current.currentTime = cur.timestamp; } catch {}
      try { html5ElRef.current.play(); } catch {}
      try { if (speedRef.current !== 1) html5ElRef.current.playbackRate = speedRef.current; } catch {}
      // Drive files are often audio stored as mediaType "video" — confirm a
      // real video track (videoWidth>0) so the cover overlay can hide for
      // genuine videos but stay up for audio/cover renders.
      if (cur.videoId > 0 && html5ElRef.current.videoWidth <= 0 && html5ElRef.current.videoHeight <= 0) {
        // audio — nothing to mark; cover stays
      } else if (cur.videoId > 0) {
        setHtml5IsVideo((prev) => {
          if (prev.get(cur.videoId)) return prev;
          const next = new Map(prev);
          next.set(cur.videoId, true);
          return next;
        });
      }
    };
    el.addEventListener("loadedmetadata", onMeta);
    try { el.src = src; } catch {}
    // Start clips that begin near 0 immediately instead of waiting for
    // metadata — Drive streams can be slow to hand over the header.
    if (cur.timestamp < 3) { try { el.play().catch(() => {}); } catch {} }
    return () => el.removeEventListener("loadedmetadata", onMeta);
  }, [currentIdx, html5Setup, item?.videoId, item?.timestamp, item?.type, html5SrcsState]);

  // Tick the loading clock while an html5 stream buffers, resetting whenever a
  // new clip starts loading.
  useEffect(() => {
    if (!html5Loading) return;
    startLoaderTick();
    return clearLoaderTick;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html5Loading]);

  useEffect(() => {
    if (!playing || !currentTime) return;
    const ap = getActivePlayer();
    if (!ap) return;
    const cur = itemsRef.current[currentIdx];
    // Only real clips have clip windows — slides advance via their own timer
    // and unplayable items must not phantom-advance off stale currentTime.
    if (!cur || cur.type === "slide") return;
    if (!videoIdsRef.current.get(cur.videoId) && !vimeoIdsRef.current.get(cur.videoId) && !html5SrcsRef.current.get(cur.videoId)) return;
    try {
      if (ap.getPlayerState() !== 1) return;
    } catch { return; }
    // Hold-mode drive/upload clip (no end set): run to the media's NATURAL
    // end, then pause — don't let the raw 548s WAV keep playing, and don't
    // advance to the next clip (hold semantics preserved).
    if (cur.endTimestamp == null && html5SrcsRef.current.get(cur.videoId)) {
      const d = ap.getDuration();
      if (d > 0 && currentTime >= d) {
        endHoldPlayer();
      }
      return;
    }
    if (currentTime < cur.timestamp) return;
    const end = cur.endTimestamp ?? (cur.timestamp + 30);
    if (currentTime >= end) {
      // Loop-one: clips are windows into longer videos — YT/Vimeo ended events
      // won't fire, so seek back as soon as playback crosses the clip end.
      if (loopOneRef.current) {
        try { ap.seekTo(cur.timestamp, true); setCurrentTime(cur.timestamp); } catch {}
        return;
      }
      advancedRef.current = true;
      advanceOrEnd();
    }
    // endHoldPlayer/advanceOrEnd are stable function declarations; keeping the
    // array narrowed to the time-polling triggers preserves clip-window timing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, playing, currentIdx]);

  function goTo(idx: number) {
    if (idx < 0 || idx >= items.length) return;
    setEnded(false);
    setCurrentIdx(idx);
  }

  // A hold-mode drive/upload clip reached its natural end: pause and keep the
  // clip in place (no advance to the next item).
  function endHoldPlayer() {
    try { html5PlayerRef.current?.pauseVideo(); } catch {}
    clearTimeInterval();
    setPlaying(false);
    setEnded(true);
  }

  // Advance to the next item, or stop at a blank black screen when the last
  // clip finishes. Slides never reach here (they advance via their own timer).
  function advanceOrEnd() {
    const idx = currentIdxRef.current;
    if (idx < itemsRef.current.length - 1) {
      setEnded(false);
      setCurrentIdx(idx + 1);
    } else {
      try { playerRef.current?.pauseVideo(); } catch {}
      try { vimeoPlayerRef.current?.pauseVideo(); } catch {}
      try { html5PlayerRef.current?.pauseVideo(); } catch {}
      setEnded(true);
      setCurrentIdx(idx);
    }
  }

  // Apply speed changes immediately to both players (active one takes effect)
  useEffect(() => {
    try { playerRef.current?.setPlaybackRate?.(SPEEDS[speedIdx]); } catch {}
    try { vimeoPlayerRef.current?.setPlaybackRate(SPEEDS[speedIdx]); } catch {}
    try { html5PlayerRef.current?.setPlaybackRate(SPEEDS[speedIdx]); } catch {}
  }, [speedIdx, playerReady, vimeoReady, html5Ready]);

  // Keyboard shortcuts: ←/→ prev-next clip, Space play/pause, Esc close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t instanceof HTMLVideoElement)) return;
      if (e.key === "Escape") {
        // In browser fullscreen, exit fullscreen (explicitly, so it also works
        // in automated/embedded browsers) rather than closing the modal.
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
          return;
        }
        onClose();
        return;
      }
      const onButton = t?.closest("button");
      if (e.key === " ") {
        if (onButton) return; // focused button handles Space itself
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(currentIdxRef.current + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(currentIdxRef.current - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track browser fullscreen so the header toggle icon stays in sync (and so
  // Esc from the browser fullscreen API doesn't close the modal underneath).
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (rootRef.current?.requestFullscreen) {
      rootRef.current.requestFullscreen().catch(() => {});
    }
  }

  // Auto-scroll the active item into view (sidebar + mobile strip)
  useEffect(() => {
    const side = sidebarScrollRef.current;
    const activeSide = sidebarRefs.current[currentIdx];
    if (side && activeSide) {
      side.scrollTop = activeSide.offsetTop - side.clientHeight / 2 + activeSide.clientHeight / 2;
    }
    const strip = stripScrollRef.current;
    const activeStrip = stripRefs.current[currentIdx];
    if (strip && activeStrip) {
      strip.scrollLeft = activeStrip.offsetLeft - strip.clientWidth / 2 + activeStrip.clientWidth / 2;
    }
  }, [currentIdx, filter]);

  // Clip progress scrubbing
  function seekWithinClip(e: React.PointerEvent<HTMLDivElement>) {
    const cur = itemsRef.current[currentIdxRef.current];
    const ap = getActivePlayer();
    if (!cur || !ap) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const end = cur.endTimestamp ?? cur.timestamp + 30;
    const target = cur.timestamp + ratio * (end - cur.timestamp);
    try {
      ap.seekTo(target, true);
      setCurrentTime(target);
    } catch {}
  }

  function toggleMute() {
    const ap = getActivePlayer();
    if (!ap) return;
    try {
      if (muted) ap.unMute?.();
      else ap.mute?.();
      setMuted(!muted);
    } catch {}
  }

  function togglePlay() {
    const ap = getActivePlayer();
    if (!ap) return;
    try {
      const state = ap.getPlayerState();
      if (state === 1) ap.pauseVideo();
      else ap.playVideo();
    } catch {}
  }

  if (items.length === 0) return null;

  const ytId = videoIds.get(item.videoId);
  const vmId = vimeoIds.get(item.videoId);
  const h5Src = html5SrcsState.get(item.videoId);
  const firstVmItem = items.find((i) => i.videoId > 0 && vimeoIds.get(i.videoId));
  const firstVmId = firstVmItem ? vimeoIds.get(firstVmItem.videoId) : undefined;
  // Drive/upload clips show a cover (audio-style) until the stream proves a
  // real video track; the cover then hides to reveal the video.
  const isHtml5Audio = !!h5Src && !html5IsVideo.get(item.videoId);
  const audioCoverSrc = isHtml5Audio ? (item.imageUrl || item.videoThumbnail) || "" : "";
  const isSlide = item?.type === "slide";
  const playable = !!(ytId || vmId || h5Src);
  const readyNow = ytId ? playerReady : vmId ? vimeoReady : h5Src ? html5Ready : false;
  const       activeKind: "youtube" | "vimeo" | "html5" | null = isSlide ? null : vmId ? "vimeo" : h5Src ? "html5" : ytId ? "youtube" : null;
  const loadElapsedSec = html5Loading ? Math.max(0, (loadNow - (loadStartRef.current || loadNow)) / 1000) : 0;
  const loadNominalSec = LOAD_NOMINAL_MS / 1000;
  const loadRemaining = Math.max(0, Math.ceil(loadNominalSec - loadElapsedSec));
  const clipEnd = item ? (item.endTimestamp ?? item.timestamp + 30) : 0;
  const clipFrac = isSlide || !playable ? 0 : Math.min(1, Math.max(0, (currentTime - item.timestamp) / Math.max(1, clipEnd - item.timestamp)));
  const slideMs = slideDeadlineRef.current?.ms ?? 5000;
  const remainingSec = items.reduce((acc, it, i) => {
    if (i < currentIdx) return acc;
    if (it.type === "slide") return acc + (it.endTimestamp ?? 5);    const end = i === currentIdx ? clipEnd : (it.endTimestamp ?? it.timestamp + 30);
    const start = i === currentIdx ? Math.min(currentTime, end) : it.timestamp;
    return acc + Math.max(0, end - start);
  }, 0);
  const types = [...new Set(items.map((it) => it.type))];
  const listedIdxs = items.map((_, i) => i).filter((i) => !filter || items[i].type === filter);

  return (
    <div ref={rootRef} className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={onClose}>
      <div className="flex flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 py-2 shrink-0 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={onClose} className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors" title="Close (Esc)">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <span className="text-xs text-white/40 font-mono">
                {formatTs(currentTime)} / {formatTs(clipEnd)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setSpeedIdx((prev) => (prev + 1) % SPEEDS.length)}
                className="px-1.5 py-0.5 rounded text-[11px] font-mono text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                title="Playback speed"
              >
                {SPEEDS[speedIdx]}×
              </button>
              <button onClick={toggleMute} disabled={!readyNow}
                className={`p-1 rounded transition-colors ${muted ? "text-accent" : "text-white/60 hover:text-white hover:bg-white/10"} disabled:opacity-30`}
                title={muted ? "Unmute" : "Mute"}>
                {muted ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0014 8v2.2l2.45 2.45c.03-.21.05-.43.05-.65zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.9 8.9 0 0021 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.26c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8v8a4.5 4.5 0 002.5-4zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                )}
              </button>
              <button onClick={() => setLoopOne((v) => !v)}
                className={`p-1 rounded transition-colors ${loopOne ? "text-accent bg-accent/15" : "text-white/60 hover:text-white hover:bg-white/10"}`}
                title={loopOne ? "Loop off" : "Loop this clip"}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </button>
              <button onClick={toggleFullscreen}
                className={`p-1 rounded transition-colors ${isFullscreen ? "text-accent" : "text-white/60 hover:text-white hover:bg-white/10"}`}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isFullscreen ? "M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" : "M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"} /></svg>
              </button>
              <span className="text-xs text-white/40 ml-1">{currentIdx + 1}/{items.length}</span>
              <span className="text-[10px] text-white/30 hidden sm:inline">· {fmtRemaining(remainingSec)}</span>
            </div>
          </div>

          <div className={isFullscreen ? "flex-1 min-h-0 w-full bg-black relative" : "aspect-video mx-auto w-full max-w-4xl bg-black relative"}>
            {/* SDK players replace their mount node (YT swaps the div for an
                iframe), so visibility is toggled on these React-owned wrappers */}
            <div className="absolute inset-0 overflow-hidden" style={{ display: activeKind === "youtube" && !ended ? undefined : "none" }}>
              <div ref={playerContainerRef} className="w-full h-full" />
              {youtubeIs360 && (
                <div className="pointer-events-none absolute right-2 top-2 z-20 rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
                  360°
                </div>
              )}
              {/* 360° camera layer: drag steers yaw/pitch, wheel zooms FOV.
                  Leaves the bottom strip (~56px) clickable so YouTube's own
                  playback controls (timeline, play/pause, settings, fullscreen)
                  remain usable. */}
              {youtubeIs360 && activeKind === "youtube" && !ended && (
                <div
                  ref={sphericalLayerRef}
                  className="absolute inset-x-0 top-0 bottom-14 z-10 cursor-grab active:cursor-grabbing touch-none select-none"
                  onPointerDown={handle360PointerDown}
                  onPointerMove={handle360PointerMove}
                  onPointerUp={handle360PointerUp}
                  onPointerCancel={handle360PointerUp}
                >
                  <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/80 transition-opacity whitespace-nowrap">
                    {orientationSensor ? "gyro · drag to look · wheel to zoom" : "drag to look · wheel to zoom"}
                  </span>
                  {gyroCapable && (
                    <button
                      onClick={toggleOrientationSensor}
                      className="pointer-events-auto absolute left-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/60 hover:text-white hover:bg-black/70 transition-colors"
                      title={orientationSensor ? "Disable device-orientation (gyroscope) control" : "Enable device-orientation (gyroscope) control: hold your device and move it to look around"}
                    >
                      {orientationSensor ? "gyro: on" : "gyro: off"}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="absolute inset-0" style={{ display: activeKind === "vimeo" && !ended ? undefined : "none" }}>
              <iframe
                ref={vimeoContainerRef}
                src={firstVmId ? vimeoEmbedUrl(firstVmId) : undefined}
                title="Vimeo player"
                className="w-full h-full"
                allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
                allowFullScreen
              />
            </div>
            <div className="absolute inset-0 h-full w-full" style={{ display: activeKind === "html5" && !ended ? undefined : "none" }}>
              <video
                ref={html5ElRef}
                className="h-full w-full"
                playsInline
                preload="metadata"
              />
            </div>
            {ended && (
              <div className="absolute inset-0 bg-black" />
            )}
            {!ended && item?.type !== "slide" && (
              ytId === "" && !vmId && !h5Src ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black px-8 text-center">
                  <span className="text-xs text-white/40">
                    This clip&apos;s video isn&apos;t playable in the playlist (social or self-hosted) — use Next to continue.
                  </span>
                </div>
              ) : !readyNow && !isHtml5Audio ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black px-8 text-center">
                  <div className="flex items-center gap-2 text-white/40">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                    <span className="text-xs">{vmId && vimeoInitError ? vimeoInitError : "Loading player..."}</span>
                  </div>
                </div>
              ) : null
            )}
            {!ended && isHtml5Audio && (
              <div className="absolute inset-0 flex items-center justify-center bg-black p-8 pointer-events-none">
                {audioCoverSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={audioCoverSrc}
                    alt={item.title || "Audio cover"}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                    className="max-h-[60%] max-w-full object-contain rounded-lg shadow-xl ring-1 ring-white/10"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-2xl bg-white/10 flex items-center justify-center">
                    <svg className="w-12 h-12 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.818m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.75z" />
                    </svg>
                  </div>
                )}
              </div>
            )}
            {!ended && h5Src && html5Loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                  <span className="text-xs text-white/80">Loading from Google Drive ({loadRemaining}s)</span>
                </div>
                <div className="w-48 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-white/70 transition-[width] duration-300"
                    style={{ width: `${Math.min(100, (loadElapsedSec / loadNominalSec) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {!ended && isSlide && (
              <div
                className="absolute inset-0 flex items-end justify-center px-12 pt-10 pb-14 bg-black"
                style={item?.color ? { backgroundColor: item.color } : undefined}
              >
                <div className="text-center max-w-2xl w-full max-h-full flex flex-col items-center">
                  {item?.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageUrl}
                      alt=""
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                      className="mb-5 max-h-[45%] max-w-full object-contain rounded-lg shadow-lg"
                    />
                  )}
                  {!item?.imageUrl && (
                    <div className="w-16 h-16 mx-auto mb-6 shrink-0 rounded-2xl bg-gradient-to-br from-purple-500/20 to-accent/5 flex items-center justify-center border border-purple-500/10">
                      <svg className="w-8 h-8 text-purple-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1l2.5-1.5A1 1 0 0121 7v10a1 1 0 01-1.5.86L17 16v1a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                  )}
                  <h2 className="text-2xl font-bold text-white mb-3">{item.title}</h2>
                  {item.detail && (
                    <div
                      className="text-base text-white/60 leading-relaxed max-h-56 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: renderNoteHtml(item.detail) }}
                    />
                  )}
                  <div className="mt-8 flex items-center justify-center gap-2 text-white/30 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400/50 animate-pulse" />
                    {slideRemainingSec === null
                      ? <>Holding — press <span className="text-white/50 font-medium">Next</span> or → to continue</>
                      : <>Auto-advancing in {Math.ceil(slideRemainingSec)}s</>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Clip / slide progress bar */}
          {!isFullscreen && (
          <div
            className="mx-auto w-full max-w-4xl px-0 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {!ended && !isSlide && playable && readyNow ? (
              <div
                className="group relative h-1.5 mx-1 cursor-pointer"
                onPointerDown={(e) => {
                  seekingRef.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  seekWithinClip(e);
                }}
                onPointerMove={(e) => { if (seekingRef.current) seekWithinClip(e); }}
                onPointerUp={() => { seekingRef.current = false; }}
                onPointerCancel={() => { seekingRef.current = false; }}
                title="Scrub within this clip"
              >
                <div className="absolute inset-y-0 left-0 right-0 my-auto rounded bg-white/15 group-hover:h-1.5 transition-all" style={{ height: 6 }} />
                <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded bg-accent" style={{ width: `${clipFrac * 100}%` }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent opacity-0 group-hover:opacity-100 transition-opacity -ml-1.5" style={{ left: `${clipFrac * 100}%` }} />
              </div>
            ) : isSlide ? (
              <div className="relative h-1 mx-1">
                <div className="absolute inset-0 rounded bg-purple-400/15" />
                <div
                  key={`${currentIdx}-${item.createdAt}`}
                  className="absolute left-0 top-0 h-1 rounded bg-purple-400/70"
                  style={{
                    width: `${slideRemainingSec === null ? 0 : Math.max(0, (slideRemainingSec * 1000) / slideMs * 100)}%`,
                    transition: "width 200ms linear",
                  }}
                />
              </div>
            ) : null}
          </div>
          )}

          {/* Mobile queue strip */}
          {!isFullscreen && (
          <div ref={stripScrollRef} className="md:hidden flex gap-2 overflow-x-auto px-4 py-2 shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.map((it, i) => (
              <button
                key={i}
                ref={(el) => { stripRefs.current[i] = el; }}
                onClick={() => goTo(i)}
                className={`shrink-0 max-w-[180px] px-3 py-1.5 rounded-full border text-xs truncate transition-colors ${
                  i === currentIdx
                    ? "border-accent bg-accent/15 text-white"
                    : "border-white/15 text-white/50 hover:text-white hover:border-white/30"
                }`}
              >
                <span className="font-mono text-[10px] mr-1.5 opacity-60">{i + 1}</span>
                {it.title}
              </button>
            ))}
          </div>
          )}

          {!isFullscreen && (
          <div className="px-4 py-3 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <span className="text-[10px] uppercase font-medium text-accent bg-accent/20 px-1.5 py-0.5 rounded inline-block mb-1">
                  {item.type.replace("_", " ")}
                </span>
                <h3 className="text-sm font-semibold text-white truncate">{item.title}</h3>
                {item.detail && (
                  <div
                    className="mt-1 text-xs text-white/60 leading-relaxed max-h-24 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-track]:bg-transparent"
                    dangerouslySetInnerHTML={{ __html: renderNoteHtml(item.detail) }}
                  />
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => goTo(currentIdx - 1)} disabled={currentIdx === 0}
                  className="p-2 rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all" title="Previous (←)">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button onClick={togglePlay}
                  className="p-3 rounded-full bg-accent text-white hover:bg-accent-hover active:scale-95 transition-all" title={playing ? "Pause" : "Play"}>
                  {playing ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  )}
                </button>
                <button onClick={() => goTo(currentIdx + 1)} disabled={currentIdx === items.length - 1}
                  className="p-2 rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all" title="Next (→)">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
            </div>
          </div>
          )}
        </div>

        {!isFullscreen && (
        <div className="w-72 border-l border-white/10 bg-black/40 hidden md:flex flex-col shrink-0">
          <div className="px-3 py-2 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 shrink-0 flex items-center justify-between">
            <span>Playlist</span>
            <span className="font-mono normal-case">{fmtRemaining(remainingSec)}</span>
          </div>
          {types.length > 1 && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-white/10 shrink-0">
              <button
                onClick={() => setFilter(null)}
                className={`px-2 py-0.5 rounded-full border text-[10px] transition-colors ${
                  filter === null ? "border-accent bg-accent/15 text-accent" : "border-white/15 text-white/40 hover:text-white hover:border-white/30"
                }`}
              >
                All
              </button>
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => setFilter(filter === t ? null : t)}
                  className={`px-2 py-0.5 rounded-full border text-[10px] capitalize truncate max-w-full transition-colors ${
                    filter === t ? "border-accent bg-accent/15 text-accent" : "border-white/15 text-white/40 hover:text-white hover:border-white/30"
                  }`}
                >
                  {t.replace("_", " ")}
                </button>
              ))}
            </div>
          )}
          <div ref={sidebarScrollRef} className="flex-1 overflow-y-auto">
            {listedIdxs.map((i) => {
              const it = items[i];
              return (
                <button
                  key={i}
                  ref={(el) => { sidebarRefs.current[i] = el; }}
                  onClick={() => goTo(i)}
                  className={`w-full text-left px-3 py-2 transition-colors flex items-center gap-2 ${
                    i === currentIdx ? "bg-accent/15 border-l-2 border-accent" : "hover:bg-white/5 border-l-2 border-transparent"
                  }`}
                >
                  <span className="relative shrink-0 w-14 h-8 rounded overflow-hidden bg-gradient-to-br from-purple-500/20 to-accent/10">
                    {it.videoThumbnail ? (
                      <Image src={it.videoThumbnail} alt="" fill sizes="56px" className="object-cover" unoptimized={!isTrustedImageUrl(it.videoThumbnail)} />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white/40">{i + 1}</span>
                    )}
                    <span className="absolute bottom-0 right-0 bg-black/75 text-[8px] font-mono px-0.5 rounded-tl text-white/80">
                      {it.type === "slide" ? (it.endTimestamp == null ? "hold" : it.endTimestamp + "s") : formatTs(it.timestamp)}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <p className={`text-xs truncate ${i === currentIdx ? "text-white" : "text-white/60"}`}>{it.title}</p>
                    <p className="text-[9px] text-white/30 font-mono">
                      {i + 1} · {formatTs(it.timestamp)}{it.endTimestamp && it.type !== "slide" ? ` – ${formatTs(it.endTimestamp)}` : ""}
                    </p>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
