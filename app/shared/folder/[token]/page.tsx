"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Image from "next/image";
import { useSession, signIn } from "next-auth/react";
import { tokenizeNoteLinks } from "@/lib/youtube";
import { parseSocialStorageId, socialEmbedUrl } from "@/lib/social";
import { isTrustedImageUrl } from "@/lib/image-host";
import { VimeoAdapter } from "@/lib/vimeo-adapter";
import { Html5Adapter } from "@/lib/html5-adapter";

interface VideoData {
  id: number;
  youtubeUrl: string;
  youtubeId: string;
  title: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  platform?: string;
  mediaType?: string | null;
  annotationCount: number;
}

interface FolderData {
  id: number;
  name: string;
  description: string | null;
  videos: VideoData[];
  shares?: Array<{ email: string; permission: string }>;
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
  email: string | null;
  createdAt: string;
  updatedAt: string | null;
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function NoteText({ note }: { note: string }) {
  return (
    <>
      {tokenizeNoteLinks(note).map((tok, i) =>
        tok.kind === "link" ? (
          <a
            key={i}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent underline decoration-accent/40 break-all hover:text-accent-hover"
          >
            {tok.display}
          </a>
        ) : (
          <span key={i}>{tok.value}</span>
        )
      )}
    </>
  );
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
    Vimeo?: { Player: new (element: HTMLElement, options?: Record<string, unknown>) => unknown };
  }
}

