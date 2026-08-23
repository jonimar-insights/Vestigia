"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { formatTimestamp, sanitizeHtml, tokenizeNoteLinks } from "@/lib/youtube";
import { parseSocialStorageId, socialEmbedUrl } from "@/lib/social";
import { VimeoAdapter } from "@/lib/vimeo-adapter";

// YouTube IFrame API types
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
    Vimeo?: { Player: new (element: HTMLIFrameElement) => unknown };
  }
}

interface Annotation {
  id: number;
  videoId: number;
  timestampStart: number;
  timestampEnd: number;
  label: string;
  tags: string[];
  note: string | null;
  createdAt: string;
}

interface VideoData {
  id: number;
  youtubeUrl: string;
  youtubeId: string;
  platform?: string;
  title: string | null;
  thumbnailUrl: string | null;
  folderId: number | null;
  annotations: Annotation[];
}

function renderNote(text: string): string {
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
    .replace(/`(.+?)`/g, '<code class="bg-surface-hover rounded px-1 font-mono text-xs">$1</code>')
    .replace(/\n/g, "<br>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => anchors[Number(i)] ?? "");
}

const LABEL_COLORS: Record<string, { border: string; dot: string; badge: string; badgeText: string; ring: string }> = {
  formula:   { border: "border-l-blue-500",    dot: "bg-blue-500",    badge: "bg-blue-500/10",    badgeText: "text-blue-600 dark:text-blue-400",    ring: "ring-blue-500/20" },
  doubt:     { border: "border-l-amber-500",   dot: "bg-amber-500",   badge: "bg-amber-500/10",   badgeText: "text-amber-600 dark:text-amber-400",   ring: "ring-amber-500/20" },
  insight:   { border: "border-l-emerald-500", dot: "bg-emerald-500", badge: "bg-emerald-500/10", badgeText: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500/20" },
  summary:   { border: "border-l-violet-500",  dot: "bg-violet-500",  badge: "bg-violet-500/10",  badgeText: "text-violet-600 dark:text-violet-400",  ring: "ring-violet-500/20" },
  example:   { border: "border-l-rose-500",    dot: "bg-rose-500",    badge: "bg-rose-500/10",    badgeText: "text-rose-600 dark:text-rose-400",     ring: "ring-rose-500/20" },
  definition:{ border: "border-l-cyan-500",    dot: "bg-cyan-500",    badge: "bg-cyan-500/10",    badgeText: "text-cyan-600 dark:text-cyan-400",     ring: "ring-cyan-500/20" },
  note:      { border: "border-l-zinc-400",    dot: "bg-zinc-400",    badge: "bg-zinc-400/10",    badgeText: "text-zinc-600 dark:text-zinc-400",     ring: "ring-zinc-400/20" },
};

const ANNOTATION_EMOJIS: Record<string, string> = {
  Formula: "\ud83d\udccc", Doubt: "\u2753", Insight: "\ud83d\udca1", Summary: "\ud83d\udcdd",
  Example: "\ud83c\udfaf", Definition: "\ud83d\udcd6", Note: "\ud83d\udcac",
};

function getLabelColor(label: string) {
  const lower = label.toLowerCase();
  for (const [key, val] of Object.entries(LABEL_COLORS)) {
    if (lower.includes(key)) return val;
  }
  return LABEL_COLORS.note;
}

function getEmoji(label: string): string {
  return ANNOTATION_EMOJIS[label] ?? "\ud83d\udccc";
}

function parseTimeInput(value: string): number {
  if (!value) return 0;
  const parts = value.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

export default function VideoPage() {
  const { t, language, toggleLanguage } = useLanguage();
  const params = useParams();
  const router = useRouter();
  const videoId = params.id as string;

  const [video, setVideo] = useState<VideoData | null>(null);
  const [loading, setLoading] = useState(true);

  // Player state
  const playerRef = useRef<YTPlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Form
  const [startDisplay, setStartDisplay] = useState("");
  const [endDisplay, setEndDisplay] = useState("");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  // UI state
  const [feedCollapsed, setFeedCollapsed] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [hoveredMarker, setHoveredMarker] = useState<number | null>(null);
  const [scrubberDragging, setScrubberDragging] = useState(false);
  const [scrubberPos, setScrubberPos] = useState<number | null>(null);
  const [filterLabel, setFilterLabel] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLabel, setBulkLabel] = useState("");
  const [summaryMoments, setSummaryMoments] = useState<Array<{ timestamp: number; endTimestamp?: number; title: string; summary: string; importance: string }>>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  // Cliplist state
  const [cliplists, setCliplists] = useState<Array<{ id: number; name: string; itemCount: number }>>([]);
  const [videoCliplistItems, setVideoCliplistItems] = useState<Array<{ cliplistId: number; cliplistName: string; timestamp: number; endTimestamp: number | null; title: string | null }>>([]);
  const [keyMomentDropdown, setKeyMomentDropdown] = useState<{ index: number; open: boolean }>({ index: -1, open: false });
  const [annotCliplistDropdown, setAnnotCliplistDropdown] = useState<{ id: number; open: boolean }>({ id: -1, open: false });
  const [showCreateCliplist, setShowCreateCliplist] = useState(false);
  const [newCliplistName, setNewCliplistName] = useState("");
  const [creatingCliplist, setCreatingCliplist] = useState(false);
  const [pendingMomentIdx, setPendingMomentIdx] = useState<number | null>(null);
  const [momentSort, setMomentSort] = useState<"time" | "importance">("time");
  const [shareCopiedId, setShareCopiedId] = useState<number | null>(null);
  const [siblingVideos, setSiblingVideos] = useState<Array<{ id: number; title: string | null; thumbnailUrl: string | null }>>([]);
  const [panelRatio, setPanelRatio] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("annotationPanelRatio");
      if (saved) { const n = parseFloat(saved); if (!isNaN(n) && n >= 25 && n <= 75) return n; }
    }
    return 55;
  });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [translatedMoments, setTranslatedMoments] = useState<Map<number, { title: string; summary: string }>>(new Map());
  const [translatedAnnotations, setTranslatedAnnotations] = useState<Map<number, { label: string; note: string }>>(new Map());
  const [translating, setTranslating] = useState(false);
  const [translatedLang, setTranslatedLang] = useState<"pt" | "en" | null>(null);
  const dragStartX = useRef(0);
  const dragStartRatio = useRef(0);

  const handlePanelDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingPanel(true);
    dragStartX.current = e.clientX;
    dragStartRatio.current = panelRatio;
  }, [panelRatio]);

  const scrubberRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const timeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derived
  const uniqueLabels = useMemo(() => {
    if (!video) return [];
    return Array.from(new Set(video.annotations.map(a => a.label)));
  }, [video]);

  const displayedAnnotations = useMemo(() => {
    if (!video) return [];
    let list = video.annotations;
    if (filterLabel) list = list.filter(a => a.label === filterLabel);
    if (filterTag) list = list.filter(a => a.tags.includes(filterTag));
    return list;
  }, [video, filterLabel, filterTag]);

  const labelCounts = useMemo(() => {
    if (!video) return {};
    const counts: Record<string, number> = {};
    for (const a of video.annotations) { counts[a.label] = (counts[a.label] || 0) + 1; }
    return counts;
  }, [video]);

  const uniqueTags = useMemo(() => {
    if (!video) return [];
    return Array.from(new Set(video.annotations.flatMap(a => a.tags))).sort((a, b) => a.localeCompare(b));
  }, [video]);

  const tagCounts = useMemo(() => {
    if (!video) return {};
    const counts: Record<string, number> = {};
    for (const a of video.annotations) for (const tg of a.tags) { counts[tg] = (counts[tg] || 0) + 1; }
    return counts;
  }, [video]);

  const hasAnnotationFilter = !!filterLabel || !!filterTag;
  const feedTitle = !video ? "" : hasAnnotationFilter
    ? `${[filterLabel, filterTag ? `#${filterTag}` : null].filter(Boolean).join(" · ")} (${displayedAnnotations.length})`
    : `${video.annotations.length} ${t("video.annotations")}`;

  // ── Social embeds (TikTok/Instagram/X/Facebook/Vimeo) ──
  const social = video && video.platform && video.platform !== "youtube"
    ? parseSocialStorageId(video.youtubeId)
    : null;
  // youtube: full YT IFrame player · vimeo: full control via Player SDK ·
  // embed: platform iframe without seek API → manual timestamps only
  const playerKind: "youtube" | "vimeo" | "embed" =
    !social ? "youtube" : social.platform === "vimeo" ? "vimeo" : "embed";
  const isSocial = !!social;

  // ── YouTube IFrame API ──
  useEffect(() => {
    if (!video || playerKind !== "youtube") return;
    const container = playerContainerRef.current;
    const ytId = video?.youtubeId;
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
              const t = new URLSearchParams(window.location.search).get("t");
              if (t) { e.target.seekTo(parseFloat(t), true); setCurrentTime(parseFloat(t)); }
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

    // API already loaded → create now
    if (window.YT && window.YT.Player) {
      createPlayer();
      return () => { destroyed = true; if (timeIntervalRef.current) clearInterval(timeIntervalRef.current); };
    }

    // Not loaded yet → insert script, poll until ready
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
    const poll = setInterval(() => {
      if (!destroyed && window.YT && window.YT.Player) { clearInterval(poll); createPlayer(); }
    }, 100);

    return () => { destroyed = true; clearInterval(poll); if (timeIntervalRef.current) clearInterval(timeIntervalRef.current); };
  }, [video, playerKind]);

  // ── Vimeo Player SDK (full seek/time control over the embed iframe) ──
  useEffect(() => {
    if (!video || playerKind !== "vimeo") return;
    let destroyed = false;
    const iframe = document.querySelector<HTMLIFrameElement>("iframe[data-vimeo-player]");
    if (!iframe) return;

    function createVimeoPlayer() {
      if (destroyed || playerRef.current || !window.Vimeo?.Player || !iframe) return;
      try {
        const adapter = new VimeoAdapter(new window.Vimeo.Player(iframe) as unknown as import("@/lib/vimeo-adapter").MinimalVimeoPlayer);
        playerRef.current = adapter;
        adapter.onPlayState((playing) => {
          setIsPlaying(playing);
          if (playing) {
            if (timeIntervalRef.current) clearInterval(timeIntervalRef.current);
            timeIntervalRef.current = setInterval(() => {
              adapter.refreshTime();
              setCurrentTime(adapter.getCurrentTime());
            }, 250);
          } else {
            if (timeIntervalRef.current) { clearInterval(timeIntervalRef.current); timeIntervalRef.current = null; }
            adapter.refreshTime();
            setCurrentTime(adapter.getCurrentTime());
          }
        });
        adapter.onReady(() => {
          if (destroyed) return;
          setDuration(adapter.getDuration());
          setPlayerReady(true);
          const t = new URLSearchParams(window.location.search).get("t");
          if (t) { adapter.seekTo(parseFloat(t), true); setCurrentTime(parseFloat(t)); }
        });
      } catch (err) {
        console.error("[Vimeo Player] create failed:", err);
      }
    }

    if (window.Vimeo?.Player) {
      createVimeoPlayer();
    } else {
      if (!document.querySelector('script[src*="player.vimeo.com/api/player.js"]')) {
        const s = document.createElement("script");
        s.src = "https://player.vimeo.com/api/player.js";
        document.head.appendChild(s);
      }
      const poll = setInterval(() => {
        if (!destroyed && window.Vimeo?.Player) { clearInterval(poll); createVimeoPlayer(); }
      }, 100);
    }

    return () => {
      destroyed = true;
      playerRef.current = null;
      if (timeIntervalRef.current) { clearInterval(timeIntervalRef.current); timeIntervalRef.current = null; }
    };
  }, [video, playerKind]);

  // ── Player control helpers ──
  function seekTo(seconds: number) {
    const p = playerRef.current;
    if (p) {
      p.seekTo(seconds, true);
      setCurrentTime(seconds);
      // Update URL without reload
      const url = new URL(window.location.href);
      url.searchParams.set("t", String(Math.floor(seconds)));
      window.history.replaceState({}, "", url.toString());
    } else if (playerKind === "embed") {
      // Platform iframe has no seek API — clicking annotations can't seek
      return;
    } else {
      // Fallback if player not ready
      const url = new URL(window.location.href);
      url.searchParams.set("t", String(Math.floor(seconds)));
      window.history.replaceState({}, "", url.toString());
      window.location.reload();
    }
  }

  function playSegment(start: number, end: number) {
    const p = playerRef.current;
    if (!p) { seekTo(start); return; }
    p.seekTo(start, true);
    setCurrentTime(start);
    p.playVideo();
    const check = setInterval(() => {
      const t = p.getCurrentTime();
      if (t >= end || t < start - 0.5) {
        p.pauseVideo();
        clearInterval(check);
      }
    }, 200);
  }

  function getScrubberPercent() {
    if (scrubberPos !== null) return scrubberPos;
    if (duration > 0) return (currentTime / duration) * 100;
    return 0;
  }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (playerKind === "embed") {
        // platform iframe without seek API — prev/next navigation + manual annotation entry
        if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          const idx = siblingVideos.findIndex((v) => v.id === Number(videoId));
          if (e.key === "ArrowLeft" && idx > 0) router.push(`/video/${siblingVideos[idx - 1].id}`);
          else if (e.key === "ArrowRight" && idx >= 0 && idx < siblingVideos.length - 1) router.push(`/video/${siblingVideos[idx + 1].id}`);
        }
        if (e.key === "a" || e.key === "A") {
          // open form with empty timestamps — user types them manually
          e.preventDefault();
          setStart(0); setEnd(0); setStartDisplay(""); setEndDisplay("");
          setShowForm(true);
        }
        if (e.key === "Escape" && showForm) setShowForm(false);
        return;
      }
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        const t = playerRef.current ? playerRef.current.getCurrentTime() : currentTime;
        const dur = duration || 3600;
        setStart(t);
        setEnd(Math.min(t + 30, dur));
        setStartDisplay(formatTimestamp(t));
        setEndDisplay(formatTimestamp(Math.min(t + 30, dur)));
        setShowForm(true);
      }
      if (e.key === "Escape" && showForm) setShowForm(false);
      // Space to play/pause
      if (e.key === " " && playerRef.current) {
        e.preventDefault();
        const state = playerRef.current.getPlayerState();
        if (state === 1) playerRef.current.pauseVideo();
        else playerRef.current.playVideo();
      }
      // Arrow keys to seek
      if (e.key === "ArrowLeft" && playerRef.current) {
        e.preventDefault();
        const t = Math.max(0, playerRef.current.getCurrentTime() - 5);
        seekTo(t);
      }
      if (e.key === "ArrowRight" && playerRef.current) {
        e.preventDefault();
        const t = Math.min(duration, playerRef.current.getCurrentTime() + 5);
        seekTo(t);
      }
      // Shift+ArrowLeft/Right for prev/next video
      if (e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault();
        const idx = siblingVideos.findIndex((v) => v.id === Number(videoId));
        if (idx > 0) router.push(`/video/${siblingVideos[idx - 1].id}`);
      }
      if (e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault();
        const idx = siblingVideos.findIndex((v) => v.id === Number(videoId));
        if (idx >= 0 && idx < siblingVideos.length - 1) router.push(`/video/${siblingVideos[idx + 1].id}`);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showForm, duration, siblingVideos, videoId, router, playerKind]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Panel resize drag ──
  useEffect(() => {
    if (!isDraggingPanel) return;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    function onMove(e: MouseEvent) {
      const container = document.querySelector("main > div > div:first-child")?.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const delta = e.clientX - dragStartX.current;
      const newRatio = Math.min(75, Math.max(25, dragStartRatio.current + (delta / rect.width) * 100));
      setPanelRatio(newRatio);
    }
    function onUp() {
      setIsDraggingPanel(false);
      localStorage.setItem("annotationPanelRatio", String(panelRatio));
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDraggingPanel, panelRatio]);

  // ── Data loading ──
  const loadVideoCancelRef = useRef<AbortController | null>(null);

  const loadVideo = useCallback(async () => {
    // Cancel any previous in-flight load
    loadVideoCancelRef.current?.abort();
    const controller = new AbortController();
    loadVideoCancelRef.current = controller;

    try {
      const res = await fetch(`/api/videos/${videoId}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!res.ok) { router.push("/"); return; }
      const data = await res.json();
      if (controller.signal.aborted) return;
      setVideo(data);
      setLoading(false);
      // Fetch cliplist items for this video (fire-and-forget)
      fetch(`/api/videos/${videoId}/cliplists`, { signal: controller.signal })
        .then((r) => r.ok ? r.json() : [])
        .then((items) => { if (!controller.signal.aborted) setVideoCliplistItems(items ?? []); })
        .catch(() => {});
      // Fetch sibling videos for prev/next navigation (fire-and-forget)
      fetch(data.folderId ? `/api/folders/${data.folderId}` : "/api/videos")
        .then((r) => r.ok ? r.json() : null)
        .then((listData) => {
          if (controller.signal.aborted || !listData) return;
          const list = data.folderId ? (listData.videos ?? []) : listData;
          setSiblingVideos(list.map((v: { id: number; title: string | null; thumbnailUrl: string | null }) => ({ id: v.id, title: v.title, thumbnailUrl: v.thumbnailUrl })));
        })
        .catch(() => {});
    } catch {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // All setState calls inside loadVideo run after `await`, so there is no
  // synchronous cascading render — the rule can't see through the callback.
  useEffect(() => { loadVideo(); }, [loadVideo]); // eslint-disable-line react-hooks/set-state-in-effect

  // Load saved summaries on mount
  useEffect(() => {
    if (!videoId) return;
    fetch(`/api/videos/${videoId}/summarize`)
      .then((r) => r.json())
      .then((data) => {
        if (data.moments?.length > 0) {
          setSummaryMoments(data.moments);
          setShowSummary(true);
        }
      })
      .catch(() => {});
  }, [videoId]);

  // Close key moment dropdown on outside click
  useEffect(() => {
    if (keyMomentDropdown.index < 0 && annotCliplistDropdown.id < 0) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-key-moment-dropdown]")) {
        setKeyMomentDropdown({ index: -1, open: false });
      }
      if (!target.closest("[data-annot-cliplist-dropdown]")) {
        setAnnotCliplistDropdown({ id: -1, open: false });
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [keyMomentDropdown.index, annotCliplistDropdown.id]);

  // ── CRUD ──
  async function handleAddAnnotation(e: React.FormEvent) {
    e.preventDefault();
    if (!start || !end) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/annotations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestampStart: start, timestampEnd: end,
          label: "Note", tags: [], note: note.trim() || null,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        const annId = created?.id;
        if (annId) {
          const matchingCliplists = videoCliplistItems.filter(c =>
            Math.abs(c.timestamp - start) < 1 && (c.endTimestamp == null || Math.abs(c.endTimestamp - end) < 1)
          );
          const seen = new Set<number>();
          for (const c of matchingCliplists) {
            if (seen.has(c.cliplistId)) continue;
            seen.add(c.cliplistId);
            await fetch(`/api/cliplists/${c.cliplistId}/items`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "annotation", videoId: Number(videoId),
                timestamp: start, endTimestamp: end,
                title: "Note", detail: note.trim() || null, tags: [],
              }),
            }).catch(() => {});
          }
        }
        setStartDisplay(""); setEndDisplay(""); setStart(0); setEnd(0); setNote(""); setShowForm(false); await loadVideo();
      }
    } finally { setSaving(false); }
  }

  function startEdit(ann: Annotation) {
    setEditingId(ann.id); setEditLabel(ann.label); setEditTags(ann.tags.join(", ")); setEditNote(ann.note ?? "");
    setEditStart(formatTimestamp(ann.timestampStart)); setEditEnd(formatTimestamp(ann.timestampEnd));
  }

  async function saveEdit(id: number) {
    if (!editLabel.trim()) return;
    const ts = parseTimeInput(editStart);
    const te = parseTimeInput(editEnd);
    await fetch(`/api/videos/${videoId}/annotations`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotationId: id,
        label: editLabel.trim(),
        tags: editTags.split(",").map(t => t.trim()).filter(Boolean),
        note: editNote.trim() || null,
        ...(ts > 0 && { timestampStart: ts }),
        ...(te > 0 && { timestampEnd: te }),
      }),
    });
    setEditingId(null); await loadVideo();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this annotation?")) return;
    await fetch(`/api/videos/${videoId}/annotations`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ annotationId: id }),
    });
    await loadVideo();
  }

  function toggleNoteExpand(id: number) {
    setExpandedNotes(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  // ── Bulk actions ──
  function toggleSelect(id: number) {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function selectAll() {
    const ids = displayedAnnotations.map(a => a.id);
    setSelectedIds(prev => ids.every(id => prev.has(id)) ? new Set() : new Set(ids));
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} annotation(s)?`)) return;
    for (const id of selectedIds) {
      await fetch(`/api/videos/${videoId}/annotations`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ annotationId: id }),
      });
    }
    setSelectedIds(new Set());
    await loadVideo();
  }

  async function bulkRelabel() {
    if (!bulkLabel.trim()) return;
    for (const id of selectedIds) {
      const ann = video?.annotations.find(a => a.id === id);
      if (!ann) continue;
      await fetch(`/api/videos/${videoId}/annotations`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotationId: id, label: bulkLabel.trim(), tags: ann.tags, note: ann.note }),
      });
    }
    setSelectedIds(new Set());
    setBulkLabel("");
    await loadVideo();
  }

  function exportSelected() {
    const toExport = selectedIds.size > 0
      ? (video?.annotations.filter(a => selectedIds.has(a.id)) ?? [])
      : displayedAnnotations;
    const ytId = video?.youtubeId;
    const url = ytId ? `https://youtube.com/watch?v=${ytId}` : "";
    const header = `${video?.title ?? "Untitled"}${url ? "\n" + url : ""}\n`;
    const chapters = header + toExport.map(a => {
      const start = formatTimestamp(a.timestampStart);
      const end = formatTimestamp(a.timestampEnd);
      const label = a.label;
      return `${start} – ${end}  ${label}${a.note ? " — " + a.note : ""}`;
    }).join("\n");
    const blob = new Blob([chapters], { type: "text/plain" });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl; link.download = "chapters.txt"; link.click();
    URL.revokeObjectURL(blobUrl);
  }

  function shareAnnotation(ann: Annotation) {
    const origin = window.location.origin;
    const start = formatTimestamp(ann.timestampStart);
    const end = formatTimestamp(ann.timestampEnd);
    const lines = [
      `${ann.label}`,
      `${start} – ${end}`,
    ];
    if (ann.note) lines.push(ann.note);
    lines.push(`${origin}/video/${videoId}#t=${Math.floor(ann.timestampStart)}`);
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setShareCopiedId(ann.id);
      setTimeout(() => setShareCopiedId(null), 2000);
    }).catch(() => {});
  }

  // ── AI Summary ──
  async function runSummary(regenerate = false) {
    setSummaryLoading(true);
    setSummaryError(null);
    setShowSummary(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Summarization failed" }));
        throw new Error(err.error || "Failed to summarize");
      }
      const data = await res.json();
      setSummaryMoments(data.moments ?? []);
    } catch (e: unknown) {
      setSummaryError(e instanceof Error ? e.message : "Failed to summarize");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function deleteSummary() {
    if (!confirm("Delete saved summary?")) return;
    try {
      await fetch(`/api/videos/${videoId}/summarize`, { method: "DELETE" });
      setSummaryMoments([]);
      setShowSummary(false);
    } catch {}
  }

  async function translateAll() {
    setTranslating(true);
    try {
      const target = translatedLang === "pt" ? "English" : "Portuguese";
      const newLang = translatedLang === "pt" ? "en" : "pt";
      // Translate key moments
      if (summaryMoments.length > 0) {
        const momentTexts = summaryMoments.flatMap((m) => [m.title, m.summary || ""]);
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: momentTexts, targetLanguage: target }),
        });
        if (res.ok) {
          const { translated } = await res.json();
          const newMap = new Map<number, { title: string; summary: string }>();
          summaryMoments.forEach((m, i) => {
            newMap.set(i, { title: translated[i * 2] || m.title, summary: translated[i * 2 + 1] || m.summary || "" });
          });
          setTranslatedMoments(newMap);
        }
      }
      // Translate annotations
      if (video && video.annotations.length > 0) {
        const annotTexts = video.annotations.flatMap((a) => [a.label, a.note || ""]);
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: annotTexts, targetLanguage: target }),
        });
        if (res.ok) {
          const { translated } = await res.json();
          const newMap = new Map<number, { label: string; note: string }>();
          video.annotations.forEach((a, i) => {
            newMap.set(i, { label: translated[i * 2] || a.label, note: translated[i * 2 + 1] || a.note || "" });
          });
          setTranslatedAnnotations(newMap);
        }
      }
      setTranslatedLang(newLang);
    } catch {}
    setTranslating(false);
  }

  function clearTranslations() {
    setTranslatedMoments(new Map());
    setTranslatedAnnotations(new Map());
    setTranslatedLang(null);
  }

  async function importAllKeyMoments() {
    if (!summaryMoments.length) return;
    const withEnd = summaryMoments.filter(m => m.endTimestamp && m.endTimestamp > m.timestamp);
    if (!withEnd.length) return;
    setSaving(true);
    try {
      for (const m of withEnd) {
        await fetch(`/api/videos/${videoId}/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timestampStart: m.timestamp,
            timestampEnd: m.endTimestamp,
            label: "Key Moment",
            tags: [m.importance],
            note: m.summary ? `${m.title}\n\n${m.summary}` : m.title,
          }),
        });
      }
      await loadVideo();
    } finally {
      setSaving(false);
    }
  }

  async function loadCliplists() {
    try {
      const res = await fetch("/api/cliplists");
      if (res.ok) setCliplists(await res.json());
    } catch {}
  }

  async function addKeyMomentToCliplist(cliplistId: number, moment: typeof summaryMoments[number]) {
    if (!moment.endTimestamp || moment.endTimestamp <= moment.timestamp) return;
    try {
      await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "key_moment",
          videoId: Number(videoId),
          timestamp: moment.timestamp,
          endTimestamp: moment.endTimestamp,
          title: moment.title,
          detail: moment.summary || null,
          tags: [moment.importance],
        }),
      });
      setKeyMomentDropdown({ index: -1, open: false });
    } catch {}
  }

  async function addAnnotationToCliplist(cliplistId: number, ann: { id: number; label: string; note: string | null; timestampStart: number; timestampEnd: number; tags: string[] }) {
    try {
      const res = await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "annotation",
          videoId: Number(videoId),
          timestamp: ann.timestampStart,
          endTimestamp: ann.timestampEnd,
          title: ann.label,
          detail: ann.note || null,
          tags: ann.tags,
        }),
      });
      if (res.ok) {
        setAnnotCliplistDropdown({ id: -1, open: false });
        await loadVideo();
      }
    } catch {}
  }

  async function handleCreateCliplistAndAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newCliplistName.trim()) return;
    setCreatingCliplist(true);
    try {
      const res = await fetch("/api/cliplists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCliplistName.trim(), description: null }),
      });
      if (res.ok) {
        const cl = await res.json();
        setCliplists(prev => [...prev, cl]);
        setNewCliplistName("");
        setShowCreateCliplist(false);
        if (pendingMomentIdx !== null && summaryMoments[pendingMomentIdx]) {
          await addKeyMomentToCliplist(cl.id, summaryMoments[pendingMomentIdx]);
        }
        setPendingMomentIdx(null);
      }
    } finally {
      setCreatingCliplist(false);
    }
  }

  // ── Scrubber drag ──
  const handleScrubberInteraction = useCallback((clientX: number) => {
    if (!scrubberRef.current || duration <= 0) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setScrubberPos(pct);
    const seconds = (pct / 100) * duration;
    seekTo(seconds);
  }, [duration]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!scrubberDragging) return;
    const onMove = (e: MouseEvent) => handleScrubberInteraction(e.clientX);
    const onUp = () => setScrubberDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [scrubberDragging, handleScrubberInteraction]);

  // Clear scrubber override when not dragging
  useEffect(() => {
    if (!scrubberDragging && scrubberPos !== null) {
      const timeout = setTimeout(() => setScrubberPos(null), 150);
      return () => clearTimeout(timeout);
    }
  }, [scrubberDragging, scrubberPos]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span className="text-sm">{t("app.loading")}</span>
        </div>
      </div>
    );
  }
  if (!video) return null;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── HEADER ── */}
      <header className="border-b border-border shrink-0">
        <div className="mx-auto max-w-[1600px] px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => router.push(video.folderId ? `/?folder=${video.folderId}` : "/")}
              className="shrink-0 p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            {(() => {
              const idx = siblingVideos.findIndex((v) => v.id === video?.id);
              if (idx < 0 || siblingVideos.length <= 1) return null;
              const prev = idx > 0 ? siblingVideos[idx - 1] : null;
              const next = idx < siblingVideos.length - 1 ? siblingVideos[idx + 1] : null;
              return (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => prev && router.push(`/video/${prev.id}`)}
                    disabled={!prev}
                    className="shrink-0 p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                    title={prev?.title ?? "Previous video"}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" /></svg>
                  </button>
                  <span className="text-[10px] text-muted tabular-nums">{idx + 1}/{siblingVideos.length}</span>
                  <button
                    onClick={() => next && router.push(`/video/${next.id}`)}
                    disabled={!next}
                    className="shrink-0 p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                    title={next?.title ?? "Next video"}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5v14" /></svg>
                  </button>
                </div>
              );
            })()}
            <div className="min-w-0">
              <h1 className="text-sm font-semibold truncate">{video.title ?? "Untitled video"}</h1>
              <p className="text-[10px] text-muted truncate">{video.annotations.length} annotations &middot; {uniqueLabels.length} categories</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden md:inline text-[10px] text-muted bg-surface-hover rounded px-1.5 py-0.5 font-mono">
              <kbd>A</kbd> {t("player.annotate")} &middot; <kbd>Space</kbd> {t("player.playPauseShort")} &middot; <kbd>&larr;</kbd><kbd>&rarr;</kbd> {t("player.seek5s")} &middot; <kbd>Shift</kbd>+<kbd>&larr;</kbd><kbd>&rarr;</kbd> {t("player.prevNext")}
            </span>
            <button
              onClick={toggleLanguage}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-hover"
              title={language === "en" ? "Mudar para Português" : "Switch to English"}
            >
              {language === "en" ? "PT" : "EN"}
            </button>
            <button onClick={() => {
                if (playerKind === "embed") {
                  setStart(0); setEnd(0); setStartDisplay(""); setEndDisplay("");
                } else {
                  const t = playerRef.current ? playerRef.current.getCurrentTime() : currentTime;
                  const dur = duration || 3600;
                  setStart(t);
                  setEnd(Math.min(t + 30, dur));
                  setStartDisplay(formatTimestamp(t));
                  setEndDisplay(formatTimestamp(Math.min(t + 30, dur)));
                }
                setShowForm(true);
              }}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover active:scale-[0.97] transition-all flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              {t("player.annotateBtn")}
            </button>
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <main className="flex-1 mx-auto max-w-[1600px] w-full px-6 py-5">
        <div className="flex gap-4 lg:gap-0 flex-col lg:flex-row">

          {/* ═══ LEFT: Video + Timeline ═══ */}
          <div style={{ width: `${panelRatio}%` }} className="flex flex-col gap-4 min-w-0">
            {/* Video Player */}
            <div className="aspect-video w-full rounded-xl overflow-hidden border border-border bg-black shadow-sm relative">
              {playerKind === "vimeo" && social ? (
                <>
                  <iframe
                    src={`${socialEmbedUrl(social.platform, social.platformId, video.youtubeUrl)}?api=1`}
                    data-vimeo-player
                    title={video.title ?? "Video"}
                    className="w-full h-full"
                    allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
                    allowFullScreen
                  />
                  <div className="absolute top-2 right-2 z-10">
                    <a href={video.youtubeUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] font-medium text-white/90 hover:bg-black/80 transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      Watch on {social.platform}
                    </a>
                  </div>
                  {!playerReady && (
                    <div className="absolute inset-x-0 bottom-0 flex justify-center pb-2 pointer-events-none">
                      <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-white/70 text-xs">
                        <div className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80" />
                      </div>
                    </div>
                  )}
                </>
              ) : isSocial && social ? (
                <>
                  <iframe
                    src={socialEmbedUrl(social.platform, social.platformId, video.youtubeUrl)}
                    title={video.title ?? "Video"}
                    className="w-full h-full"
                    allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
                    allowFullScreen
                  />
                  <div className="absolute top-2 right-2 z-10">
                    <a href={video.youtubeUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] font-medium text-white/90 hover:bg-black/80 transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      Watch on {social.platform}
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <div ref={playerContainerRef} className="w-full h-full" />
                  {!playerReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black">
                      <div className="flex items-center gap-3 text-white/60">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
                        <span className="text-sm">{t("player.loading")}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Live time + Timeline Scrubber */}
            {playerKind !== "embed" && (
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              {/* Current time display */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isPlaying ? "bg-emerald-500 animate-pulse" : "bg-muted/40"}`} />
                  <span className="text-lg font-mono font-semibold text-foreground tabular-nums tracking-tight">
                    {formatTimestamp(currentTime)}
                  </span>
                  <span className="text-xs text-muted">/</span>
                  <span className="text-xs font-mono text-muted tabular-nums">
                    {formatTimestamp(duration)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => seekTo(Math.max(0, currentTime - 10))}
                    className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                    title={t("player.back10s")}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" /></svg>
                  </button>
                  <button onClick={() => {
                    if (!playerRef.current) return;
                    const state = playerRef.current.getPlayerState();
                    if (state === 1) playerRef.current.pauseVideo();
                    else playerRef.current.playVideo();
                  }}
                    className="p-2 rounded-lg bg-accent text-white hover:bg-accent-hover active:scale-95 transition-all"
                    title={t("player.playPause")}>
                    {isPlaying ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                    ) : (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    )}
                  </button>
                  <button onClick={() => seekTo(Math.min(duration, currentTime + 10))}
                    className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                    title={t("player.forward10s")}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" /></svg>
                  </button>
                </div>
              </div>

              {/* Scrubber bar */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-muted shrink-0 tabular-nums">0:00</span>
                <div ref={scrubberRef}
                  className="flex-1 h-8 rounded-full bg-border/60 relative cursor-pointer group"
                  onMouseDown={e => { setScrubberDragging(true); handleScrubberInteraction(e.clientX); }}>
                  {/* Progress fill */}
                  <div className="absolute inset-y-0 left-0 rounded-full bg-accent/25 transition-all duration-100"
                    style={{ width: `${getScrubberPercent()}%` }} />

                  {/* Annotation duration bars */}
                  {duration > 0 && video.annotations.map(ann => {
                    const leftPct = (ann.timestampStart / duration) * 100;
                    const widthPct = Math.max(0.3, ((ann.timestampEnd - ann.timestampStart) / duration) * 100);
                    const colors = getLabelColor(ann.label);
                    return (
                      <div key={ann.id}
                        className="absolute h-3 rounded-full opacity-60 hover:opacity-100 transition-all cursor-pointer top-1/2 -translate-y-1/2 z-10"
                        style={{ left: `${Math.min(leftPct, 99)}%`, width: `${Math.min(widthPct, 100 - leftPct)}%` }}
                        onClick={e => { e.stopPropagation(); seekTo(ann.timestampStart); }}
                        onMouseEnter={() => setHoveredMarker(ann.id)}
                        onMouseLeave={() => setHoveredMarker(null)}>
                        <div className={`w-full h-full rounded-full ${colors.dot}`} />
                        {hoveredMarker === ann.id && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-2.5 py-1.5 rounded-lg bg-foreground text-background text-[10px] font-medium whitespace-nowrap z-40 pointer-events-none shadow-xl">
                            <div className="flex items-center gap-1.5">
                              <span>{getEmoji(ann.label)}</span>
                              <span>{ann.label}</span>
                              <span className="opacity-50">|</span>
                              <span className="font-mono">{formatTimestamp(ann.timestampStart)} &ndash; {formatTimestamp(ann.timestampEnd)}</span>
                            </div>
                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-foreground" />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Playhead */}
                  <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-accent border-[3px] border-background shadow-lg pointer-events-none z-20 transition-all duration-100"
                    style={{ left: `calc(${getScrubberPercent()}% - 8px)` }} />
                </div>
                <span className="text-[10px] font-mono text-muted shrink-0 tabular-nums">{formatTimestamp(duration)}</span>
              </div>
              {/* Time markers */}
              {duration > 0 && (
                <div className="flex justify-between mt-2 px-1">
                  {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                    <span key={pct} className="text-[9px] font-mono text-muted/50 tabular-nums">
                      {formatTimestamp(pct * duration)}
                    </span>
                  ))}
                </div>
              )}

              {/* Keyboard hints */}
              <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-border/40">
                <span className="text-[9px] text-muted/40 font-mono flex items-center gap-1">
                  <kbd className="bg-surface-hover border border-border/40 rounded px-1 py-0.5 text-[8px]">Space</kbd> {t("player.playPauseShort")}
                </span>
                <span className="text-[9px] text-muted/40 font-mono flex items-center gap-1">
                  <kbd className="bg-surface-hover border border-border/40 rounded px-1 py-0.5 text-[8px]">&larr;</kbd><kbd className="bg-surface-hover border border-border/40 rounded px-1 py-0.5 text-[8px]">&rarr;</kbd> {t("player.seek5s")}
                </span>
                <span className="text-[9px] text-muted/40 font-mono flex items-center gap-1">
                  <kbd className="bg-surface-hover border border-border/40 rounded px-1 py-0.5 text-[8px]">A</kbd> {t("player.annotate")}
                </span>
              </div>
            </div>
            )}

            {playerKind === "embed" && (
              <div className="rounded-xl border border-border/60 bg-surface px-4 py-3 text-xs text-muted flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                This platform doesn&apos;t allow player control — type timestamps manually (e.g. 1:23). Press A to add an annotation.
              </div>
            )}
          </div>

          {/* ═══ Resize Handle ═══ */}
          <div
            onMouseDown={handlePanelDragStart}
            className="hidden lg:flex w-2 shrink-0 cursor-col-resize items-center justify-center group/drag hover:bg-accent/10 transition-colors"
            title={t("player.dragResize")}
          >
            <div className="w-0.5 h-8 rounded-full bg-border group-hover/drag:bg-accent/40 transition-colors" />
          </div>

          {/* ═══ RIGHT: Annotation Panel ═══ */}
          <div style={{ width: `${100 - panelRatio}%` }} className="flex flex-col min-h-0 min-w-0">

            {/* ── Inline Create Form ── */}
            {showForm ? (
              <div className="rounded-xl border border-accent/30 bg-surface shadow-sm mb-3 overflow-hidden relative">
                {/* Timeline dot placeholder */}
                <div className="absolute left-[11px] top-[18px] w-[10px] h-[10px] rounded-full border-2 border-background bg-accent ring-2 ring-accent/20 animate-pulse" />

                <form onSubmit={handleAddAnnotation} className="pl-9 p-2.5">
                  {/* Header: Timestamps + Now buttons + Actions */}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <input type="text" value={startDisplay} required
                        onChange={e => setStartDisplay(e.target.value)}
                        onBlur={() => { const s = parseTimeInput(startDisplay); setStart(s); setStartDisplay(s > 0 ? formatTimestamp(s) : ""); }}
                        placeholder="0:00"
                        className="w-14 rounded border border-border/60 bg-background px-1.5 py-px text-[10px] font-mono text-accent/80 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all tabular-nums" />
                      {playerKind !== "embed" && (
                        <button type="button" onClick={() => { setStart(currentTime); setStartDisplay(formatTimestamp(currentTime)); }}
                          className="text-[9px] text-accent/60 hover:text-accent transition-colors shrink-0" title={t("annotation.setStartNow")}>{t("annotation.now")}</button>
                      )}
                      <span className="text-[9px] text-muted/30">&ndash;</span>
                      <input type="text" value={endDisplay} required
                        onChange={e => setEndDisplay(e.target.value)}
                        onBlur={() => { const s = parseTimeInput(endDisplay); setEnd(s); setEndDisplay(s > 0 ? formatTimestamp(s) : ""); }}
                        placeholder="0:00"
                        className="w-14 rounded border border-border/60 bg-background px-1.5 py-px text-[10px] font-mono text-accent/80 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all tabular-nums" />
                      {playerKind !== "embed" && (
                        <button type="button" onClick={() => { setEnd(currentTime); setEndDisplay(formatTimestamp(currentTime)); }}
                          className="text-[9px] text-accent/60 hover:text-accent transition-colors shrink-0" title={t("annotation.setEndNow")}>{t("annotation.now")}</button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="submit" disabled={saving || !start || !end}
                        className="rounded bg-accent px-2.5 py-0.5 text-[10px] font-semibold text-white hover:bg-accent-hover active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                        {saving ? t("annotation.saving") : t("annotation.save")}
                      </button>
                      <button type="button" onClick={() => setShowForm(false)}
                        className="rounded px-2 py-0.5 text-[10px] text-muted hover:text-foreground transition-colors">
                        {t("annotation.cancel")}
                      </button>
                    </div>
                  </div>

                  {/* Note */}
                  <input type="text" value={note} onChange={e => setNote(e.target.value)}
                    placeholder={t("annotation.addNote")}
                    className="w-full rounded border border-border/60 bg-background px-1.5 py-px text-[10px] focus:border-accent outline-none transition-all mt-0.5" />
                </form>
              </div>
            ) : (
              <button onClick={() => setShowForm(true)}
                className="w-full rounded-xl border border-dashed border-border hover:border-accent/40 bg-surface hover:bg-accent/5 py-3 mb-4 flex items-center justify-center gap-2 transition-all group">
                <svg className="w-4 h-4 text-muted group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                <span className="text-xs font-medium text-muted group-hover:text-foreground transition-colors">{t("annotation.new")}</span>
                <kbd className="bg-surface-hover border border-border/60 rounded px-1.5 py-0.5 text-[9px] text-muted font-mono">A</kbd>
              </button>
            )}

            {/* ── Translation toolbar ── */}
            <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg border border-border/60 bg-surface">
              <svg className="w-3.5 h-3.5 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
              <span className="text-[10px] text-muted font-medium">{t("translate")}</span>
              <div className="flex items-center ml-auto rounded-md border border-border/60 overflow-hidden">
                <button onClick={() => { if (translatedLang && !translating) clearTranslations(); }}
                  disabled={!translatedLang || translating}
                  className={`px-2.5 py-1 text-[10px] font-medium transition-all ${translatedLang ? "bg-accent text-white" : "text-muted/40"}`}>
                  EN
                </button>
                <div className="w-px h-3 bg-border/60" />
                <button onClick={() => { if (!translatedLang && !translating) translateAll(); }}
                  disabled={!!translatedLang || translating}
                  className={`px-2.5 py-1 text-[10px] font-medium transition-all ${!translatedLang ? "text-muted hover:text-foreground" : "bg-accent text-white"}`}>
                  PT
                </button>
              </div>
            </div>

            {/* ── AI Summary ── */}
            {!showForm && playerKind === "youtube" && (
              <div className="mb-3 shrink-0">
                {!showSummary ? (
                  <button onClick={() => runSummary()} disabled={summaryLoading}
                    className="w-full rounded-xl border border-border/60 bg-surface hover:bg-surface-hover/50 py-2.5 flex items-center justify-center gap-2 transition-all group text-[11px]">
                    <svg className="w-3.5 h-3.5 text-muted group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    <span className="text-muted group-hover:text-foreground transition-colors font-medium">{t("keyMoments.aiSummary")}</span>
                  </button>
                ) : (
                  <div className="rounded-xl border border-border/60 bg-surface overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">{t("keyMoments.title")}</span>
                        {summaryMoments.length > 0 && <span className="text-[10px] text-muted/50">{summaryMoments.length}</span>}
                        {summaryMoments.length > 0 && (
                          <button
                            onClick={() => setMomentSort(momentSort === "time" ? "importance" : "time")}
                            className="text-[9px] text-muted/60 hover:text-accent transition-colors px-1 py-0.5 rounded hover:bg-surface-hover/50"
                            title={`Sort by ${momentSort === "time" ? "importance" : "time"}`}
                          >
                            {momentSort === "time" ? "↕ time" : "↕ importance"}
                          </button>
                        )}
                        {summaryMoments.length > 0 && (
                          <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium">{t("keyMoments.saved")}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {!summaryLoading && summaryMoments.length === 0 && !summaryError && (
                          <button onClick={() => runSummary()} className="text-[10px] text-accent hover:text-accent-hover transition-colors">{t("keyMoments.retry")}</button>
                        )}
                        {!summaryLoading && summaryMoments.length > 0 && (
                          <>
                            <button onClick={importAllKeyMoments} disabled={saving}
                              className="text-[10px] text-muted hover:text-accent transition-colors disabled:opacity-50" title={t("keyMoments.importAll")}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            </button>
                            <button onClick={() => runSummary(true)} className="text-[10px] text-muted hover:text-accent transition-colors" title={t("keyMoments.regenerate")}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            </button>
                            <button onClick={deleteSummary} className="text-[10px] text-danger/60 hover:text-danger transition-colors" title={t("keyMoments.delete")}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </>
                        )}
                        <button onClick={() => { setShowSummary(false); }}
                          className="p-0.5 rounded text-muted hover:text-foreground hover:bg-surface-hover transition-colors">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>

                    <div className="max-h-52 overflow-y-auto scrollbar-thin" style={{ zoom: 1.5 }}>
                      {summaryLoading && (
                        <div className="flex items-center justify-center gap-2 py-6 text-muted">
                          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                          <span className="text-[10px]">{t("keyMoments.loading")}</span>
                        </div>
                      )}
                      {summaryError && (
                        <div className="px-3 py-4 text-center">
                          <p className="text-[10px] text-danger">{summaryError}</p>
                          <button onClick={() => runSummary()} className="text-[10px] text-accent hover:text-accent-hover mt-1 transition-colors">{t("keyMoments.tryAgain")}</button>
                        </div>
                      )}
                      {!summaryLoading && !summaryError && summaryMoments.length === 0 && (
                        <div className="px-3 py-4 text-center">
                          <p className="text-[10px] text-muted">{t("keyMoments.noResults")}</p>
                        </div>
                      )}
                      {summaryMoments.slice().sort((a, b) => {
                        if (momentSort === "importance") {
                          const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
                          const diff = (order[a.importance] ?? 3) - (order[b.importance] ?? 3);
                          return diff !== 0 ? diff : a.timestamp - b.timestamp;
                        }
                        return a.timestamp - b.timestamp;
                      }).map((m, i) => {
                        const originalIdx = summaryMoments.indexOf(m);
                        const translated = translatedMoments.get(originalIdx);
                        const dur = m.endTimestamp ? m.endTimestamp - m.timestamp : undefined;
                        return (
                          <div key={i} className="px-3 py-2 hover:bg-surface-hover/50 transition-colors border-b border-border/20 last:border-0 group/row">
                            <button onClick={() => m.endTimestamp ? playSegment(m.timestamp, m.endTimestamp) : seekTo(m.timestamp)} className="w-full text-left">
                              <div className="flex items-start gap-2">
                                <div className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                                  m.importance === "high" ? "bg-emerald-500" :
                                  m.importance === "medium" ? "bg-amber-500" :
                                  "bg-muted/40"
                                }`} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-mono text-accent/80 tabular-nums shrink-0">
                                      {formatTimestamp(m.timestamp)}
                                      {m.endTimestamp && <> – {formatTimestamp(m.endTimestamp)}</>}
                                    </span>
                                    {dur != null && dur > 0 && (
                                      <span className="text-[9px] font-mono text-muted/40">({Math.round(dur)}s)</span>
                                    )}
                                    <span className="text-[11px] font-medium text-foreground truncate">{translated?.title || m.title}</span>
                                    {(() => {
                                      const matching = videoCliplistItems.filter(c =>
                                        Math.abs(c.timestamp - m.timestamp) < 1 &&
                                        (m.endTimestamp == null || c.endTimestamp == null || Math.abs(c.endTimestamp - m.endTimestamp) < 1)
                                      );
                                      if (matching.length === 0) return null;
                                      const seen = new Set<number>();
                                      return matching.filter(c => { if (seen.has(c.cliplistId)) return false; seen.add(c.cliplistId); return true; }).map(c => (
                                        <Link key={c.cliplistId} href={`/?cliplist=${c.cliplistId}`}
                                          onClick={e => e.stopPropagation()}
                                          className="inline-flex items-center gap-0.5 text-[9px] text-accent/70 hover:text-accent bg-accent/5 hover:bg-accent/10 px-1.5 py-px rounded transition-colors shrink-0"
                                          title={`View in cliplist: ${c.cliplistName}`}>
                                          <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                          </svg>
                                          {c.cliplistName}
                                        </Link>
                                      ));
                                    })()}
                                  </div>
                                  <p className="text-[10px] text-muted/70 leading-relaxed mt-0.5 line-clamp-2">{translated?.summary || m.summary}</p>
                                </div>
                              </div>
                            </button>
                            {m.endTimestamp && (
                              <div className="ml-5 mt-1 flex items-center gap-2 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                <button
                                  onClick={() => {
                                    setStartDisplay(formatTimestamp(m.timestamp));
                                    setEndDisplay(formatTimestamp(m.endTimestamp!));
                                    setStart(m.timestamp);
                                    setEnd(m.endTimestamp!);
                                    setNote(m.summary ? `${m.title}\n\n${m.summary}` : m.title);
                                    setShowForm(true);
                                  }}
                                  className="text-[9px] text-muted/40 hover:text-accent transition-colors"
                                >
                                  {t("keyMoments.addAsAnnotation")}
                                </button>
                                <span className="text-[9px] text-muted/20">|</span>
                                <div className="relative" data-key-moment-dropdown>
                                  <button
                                    onClick={() => {
                                      if (cliplists.length === 0) loadCliplists();
                                      setKeyMomentDropdown({ index: i, open: keyMomentDropdown.index === i ? !keyMomentDropdown.open : true });
                                    }}
                                    className="text-[9px] text-muted/40 hover:text-accent transition-colors"
                                  >
                                    {t("keyMoments.addToCliplist")}
                                  </button>
                                  {keyMomentDropdown.open && keyMomentDropdown.index === i && (
                                    <div className="absolute left-0 top-full mt-1 w-52 rounded-lg border border-border bg-surface shadow-xl z-50 py-1" data-key-moment-dropdown>
                                      {showCreateCliplist ? (
                                        <form onSubmit={handleCreateCliplistAndAdd} className="p-2 space-y-1.5">
                                          <input type="text" value={newCliplistName} onChange={e => setNewCliplistName(e.target.value)}
                                            placeholder={t("cliplist.name")} autoFocus
                                            className="w-full rounded border border-border bg-background px-2 py-1 text-[10px] focus:border-accent outline-none" />
                                          <div className="flex items-center gap-1">
                                            <button type="submit" disabled={creatingCliplist || !newCliplistName.trim()}
                                              className="rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all">
                                              {creatingCliplist ? "..." : t("keyMoments.create")}
                                            </button>
                                            <button type="button" onClick={() => { setShowCreateCliplist(false); setNewCliplistName(""); setPendingMomentIdx(null); }}
                                              className="rounded px-2 py-0.5 text-[10px] text-muted hover:text-foreground transition-colors">
                                              {t("annotation.cancel")}
                                            </button>
                                          </div>
                                        </form>
                                      ) : (
                                        <>
                                          <div className="px-2.5 py-1 text-[9px] font-semibold text-muted uppercase tracking-wider">
                                            {t("keyMoments.addToCliplist")}
                                          </div>
                                          {cliplists.length === 0 ? (
                                            <div className="px-2.5 py-1 text-[9px] text-muted">No cliplists yet</div>
                                          ) : (
                                            cliplists.map((cl) => (
                                              <button
                                                key={cl.id}
                                                onClick={() => addKeyMomentToCliplist(cl.id, m)}
                                                className="w-full text-left px-2.5 py-1 text-[10px] hover:bg-surface-hover transition-colors flex items-center justify-between"
                                              >
                                                <span className="truncate">{cl.name}</span>
                                                <span className="text-[9px] text-muted shrink-0 ml-2">{cl.itemCount}</span>
                                              </button>
                                            ))
                                          )}
                                          <div className="border-t border-border/50 mt-1 pt-1">
                                            <button
                                              onClick={() => { setPendingMomentIdx(i); setShowCreateCliplist(true); }}
                                              className="w-full text-left px-2.5 py-1 text-[10px] text-accent hover:bg-accent/10 transition-colors"
                                            >
                                              {t("keyMoments.newCliplist")}
                                            </button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Filter chips */}
            {uniqueLabels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3 shrink-0">
                <button onClick={() => setFilterLabel(null)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
                    filterLabel === null
                      ? "bg-accent text-white shadow-sm"
                      : "bg-surface border border-border text-muted hover:text-foreground hover:border-accent/30"
                  }`}>
                  {t("feed.all")}
                  <span className="opacity-60">{video.annotations.length}</span>
                </button>
                {uniqueLabels.map(l => {
                  const colors = getLabelColor(l);
                  const active = filterLabel === l;
                  return (
                    <button key={l} onClick={() => setFilterLabel(active ? null : l)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
                        active
                          ? `${colors.badge} ${colors.badgeText} ring-1 ${colors.ring} shadow-sm`
                          : "bg-surface border border-border text-muted hover:text-foreground hover:border-accent/30"
                      }`}>
                      <span>{getEmoji(l)}</span>{l}
                      <span className="opacity-50">{labelCounts[l]}</span>
                    </button>
                        );
                      })}
                    </div>
            )}

            {/* Tag filter chips */}
            {uniqueTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3 shrink-0">
                {uniqueTags.map(tag => {
                  const active = filterTag === tag;
                  return (
                    <button key={tag} onClick={() => setFilterTag(active ? null : tag)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium font-mono transition-all ${
                        active
                          ? "bg-accent text-white shadow-sm"
                          : "bg-surface border border-border text-muted hover:text-foreground hover:border-accent/30"
                      }`}>
                      #{tag}
                      <span className="opacity-50">{tagCounts[tag]}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Feed header */}
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <button onClick={() => setFeedCollapsed(!feedCollapsed)}
                  className="p-1 rounded text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                  title={feedCollapsed ? t("player.expand") : t("player.collapse")}>
                  <svg className={`w-4 h-4 transition-transform duration-200 ${feedCollapsed ? "-rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {displayedAnnotations.length > 0 && (
                  <button onClick={selectAll}
                    className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${
                      selectedIds.size > 0 && selectedIds.size === displayedAnnotations.length
                        ? "bg-accent border-accent text-white"
                        : "border-border hover:border-accent/50"
                    }`} title={t("feed.selectAll")}>
                    {selectedIds.size > 0 && selectedIds.size === displayedAnnotations.length && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    )}
                  </button>
                )}
                <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">
                  {feedTitle}
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={exportSelected}
                  className="p-1.5 rounded text-muted hover:text-foreground hover:bg-surface-hover transition-colors" title={t("annotation.exportChapters")}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </button>
              </div>
            </div>

            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-accent/5 border border-accent/15 shrink-0">
                <span className="text-[10px] font-medium text-accent">{selectedIds.size} {t("video.selected")}</span>
                <div className="flex-1" />
                <div className="relative">
                  <input type="text" value={bulkLabel} onChange={e => setBulkLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); bulkRelabel(); } }}
                    placeholder={t("annotation.relabelTo")}
                    className="w-32 rounded-md border border-border bg-background px-2 py-1 text-[10px] focus:border-accent outline-none" />
                </div>
                <button onClick={bulkRelabel} disabled={!bulkLabel.trim()}
                  className="rounded-md bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-30 transition-all">
                  {t("annotation.relabel")}
                </button>
                <button onClick={bulkDelete}
                  className="rounded-md bg-danger/10 px-2 py-1 text-[10px] font-medium text-danger hover:bg-danger/20 transition-all">
                  {t("annotation.delete")}
                </button>
                <button onClick={() => setSelectedIds(new Set())}
                  className="rounded-md px-2 py-1 text-[10px] text-muted hover:text-foreground transition-all">
                  {t("annotation.clear")}
                </button>
              </div>
            )}

            {/* Feed list */}
            {!feedCollapsed && (
              <div className="flex-1 min-h-0 overflow-y-auto max-h-[calc(100vh-16rem)] pr-1 space-y-2 scrollbar-thin" style={{ zoom: 1.5 }}>
                {displayedAnnotations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-20 h-20 rounded-2xl bg-surface-hover border border-border flex items-center justify-center mb-5 shadow-inner">
                      <svg className="w-10 h-10 text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-muted mb-1">{hasAnnotationFilter ? t("annotation.noMatching") : t("annotation.noAnnotationsYet")}</p>
                    <p className="text-xs text-muted/60 mb-4">
                      {hasAnnotationFilter ? t("annotation.tryDifferentFilter") : t("annotation.press")} {!hasAnnotationFilter && <kbd className="inline-block bg-surface-hover border border-border rounded px-1.5 py-0.5 font-mono text-[10px] mx-0.5">A</kbd>}
                      {!hasAnnotationFilter ? t("annotation.toCreateFirst") : ""}
                    </p>
                    {!hasAnnotationFilter && (
                      <button onClick={() => setShowForm(true)}
                        className="text-xs text-accent hover:text-accent-hover font-medium transition-colors">
                        {t("annotation.createFirstAction")}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    {/* Timeline spine */}
                    <div className="absolute left-[15px] top-3 bottom-3 w-px bg-border/60" />

                    <div className="space-y-1.5">
                      {displayedAnnotations.map(ann => {
                        const colors = getLabelColor(ann.label);
                        const isExpanded = expandedNotes.has(ann.id);
                        const isEditing = editingId === ann.id;
                        const annDuration = ann.timestampEnd - ann.timestampStart;
                        const translated = translatedAnnotations.get(video.annotations.indexOf(ann));

                        return (
                          <div key={ann.id} className="relative pl-9 group/card">
                            {/* Timeline dot */}
                            <div className={`absolute left-[11px] top-[18px] w-[10px] h-[10px] rounded-full border-2 border-background ${colors.dot} ring-2 ${colors.ring} transition-transform group-hover/card:scale-125`} />

                            <div
                              className={`rounded-xl border border-border/60 ${colors.border} bg-surface hover:bg-surface-hover/50 hover:border-border transition-all duration-150 overflow-hidden ${
                                isEditing ? "ring-1 ring-accent/30" : ""
                              } ${selectedIds.has(ann.id) ? "ring-1 ring-accent/40 bg-accent/5" : ""}`}
                              onClick={() => { if (!isEditing) playSegment(ann.timestampStart, ann.timestampEnd); }}>

                              {isEditing ? (
                                <div className="p-2.5 space-y-2" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center gap-1.5">
                                    <input type="text" value={editStart} onChange={e => setEditStart(e.target.value)}
                                      placeholder="0:00"
                                      className="w-14 rounded border border-border bg-background px-1.5 py-1 text-xs font-mono text-accent/80 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all tabular-nums" />
                                    <span className="text-[9px] text-muted/30">&ndash;</span>
                                    <input type="text" value={editEnd} onChange={e => setEditEnd(e.target.value)}
                                      placeholder="0:00"
                                      className="w-14 rounded border border-border bg-background px-1.5 py-1 text-xs font-mono text-accent/80 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all tabular-nums" />
                                  </div>
                                  <input type="text" value={editLabel} onChange={e => setEditLabel(e.target.value)}
                                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all" />
                                  <input type="text" value={editTags} onChange={e => setEditTags(e.target.value)}
                                    placeholder={t("annotation.tagsPlaceholder")}
                                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all" />
                                  <textarea value={editNote} onChange={e => setEditNote(e.target.value)}
                                    rows={3} placeholder={t("annotation.notePlaceholder")}
                                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none resize-none transition-all" />
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => saveEdit(ann.id)}
                                      className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover active:scale-[0.97] transition-all">{t("annotation.save")}</button>
                                    <button onClick={() => setEditingId(null)}
                                      className="rounded-lg border border-border px-3 py-1 text-xs text-muted hover:text-foreground hover:bg-surface-hover transition-all">{t("annotation.cancel")}</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-2.5">
                                  {/* Header: Label + Timestamps + Cliplists + Actions */}
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                      <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-px rounded shrink-0 ${colors.badge} ${colors.badgeText}`}>
                                        {getEmoji(ann.label)} {translated?.label || ann.label}
                                      </span>
                                      {(() => {
                                        const matching = videoCliplistItems.filter(c =>
                                          Math.abs(c.timestamp - ann.timestampStart) < 1 &&
                                          (c.endTimestamp == null || Math.abs(c.endTimestamp - ann.timestampEnd) < 1)
                                        );
                                        if (matching.length === 0) return null;
                                        const seen = new Set<number>();
                                        return matching.filter(c => { if (seen.has(c.cliplistId)) return false; seen.add(c.cliplistId); return true; }).map(c => (
                                          <Link key={c.cliplistId} href={`/?cliplist=${c.cliplistId}`}
                                            onClick={e => e.stopPropagation()}
                                            className="inline-flex items-center gap-0.5 text-[9px] text-accent/70 hover:text-accent bg-accent/5 hover:bg-accent/10 px-1.5 py-px rounded transition-colors shrink-0"
                                            title={`View in cliplist: ${c.cliplistName}`}>
                                            <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                                            {c.cliplistName}
                                          </Link>
                                        ));
                                      })()}
                                      <button onClick={e => { e.stopPropagation(); seekTo(ann.timestampStart); }}
                                        className="inline-flex items-center rounded px-1.5 py-px text-[10px] font-mono text-accent/80 hover:text-accent hover:bg-accent/10 active:scale-[0.97] transition-all shrink-0">
                                        {formatTimestamp(ann.timestampStart)}
                                      </button>
                                      <span className="text-[9px] text-muted/30">&ndash;</span>
                                      <button onClick={e => { e.stopPropagation(); seekTo(ann.timestampEnd); }}
                                        className="inline-flex items-center rounded px-1.5 py-px text-[10px] font-mono text-accent/80 hover:text-accent hover:bg-accent/10 active:scale-[0.97] transition-all shrink-0">
                                        {formatTimestamp(ann.timestampEnd)}
                                      </button>
                                      <span className="text-[9px] text-muted/30 font-mono tabular-nums shrink-0">{formatTimestamp(annDuration)}</span>
                                    </div>
                                    <div className="flex items-center gap-0.5 shrink-0">
                                      <button onClick={e => { e.stopPropagation(); toggleSelect(ann.id); }}
                                        className={`w-3.5 h-3.5 rounded border transition-all flex items-center justify-center ${
                                          selectedIds.has(ann.id) ? "bg-accent border-accent text-white" : "border-border hover:border-accent/50"
                                        }`} title={t("annotation.select")}>
                                        {selectedIds.has(ann.id) && (
                                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                        )}
                                      </button>
                                      <div className="flex items-center opacity-0 group-hover/card:opacity-100 transition-opacity">
                                        <div className="relative" data-annot-cliplist-dropdown>
                                          <button onClick={e => {
                                              e.stopPropagation();
                                              if (cliplists.length === 0) loadCliplists();
                                              setAnnotCliplistDropdown({ id: ann.id, open: annotCliplistDropdown.id === ann.id ? !annotCliplistDropdown.open : true });
                                            }}
                                            className="p-0.5 rounded text-muted hover:text-accent hover:bg-accent/10 transition-colors" title={t("annotation.share")}>
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                                          </button>
                                          {annotCliplistDropdown.id === ann.id && annotCliplistDropdown.open && (
                                            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface shadow-xl z-50 py-1" data-annot-cliplist-dropdown>
                                              <div className="px-2.5 py-1 text-[9px] font-semibold text-muted uppercase tracking-wider">{t("keyMoments.addToCliplist")}</div>
                                              {cliplists.length === 0 ? (
                                            <div className="px-2.5 py-1 text-[9px] text-muted">{t("keyMoments.noCliplists")}</div>
                                              ) : (
                                                cliplists.map(cl => (
                                                  <button key={cl.id} onClick={e => { e.stopPropagation(); addAnnotationToCliplist(cl.id, ann); }}
                                                    className="w-full text-left px-2.5 py-1 text-[10px] hover:bg-surface-hover transition-colors flex items-center justify-between">
                                                    <span className="truncate">{cl.name}</span>
                                                    <span className="text-[9px] text-muted shrink-0 ml-2">{cl.itemCount}</span>
                                                  </button>
                                                ))
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        <button onClick={e => { e.stopPropagation(); shareAnnotation(ann); }}
                                          className={`p-0.5 rounded transition-colors shrink-0 ${shareCopiedId === ann.id ? "text-accent" : "text-muted hover:text-accent hover:bg-accent/10"}`}
                                          title={shareCopiedId === ann.id ? t("annotation.copied") : t("annotation.share")}>
                                          {shareCopiedId === ann.id ? (
                                            <span className="text-[9px] font-medium px-0.5">{t("annotation.copied")}</span>
                                          ) : (
                                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                                          )}
                                        </button>
                                        <button onClick={e => { e.stopPropagation(); startEdit(ann); }}
                                          className="p-0.5 rounded text-muted hover:text-foreground hover:bg-surface-hover transition-colors" title={t("annotation.edit")}>
                                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                        </button>
                                        <button onClick={e => { e.stopPropagation(); handleDelete(ann.id); }}
                                          className="p-0.5 rounded text-muted hover:text-danger hover:bg-danger/10 transition-colors" title={t("annotation.delete")}>
                                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Note */}
                                  {(translated?.note || ann.note) && (
                                    <div className="text-xs text-muted/80 leading-relaxed mb-1" onClick={e => e.stopPropagation()}>
                                      <div className={!isExpanded ? "line-clamp-3" : ""} dangerouslySetInnerHTML={{ __html: renderNote(translated?.note || ann.note || "") }} />
                                      {(translated?.note || ann.note || "").length > 120 && (
                                        <button onClick={() => toggleNoteExpand(ann.id)}
                                          className="text-[10px] text-accent hover:text-accent-hover mt-0.5 font-medium transition-colors">
                                          {isExpanded ? t("annotation.less") : t("annotation.more")}
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  {/* Tags */}
                                  {ann.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-0.5" onClick={e => e.stopPropagation()}>
                                      {ann.tags.map(tag => (
                                        <button key={tag} onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                                          title={t("annotation.filterByTag")}
                                          className={`text-[9px] font-mono transition-colors ${filterTag === tag ? "text-accent" : "text-muted/50 hover:text-accent"}`}>
                                          #{tag}
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <style jsx global>{`
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 4px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted)); }
      `}</style>
    </div>
  );
}
