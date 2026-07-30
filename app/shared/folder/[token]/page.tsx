"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";

interface VideoData {
  id: number;
  youtubeUrl: string;
  youtubeId: string;
  title: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  annotationCount: number;
}

interface FolderData {
  id: number;
  name: string;
  description: string | null;
  videos: VideoData[];
}

interface SharedAnnotation {
  id: number;
  videoId: number;
  timestampStart: number;
  timestampEnd: number;
  label: string;
  tags: string[];
  note: string | null;
  createdBy: string;
  createdAt: string;
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  loadVideoById(videoId: string, startSeconds: number): void;
  cueVideoById(videoId: string, startSeconds: number): void;
}

declare global {
  interface Window {
    YT: { Player: new (id: string | HTMLElement, config: Record<string, unknown>) => YTPlayer };
    onYouTubeIframeAPIReady: () => void;
  }
}

export default function SharedFolderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedVideo, setSelectedVideo] = useState<VideoData | null>(null);
  const [annotations, setAnnotations] = useState<SharedAnnotation[]>([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);

  // Annotation form
  const [authorName, setAuthorName] = useState("");
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // YT Player
  const playerRef = useRef<YTPlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const timeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function init() {
      const p = await params;
      setToken(p.token);
    }
    init();
  }, [params]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/shared/folder/${token}`);
        if (!res.ok) {
          setError("Folder not found");
          return;
        }
        const data = await res.json();
        setFolder(data);
      } catch {
        setError("Failed to load folder");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const loadAnnotations = useCallback(async (videoId: number) => {
    if (!token) return;
    setAnnotationsLoading(true);
    try {
      const res = await fetch(`/api/shared/folder/${token}/annotations?videoId=${videoId}`);
      if (res.ok) setAnnotations(await res.json());
    } finally {
      setAnnotationsLoading(false);
    }
  }, [token]);

  function selectVideo(video: VideoData) {
    setSelectedVideo(video);
    setPlayerReady(false);
    playerRef.current = null;
    setAnnotations([]);
    loadAnnotations(video.id);
    setStartSec(0);
    setEndSec(0);
    setNote("");
  }

  // YT IFrame API init
  useEffect(() => {
    const container = playerContainerRef.current;
    const ytId = selectedVideo?.youtubeId;
    if (!container || playerRef.current || !ytId) return;
    let destroyed = false;

    function createPlayer() {
      if (destroyed || playerRef.current || !container) return;
      try {
        new window.YT.Player(container, {
          videoId: ytId,
          playerVars: { autoplay: 0, modestbranding: 1, rel: 0, controls: 1, enablejsapi: 1 },
          events: {
            onReady: (e: { target: YTPlayer }) => {
              if (destroyed) return;
              playerRef.current = e.target;
              setDuration(e.target.getDuration());
              setPlayerReady(true);
            },
            onStateChange: (e: { data: number }) => {
              if (destroyed) return;
              const playing = e.data === 1;
              setIsPlaying(playing);
              if (playing) {
                if (timeIntervalRef.current) clearInterval(timeIntervalRef.current);
                timeIntervalRef.current = setInterval(() => {
                  if (playerRef.current) setCurrentTime(playerRef.current.getCurrentTime());
                }, 250);
              } else {
                if (timeIntervalRef.current) { clearInterval(timeIntervalRef.current); timeIntervalRef.current = null; }
                if (playerRef.current) setCurrentTime(playerRef.current.getCurrentTime());
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
      return () => { destroyed = true; if (timeIntervalRef.current) clearInterval(timeIntervalRef.current); };
    }

    const poll = setInterval(() => {
      if (!destroyed && window.YT && window.YT.Player) { clearInterval(poll); createPlayer(); }
    }, 100);

    return () => { destroyed = true; clearInterval(poll); if (timeIntervalRef.current) clearInterval(timeIntervalRef.current); };
  }, [selectedVideo]);

  function seekTo(seconds: number) {
    playerRef.current?.seekTo(seconds, true);
    setCurrentTime(seconds);
  }

  function playSegment(start: number, end: number) {
    const p = playerRef.current;
    if (!p) { seekTo(start); return; }
    p.seekTo(start, true);
    setCurrentTime(start);
    p.playVideo();
    const check = setInterval(() => {
      const t = p.getCurrentTime();
      if (t >= end || t < start - 0.5) { p.pauseVideo(); clearInterval(check); }
    }, 200);
  }

  function markStart() {
    const t = playerRef.current ? playerRef.current.getCurrentTime() : currentTime;
    setStartSec(t);
  }

  function markEnd() {
    const t = playerRef.current ? playerRef.current.getCurrentTime() : currentTime;
    setEndSec(t);
  }

  async function handleAddAnnotation(e: React.FormEvent) {
    e.preventDefault();
    if (!authorName.trim() || !startSec || !endSec || !token || !selectedVideo) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/shared/folder/${token}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: selectedVideo.id,
          name: authorName.trim(),
          timestampStart: startSec,
          timestampEnd: endSec,
          note: note.trim() || null,
        }),
      });
      if (res.ok) {
        setStartSec(0);
        setEndSec(0);
        setNote("");
        await loadAnnotations(selectedVideo.id);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (error || !folder) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="w-16 h-16 rounded-2xl bg-surface-hover border border-border flex items-center justify-center">
          <svg className="w-8 h-8 text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-foreground">Folder not found</h1>
        <p className="text-sm text-muted">This shared folder may have been removed or the link is invalid.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 shrink-0">
        <div className="mx-auto w-full max-w-6xl">
          {selectedVideo ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setSelectedVideo(null); setPlayerReady(false); playerRef.current = null; }}
                className="shrink-0 p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold truncate">{selectedVideo.title ?? "Untitled"}</h1>
                <p className="text-[10px] text-muted">{folder.name}</p>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-xl font-semibold">{folder.name}</h1>
              {folder.description && (
                <p className="text-sm text-muted mt-0.5">{folder.description}</p>
              )}
              <p className="text-[10px] text-muted/60 mt-1">
                {folder.videos.length} video{folder.videos.length !== 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-6">
        {selectedVideo ? (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Player */}
            <div className="flex-1 min-w-0">
              <div className="aspect-video w-full rounded-xl overflow-hidden border border-border bg-black shadow-sm relative">
                <div ref={playerContainerRef} className="w-full h-full" />
                {!playerReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black">
                    <div className="flex items-center gap-3 text-white/60">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
                      <span className="text-sm">Loading player...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Player controls */}
              {playerReady && (
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isPlaying ? "bg-emerald-500 animate-pulse" : "bg-muted/40"}`} />
                    <span className="text-lg font-mono font-semibold tabular-nums tracking-tight">
                      {formatTs(currentTime)}
                    </span>
                    <span className="text-xs text-muted">/</span>
                    <span className="text-xs font-mono text-muted tabular-nums">
                      {formatTs(duration)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => seekTo(Math.max(0, currentTime - 10))}
                      className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                      title="Back 10s">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                      </svg>
                    </button>
                    <button onClick={() => {
                      if (!playerRef.current) return;
                      const state = playerRef.current.getPlayerState();
                      if (state === 1) playerRef.current.pauseVideo();
                      else playerRef.current.playVideo();
                    }}
                      className="p-2 rounded-lg bg-accent text-white hover:bg-accent-hover active:scale-95 transition-all">
                      {isPlaying ? (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                      ) : (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      )}
                    </button>
                    <button onClick={() => seekTo(Math.min(duration, currentTime + 10))}
                      className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                      title="Forward 10s">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* Scrubber */}
              {playerReady && duration > 0 && (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted tabular-nums">0:00</span>
                    <div className="flex-1 h-1.5 rounded-full bg-border/60 relative">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-accent/30"
                        style={{ width: `${(currentTime / duration) * 100}%` }} />
                      <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent border-2 border-background shadow-sm"
                        style={{ left: `calc(${(currentTime / duration) * 100}% - 6px)` }} />
                    </div>
                    <span className="text-[10px] font-mono text-muted tabular-nums">{formatTs(duration)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Annotation panel */}
            <div className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
              {/* Form */}
              <div className="rounded-xl border border-border bg-surface p-3">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Add Annotation</h3>
                <form onSubmit={handleAddAnnotation} className="space-y-2.5">
                  <input
                    type="text"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder="Your name"
                    required
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="text-[9px] text-muted/60 mb-0.5">Start</div>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={formatTs(startSec)}
                          readOnly
                          className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-mono text-accent tabular-nums"
                        />
                        <button type="button" onClick={markStart}
                          className="text-[9px] text-accent hover:text-accent-hover shrink-0 px-1.5 py-1 rounded hover:bg-accent/5 transition-colors">
                          now
                        </button>
                      </div>
                    </div>
                    <span className="text-muted/30 mt-4">–</span>
                    <div className="flex-1">
                      <div className="text-[9px] text-muted/60 mb-0.5">End</div>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={formatTs(endSec)}
                          readOnly
                          className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-mono text-accent tabular-nums"
                        />
                        <button type="button" onClick={markEnd}
                          className="text-[9px] text-accent hover:text-accent-hover shrink-0 px-1.5 py-1 rounded hover:bg-accent/5 transition-colors">
                          now
                        </button>
                      </div>
                    </div>
                  </div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note..."
                    rows={2}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none resize-none"
                  />
                  <button
                    type="submit"
                    disabled={saving || !authorName.trim() || !startSec || !endSec}
                    className="w-full rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {saving ? "Saving..." : "Save Annotation"}
                  </button>
                </form>
              </div>

              {/* Annotation feed */}
              <div className="flex-1 min-h-0">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  Annotations
                  <span className="text-[10px] text-muted/50 font-normal">{annotations.length}</span>
                </h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {annotationsLoading && (
                    <div className="flex items-center justify-center py-6">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    </div>
                  )}
                  {!annotationsLoading && annotations.length === 0 && (
                    <p className="text-xs text-muted/60 text-center py-6">No annotations yet. Play the video and add one!</p>
                  )}
                  {annotations.map((a) => (
                    <div key={a.id}
                      className="rounded-lg border border-border/60 bg-surface p-2.5 hover:bg-surface-hover/50 transition-colors cursor-pointer"
                      onClick={() => playSegment(a.timestampStart, a.timestampEnd)}
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[10px] font-semibold text-accent/80 truncate">{a.createdBy}</span>
                        <span className="text-[9px] font-mono text-muted/50 tabular-nums shrink-0">
                          {formatTs(a.timestampStart)} – {formatTs(a.timestampEnd)}
                        </span>
                      </div>
                      {a.note && (
                        <p className="text-[10px] text-muted/80 line-clamp-2">{a.note}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : folder.videos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-20 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-hover border border-border flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-sm text-muted">This folder is empty.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {folder.videos.map((v) => (
              <button
                key={v.id}
                onClick={() => selectVideo(v)}
                className="group rounded-xl border border-border bg-surface hover:border-accent/50 hover:bg-surface-hover/30 transition-all overflow-hidden text-left"
              >
                <div className="aspect-video w-full overflow-hidden bg-muted relative">
                  {v.thumbnailUrl ? (
                    <Image src={v.thumbnailUrl} alt={v.title ?? "Video"} fill className="object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-10 h-10 text-muted/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <h3 className="text-sm font-medium line-clamp-2">{v.title ?? "Untitled"}</h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    {v.annotationCount > 0 && (
                      <span className="text-[10px] font-medium text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">
                        {v.annotationCount} annotation{v.annotationCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <style jsx global>{`
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 4px; }
      `}</style>
    </div>
  );
}