export default function SharedFolderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { data: session } = useSession();
  const [token, setToken] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Email verification
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [permission, setPermission] = useState<"view" | "edit" | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifiedName, setVerifiedName] = useState("");

  const [selectedVideo, setSelectedVideo] = useState<VideoData | null>(null);
  const [annotations, setAnnotations] = useState<SharedAnnotation[]>([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);

  // Add video (edit collaborators)
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [addingVideo, setAddingVideo] = useState(false);
  const [addVideoError, setAddVideoError] = useState<string | null>(null);

  // Annotation form
  const [startSec, setStartSec] = useState(-1);
  const [endSec, setEndSec] = useState(-1);
  const [note, setNote] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);

  // Annotation editing
  const [editingAnnotation, setEditingAnnotation] = useState<{
    id: number;
    timestampStart: number;
    timestampEnd: number;
    note: string;
  } | null>(null);
  const [editStart, setEditStart] = useState(0);
  const [editEnd, setEditEnd] = useState(0);
  const [editNote, setEditNote] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // YT Player
  const playerRef = useRef<YTPlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const timeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Undoable deletes (delayed commit)
  const UNDO_MS = 8000;
  interface PendingDelete { label: string; commit: () => Promise<void>; revert: () => void; }
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingAnnotationIds, setPendingAnnotationIds] = useState<number[]>([]);
  const pendingRef = useRef<PendingDelete | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flushPendingDelete() {
    if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
    const p = pendingRef.current;
    pendingRef.current = null;
    setPendingDelete(null);
    setPendingAnnotationIds([]);
    void p?.commit();
  }

  function undoPendingDelete() {
    if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
    const p = pendingRef.current;
    pendingRef.current = null;
    setPendingDelete(null);
    setPendingAnnotationIds([]);
    p?.revert();
  }

  function enqueueDelete(label: string, commit: () => Promise<void>, revert: () => void, hideIds: number[] = []) {
    if (pendingRef.current) flushPendingDelete();
    pendingRef.current = { label, commit, revert };
    setPendingDelete({ label, commit, revert });
    if (hideIds.length > 0) setPendingAnnotationIds(hideIds);
    pendingTimerRef.current = setTimeout(() => { flushPendingDelete(); }, UNDO_MS);
  }

  // Commit an in-flight undoable delete when leaving the page.
  useEffect(() => () => { if (pendingRef.current) void pendingRef.current.commit(); }, []);

  useEffect(() => {
    async function init() {
      const p = await params;
      setToken(p.token);
      // Restore verified email from localStorage
      const stored = localStorage.getItem(`shared_folder_email_${p.token}`);
      if (stored) {
        try {
          const { email, permission: perm, name } = JSON.parse(stored);
          setVerifiedEmail(email);
          setPermission(perm);
          setVerifiedName(name || "");
        } catch {}
      }
    }
    init();
  }, [params]);

  const refreshFolder = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/shared/folder/${token}`);
      if (res.ok) setFolder(await res.json());
    } catch {}
  }, [token]);

  useEffect(() => {
    if (!token || verifiedEmail) return;
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
  }, [token, verifiedEmail]);

  // Returning visitor: email restored from localStorage skips the effect
  // above, so load the folder (and clear the spinner) here instead.
  useEffect(() => {
    if (!token || !verifiedEmail || folder) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shared/folder/${token}`);
        if (cancelled) return;
        if (!res.ok) {
          setError("Folder not found");
          return;
        }
        const data = await res.json();
        if (!cancelled) setFolder(data);
      } catch {
        if (!cancelled) setError("Failed to load folder");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, verifiedEmail, folder]);

  // Auto-verify with Google session email if signed in
  useEffect(() => {
    const sessionEmail = session?.user?.email;
    const sessionName = session?.user?.name;
    if (!token || verifiedEmail || !sessionEmail) return;
    (async () => {
      setVerifying(true);
      setVerifyError(null);
      try {
        const res = await fetch(`/api/shared/folder/${token}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: sessionEmail }),
        });
        const data = await res.json();
        if (res.ok && data.authorized) {
          setVerifiedEmail(data.email);
          setPermission(data.permission);
          const name = sessionName || sessionEmail.split("@")[0];
          setVerifiedName(name);
          localStorage.setItem(
            `shared_folder_email_${token}`,
            JSON.stringify({ email: data.email, permission: data.permission, name })
          );
        } else if (res.status !== 403 || data?.error !== "Email not authorized") {
          // Only surface real errors (network / server) — a 403 for an
          // unauthorized email is expected and just means "try another email".
          setVerifyError(data?.error || "Failed to verify access");
        }
      } catch {
        setVerifyError("Failed to check access. Please try again.");
      }
      setVerifying(false);
    })();
  }, [token, verifiedEmail, session?.user?.email, session?.user?.name]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!emailInput.trim() || !token) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch(`/api/shared/folder/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.authorized) {
        setVerifiedEmail(data.email);
        setPermission(data.permission);
        setVerifiedName(emailInput.trim().split("@")[0]);
        // Store in localStorage
        localStorage.setItem(
          `shared_folder_email_${token}`,
          JSON.stringify({ email: data.email, permission: data.permission, name: emailInput.trim().split("@")[0] })
        );
      } else {
        setVerifyError(data.error || "You don't have access to this folder");
      }
    } catch {
      setVerifyError("Failed to verify email");
    } finally {
      setVerifying(false);
    }
  }

  function handleSignOut() {
    if (token) {
      localStorage.removeItem(`shared_folder_email_${token}`);
    }
    setVerifiedEmail(null);
    setPermission(null);
    setVerifiedName("");
    setEmailInput("");
    setFolder(null);
    setLoading(true);
    setSelectedVideo(null);
  }

  async function handleAddVideo(e: React.FormEvent) {
    e.preventDefault();
    if (!newVideoUrl.trim() || !token || !verifiedEmail) return;
    setAddingVideo(true);
    setAddVideoError(null);
    try {
      const res = await fetch(`/api/shared/folder/${token}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: verifiedEmail,
          name: verifiedName,
          url: newVideoUrl.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewVideoUrl("");
        await refreshFolder();
      } else {
        setAddVideoError(data.error || "Failed to add video");
      }
    } catch {
      setAddVideoError("Failed to add video");
    } finally {
      setAddingVideo(false);
    }
  }

  async function handleExport(format: "csv" | "json") {
    if (!token || !verifiedEmail || !folder) return;
    try {
      const res = await fetch(
        `/api/shared/folder/${token}/export?email=${encodeURIComponent(verifiedEmail)}&format=${format}`
      );
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `annotations-${folder.name || "folder"}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {}
  }

  const loadAnnotations = useCallback(async (videoId: number) => {
    if (!token) return;
    setAnnotationsLoading(true);
    setFilterTag(null);
    try {
      const res = await fetch(`/api/shared/folder/${token}/annotations?videoId=${videoId}`);
      if (res.ok) setAnnotations(await res.json());
    } finally {
      setAnnotationsLoading(false);
    }
  }, [token]);

  // Live annotation updates: silently refresh every 5s while a video is open
  useEffect(() => {
    if (!selectedVideo || !token) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/shared/folder/${token}/annotations?videoId=${selectedVideo.id}`);
        if (res.ok) {
          const data = await res.json();
          setAnnotations((prev) => {
            if (prev.length === data.length && prev.every((a, i) => a.id === data[i].id && a.updatedAt === data[i].updatedAt)) {
              return prev;
            }
            return data;
          });
        }
      } catch {}
    }, 5000);
    return () => clearInterval(poll);
  }, [selectedVideo, token]);

  const liveAnnotations = useMemo(
    () => annotations.filter((a) => !pendingAnnotationIds.includes(a.id)),
    [annotations, pendingAnnotationIds]
  );
  const visibleAnnotations = useMemo(
    () => (filterTag ? liveAnnotations.filter((a) => a.tags.includes(filterTag)) : liveAnnotations),
    [liveAnnotations, filterTag]
  );

  function selectVideo(video: VideoData) {
    setSelectedVideo(video);
    setPlayerReady(false);
    playerRef.current = null;
    setAnnotations([]);
    loadAnnotations(video.id);
    setStartSec(-1);
    setEndSec(-1);
    setNote("");
    setEditingAnnotation(null);
  }

  // Social platform handling for the selected video
  const sharedSocial = selectedVideo && selectedVideo.platform !== "youtube"
    ? parseSocialStorageId(selectedVideo.youtubeId)
    : null;
  const sharedKind: "youtube" | "vimeo" | "html5" | "embed" =
    selectedVideo?.platform === "upload" || selectedVideo?.platform === "drive"
      ? "html5"
      : !sharedSocial
        ? "youtube"
        : sharedSocial.platform === "vimeo"
          ? "vimeo"
          : "embed";

  // YT IFrame API init
  useEffect(() => {
    if (sharedSocial || sharedKind === "html5") return;
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

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
    const poll = setInterval(() => {
      if (!destroyed && window.YT && window.YT.Player) { clearInterval(poll); createPlayer(); }
    }, 100);

    return () => { destroyed = true; clearInterval(poll); if (timeIntervalRef.current) clearInterval(timeIntervalRef.current); };
  }, [selectedVideo, sharedSocial, sharedKind]);

  // Vimeo Player SDK init (full seek/time control over the embed iframe)
  useEffect(() => {
    if (!selectedVideo || sharedKind !== "vimeo") return;
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

    return () => { destroyed = true; if (timeIntervalRef.current) clearInterval(timeIntervalRef.current); };
  }, [selectedVideo, sharedKind]);

  // Native HTML5 player init for self-hosted uploads
  useEffect(() => {
    if (!selectedVideo || sharedKind !== "html5") return;
    let destroyed = false;
    const el = document.querySelector<HTMLMediaElement>("video[data-html5-player], audio[data-html5-player]");
    if (!el || playerRef.current) return;

    const adapter = new Html5Adapter(el);
    playerRef.current = adapter;
    adapter.onPlayState((playing) => {
      if (destroyed) return;
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
    });
    adapter.onReady(() => {
      if (destroyed) return;
      setDuration(adapter.getDuration());
      setPlayerReady(true);
    });

    return () => {
      destroyed = true;
      adapter.destroy();
      playerRef.current = null;
      if (timeIntervalRef.current) { clearInterval(timeIntervalRef.current); timeIntervalRef.current = null; }
    };
  }, [selectedVideo, sharedKind]);

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
    if (!authorName.trim() || startSec < 0 || endSec < 0 || !token || !selectedVideo || !verifiedEmail) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/shared/folder/${token}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: selectedVideo.id,
          name: authorName.trim(),
          email: verifiedEmail,
          timestampStart: startSec,
          timestampEnd: endSec,
          note: note.trim() || null,
          title: newTitle.trim() || undefined,
        }),
      });
      if (res.ok) {
        setStartSec(-1);
        setEndSec(-1);
        setNote("");
        setNewTitle("");
        await loadAnnotations(selectedVideo.id);
      } else {
        const data = await res.json();
        console.error("Failed to save annotation:", data.error);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteAnnotation(annotationId: number) {
    if (!token || !verifiedEmail) return;
    const snapshot = annotations.find((a) => a.id === annotationId);
    const label = snapshot?.label && snapshot.label !== "Note" ? snapshot.label.slice(0, 40) : `#${annotationId}`;
    enqueueDelete(
      label,
      async () => {
        try {
          const res = await fetch(`/api/shared/folder/${token}/annotations`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ annotationId, email: verifiedEmail }),
          });
          if (res.ok && selectedVideo) {
            await loadAnnotations(selectedVideo.id);
          }
        } catch {}
      },
      () => {},
      [annotationId],
    );
  }

  function startEditAnnotation(a: SharedAnnotation) {
    setEditingAnnotation({ id: a.id, timestampStart: a.timestampStart, timestampEnd: a.timestampEnd, note: a.note ?? "" });
    setEditStart(a.timestampStart);
    setEditEnd(a.timestampEnd);
    setEditNote(a.note ?? "");
    setEditTitle(a.label ?? "");
  }

  function cancelEditAnnotation() {
    setEditingAnnotation(null);
  }

  async function saveEditAnnotation(e: React.FormEvent) {
    e.preventDefault();
    if (!editingAnnotation || !token || !verifiedEmail) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/shared/folder/${token}/annotations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotationId: editingAnnotation.id,
          email: verifiedEmail,
          timestampStart: editStart,
          timestampEnd: editEnd,
          note: editNote.trim() || null,
          title: editTitle.trim(),
        }),
      });
      if (res.ok && selectedVideo) {
        setEditingAnnotation(null);
        await loadAnnotations(selectedVideo.id);
      } else {
        const data = await res.json();
        console.error("Failed to edit annotation:", data.error);
      }
    } catch {} finally {
      setSavingEdit(false);
    }
  }

  const authorName = verifiedName;

  // ── Email verification screen ──
  if (!verifiedEmail) {
    const isAutoChecking = verifying && !!session?.user?.email;
    const autoCheckFailed = !verifying && !!session?.user?.email && !!verifyError;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              {isAutoChecking ? (
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              ) : (
                <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <h1 className="text-lg font-semibold">Shared Folder</h1>
            {isAutoChecking ? (
              <p className="text-sm text-muted mt-1">
                Checking access for <span className="font-medium text-foreground">{session?.user?.email}</span>...
              </p>
            ) : autoCheckFailed ? (
              <p className="text-sm text-muted mt-1">
                Signed in as <span className="font-medium text-foreground">{session?.user?.email}</span>,
                but that email doesn&apos;t have access.
              </p>
            ) : (
              <p className="text-sm text-muted mt-1">
                Enter your email to access this folder
              </p>
            )}
          </div>

          {/* Google sign-in — show when not signed in, or when signed in with an unauthorized email */}
          {(!session?.user?.email || autoCheckFailed) && (
            <button
              onClick={() => signIn("google")}
              className="w-full mb-4 flex items-center justify-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium hover:bg-surface-hover transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" fill="#34A853" />
                <path d="M5.84 14.09a6.6 6.6 0 010-4.18V7.07H2.18a11 11 0 000 9.86l3.66-2.84z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 002.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335" />
              </svg>
              {session?.user?.email
                ? "Sign in with a different Google account"
                : "Continue with Google"}
            </button>
          )}

          {(session?.user?.email || autoCheckFailed) && (
            <div className="flex items-center gap-3 my-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] text-muted uppercase tracking-wider">or use email</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-3">
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="your@email.com"
              required
              autoFocus={!session?.user?.email}
              defaultValue={!session?.user?.email && verifyError ? undefined : undefined}
              className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {verifyError && (
              <p className="text-xs text-danger text-center">{verifyError}</p>
            )}
            <button
              type="submit"
              disabled={verifying || !emailInput.trim()}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {verifying ? "Verifying..." : "Access Folder"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Loading state ──
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

  // ── Error state ──
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

  const canEdit = permission === "edit";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 shrink-0">
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
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
                  {folder.shares && folder.shares.length > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      {folder.shares.map((s, i) => (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ${
                            s.permission === "edit"
                              ? "bg-accent/10 text-accent"
                              : "bg-surface-hover text-muted"
                          }`}
                        >
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          {s.email}
                          <span className="ml-0.5">{s.permission === "edit" ? "✏️" : "👁️"}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <p className="text-xs text-muted">{verifiedEmail}</p>
                <p className="text-[10px] text-muted/60">
                  {canEdit ? "Edit access" : "View only"}
                </p>
              </div>
              <button
                onClick={handleSignOut}
                className="text-[10px] text-muted hover:text-foreground px-2 py-1 rounded border border-border hover:bg-surface-hover transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-6">
        {selectedVideo ? (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Player */}
            <div className="flex-1 min-w-0">
              <div className="aspect-video w-full rounded-xl overflow-hidden border border-border bg-black shadow-sm relative">
                {sharedKind === "html5" && selectedVideo && selectedVideo.mediaType === "audio" ? (
                  <div className="w-full h-full bg-black flex flex-col items-center justify-center gap-4 p-4">
                    {selectedVideo.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={selectedVideo.id}
                        src={selectedVideo.thumbnailUrl}
                        alt={selectedVideo.title ?? "Audio cover"}
                        className="max-h-[55%] max-w-full object-contain rounded-lg shadow-xl ring-1 ring-white/10"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-2xl bg-white/10 flex items-center justify-center">
                        <svg className="w-12 h-12 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.818m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.75z" />
                        </svg>
                      </div>
                    )}
                    <audio
                      key={`a-${selectedVideo.id}`}
                      data-html5-player
                      src={selectedVideo.youtubeUrl}
                      controls
                      preload="metadata"
                      className="w-[min(92%,460px)]"
                    />
                  </div>
                ) : sharedKind === "html5" && selectedVideo ? (
                  <video
                    key={selectedVideo.id}
                    data-html5-player
                    src={selectedVideo.youtubeUrl}
                    controls
                    preload="metadata"
                    className="w-full h-full bg-black"
                  />
                ) : sharedKind === "vimeo" && sharedSocial ? (
                  <iframe
                    key={selectedVideo.id}
                    src={`${socialEmbedUrl(sharedSocial.platform, sharedSocial.platformId, selectedVideo.youtubeUrl)}?api=1`}
                    data-vimeo-player
                    title={selectedVideo.title ?? "Video"}
                    className="w-full h-full"
                    allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
                    allowFullScreen
                  />
                ) : sharedKind === "embed" && sharedSocial ? (
                  <iframe
                    key={selectedVideo.id}
                    src={socialEmbedUrl(sharedSocial.platform, sharedSocial.platformId, selectedVideo.youtubeUrl)}
                    title={selectedVideo.title ?? "Video"}
                    className="w-full h-full"
                    allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
                    allowFullScreen
                  />
                ) : (
                  <>
                    <div ref={playerContainerRef} className="w-full h-full" />
                    {!playerReady && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black">
                        <div className="flex items-center gap-3 text-white/60">
                          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
                          <span className="text-sm">Loading player...</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {sharedKind === "embed" && (
                  <div className="absolute top-2 right-2 z-10">
                    <a href={selectedVideo.youtubeUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] font-medium text-white/90 hover:bg-black/80 transition-colors">
                      Watch on {sharedSocial?.platform}
                    </a>
                  </div>
                )}
              </div>

              {sharedKind === "embed" && (
                <div className="mt-3 rounded-xl border border-border/60 bg-surface px-4 py-3 text-xs text-muted flex items-center gap-2">
                  This platform doesn&apos;t allow player control here — play it above and read the timestamps below.
                </div>
              )}

              {/* Player controls */}
              {playerReady && sharedKind !== "embed" && (
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
              {playerReady && sharedKind !== "embed" && duration > 0 && (
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
              {/* Annotation form (only for edit permission) */}
              {canEdit && (
                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Add Annotation</h3>
                    <span className="text-[10px] text-accent/80 bg-accent/5 px-2 py-0.5 rounded-full">Editing</span>
                  </div>
                  <form onSubmit={handleAddAnnotation} className="space-y-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted/80 bg-background rounded-lg px-3 py-1.5 border border-border/50">
                      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span className="truncate">{verifiedEmail}</span>
                    </div>
                    <div className="flex items-center gap-2 w-full min-w-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] text-muted/60 mb-0.5">Start</div>
                        <div className="flex items-center gap-1 min-w-0">
                          <input
                            type="text"
                            value={startSec < 0 ? "—" : formatTs(startSec)}
                            readOnly
                            className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-mono text-accent tabular-nums"
                          />
                          <button type="button" onClick={markStart}
                            className="text-[9px] text-accent hover:text-accent-hover shrink-0 px-1.5 py-1 rounded hover:bg-accent/5 transition-colors">
                            now
                          </button>
                        </div>
                      </div>
                      <span className="text-muted/30 mt-4">–</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] text-muted/60 mb-0.5">End</div>
                        <div className="flex items-center gap-1 min-w-0">
                          <input
                            type="text"
                            value={endSec < 0 ? "—" : formatTs(endSec)}
                            readOnly
                            className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-mono text-accent tabular-nums"
                          />
                          <button type="button" onClick={markEnd}
                            className="text-[9px] text-accent hover:text-accent-hover shrink-0 px-1.5 py-1 rounded hover:bg-accent/5 transition-colors">
                            now
                          </button>
                        </div>
                      </div>
                    </div>
                    <input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="Title (optional)"
                      maxLength={120}
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                    />
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add a note..."
                      rows={2}
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none resize-none"
                    />
                    <button
                      type="submit"
                      disabled={saving || startSec < 0 || endSec < 0}
                      className="w-full rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {saving ? "Saving..." : "Save Annotation"}
                    </button>
                  </form>
                </div>
              )}

              {/* Permission badge for view-only */}
              {!canEdit && (
                <div className="rounded-xl border border-border bg-surface p-3 text-center">
                  <p className="text-xs text-muted/60">You have view-only access</p>
                </div>
              )}

              {/* Annotation feed */}
              <div className="flex-1 min-h-0">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  Annotations
                  <span className="text-[10px] text-muted/50 font-normal">
                    {filterTag ? `${visibleAnnotations.length} / ${liveAnnotations.length}` : liveAnnotations.length}
                  </span>
                  {filterTag && (
                    <button
                      onClick={() => setFilterTag(null)}
                      className="ml-1 inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent normal-case hover:bg-accent/20 transition-colors"
                      title="Clear tag filter"
                    >
                      #{filterTag} ×
                    </button>
                  )}
                </h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {annotationsLoading && (
                    <div className="flex items-center justify-center py-6">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    </div>
                  )}
                  {!annotationsLoading && visibleAnnotations.length === 0 && (
                    <p className="text-xs text-muted/60 text-center py-6">
                      {filterTag
                        ? `No annotations tagged #${filterTag}.`
                        : canEdit
                        ? "No annotations yet. Play the video and add one!"
                        : "No annotations yet."}
                    </p>
                  )}
                  {visibleAnnotations.map((a) => {
                    const isEditing = editingAnnotation?.id === a.id;
                    return (
                    <div key={a.id}
                      className={`rounded-lg border border-border/60 bg-surface p-2.5 transition-colors group ${isEditing ? "" : "hover:bg-surface-hover/50 cursor-pointer"}`}
                      onClick={isEditing ? undefined : () => playSegment(a.timestampStart, a.timestampEnd)}
                    >
                      {isEditing ? (
                        <form onSubmit={saveEditAnnotation} onClick={(e) => e.stopPropagation()} className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold text-accent/80 truncate">{a.createdBy}</span>
                            <span className="text-[9px] text-muted/40">Editing</span>
                          </div>
                          <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="Title"
                            maxLength={120}
                            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <div className="min-w-0">
                              <div className="text-[9px] text-muted/60 mb-0.5">Start (s)</div>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={editStart}
                                onChange={(e) => setEditStart(parseFloat(e.target.value) || 0)}
                                className="w-full min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-mono text-accent tabular-nums"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[9px] text-muted/60 mb-0.5">End (s)</div>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={editEnd}
                                onChange={(e) => setEditEnd(parseFloat(e.target.value) || 0)}
                                className="w-full min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-mono text-accent tabular-nums"
                              />
                            </div>
                          </div>
                          <textarea
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            rows={2}
                            placeholder="Add a note..."
                            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none resize-none"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              disabled={savingEdit || editEnd < editStart}
                              className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all"
                            >
                              {savingEdit ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditAnnotation}
                              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-semibold text-accent/80 truncate">{a.createdBy}</span>
                          {a.email && (
                            <span className="text-[8px] text-muted/40 truncate">{a.email}</span>
                          )}
                        </div>
                        <span className="text-[9px] font-mono text-muted/50 tabular-nums shrink-0">
                          {formatTs(a.timestampStart)} – {formatTs(a.timestampEnd)}
                        </span>
                      </div>
                      {a.label && a.label !== "Note" && (
                        <p className="text-xs font-medium text-foreground truncate mb-0.5">{a.label}</p>
                      )}
                      {a.note && (
                        <p className="text-[10px] text-muted/80 line-clamp-2">
                          <NoteText note={a.note} />
                        </p>
                      )}
                      {a.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                          {a.tags.map((tag) => (
                            <button
                              key={tag}
                              onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                              className={`text-[9px] font-mono transition-colors ${
                                filterTag === tag ? "text-accent" : "text-muted/50 hover:text-accent"
                              }`}
                            >
                              #{tag}
                            </button>
                          ))}
                        </div>
                      )}
                      {/* Edit + Delete buttons for own annotations */}
                      {canEdit && a.email === verifiedEmail && (
                        <div className="mt-1.5 flex items-center gap-3 opacity-0 group-hover:opacity-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditAnnotation(a);
                            }}
                            className="text-[9px] text-accent/60 hover:text-accent transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteAnnotation(a.id);
                            }}
                            className="text-[9px] text-danger/60 hover:text-danger transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                        </>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : folder.videos.length === 0 ? (
          <>
            <div className="flex flex-col sm:flex-row gap-3 mb-5 items-stretch sm:items-center justify-between">
              {canEdit ? (
                <form onSubmit={handleAddVideo} className="flex flex-1 min-w-0 gap-2">
                  <input
                    type="text"
                    value={newVideoUrl}
                    onChange={(e) => setNewVideoUrl(e.target.value)}
                    placeholder="Paste a YouTube URL to add a video..."
                    className="flex-1 min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    type="submit"
                    disabled={addingVideo || !newVideoUrl.trim()}
                    className="shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {addingVideo ? "Adding..." : "Add video"}
                  </button>
                </form>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-muted/60">Export</span>
                <button
                  onClick={() => handleExport("csv")}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                >
                  CSV
                </button>
                <button
                  onClick={() => handleExport("json")}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                >
                  JSON
                </button>
              </div>
            </div>
            {addVideoError && <p className="text-xs text-danger mb-3">{addVideoError}</p>}
            <div className="rounded-lg border border-dashed border-border py-20 text-center">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-hover border border-border flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm text-muted">This folder is empty.</p>
              {canEdit && (
                <p className="text-xs text-muted/60 mt-1">Add a YouTube video above to get started.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-3 mb-5 items-stretch sm:items-center justify-between">
              {canEdit ? (
                <form onSubmit={handleAddVideo} className="flex flex-1 min-w-0 gap-2">
                  <input
                    type="text"
                    value={newVideoUrl}
                    onChange={(e) => setNewVideoUrl(e.target.value)}
                    placeholder="Paste a YouTube URL to add a video..."
                    className="flex-1 min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    type="submit"
                    disabled={addingVideo || !newVideoUrl.trim()}
                    className="shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {addingVideo ? "Adding..." : "Add video"}
                  </button>
                </form>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-muted/60">Export</span>
                <button
                  onClick={() => handleExport("csv")}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                >
                  CSV
                </button>
                <button
                  onClick={() => handleExport("json")}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                >
                  JSON
                </button>
              </div>
            </div>
            {addVideoError && <p className="text-xs text-danger mb-3">{addVideoError}</p>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {folder.videos.map((v) => (
                <button
                  key={v.id}
                  onClick={() => selectVideo(v)}
                  className="group rounded-xl border border-border bg-surface hover:border-accent/50 hover:bg-surface-hover/30 transition-all overflow-hidden text-left"
                >
                  <div className="aspect-video w-full overflow-hidden bg-muted relative">
                    {v.thumbnailUrl ? (
                      <Image src={v.thumbnailUrl} alt={v.title ?? "Video"} fill className="object-cover group-hover:scale-105 transition-transform duration-300" unoptimized={!isTrustedImageUrl(v.thumbnailUrl)} />
                    ) : v.platform === "drive" ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-muted/40" viewBox="0 0 87.3 78" fill="currentColor" aria-hidden="true">
                          <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L31.5 19.6 9.6 54.6a7.02 7.02 0 0 0-3 12.25z" />
                          <path d="M43.65 25.5 36.3 8.85a6.94 6.94 0 0 0-5.9-4.9 6.82 6.82 0 0 0-4.05.85.45.45 0 0 0-.1.5L4.5 55.55c-.4.7-.65 1.45-.75 2.25l.05.35-3.5 6.05L2.9 67.8h.4l34.1-35.7a6.97 6.97 0 0 0 6.25-6.6z" />
                          <path d="M54.65 18.6H45.9a7.02 7.02 0 0 1-5.05 6.95l-8.7 3.6-8.3 3.45-5.25 2.15 10.75-24.3-2.85-5.5-3.6 2.6 2.8 5.45-6.95 15.1 43.9-18.2a6.75 6.75 0 0 0-5.7-3.3h-.2l.3-.05c0-.1 0-.1-.05-.15h-.05l-.05.05z" />
                          <path d="M44.9 78h30.55a6.8 6.8 0 0 0 6.9-6.1c.05-.3.05-.6.05-.9 0-1.35-.4-2.65-1.1-3.75l-17-29.45a6.9 6.9 0 0 0-11.9 0l-8.7 15.05-4.35 7.55-7.5 13a7.06 7.06 0 0 0 5.9 10.6z" />
                          <path d="M57.88 6.68a7.06 7.06 0 0 1 5.4-1.6 6.95 6.95 0 0 1 4.5 2.6l5.75 9.4-4.45-7.75-14.1 24.4 10.6 18.35v-.05l12.05-20.85a6.9 6.9 0 0 0-.55-7.55 6.85 6.85 0 0 0-5.35-2.75l-14.15-.2z" />
                        </svg>
                      </div>
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
          </>
        )}
      </main>

      {/* ── Undo toast ── */}
      {pendingDelete && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-xl">
          <span className="text-xs text-foreground truncate max-w-[240px]">
            <span className="text-muted">Deleted</span> — {pendingDelete.label}
          </span>
          <button
            onClick={undoPendingDelete}
            className="text-xs font-medium text-accent hover:text-accent-hover transition-colors shrink-0"
          >
            Undo
          </button>
          <button
            onClick={flushPendingDelete}
            className="p-1 rounded text-muted/50 hover:text-foreground transition-colors shrink-0"
            title="Delete now"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      <style jsx global>{`
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 4px; }
      `}</style>
    </div>
  );
}