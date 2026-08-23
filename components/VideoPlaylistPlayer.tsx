"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { sanitizeHtml, tokenizeNoteLinks } from "@/lib/youtube";
import { VimeoAdapter } from "@/lib/vimeo-adapter";

declare global {
  interface Window {
    // New property only — YT/onYouTubeIframeAPIReady are declared by the
    // video/shared pages with their local YTPlayer symbol and must not
    // be redeclared here with a different identity.
    Vimeo?: { Player: new (element: HTMLElement, options?: Record<string, unknown>) => unknown };
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

export interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  loadVideoById(videoId: string, startSeconds: number): void;
  cueVideoById(videoId: string, startSeconds: number): void;
  setPlaybackRate?(rate: number): void;
  mute?(): void;
  unMute?(): void;
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
  createdAt: string;
  videoTitle: string | null;
  videoThumbnail: string | null;
}

export function formatTs(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function VideoPlaylistPlayer({ items, onClose }: { items: ClipItem[]; onClose: () => void }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<YTPlayer | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const timeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const item = items[currentIdx];

  const [videoIds, setVideoIds] = useState<Map<number, string>>(new Map());
  const [vimeoIds, setVimeoIds] = useState<Map<number, string>>(new Map());
  const videoIdsRef = useRef<Map<number, string>>(videoIds);
  useEffect(() => { videoIdsRef.current = videoIds; });
  const vimeoIdsRef = useRef<Map<number, string>>(vimeoIds);
  useEffect(() => { vimeoIdsRef.current = vimeoIds; });
  const vimeoPlayerRef = useRef<VimeoAdapter | null>(null);
  const vimeoContainerRef = useRef<HTMLDivElement>(null);
  const [vimeoReady, setVimeoReady] = useState(false);
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
    const uniqueIds = [...new Set(items.filter(i => i.videoId > 0).map((i) => i.videoId))];
    const missingIds = uniqueIds.filter((id) => !fetchedIdsRef.current.has(id));
    if (missingIds.length === 0) return;
    missingIds.forEach((id) => fetchedIdsRef.current.add(id));
    Promise.all(
      missingIds.map(async (vid) => {
        try {
          const res = await fetch(`/api/videos/${vid}`);
          if (res.ok) {
            const data = await res.json();
            // Classify by youtubeId shape: 11-char = YouTube, "vimeo:<id>" =
            // Vimeo; other social/self-hosted prefixes stay unplayable ("").
            const raw = String(data.youtubeId ?? "");
            const ytOk = /^[A-Za-z0-9_-]{11}$/.test(raw);
            return {
              videoId: vid,
              youtubeId: ytOk ? raw : "",
              vimeoId: !ytOk && raw.startsWith("vimeo:") ? raw.slice("vimeo:".length) : "",
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
    });
  }, [items]);

  useEffect(() => {
    const cur = itemsRef.current[currentIdx];
    if (cur?.type === "slide") {
      clearTimeInterval();
      const ms = (cur.endTimestamp ?? 5) * 1000;
      slideDeadlineRef.current = { start: Date.now(), ms };
      setSlideRemainingSec(ms / 1000);
      timeIntervalRef.current = setInterval(() => {
        const d = slideDeadlineRef.current;
        if (!d) return;
        const remain = Math.max(0, (d.ms - (Date.now() - d.start)) / 1000);
        setSlideRemainingSec(remain);
      }, 200);
      slideTimerRef.current = setTimeout(() => {
        setCurrentIdx((prev) => (prev < itemsRef.current.length - 1 ? prev + 1 : 0));
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

  // The player backing the current clip (Vimeo adapter or YouTube iframe).
  function getActivePlayer(): YTPlayer | null {
    const cur = itemsRef.current[currentIdxRef.current];
    if (!cur) return null;
    if (vimeoIdsRef.current.get(cur.videoId)) return vimeoPlayerRef.current;
    return playerRef.current;
  }

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
    setCurrentTime(cur.timestamp);
    lastVideoIdRef.current = ytId;

    try {
      playerRef.current.loadVideoById(ytId, cur.timestamp);
      playerRef.current.playVideo();
      // loadVideoById resets playback rate — re-apply the chosen speed
      if (speedRef.current !== 1) playerRef.current.setPlaybackRate?.(speedRef.current);
    } catch {}
  }, [currentIdx, playerReady, item?.videoId, item?.timestamp, item?.type, videoIds]);

  useEffect(() => {
    const container = playerContainerRef.current;
    if (!container || playerRef.current) return;
    // Create the player from the first item that is actually playable on YT
    const firstPlayable = itemsRef.current.find((i) => i.videoId > 0 && videoIds.get(i.videoId));
    const firstYtId = firstPlayable ? videoIds.get(firstPlayable.videoId) : undefined;
    if (!firstYtId) return;
    lastVideoIdRef.current = firstYtId;
    let destroyed = false;

    function createPlayer() {
      if (destroyed || playerRef.current || !container) return;
      try {
        playerRef.current = new window.YT.Player(container, {
          videoId: firstYtId,
          playerVars: { autoplay: 0, modestbranding: 1, rel: 0, controls: 1, enablejsapi: 1 },
          events: {
            onReady: () => {
              if (destroyed) return;
              setPlayerReady(true);
            },
            onStateChange: (e: { data: number }) => {
              if (destroyed) return;
              // Ignore YouTube events while a Vimeo clip is active —
              // pausing the hidden YT player must not flip shared UI state.
              const curItem = itemsRef.current[currentIdxRef.current];
              if (curItem && vimeoIdsRef.current.get(curItem.videoId)) return;
              const state = e.data;
              const pl = state === 1;
              setPlaying(pl);
              if (pl) startTimePolling();
              else clearTimeInterval();
              if (state === 0) {
                if (loopOneRef.current) {
                  const it = itemsRef.current[currentIdxRef.current];
                  try {
                    playerRef.current?.seekTo(it.timestamp, true);
                    playerRef.current?.playVideo();
                  } catch {}
                } else if (advancedRef.current) {
                  advancedRef.current = false;
                } else {
                  setCurrentIdx((prev) => (prev < itemsRef.current.length - 1 ? prev + 1 : 0));
                }
              }
            },
          },
        });
      } catch (err) {
        console.error("[YT Player] createPlayer failed:", err);
      }
    }

    if (window.YT && window.YT.Player) {
      createPlayer();
      return () => { destroyed = true; clearTimeInterval(); };
    }

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
    const poll = setInterval(() => {
      if (!destroyed && window.YT && window.YT.Player) { clearInterval(poll); createPlayer(); }
    }, 100);

    return () => { destroyed = true; clearInterval(poll); clearTimeInterval(); };
    // Deps narrowed to their trigger (metadata map): startTimePolling closes
    // over refs only, and recreating the YT player per render would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoIds]);

  // Load the current clip into the Vimeo player when it's a Vimeo video.
  useEffect(() => {
    const cur = itemsRef.current[currentIdx];
    if (!vimeoReady || !vimeoPlayerRef.current || !cur || cur.type === "slide") return;
    const vmId = vimeoIds.get(cur.videoId);
    if (!vmId) return;

    advancedRef.current = false;
    clearTimeInterval();
    setCurrentTime(cur.timestamp);

    try {
      playerRef.current?.pauseVideo();
      vimeoPlayerRef.current.loadVideoById(vmId, cur.timestamp);
      vimeoPlayerRef.current.playVideo();
      if (speedRef.current !== 1) vimeoPlayerRef.current.setPlaybackRate(speedRef.current);
    } catch {}
  }, [currentIdx, vimeoReady, item?.videoId, item?.timestamp, item?.type, vimeoIds]);

  // ── Vimeo Player SDK (created on demand from the first Vimeo clip) ──
  useEffect(() => {
    const container = vimeoContainerRef.current;
    if (!container || vimeoPlayerRef.current) return;
    const firstVmItem = itemsRef.current.find((i) => i.videoId > 0 && vimeoIds.get(i.videoId));
    if (!firstVmItem) return;
    const firstVmId = vimeoIds.get(firstVmItem.videoId)!;
    let destroyed = false;

    function createVimeoPlayer() {
      if (destroyed || vimeoPlayerRef.current || !window.Vimeo?.Player || !container) return;
      try {
        const p = new window.Vimeo.Player(container, { id: Number(firstVmId), width: "100%" }) as unknown as import("@/lib/vimeo-adapter").MinimalVimeoPlayer;
        const adapter = new VimeoAdapter(p);
        vimeoPlayerRef.current = adapter;
        adapter.onReady(() => {
          if (destroyed) return;
          setVimeoReady(true);
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
              setCurrentIdx((prev) => (prev < itemsRef.current.length - 1 ? prev + 1 : 0));
            }
          }
        });
      } catch (err) {
        console.error("[Vimeo Player] createVimeoPlayer failed:", err);
      }
    }

    if (window.Vimeo?.Player) {
      createVimeoPlayer();
      return () => { destroyed = true; };
    }

    if (!document.querySelector('script[src*="player.vimeo.com/api/player.js"]')) {
      const s = document.createElement("script");
      s.src = "https://player.vimeo.com/api/player.js";
      document.head.appendChild(s);
    }
    const poll = setInterval(() => {
      if (!destroyed && window.Vimeo?.Player) { clearInterval(poll); createVimeoPlayer(); }
    }, 100);

    return () => {
      destroyed = true;
      clearInterval(poll);
      if (vimeoPlayerRef.current) {
        try { vimeoPlayerRef.current.destroy(); } catch {}
        vimeoPlayerRef.current = null;
      }
    };
    // Same narrowing rationale as the YT creation effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vimeoIds]);

  useEffect(() => {
    if (!playing || !currentTime) return;
    const ap = getActivePlayer();
    if (!ap) return;
    const cur = itemsRef.current[currentIdx];
    if (!cur) return;
    try {
      if (ap.getPlayerState() !== 1) return;
    } catch { return; }
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
      setCurrentIdx((prev) => (prev < itemsRef.current.length - 1 ? prev + 1 : 0));
    }
  }, [currentTime, playing, currentIdx]);

  function goTo(idx: number) {
    if (idx < 0 || idx >= items.length) return;
    setCurrentIdx(idx);
  }

  // Apply speed changes immediately to both players (active one takes effect)
  useEffect(() => {
    try { playerRef.current?.setPlaybackRate?.(SPEEDS[speedIdx]); } catch {}
    try { vimeoPlayerRef.current?.setPlaybackRate(SPEEDS[speedIdx]); } catch {}
  }, [speedIdx, playerReady, vimeoReady]);

  // Keyboard shortcuts: ←/→ prev-next clip, Space play/pause, Esc close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t instanceof HTMLVideoElement)) return;
      if (e.key === "Escape") { onClose(); return; }
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
  const isSlide = item?.type === "slide";
  const playable = !!(ytId || vmId);
  const readyNow = ytId ? playerReady : vmId ? vimeoReady : false;
  const activeKind: "youtube" | "vimeo" | null = isSlide ? null : vmId ? "vimeo" : "youtube";
  const clipEnd = item ? (item.endTimestamp ?? item.timestamp + 30) : 0;
  const clipFrac = isSlide || !playable ? 0 : Math.min(1, Math.max(0, (currentTime - item.timestamp) / Math.max(1, clipEnd - item.timestamp)));
  const slideMs = slideDeadlineRef.current?.ms ?? 5000;
  const upNext = !isSlide && playable && items.length > 1 && clipEnd - currentTime <= 5
    ? items[(currentIdx + 1) % items.length]
    : null;
  const remainingSec = items.reduce((acc, it, i) => {
    if (i < currentIdx) return acc;
    if (it.type === "slide") return acc + (it.endTimestamp ?? 5);
    const end = i === currentIdx ? clipEnd : (it.endTimestamp ?? it.timestamp + 30);
    const start = i === currentIdx ? Math.min(currentTime, end) : it.timestamp;
    return acc + Math.max(0, end - start);
  }, 0);
  const types = [...new Set(items.map((it) => it.type))];
  const listedIdxs = items.map((_, i) => i).filter((i) => !filter || items[i].type === filter);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={onClose}>
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
              <span className="text-xs text-white/40 ml-1">{currentIdx + 1}/{items.length}</span>
              <span className="text-[10px] text-white/30 hidden sm:inline">· {fmtRemaining(remainingSec)}</span>
            </div>
          </div>

          <div className="aspect-video mx-auto w-full max-w-4xl bg-black relative">
            {/* SDK players replace their mount node (YT swaps the div for an
                iframe), so visibility is toggled on these React-owned wrappers */}
            <div className="absolute inset-0" style={{ display: activeKind === "youtube" ? undefined : "none" }}>
              <div ref={playerContainerRef} className="w-full h-full" />
            </div>
            <div className="absolute inset-0 [&_iframe]:w-full [&_iframe]:h-full" style={{ display: activeKind === "vimeo" ? undefined : "none" }}>
              <div ref={vimeoContainerRef} className="w-full h-full" />
            </div>
            {item?.type !== "slide" && (
              ytId === "" && !vmId ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black px-8 text-center">
                  <span className="text-xs text-white/40">
                    This clip&apos;s video isn&apos;t playable in the playlist (social or self-hosted) — use Next to continue.
                  </span>
                </div>
              ) : !readyNow ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black">
                  <div className="flex items-center gap-2 text-white/40">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                    <span className="text-xs">Loading player...</span>
                  </div>
                </div>
              ) : null
            )}
            {isSlide && (
              <div className="absolute inset-0 flex items-end justify-center px-12 pt-10 pb-14 bg-black">
                <div className="text-center max-w-2xl w-full">
                  <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500/20 to-accent/5 flex items-center justify-center border border-purple-500/10">
                    <svg className="w-8 h-8 text-purple-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1l2.5-1.5A1 1 0 0121 7v10a1 1 0 01-1.5.86L17 16v1a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-3">{item.title}</h2>
                  {item.detail && (
                    <div
                      className="text-base text-white/60 leading-relaxed max-h-56 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: renderNoteHtml(item.detail) }}
                    />
                  )}
                  <div className="mt-8 flex items-center justify-center gap-2 text-white/30 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400/50 animate-pulse" />
                    Auto-advancing in {Math.ceil(slideRemainingSec ?? 0)}s
                  </div>
                </div>
              </div>
            )}
            {upNext && (
              <button
                onClick={(e) => { e.stopPropagation(); goTo(currentIdx + 1); }}
                className="absolute bottom-3 right-3 z-10 max-w-[70%] bg-black/85 border border-white/15 rounded-lg px-3 py-2 text-left hover:border-accent/50 transition-colors"
              >
                <span className="block text-[9px] uppercase tracking-wider text-white/40 mb-0.5">Up next in {Math.ceil(clipEnd - currentTime)}s</span>
                <span className="block text-xs text-white truncate">{upNext.title}</span>
              </button>
            )}
          </div>

          {/* Clip / slide progress bar */}
          <div
            className="mx-auto w-full max-w-4xl px-0 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {!isSlide && playable && readyNow ? (
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
                    width: `${slideRemainingSec === null ? 100 : Math.max(0, (slideRemainingSec * 1000) / slideMs * 100)}%`,
                    transition: "width 200ms linear",
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* Mobile queue strip */}
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

          <div className="px-4 py-3 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <span className="text-[10px] uppercase font-medium text-accent bg-accent/20 px-1.5 py-0.5 rounded inline-block mb-1">
                  {item.type.replace("_", " ")}
                </span>
                <h3 className="text-sm font-semibold text-white truncate">{item.title}</h3>
                {item.videoTitle && (
                  <p className="text-[10px] text-white/40 truncate">{item.videoTitle}</p>
                )}
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
        </div>

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
                      <Image src={it.videoThumbnail} alt="" fill sizes="56px" className="object-cover" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white/40">{i + 1}</span>
                    )}
                    <span className="absolute bottom-0 right-0 bg-black/75 text-[8px] font-mono px-0.5 rounded-tl text-white/80">
                      {it.type === "slide" ? (it.endTimestamp ?? 5) + "s" : formatTs(it.timestamp)}
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
      </div>
    </div>
  );
}
