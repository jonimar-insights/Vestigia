"use client";

import { useState, useEffect, useRef } from "react";

export interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  loadVideoById(videoId: string, startSeconds: number): void;
  cueVideoById(videoId: string, startSeconds: number): void;
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
  const fetchedIdsRef = useRef<Set<number>>(new Set());
  const lastVideoIdRef = useRef<string | null>(null);
  const advancedRef = useRef(false);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            return { videoId: vid, youtubeId: data.youtubeId };
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
    });
  }, [items]);

  useEffect(() => {
    if (item?.type === "slide") {
      clearTimeInterval();
      const ms = (item.endTimestamp ?? 5) * 1000;
      slideTimerRef.current = setTimeout(() => {
        setCurrentIdx((prev) => (prev < items.length - 1 ? prev + 1 : 0));
      }, ms);
      return () => { if (slideTimerRef.current) clearTimeout(slideTimerRef.current); };
    }
  }, [currentIdx, item?.type]);

  function clearTimeInterval() {
    if (timeIntervalRef.current) { clearInterval(timeIntervalRef.current); timeIntervalRef.current = null; }
  }

  useEffect(() => {
    if (!playerReady || !playerRef.current || !item || item?.type === "slide") return;
    const ytId = videoIds.get(item.videoId);
    if (!ytId) return;

    advancedRef.current = false;
    clearTimeInterval();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync displayed time to clip start when switching clips
    setCurrentTime(item.timestamp);
    lastVideoIdRef.current = ytId;

    try {
      playerRef.current.loadVideoById(ytId, item.timestamp);
      playerRef.current.playVideo();
    } catch {}
  }, [currentIdx, playerReady, item?.videoId, item?.timestamp, item?.type, videoIds]);

  useEffect(() => {
    const container = playerContainerRef.current;
    if (!container || playerRef.current) return;
    const firstVideoItem = items.find((i) => i.videoId > 0);
    const firstYtId = firstVideoItem ? videoIds.get(firstVideoItem.videoId) : undefined;
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
              const state = e.data;
              const pl = state === 1;
              setPlaying(pl);
              if (pl) {
                if (timeIntervalRef.current) clearInterval(timeIntervalRef.current);
                timeIntervalRef.current = setInterval(() => {
                  try {
                    if (playerRef.current && playerRef.current.getPlayerState() === 1) {
                      setCurrentTime(playerRef.current.getCurrentTime());
                    }
                  } catch {}
                }, 250);
              } else {
                if (timeIntervalRef.current) { clearInterval(timeIntervalRef.current); timeIntervalRef.current = null; }
              }
              if (state === 0) {
                if (advancedRef.current) {
                  advancedRef.current = false;
                } else {
                  setCurrentIdx((prev) => (prev < items.length - 1 ? prev + 1 : 0));
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
  }, [videoIds]);

  useEffect(() => {
    if (!playing || !item || !currentTime || !playerRef.current) return;
    try {
      if (playerRef.current.getPlayerState() !== 1) return;
    } catch { return; }
    if (currentTime < item.timestamp) return;
    const end = item.endTimestamp ?? (item.timestamp + 30);
    if (currentTime >= end) {
      advancedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-advance to next clip when playback crosses its end
      setCurrentIdx((prev) => (prev < items.length - 1 ? prev + 1 : 0));
    }
  }, [currentTime, playing]);

  function goTo(idx: number) {
    if (idx < 0 || idx >= items.length) return;
    setCurrentIdx(idx);
  }

  function togglePlay() {
    if (!playerRef.current) return;
    try {
      const state = playerRef.current.getPlayerState();
      if (state === 1) playerRef.current.pauseVideo();
      else playerRef.current.playVideo();
    } catch {}
  }

  if (items.length === 0) return null;

  const ytId = videoIds.get(item.videoId);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={onClose}>
      <div className="flex flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 py-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={onClose} className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <span className="text-xs text-white/40 font-mono">
                {formatTs(currentTime)} / {item.endTimestamp ? formatTs(item.endTimestamp) : formatTs(item.timestamp + 30)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">{currentIdx + 1}/{items.length}</span>
            </div>
          </div>

          <div className="aspect-video mx-auto w-full max-w-4xl bg-black relative">
            <div ref={playerContainerRef} className="w-full h-full" />
            {(!playerReady || !ytId) && item?.type !== "slide" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <div className="flex items-center gap-2 text-white/40">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                  <span className="text-xs">Loading player...</span>
                </div>
              </div>
            )}
            {item?.type === "slide" && (
              <div className="absolute inset-0 flex items-center justify-center px-12 bg-black">
                <div className="text-center max-w-2xl">
                  <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500/20 to-accent/5 flex items-center justify-center border border-purple-500/10">
                    <svg className="w-8 h-8 text-purple-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1l2.5-1.5A1 1 0 0121 7v10a1 1 0 01-1.5.86L17 16v1a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-3">{item.title}</h2>
                  {item.detail && (
                    <p className="text-base text-white/60">{item.detail}</p>
                  )}
                  <div className="mt-8 flex items-center justify-center gap-2 text-white/30 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400/50 animate-pulse" />
                    Auto-advancing...
                  </div>
                </div>
              </div>
            )}
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
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => goTo(currentIdx - 1)} disabled={currentIdx === 0}
                  className="p-2 rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all" title="Previous">
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
                  className="p-2 rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all" title="Next">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="w-72 border-l border-white/10 bg-black/40 hidden md:flex flex-col shrink-0">
          <div className="px-3 py-2 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 shrink-0">
            Playlist
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.map((it, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`w-full text-left px-3 py-2 transition-colors flex items-center gap-2 ${
                  i === currentIdx ? "bg-accent/15 border-l-2 border-accent" : "hover:bg-white/5 border-l-2 border-transparent"
                }`}
              >
                <span className={`text-[10px] font-mono shrink-0 w-6 text-right ${
                  i === currentIdx ? "text-accent" : "text-white/30"
                }`}>
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className={`text-xs truncate ${i === currentIdx ? "text-white" : "text-white/60"}`}>{it.title}</p>
                  <p className="text-[9px] text-white/30 font-mono">{formatTs(it.timestamp)}{it.endTimestamp ? ` – ${formatTs(it.endTimestamp)}` : ""}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
