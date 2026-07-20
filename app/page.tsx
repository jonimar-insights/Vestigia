"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

// YouTube IFrame API types (local to this file)
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

interface Video {
  id: number;
  youtubeUrl: string;
  youtubeId: string;
  title: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
}

interface PlaylistVideo {
  id: string;
  title: string;
  thumbnail: string;
  position: number;
}

interface SearchResult {
  type: "annotation" | "scene" | "key_moment";
  videoId: number;
  videoTitle: string | null;
  videoThumbnail: string | null;
  timestamp: number;
  endTimestamp: number | null;
  title: string;
  detail: string | null;
  tags?: string[];
}

interface Cliplist {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
}

interface ClipItem {
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

interface CliplistWithItems extends Cliplist {
  items: ClipItem[];
}

type Tab = "import" | "search" | "cliplists";

function isPlaylistUrl(u: string) {
  return /[?&]list=/.test(u);
}

function formatTs(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function highlight(text: string, query: string) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query})`, "gi"));
  return (
    <>{
      parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-600">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )
    }</>
  );
}

// ── Video Playlist Player ──
function VideoPlaylistPlayer({ items, onClose }: { items: ClipItem[]; onClose: () => void }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<YTPlayer | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const timeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const item = items[currentIdx];

  // Load the data for the current video(s) - we need youtubeId for each
  const [videoIds, setVideoIds] = useState<Map<number, string>>(new Map());

  // Track which video IDs we've already fetched to avoid repeated calls
  const fetchedIdsRef = useRef<Set<number>>(new Set());

  // Track the last videoId we loaded and prevent double-advance
  const lastVideoIdRef = useRef<string | null>(null);
  const advancedRef = useRef(false);

  // Load video youtubeIds (only for videos not already fetched)
  useEffect(() => {
    const uniqueIds = [...new Set(items.map((i) => i.videoId))];
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
  }, [items]); // eslint-disable-line

  function clearTimeInterval() {
    if (timeIntervalRef.current) { clearInterval(timeIntervalRef.current); timeIntervalRef.current = null; }
  }

  // Playback effect - loads/seeks video when currentIdx changes
  useEffect(() => {
    if (!playerReady || !playerRef.current || !item) return;
    const ytId = videoIds.get(item.videoId);
    if (!ytId) return;

    // Same video - just seek
    if (lastVideoIdRef.current === ytId) {
      try {
        playerRef.current.seekTo(item.timestamp, true);
        playerRef.current.playVideo();
      } catch {}
      return;
    }

    // Different video
    advancedRef.current = false;
    clearTimeInterval();
    setCurrentTime(item.timestamp);

    let poll: ReturnType<typeof setInterval> | null = null;
    const load = () => {
      if (!playerRef.current) return;
      lastVideoIdRef.current = ytId;
      try { playerRef.current.loadVideoById(ytId, item.timestamp); } catch {}
    };

    try {
      const state = playerRef.current.getPlayerState();
      if (state === 3) {
        poll = setInterval(() => {
          try {
            if (!playerRef.current) { if (poll) clearInterval(poll); return; }
            if (playerRef.current.getPlayerState() !== 3) {
              if (poll) clearInterval(poll);
              load();
            }
          } catch { if (poll) clearInterval(poll); }
        }, 100);
      } else {
        load();
      }
    } catch {
      load();
    }

    return () => { if (poll) clearInterval(poll); };
  }, [currentIdx, playerReady, item?.videoId, item?.timestamp]); // eslint-disable-line

  // YouTube IFrame setup
  useEffect(() => {
    const container = playerContainerRef.current;
    if (!container || playerRef.current) return;
    const firstItem = items[0];
    const firstYtId = firstItem ? videoIds.get(firstItem.videoId) : undefined;
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
              if (firstItem && playerRef.current) {
                playerRef.current.seekTo(firstItem.timestamp, true);
              }
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
              // Auto-advance when video ends naturally (state 0)
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
  }, [videoIds]); // eslint-disable-line

  // Monitor endTime to advance to next item
  useEffect(() => {
    if (!playing || !item || !currentTime || !playerRef.current) return;
    try {
      if (playerRef.current.getPlayerState() !== 1) return;
    } catch { return; }
    const end = item.endTimestamp ?? (item.timestamp + 30);
    if (currentTime >= end) {
      advancedRef.current = true;
      if (currentIdx < items.length - 1) {
        setCurrentIdx((prev) => prev + 1);
      } else {
        setCurrentIdx(0);
      }
    }
  }, [currentTime, playing]); // eslint-disable-line

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
        {/* Left: Player */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
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

          {/* Video player */}
          <div className="aspect-video mx-auto w-full max-w-4xl bg-black">
            <div ref={playerContainerRef} className="w-full h-full" />
            {(!playerReady || !ytId) && (
              <div className="flex items-center justify-center h-full">
                <div className="flex items-center gap-2 text-white/40">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                  <span className="text-xs">Loading player...</span>
                </div>
              </div>
            )}
          </div>

          {/* Item info + controls */}
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

        {/* Right: Playlist */}
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

export default function Home() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>("import");

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [fetching, setFetching] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [playlistVideos, setPlaylistVideos] = useState<PlaylistVideo[]>([]);
  const [playlistSelected, setPlaylistSelected] = useState<Set<string>>(new Set());
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistImporting, setPlaylistImporting] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  // ── Cliplist state ──
  const [cliplists, setCliplists] = useState<Cliplist[]>([]);
  const [cliplistsLoading, setCliplistsLoading] = useState(false);
  const [selectedCliplist, setSelectedCliplist] = useState<CliplistWithItems | null>(null);
  const [showCreateCliplist, setShowCreateCliplist] = useState(false);
  const [newCliplistName, setNewCliplistName] = useState("");
  const [newCliplistDesc, setNewCliplistDesc] = useState("");
  const [creatingCliplist, setCreatingCliplist] = useState(false);
  const [slideshowItems, setSlideshowItems] = useState<ClipItem[] | null>(null);

  // "Add to cliplist" dropdown per search result
  const [addToDropdown, setAddToDropdown] = useState<{ index: number; open: boolean }>({ index: -1, open: false });
  const addToRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const openIdx = addToDropdown.index;
      if (openIdx < 0) return;
      const ref = addToRefs.current.get(openIdx);
      if (ref && !ref.contains(e.target as Node)) {
        setAddToDropdown({ index: -1, open: false });
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [addToDropdown.index]);

  const loadVideos = useCallback(async () => {
    try {
      const res = await fetch("/api/videos");
      if (res.ok) setVideos(await res.json());
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // ── Load cliplists ──
  const loadCliplists = useCallback(async () => {
    setCliplistsLoading(true);
    try {
      const res = await fetch("/api/cliplists");
      if (res.ok) setCliplists(await res.json());
    } finally {
      setCliplistsLoading(false);
    }
  }, []);

  // Load cliplists when switching to the cliplists tab
  const switchToTab = useCallback((newTab: Tab) => {
    setTab(newTab);
    if (newTab === "cliplists") loadCliplists();
  }, [loadCliplists]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);

    if (isPlaylistUrl(url.trim())) {
      await fetchPlaylist(url.trim());
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add video");
      }
      setUrl("");
      await loadVideos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this video and all its annotations?")) return;
    await fetch(`/api/videos/${id}`, { method: "DELETE" });
    await loadVideos();
  }

  async function fetchPlaylist(playlistUrl: string) {
    setPlaylistLoading(true);
    setPlaylistError(null);
    setPlaylistVideos([]);
    setPlaylistSelected(new Set());
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch playlist");
      }
      const data = await res.json();
      setPlaylistVideos(data.videos);
      setPlaylistSelected(new Set(data.videos.map((v: PlaylistVideo) => v.id)));
    } catch (err) {
      setPlaylistError(err instanceof Error ? err.message : "Failed to fetch playlist");
    } finally {
      setPlaylistLoading(false);
    }
  }

  function togglePlaylistVideo(id: string) {
    setPlaylistSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (playlistSelected.size === playlistVideos.length) {
      setPlaylistSelected(new Set());
    } else {
      setPlaylistSelected(new Set(playlistVideos.map((v) => v.id)));
    }
  }

  function cancelPlaylist() {
    setPlaylistVideos([]);
    setPlaylistSelected(new Set());
    setPlaylistError(null);
    setUrl("");
  }

  async function importSelectedVideos() {
    const toImport = playlistVideos.filter((v) => playlistSelected.has(v.id));
    if (!toImport.length) return;
    setPlaylistImporting(true);
    try {
      for (const v of toImport) {
        await fetch("/api/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${v.id}` }),
        });
      }
      setPlaylistVideos([]);
      setPlaylistSelected(new Set());
      setUrl("");
      await loadVideos();
    } finally {
      setPlaylistImporting(false);
    }
  }

  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  function handleSearch(q: string) {
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results);
        }
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  // ── Cliplist actions ──
  async function handleCreateCliplist(e: React.FormEvent) {
    e.preventDefault();
    if (!newCliplistName.trim()) return;
    setCreatingCliplist(true);
    try {
      const res = await fetch("/api/cliplists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCliplistName.trim(), description: newCliplistDesc.trim() || null }),
      });
      if (res.ok) {
        setNewCliplistName("");
        setNewCliplistDesc("");
        setShowCreateCliplist(false);
        await loadCliplists();
      }
    } finally {
      setCreatingCliplist(false);
    }
  }

  async function addToCliplist(cliplistId: number, result: SearchResult, index: number) {
    try {
      await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: result.type,
          videoId: result.videoId,
          timestamp: result.timestamp,
          endTimestamp: result.endTimestamp,
          title: result.title,
          detail: result.detail,
          tags: result.tags,
        }),
      });
      setAddToDropdown({ index: -1, open: false });
      // Refresh cliplists if on that tab
      if (tab === "cliplists") loadCliplists();
    } catch {}
  }

  async function openCliplist(id: number) {
    try {
      const res = await fetch(`/api/cliplists/${id}`);
      if (res.ok) setSelectedCliplist(await res.json());
    } catch {}
  }

  async function deleteCliplist(id: number) {
    if (!confirm("Delete this cliplist and all its items?")) return;
    await fetch(`/api/cliplists/${id}`, { method: "DELETE" });
    if (selectedCliplist?.id === id) setSelectedCliplist(null);
    await loadCliplists();
  }

  async function removeClipItem(cliplistId: number, itemId: number) {
    await fetch(`/api/cliplists/${cliplistId}/items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    if (selectedCliplist?.id === cliplistId) {
      setSelectedCliplist((prev) => {
        if (!prev) return prev;
        return { ...prev, items: prev.items.filter((i) => i.id !== itemId) };
      });
    }
    await loadCliplists();
  }

  const playlistActive = playlistVideos.length > 0 || playlistLoading;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border px-6 py-4 shrink-0">
        <div className="mx-auto max-w-5xl flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">MARGINALIA: Vestigia</h1>
            <p className="text-sm text-muted">Import, annotate, and search video content</p>
          </div>
          {session?.user && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted">{session.user.name}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/signin" })}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-hover"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-5xl w-full px-6 pt-6">
        <nav className="flex gap-1 border-b border-border">
          {([
            { key: "import", label: "Import", icon: "+" },
            { key: "search", label: "Search", icon: "\u2315" },
            { key: "cliplists", label: "Cliplists", icon: "\ud83d\udccb" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => switchToTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              <span className="mr-1.5">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <main className="mx-auto max-w-5xl w-full px-6 py-6 flex-1">
        {/* ── IMPORT TAB ── */}
        {tab === "import" && (
          <div>
            <form onSubmit={handleSubmit} className="mb-6">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste a YouTube URL or playlist link..."
                  className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  disabled={loading || playlistLoading}
                />
                <button
                  type="submit"
                  disabled={loading || playlistLoading || !url.trim()}
                  className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Adding..." : playlistLoading ? "Loading..." : "Import"}
                </button>
              </div>
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </form>

            {/* ── INLINE PLAYLIST ── */}
            {playlistActive && (
              <div className="mb-6 rounded-lg border border-border bg-surface">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <h3 className="text-sm font-medium">
                    {playlistLoading ? "Loading playlist..." : `${playlistVideos.length} videos in playlist`}
                  </h3>
                  <button onClick={cancelPlaylist} className="text-xs text-muted hover:text-foreground transition-colors">
                    Cancel
                  </button>
                </div>

                {playlistError && <p className="px-4 py-2 text-xs text-danger">{playlistError}</p>}

                {!playlistLoading && playlistVideos.length > 0 && (
                  <>
                    <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
                      <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={playlistSelected.size === playlistVideos.length}
                          onChange={toggleSelectAll}
                          className="rounded border-border accent-accent"
                        />
                        {playlistSelected.size}/{playlistVideos.length} selected
                      </label>
                      <button
                        onClick={importSelectedVideos}
                        disabled={playlistImporting || playlistSelected.size === 0}
                        className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {playlistImporting
                          ? "Importing..."
                          : `Import ${playlistSelected.size} video${playlistSelected.size !== 1 ? "s" : ""}`}
                      </button>
                    </div>

                    <div className="max-h-96 overflow-y-auto divide-y divide-border/50">
                      {playlistVideos.map((v) => (
                        <label
                          key={v.id}
                          className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                            playlistSelected.has(v.id) ? "bg-accent/5" : "hover:bg-surface-hover/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={playlistSelected.has(v.id)}
                            onChange={() => togglePlaylistVideo(v.id)}
                            className="rounded border-border accent-accent shrink-0"
                          />
                          <img
                            src={v.thumbnail}
                            alt={v.title}
                            className="w-24 h-14 object-cover rounded shrink-0"
                          />
                          <span className="text-xs text-foreground line-clamp-2">{v.title}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {fetching ? (
              <p className="text-center text-muted py-12">Loading videos...</p>
            ) : videos.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-16 text-center">
                <p className="text-muted">No videos yet. Paste a YouTube URL above to get started.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {videos.map((video) => (
                  <Link
                    key={video.id}
                    href={`/video/${video.id}`}
                    className="group rounded-lg border border-border bg-surface hover:border-accent/50 transition-colors overflow-hidden"
                  >
                    {video.thumbnailUrl && (
                      <div className="aspect-video w-full overflow-hidden bg-muted">
                        <img
                          src={video.thumbnailUrl}
                          alt={video.title ?? "Video"}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                    )}
                    <div className="p-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium line-clamp-2">{video.title ?? "Untitled"}</h3>
                        <p className="text-xs text-muted mt-1 truncate">{video.youtubeId}</p>
                      </div>
                      <button
                        onClick={(e) => { e.preventDefault(); handleDelete(video.id); }}
                        className="shrink-0 text-muted hover:text-danger transition-colors p-1 rounded"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SEARCH TAB ── */}
        {tab === "search" && (
          <div>
            <div className="relative mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search annotations, scenes, key moments..."
                autoFocus
                className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <p className="text-sm text-muted text-center py-8">No results found</p>
            )}

            {searchResults.length > 0 && (
              <div className="space-y-2">
                {searchResults.map((r, i) => (
                  <div key={i} className="group relative flex items-center gap-4 p-3 rounded-lg border border-border bg-surface hover:border-accent/50 transition-colors">
                    <Link
                      href={`/video/${r.videoId}#t=${Math.floor(r.timestamp)}`}
                      className="flex items-center gap-4 flex-1 min-w-0"
                    >
                      {r.videoThumbnail && (
                        <div className="relative shrink-0">
                          <img src={r.videoThumbnail} alt="" className="w-28 h-16 object-cover rounded" />
                          <span className="absolute bottom-1 right-1 text-[10px] bg-black/75 text-white px-1 py-0.5 rounded">
                            {formatTs(r.timestamp)}
                          </span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                            {r.type.replace("_", " ")}
                          </span>
                          <span className="text-sm font-medium truncate">{highlight(r.title, searchQuery)}</span>
                        </div>
                        {r.detail && (
                          <p className="text-xs text-muted mt-0.5 line-clamp-1">{highlight(r.detail, searchQuery)}</p>
                        )}
                        {r.tags && r.tags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {r.tags.slice(0, 4).map((tag) => (
                              <span key={tag} className="text-[10px] bg-surface-hover rounded px-1.5 py-0.5">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted shrink-0 truncate max-w-[160px]">
                        {r.videoTitle}
                      </p>
                    </Link>

                    {/* Add to cliplist button */}
                    <div ref={(el) => { if (el) addToRefs.current.set(i, el); else addToRefs.current.delete(i); }} className="relative shrink-0">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Load cliplists if not loaded
                          if (cliplists.length === 0) {
                            fetch("/api/cliplists").then((res) => res.ok && res.json()).then((data) => setCliplists(data));
                          }
                          setAddToDropdown({ index: i, open: addToDropdown.index === i ? !addToDropdown.open : true });
                        }}
                        className="p-1.5 rounded text-muted hover:text-accent hover:bg-accent/10 transition-all opacity-0 group-hover:opacity-100"
                        title="Add to cliplist"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </button>

                      {addToDropdown.open && addToDropdown.index === i && (
                        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-border bg-surface shadow-xl z-50 py-1 max-h-60 overflow-y-auto">
                          <div className="px-3 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider">
                            Add to cliplist
                          </div>
                          {cliplists.length === 0 ? (
                            <div className="px-3 py-2 text-[10px] text-muted">No cliplists yet</div>
                          ) : (
                            cliplists.map((cl) => (
                              <button
                                key={cl.id}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  addToCliplist(cl.id, r, i);
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors flex items-center justify-between"
                              >
                                <span className="truncate">{cl.name}</span>
                                <span className="text-[9px] text-muted shrink-0 ml-2">{cl.itemCount}</span>
                              </button>
                            ))
                          )}
                          <div className="border-t border-border/50 mt-1 pt-1">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setShowCreateCliplist(true);
                                setAddToDropdown({ index: -1, open: false });
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs text-accent hover:bg-accent/10 transition-colors"
                            >
                              + New cliplist
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CLIPLISTS TAB ── */}
        {tab === "cliplists" && (
          <div>
            {/* Header + Create button */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
                {cliplistsLoading ? "Loading..." : `${cliplists.length} cliplist${cliplists.length !== 1 ? "s" : ""}`}
              </h2>
              <button
                onClick={() => setShowCreateCliplist(true)}
                className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-all flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                New Cliplist
              </button>
            </div>

            {/* Create cliplist form */}
            {showCreateCliplist && (
              <div className="mb-6 rounded-xl border border-accent/30 bg-surface p-4 shadow-sm">
                <form onSubmit={handleCreateCliplist}>
                  <input
                    type="text"
                    value={newCliplistName}
                    onChange={(e) => setNewCliplistName(e.target.value)}
                    placeholder="Cliplist name"
                    autoFocus
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none mb-2"
                  />
                  <input
                    type="text"
                    value={newCliplistDesc}
                    onChange={(e) => setNewCliplistDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none mb-3"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={creatingCliplist || !newCliplistName.trim()}
                      className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all"
                    >
                      {creatingCliplist ? "Creating..." : "Create"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowCreateCliplist(false); setNewCliplistName(""); setNewCliplistDesc(""); }}
                      className="rounded-lg border border-border px-4 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {cliplistsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : cliplists.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-16 text-center">
                <p className="text-muted text-sm">No cliplists yet.</p>
                <p className="text-xs text-muted/60 mt-1">Create one to start saving search results.</p>
              </div>
            ) : selectedCliplist ? (
              /* ── Single cliplist view ── */
              <div>
                <button
                  onClick={() => setSelectedCliplist(null)}
                  className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors mb-4"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  Back to all cliplists
                </button>

                <div className="rounded-xl border border-border bg-surface overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div>
                      <h3 className="text-sm font-semibold">{selectedCliplist.name}</h3>
                      {selectedCliplist.description && (
                        <p className="text-[10px] text-muted mt-0.5">{selectedCliplist.description}</p>
                      )}
                      <p className="text-[10px] text-muted/50 mt-0.5">{selectedCliplist.items.length} item{selectedCliplist.items.length !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedCliplist.items.length > 0 && (
                        <button
                          onClick={() => setSlideshowItems(selectedCliplist.items)}
                          className="rounded-lg bg-accent px-3 py-1.5 text-[10px] font-medium text-white hover:bg-accent-hover active:scale-95 transition-all flex items-center gap-1.5"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          Play
                        </button>
                      )}
                      <button
                        onClick={() => deleteCliplist(selectedCliplist.id)}
                        className="text-xs text-danger/60 hover:text-danger transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {selectedCliplist.items.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-muted">No items in this cliplist</div>
                  ) : (
                    <div className="divide-y divide-border/50 max-h-[60vh] overflow-y-auto">
                      {selectedCliplist.items.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover/50 transition-colors group/item">
                          {item.videoThumbnail && (
                            <div className="relative shrink-0">
                              <img src={item.videoThumbnail} alt="" className="w-20 h-12 object-cover rounded" />
                              <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/75 text-white px-0.5 rounded">
                                {formatTs(item.timestamp)}
                              </span>
                            </div>
                          )}
                          <Link
                            href={`/video/${item.videoId}#t=${Math.floor(item.timestamp)}`}
                            className="min-w-0 flex-1"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] uppercase font-medium text-accent bg-accent/10 px-1 py-0.5 rounded shrink-0">
                                {item.type.replace("_", " ")}
                              </span>
                              <span className="text-xs font-medium truncate">{item.title}</span>
                            </div>
                            {item.detail && (
                              <p className="text-[10px] text-muted mt-0.5 line-clamp-1">{item.detail}</p>
                            )}
                            {item.videoTitle && (
                              <p className="text-[9px] text-muted/50 mt-0.5 truncate">{item.videoTitle}</p>
                            )}
                          </Link>
                          <button
                            onClick={() => removeClipItem(selectedCliplist.id, item.id)}
                            className="p-1 rounded text-muted/40 hover:text-danger hover:bg-danger/10 transition-all opacity-0 group-hover/item:opacity-100"
                            title="Remove from cliplist"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ── Cliplist grid ── */
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cliplists.map((cl) => (
                  <button
                    key={cl.id}
                    onClick={() => openCliplist(cl.id)}
                    className="group rounded-xl border border-border bg-surface hover:border-accent/50 hover:bg-surface-hover/30 transition-all text-left p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold truncate group-hover:text-accent transition-colors">{cl.name}</h3>
                        {cl.description && (
                          <p className="text-[10px] text-muted mt-0.5 line-clamp-2">{cl.description}</p>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-muted/50 shrink-0 mt-0.5">{cl.itemCount}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-3 text-[9px] text-muted/40">
                      <span>{new Date(cl.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Video Playlist overlay ── */}
      {slideshowItems && (
        <VideoPlaylistPlayer items={slideshowItems} onClose={() => setSlideshowItems(null)} />
      )}
    </div>
  );
}
