"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import VideoPlaylistPlayer, { ClipItem, formatTs } from "@/components/VideoPlaylistPlayer";
import HistoryPanel from "@/components/HistoryPanel";
import { pushHistory } from "@/lib/history";
import { useLanguage } from "@/components/LanguageProvider";
import HelpSection from "@/components/HelpSection";
import GuidedTour, { isTourCompleted, completeTour, type TourStep } from "@/components/GuidedTour";

interface Video {
  id: number;
  youtubeUrl: string;
  youtubeId: string;
  title: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  year?: number | null;
  channel?: string | null;
  annotationCount?: number;
  sceneCount?: number;
  momentCount?: number;
  hasTranscript?: boolean;
  searchText?: string;
  folderName?: string | null;
  latestAnnotationAt?: string;
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
  videoYear: number | null;
  videoChannel: string | null;
  folderName: string | null;
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

interface CliplistWithItems extends Cliplist {
  items: ClipItem[];
}

type SelectedCliplistItem = CliplistWithItems["items"][number];

type Tab = "import" | "search" | "cliplists" | "settings" | "help";

function isPlaylistUrl(u: string) {
  return /[?&]list=/.test(u);
}

function highlight(text: string, query: string) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
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

// Dark slide themes that read well with white text in the playlist player
const SLIDE_COLORS = ["", "#1e1b4b", "#312e81", "#134e4a", "#0c4a6e", "#4c1d95", "#3f3f46", "#713f12"];

function parseBulkSlides(text: string): Array<{ title: string; detail: string | null; endTimestamp: number | null }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((p) => p.trim());
      const title = parts[0] || "";
      const detail = parts[1] || null;
      let endTimestamp: number | null = 5;
      if (parts[2]) {
        if (/^hold$/i.test(parts[2])) endTimestamp = null;
        else {
          const n = Number(parts[2]);
          endTimestamp = Number.isFinite(n) && n > 0 ? Math.min(3600, n) : 5;
        }
      }
      return { title, detail, endTimestamp };
    })
    .filter((s) => s.title);
}

export default function Home() {
  const { data: session } = useSession();
  const { t, language, toggleLanguage } = useLanguage();
  const [tab, setTab] = useState<Tab>("import");

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractKeyMoments, setExtractKeyMoments] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [fetching, setFetching] = useState(true);

  const [showTour, setShowTour] = useState(() => !isTourCompleted("vestigia-dashboard-tour"));
  const DASHBOARD_TOUR_STEPS: TourStep[] = [
    { target: '[data-tour="import-tab"]', title: t("tour.step1Title"), description: t("tour.step1Desc"), placement: "bottom" },
    { target: '[data-tour="import-input"]', title: t("tour.step2Title"), description: t("tour.step2Desc"), placement: "bottom" },
    { target: '[data-tour="sidebar-folders"]', title: t("tour.step3Title"), description: t("tour.step3Desc"), placement: "right" },
    { target: '[data-tour="video-grid"]', title: t("tour.step4Title"), description: t("tour.step4Desc"), placement: "top" },
    { target: '[data-tour="search-tab"]', title: t("tour.step5Title"), description: t("tour.step5Desc"), placement: "bottom" },
  ];

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [playlistVideos, setPlaylistVideos] = useState<PlaylistVideo[]>([]);
  const [playlistSelected, setPlaylistSelected] = useState<Set<string>>(new Set());
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistImporting, setPlaylistImporting] = useState(false);
  const [playlistImportProgress, setPlaylistImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [playlistTargetFolder, setPlaylistTargetFolder] = useState<number | null>(null);
  const [playlistNewFolderName, setPlaylistNewFolderName] = useState("");
  const [playlistCreatingFolder, setPlaylistCreatingFolder] = useState(false);
  const [playlistFolderDropdownOpen, setPlaylistFolderDropdownOpen] = useState(false);

  // ── Cliplist state ──
  const [cliplists, setCliplists] = useState<Cliplist[]>([]);
  const [cliplistsLoading, setCliplistsLoading] = useState(false);
  const [selectedCliplist, setSelectedCliplist] = useState<CliplistWithItems | null>(null);
  const [showCreateCliplist, setShowCreateCliplist] = useState(false);
  const [newCliplistName, setNewCliplistName] = useState("");
  const [newCliplistDesc, setNewCliplistDesc] = useState("");
  const [creatingCliplist, setCreatingCliplist] = useState(false);
  const [slideshowItems, setSlideshowItems] = useState<ClipItem[] | null>(null);
  const [editingCliplistId, setEditingCliplistId] = useState<number | null>(null);
  const [editingCliplistName, setEditingCliplistName] = useState("");
  const [showSlideForm, setShowSlideForm] = useState(false);
  const [slideTitle, setSlideTitle] = useState("");
  const [slideDetail, setSlideDetail] = useState("");
  const [slideDuration, setSlideDuration] = useState(5);
  const [slideHold, setSlideHold] = useState(false);
  const [slideColor, setSlideColor] = useState("");
  const [slideImage, setSlideImage] = useState("");
  const [slideInsertIdx, setSlideInsertIdx] = useState(-1); // -1 = at end, else insert after items[idx]
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [dragArmedId, setDragArmedId] = useState<number | null>(null);
  const [dragItemId, setDragItemId] = useState<number | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<number | null>(null);
  const [editingSlideId, setEditingSlideId] = useState<number | null>(null);
  const [editSlideTitle, setEditSlideTitle] = useState("");
  const [editSlideDetail, setEditSlideDetail] = useState("");
  const [editSlideDuration, setEditSlideDuration] = useState(5);
  const [editSlideHold, setEditSlideHold] = useState(false);
  const [editSlideColor, setEditSlideColor] = useState("");
  const [editSlideImage, setEditSlideImage] = useState("");
  const [editingClipId, setEditingClipId] = useState<number | null>(null);
  const [editClipTitle, setEditClipTitle] = useState("");
  const [editClipDetail, setEditClipDetail] = useState("");
  const [editClipStart, setEditClipStart] = useState(0);
  const [editClipEnd, setEditClipEnd] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  // ── Settings state ──
  const [settings, setSettings] = useState<{ aiKeys: Record<string, string>; preferredProvider: string | null }>({ aiKeys: {}, preferredProvider: null });
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set());
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; testing: boolean; error?: string }>>({});
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Folder state ──
  const [folderList, setFolderList] = useState<Array<{ id: number; name: string; videoCount: number; shareToken: string | null; color?: string | null }>>([]);
  const [sharedFolderCopied, setSharedFolderCopied] = useState<number | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [folderVideos, setFolderVideos] = useState<Video[]>([]);
  const [folderVideosLoading, setFolderVideosLoading] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderDropdown, setFolderDropdown] = useState<{ videoId: number; open: boolean }>({ videoId: -1, open: false });
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [bulkFolderDropdown, setBulkFolderDropdown] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<{ done: number; total: number } | null>(null);

  // ── Undoable deletes: hide immediately, commit the server DELETE after a
  // short delay unless the user hits Undo. Nothing is sent before the timeout,
  // so Undo is a pure client-side cancel. ──
  const UNDO_MS = 8000;
  interface PendingDelete { label: string; commit: () => Promise<void>; revert: () => void; }
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const pendingRef = useRef<PendingDelete | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingVideoIds, setPendingVideoIds] = useState<number[]>([]);
  const [pendingFolderIds, setPendingFolderIds] = useState<number[]>([]);
  const [pendingCliplistIds, setPendingCliplistIds] = useState<number[]>([]);
  const [pendingItemIds, setPendingItemIds] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // ── Video grid enhancements ──
  const [allVideos, setAllVideos] = useState<Video[]>([]);
  const [_allVideosLoading, setAllVideosLoading] = useState(false);
  const [showAllVideos, setShowAllVideos] = useState(false);

  // ── Search enhancements ──
  const [searchTypeFilter, setSearchTypeFilter] = useState<string | null>(null);
  const [searchFolderFilter, setSearchFolderFilter] = useState<number | null>(null);
  const [searchYearFilter, setSearchYearFilter] = useState<number | null>(null);
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const SEARCH_LIMIT = 50;

  // ── Tag browser ──
  const [showTagBrowser, setShowTagBrowser] = useState(false);
  const [globalTags, setGlobalTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [globalTagsLoading, setGlobalTagsLoading] = useState(false);

  // ── Cmd+K global search ──
  const [showCmdK, setShowCmdK] = useState(false);
  const cmdKInputRef = useRef<HTMLInputElement>(null);

  // ── Pinned searches ──
  const [pinnedSearches, setPinnedSearches] = useState<string[]>([]);

  // ── Cliplist bulk selection ──
  const [cliplistSelectedIds, setCliplistSelectedIds] = useState<Set<number>>(new Set()); // eslint-disable-line @typescript-eslint/no-unused-vars

  // ── Share dialog state ──
  const [shareDialogFolderId, setShareDialogFolderId] = useState<number | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareList, setShareList] = useState<Array<{ id: number; email: string; permission: string }>>([]);
  const [shareListLoading, setShareListLoading] = useState(false);
  const [newShareEmail, setNewShareEmail] = useState("");
  const [newSharePermission, setNewSharePermission] = useState<"view" | "edit">("view");
  const [addingShare, setAddingShare] = useState(false);
  const [savedEmails, setSavedEmails] = useState<string[]>([]);
  const [saveEmailForFuture, setSaveEmailForFuture] = useState(true);

  // ── Translation state ──
  const [translatedTitles, setTranslatedTitles] = useState<Map<number, string>>(new Map());
  const [translating, setTranslating] = useState(false);
  const [translatedLang, setTranslatedLang] = useState<"pt" | "en" | null>(null);

  // "Add to cliplist" dropdown per search result
  const [addToDropdown, setAddToDropdown] = useState<{ index: number; open: boolean }>({ index: -1, open: false });
  const addToRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const openIdx = addToDropdown.index;
      if (openIdx >= 0) {
        const ref = addToRefs.current.get(openIdx);
        if (ref && !ref.contains(e.target as Node)) {
          setAddToDropdown({ index: -1, open: false });
        }
      }
      // Close folder dropdown on outside click
      if (folderDropdown.open) {
        const target = e.target as HTMLElement;
        if (!target.closest("[data-folder-dropdown]")) {
          setFolderDropdown({ videoId: -1, open: false });
        }
      }
      // Close bulk folder dropdown on outside click
      if (bulkFolderDropdown) {
        const target = e.target as HTMLElement;
        if (!target.closest("[data-folder-dropdown]")) {
          setBulkFolderDropdown(false);
        }
      }
      // Close playlist folder dropdown on outside click
      if (playlistFolderDropdownOpen) {
        const target = e.target as HTMLElement;
        if (!target.closest("[data-folder-dropdown]")) {
          setPlaylistFolderDropdownOpen(false);
        }
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [addToDropdown.index, folderDropdown.open, bulkFolderDropdown, playlistFolderDropdownOpen]);

  const loadVideos = useCallback(async () => {
    try {
      const res = await fetch("/api/videos");
      if (res.ok) setVideos(await res.json());
    } finally {
      setFetching(false);
    }
  }, []);

  // ── Load folders ──
  const loadFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/folders");
      if (res.ok) setFolderList(await res.json());
    } catch {}
  }, []);

  const loadFolderVideos = useCallback(async (folderId: number) => {
    setFolderVideosLoading(true);
    try {
      const res = await fetch(`/api/folders/${folderId}`);
      if (res.ok) {
        const data = await res.json();
        setFolderVideos(data.videos ?? []);
      }
    } finally {
      setFolderVideosLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVideos();  
    loadFolders(); // eslint-disable-line react-hooks/set-state-in-effect

    // Auto-select folder from URL ?folder= param
    const params = new URLSearchParams(window.location.search);
    const folderParam = params.get("folder");
    if (folderParam) {
      const fid = parseInt(folderParam);
      if (!isNaN(fid)) setSelectedFolderId(fid);
    }

    // Auto-select cliplist from URL ?cliplist= param
    const cliplistParam = params.get("cliplist");
    if (cliplistParam) {
      const cid = parseInt(cliplistParam);
      if (!isNaN(cid)) {
        setTab("cliplists");
        fetch(`/api/cliplists/${cid}`).then(r => r.ok ? r.json() : null).then(data => { if (data) setSelectedCliplist(data); }).catch(() => {});
      }
    }
  }, [loadVideos, loadFolders]);

  useEffect(() => {
    if (selectedFolderId !== null) {
      loadFolderVideos(selectedFolderId); // eslint-disable-line react-hooks/set-state-in-effect
    } else {
      setFolderVideos([]);  
    }
  }, [selectedFolderId, loadFolderVideos]);

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

  const loadAllVideos = useCallback(async () => {
    setAllVideosLoading(true);
    try {
      const res = await fetch(`/api/videos/all?sort=newest`);
      if (res.ok) setAllVideos(await res.json());
    } finally {
      setAllVideosLoading(false);
    }
  }, []);

  const loadGlobalTags = useCallback(async () => {
    setGlobalTagsLoading(true);
    try {
      const res = await fetch("/api/tags");
      if (res.ok) { const data = await res.json(); setGlobalTags(data.tags ?? []); }
    } finally {
      setGlobalTagsLoading(false);
    }
  }, []);

  // ── Load settings ──
  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        const keys = data.aiKeys ?? {};
        // API returns masked keys — extract which providers have keys configured
        const configured = new Set<string>();
        for (const [provider, masked] of Object.entries(keys)) {
          if (masked && masked !== "****" && typeof masked === "string" && masked.length > 0) {
            configured.add(provider);
          }
        }
        setConfiguredProviders(configured);
        // Don't populate inputs with masked keys — start empty
        setSettings({ aiKeys: {}, preferredProvider: data.preferredProvider ?? null });
      }
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (newSettings: { aiKeys: Record<string, string>; preferredProvider: string | null }) => {
    setSettingsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      if (res.ok) {
        const data = await res.json();
        const keys = data.aiKeys ?? {};
        const configured = new Set<string>();
        for (const [provider, masked] of Object.entries(keys)) {
          if (masked && masked !== "****" && typeof masked === "string" && masked.length > 0) {
            configured.add(provider);
          }
        }
        setConfiguredProviders(configured);
        setSettings({ aiKeys: {}, preferredProvider: data.preferredProvider ?? null });
      }
    } finally {
      setSettingsSaving(false);
    }
  }, []);

  const testProvider = useCallback(async (provider: string) => {
    setTestResults(prev => ({ ...prev, [provider]: { success: false, testing: true } }));
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      setTestResults(prev => ({ ...prev, [provider]: { success: data.success, testing: false, error: data.error } }));
      // If test failed, remove from configuredProviders (key is broken)
      if (!data.success) {
        setConfiguredProviders(prev => { const next = new Set(prev); next.delete(provider); return next; });
      }
    } catch {
      setTestResults(prev => ({ ...prev, [provider]: { success: false, testing: false, error: "Network error" } }));
    }
  }, []);

  // Load cliplists when switching to the cliplists tab
  const switchToTab = useCallback((newTab: Tab) => {
    setTab(newTab);
    if (newTab === "cliplists") loadCliplists();
    if (newTab === "settings") loadSettings();
  }, [loadCliplists, loadSettings]);

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
        body: JSON.stringify({ url: url.trim(), extractKeyMoments }),
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

  function flushPendingDelete() {
    if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
    const p = pendingRef.current;
    pendingRef.current = null;
    setPendingDelete(null);
    setPendingVideoIds([]); setPendingFolderIds([]); setPendingCliplistIds([]); setPendingItemIds([]);
    void p?.commit();
  }

  function undoPendingDelete() {
    if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
    const p = pendingRef.current;
    pendingRef.current = null;
    setPendingDelete(null);
    setPendingVideoIds([]); setPendingFolderIds([]); setPendingCliplistIds([]); setPendingItemIds([]);
    p?.revert();
  }

  function enqueueDelete(label: string, commit: () => Promise<void>, revert: () => void, hide: { videos?: number[]; folders?: number[]; cliplists?: number[]; items?: number[] } = {}) {
    // A new delete supersedes a pending one: commit the old immediately.
    if (pendingRef.current) flushPendingDelete();
    pendingRef.current = { label, commit, revert };
    setPendingDelete({ label, commit, revert });
    if (hide.videos) setPendingVideoIds(hide.videos);
    if (hide.folders) setPendingFolderIds(hide.folders);
    if (hide.cliplists) setPendingCliplistIds(hide.cliplists);
    if (hide.items) setPendingItemIds(hide.items);
    pendingTimerRef.current = setTimeout(() => { flushPendingDelete(); }, UNDO_MS);
  }

  // Commit an in-flight undoable delete when leaving the page.
  useEffect(() => () => { if (pendingRef.current) void pendingRef.current.commit(); }, []);

  // Load all videos when toggling "All Videos" mode
  useEffect(() => {
    if (showAllVideos) loadAllVideos(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [showAllVideos, loadAllVideos]);

  // Load global tags when tag browser opens
  useEffect(() => {
    if (showTagBrowser && globalTags.length === 0) loadGlobalTags(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [showTagBrowser, globalTags.length, loadGlobalTags]);

  // Load pinned searches from settings on mount
  useEffect(() => {
    fetch("/api/settings").then(r => r.ok ? r.json() : null).then(data => {
      if (data?.pinnedSearches) setPinnedSearches(data.pinnedSearches);
    }).catch(() => {});
  }, []);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCmdK(true);
      }
      if (e.key === "Escape") setShowCmdK(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function handleDelete(id: number) {
    const doDelete = async () => {
      await fetch(`/api/videos/${id}`, { method: "DELETE" });
      await loadVideos();
      if (selectedFolderId !== null) await loadFolderVideos(selectedFolderId);
    };
    const video = currentVideoList.find((v) => v.id === id);
    enqueueDelete(
      video?.title ? video.title.slice(0, 40) : `#${id}`,
      doDelete,
      () => {},
      { videos: [id] },
    );
  }

  // ── Local file upload (self-hosted video, full annotation support) ──
  async function probeVideoDuration(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const el = document.createElement("video");
      const objUrl = URL.createObjectURL(file);
      const done = (d: number | null) => {
        URL.revokeObjectURL(objUrl);
        el.removeAttribute("src");
        resolve(d);
      };
      const timer = setTimeout(() => done(null), 15000);
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        clearTimeout(timer);
        done(Number.isFinite(el.duration) ? el.duration : null);
      };
      el.onerror = () => { clearTimeout(timer); done(null); };
      el.src = objUrl;
    });
  }

  async function captureThumbnail(file: File, duration: number | null): Promise<Blob | null> {
    if (!document.createElement("canvas").getContext("2d")) return null;
    return new Promise((resolve) => {
      const el = document.createElement("video");
      const objUrl = URL.createObjectURL(file);
      const timer = setTimeout(() => { URL.revokeObjectURL(objUrl); resolve(null); }, 15000);
      el.muted = true;
      el.preload = "auto";
      el.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = Math.round(640 * (el.videoHeight / el.videoWidth)) || 360;
          canvas.getContext("2d")!.drawImage(el, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => { clearTimeout(timer); URL.revokeObjectURL(objUrl); resolve(blob); },
            "image/jpeg",
            0.75,
          );
        } catch {
          clearTimeout(timer);
          URL.revokeObjectURL(objUrl);
          resolve(null);
        }
      };
      el.onerror = () => { clearTimeout(timer); URL.revokeObjectURL(objUrl); resolve(null); };
      el.src = objUrl;
      el.onloadedmetadata = () => {
        el.currentTime = duration && Number.isFinite(duration) ? Math.min(duration * 0.1, 5) : 0.5;
      };
    });
  }

  async function handleLocalUpload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const [{ upload }, duration] = await Promise.all([
        import("@vercel/blob/client"),
        probeVideoDuration(file),
      ]);
      const videoBlob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: file.type || "video/mp4",
      });
      let thumbnailUrl: string | undefined;
      try {
        const thumb = await captureThumbnail(file, duration);
        if (thumb) {
          const thumbBlob = await upload(`thumb-${file.name}.jpg`, thumb, {
            access: "public",
            handleUploadUrl: "/api/upload",
            contentType: "image/jpeg",
          });
          thumbnailUrl = thumbBlob.url;
        }
      } catch {
        // Thumbnail is optional — don't fail the import after the video
        // itself is already stored.
      }
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: videoBlob.url,
          title: file.name.replace(/\.[^.]+$/, ""),
          thumbnailUrl,
          durationSeconds: duration,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error || "Failed to add uploaded video");
      }
      await loadVideos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ── Folder management ──
  async function createFolder() {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });
      setNewFolderName("");
      setShowCreateFolder(false);
      await loadFolders();
    } finally {
      setCreatingFolder(false);
    }
  }

  async function renameFolder(folderId: number) {
    if (!editingFolderName.trim()) return;
    await fetch(`/api/folders/${folderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingFolderName.trim() }),
    });
    setEditingFolderId(null);
    await loadFolders();
  }

  async function deleteFolder(folderId: number) {
    const folder = folderList.find((f) => f.id === folderId);
    if (selectedFolderId === folderId) setSelectedFolderId(null);
    enqueueDelete(
      folder?.name ?? `#${folderId}`,
      async () => {
        await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
        await loadFolders();
      },
      () => {},
      { folders: [folderId] },
    );
  }

  // ── Share dialog ──
  async function openShareDialog(folderId: number) {
    setShareDialogFolderId(folderId);
    setShareDialogOpen(true);
    setShareLink("");
    setShareList([]);
    setNewShareEmail("");
    setNewSharePermission("view");
    // Generate share link
    try {
      const res = await fetch(`/api/folders/${folderId}/share`, { method: "POST" });
      if (res.ok) {
        const { url } = await res.json();
        setShareLink(url);
      }
    } catch {}
    // Load existing shares
    await loadShareList(folderId);
    // Load saved emails for future shares
    try {
      const res = await fetch("/api/users/saved-emails");
      if (res.ok) setSavedEmails(await res.json());
    } catch {}
  }

  async function loadShareList(folderId: number) {
    setShareListLoading(true);
    try {
      const res = await fetch(`/api/folders/${folderId}/shares`);
      if (res.ok) setShareList(await res.json());
    } catch {}
    setShareListLoading(false);
  }

  async function handleAddShare(e: React.FormEvent) {
    e.preventDefault();
    if (!newShareEmail.trim() || !shareDialogFolderId) return;
    setAddingShare(true);
    try {
      const email = newShareEmail.trim().toLowerCase();
      const res = await fetch(`/api/folders/${shareDialogFolderId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, permission: newSharePermission }),
      });
      if (res.ok) {
        if (saveEmailForFuture) {
          try {
            await fetch("/api/users/saved-emails", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            });
            setSavedEmails((prev) => (prev.includes(email) ? prev : [...prev, email]));
          } catch {}
        }
        setNewShareEmail("");
        await loadShareList(shareDialogFolderId);
      } else {
        const data = await res.json();
        console.error("Failed to add share:", data.error);
      }
    } catch {}
    setAddingShare(false);
  }

  function handleRemoveSavedEmail(email: string) {
    setSavedEmails((prev) => prev.filter((e) => e !== email));
    enqueueDelete(
      t("undo.savedEmail"),
      async () => {
        try {
          await fetch(`/api/users/saved-emails?email=${encodeURIComponent(email)}`, { method: "DELETE" });
        } catch {}
      },
      () => setSavedEmails((prev) => (prev.includes(email) ? prev : [...prev, email])),
    );
  }

  function handleRemoveShare(email: string) {
    if (!shareDialogFolderId) return;
    const folderId = shareDialogFolderId;
    enqueueDelete(
      `${t("undo.invite")} ${email}`,
      async () => {
        try {
          await fetch(`/api/folders/${folderId}/shares?email=${encodeURIComponent(email)}`, { method: "DELETE" });
          await loadShareList(folderId);
          await loadFolders();
        } catch {}
      },
      () => {},
    );
  }

  async function handleCopyShareLink() {
    if (shareLink) {
      await navigator.clipboard.writeText(shareLink);
      setSharedFolderCopied(shareDialogFolderId);
      setTimeout(() => setSharedFolderCopied(null), 2000);
    }
  }

  async function addVideoToFolder(folderId: number, videoId: number) {
    await fetch(`/api/folders/${folderId}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
    });
    await loadFolders();
    await loadVideos();
    if (selectedFolderId === folderId) await loadFolderVideos(folderId);
    setFolderDropdown({ videoId: -1, open: false });
  }

  function removeVideoFromFolder(folderId: number, videoId: number) {
    enqueueDelete(
      t("undo.removedFromFolder"),
      async () => {
        try {
          await fetch(`/api/folders/${folderId}/videos`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId }),
          });
        } catch {}
        await loadFolders();
        await loadVideos();
        if (selectedFolderId === folderId) await loadFolderVideos(folderId);
        setFolderDropdown({ videoId: -1, open: false });
      },
      () => {},
    );
  }

  async function bulkAddToFolder(folderId: number) {
    const ids = Array.from(selectedVideoIds);
    for (const videoId of ids) {
      await fetch(`/api/folders/${folderId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
    }
    setSelectedVideoIds(new Set());
    setBulkFolderDropdown(false);
    await loadFolders();
    await loadVideos();
    if (selectedFolderId === folderId) await loadFolderVideos(folderId);
  }

  async function bulkDeleteSelected() {
    const ids = Array.from(selectedVideoIds);
    if (!ids.length) return;
    const doDelete = async () => {
      setBulkDeleteProgress({ done: 0, total: ids.length });
      for (let i = 0; i < ids.length; i++) {
        await fetch(`/api/videos/${ids[i]}`, { method: "DELETE" });
        setBulkDeleteProgress({ done: i + 1, total: ids.length });
      }
      setBulkDeleteProgress(null);
      await loadVideos();
      if (selectedFolderId !== null) await loadFolderVideos(selectedFolderId);
    };
    setSelectedVideoIds(new Set());
    enqueueDelete(`${ids.length} ${t("undo.videos")}`, doDelete, () => {}, { videos: ids });
  }

  function toggleVideoSelection(videoId: number) {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }

  async function translateTitles() {
    const target = translatedLang === "pt" ? "English" : "Portuguese";
    const newLang = translatedLang === "pt" ? "en" : "pt";
    const list = currentVideoList;
    const titles = list.map((v) => v.title || "");
    if (!titles.some(Boolean)) return;
    setTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: titles, targetLanguage: target }),
      });
      if (res.ok) {
        const { translated } = await res.json();
        const newMap = new Map<number, string>();
        list.forEach((v, i) => {
          if (translated[i]) newMap.set(v.id, translated[i]);
        });
        setTranslatedTitles(newMap);
        setTranslatedLang(newLang);
      }
    } catch {}
    setTranslating(false);
  }

  function clearTitleTranslations() {
    setTranslatedTitles(new Map());
    setTranslatedLang(null);
  }

  const visibleVideos = useMemo(() => videos.filter((v) => !pendingVideoIds.includes(v.id)), [videos, pendingVideoIds]);
  const visibleFolderVideos = useMemo(() => folderVideos.filter((v) => !pendingVideoIds.includes(v.id)), [folderVideos, pendingVideoIds]);
  const visibleCliplists = useMemo(() => cliplists.filter((c) => !pendingCliplistIds.includes(c.id)), [cliplists, pendingCliplistIds]);
  const currentVideoList = selectedFolderId !== null ? visibleFolderVideos : visibleVideos;
  const allSelected = currentVideoList.length > 0 && currentVideoList.every((v) => selectedVideoIds.has(v.id));

  // ── Grid: source selection only (no client-side filter/sort) ──
  const gridVideos = useMemo(() => {
    return showAllVideos ? allVideos : (selectedFolderId !== null ? visibleFolderVideos : visibleVideos);
  }, [showAllVideos, allVideos, selectedFolderId, visibleFolderVideos, visibleVideos]);

  const uniqueYears = useMemo(() => {
    const source = showAllVideos ? allVideos : videos;
    const years = new Set<number>();
    for (const v of source) { if (v.year != null) years.add(v.year); }
    return Array.from(years).sort((a, b) => b - a);
  }, [allVideos, videos, showAllVideos]);

  async function fetchPlaylist(playlistUrl: string) {
    setPlaylistLoading(true);
    setPlaylistError(null);
    setPlaylistVideos([]);
    setPlaylistSelected(new Set());
    try {
      const [playlistRes, videosRes] = await Promise.all([
        fetch("/api/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: playlistUrl }),
        }),
        fetch("/api/videos"),
      ]);
      if (!playlistRes.ok) {
        const data = await playlistRes.json();
        throw new Error(data.error || "Failed to fetch playlist");
      }
      const data = await playlistRes.json();
      const vids: PlaylistVideo[] = data.videos;

      const existing = videosRes.ok ? ((await videosRes.json()) as Video[]) : [];
      const existSet = new Set(existing.map((v) => v.youtubeId));
      setImportedIds(existSet);

      const newOnly = vids.filter((v) => !existSet.has(v.id));
      setPlaylistVideos(vids);
      setPlaylistSelected(new Set(newOnly.map((v) => v.id)));
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
    const importable = playlistVideos.filter((v) => !importedIds.has(v.id));
    if (playlistSelected.size === importable.length) {
      setPlaylistSelected(new Set());
    } else {
      setPlaylistSelected(new Set(importable.map((v) => v.id)));
    }
  }

  function cancelPlaylist() {
    setPlaylistVideos([]);
    setPlaylistSelected(new Set());
    setPlaylistError(null);
    setImportedIds(new Set());
    setPlaylistImportProgress(null);
    setPlaylistTargetFolder(null);
    setPlaylistNewFolderName("");
    setPlaylistFolderDropdownOpen(false);
    setUrl("");
  }

  async function importSelectedVideos() {
    const toImport = playlistVideos.filter((v) => playlistSelected.has(v.id) && !importedIds.has(v.id));
    if (!toImport.length) return;
    setPlaylistImporting(true);
    setPlaylistImportProgress({ done: 0, total: toImport.length });
    const targetFolderId = playlistTargetFolder && playlistTargetFolder > 0 ? playlistTargetFolder : null;
    try {
      const newImported = new Set(importedIds);
      for (let i = 0; i < toImport.length; i++) {
        const v = toImport[i];
        try {
          const payload = {
            url: `https://www.youtube.com/watch?v=${v.id}`,
            title: v.title,
            thumbnailUrl: v.thumbnail,
            extractKeyMoments,
          };
          // Use the atomic endpoint when importing into a folder so the video
          // is created and linked in one request (no orphan videos on failure).
          const endpoint = targetFolderId
            ? `/api/folders/${targetFolderId}/videos`
            : "/api/videos";
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            newImported.add(v.id);
          } else {
            console.error(`[import] POST ${endpoint} failed for ${v.id}: ${res.status}`, await res.text().catch(() => ""));
          }
        } catch (e) {
          console.error(`[import] error for ${v.id}:`, e);
        }
        setPlaylistImportProgress({ done: i + 1, total: toImport.length });
      }
      setImportedIds(newImported);
      setPlaylistSelected(new Set());
      await loadVideos();
      if (targetFolderId) await loadFolders();
      cancelPlaylist();
    } finally {
      setPlaylistImporting(false);
      setPlaylistImportProgress(null);
    }
  }

  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // ── Undo/redo history support ──
  const openListIdRef = useRef<number | null>(null);
  useEffect(() => { openListIdRef.current = selectedCliplist?.id ?? null; }, [selectedCliplist]);
  async function refreshAfterItemChange(cliplistId: number) {
    await loadCliplists();
    if (openListIdRef.current === cliplistId) {
      const res = await fetch(`/api/cliplists/${cliplistId}`);
      if (res.ok) setSelectedCliplist(await res.json());
    }
  }
  function handleSearch(q: string, overrides?: { type?: string | null; folder?: number | null; year?: number | null }) {
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (q.trim().length < 2) {
      setSearchResults([]);
      setSearchTotal(0);
      return;
    }
    const type = overrides?.type ?? searchTypeFilter;
    const folder = overrides?.folder ?? searchFolderFilter;
    const year = overrides?.year ?? searchYearFilter;
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: q.trim(), limit: String(SEARCH_LIMIT), offset: "0" });
        if (type) params.set("type", type);
        if (folder) params.set("folderId", String(folder));
        if (year) params.set("year", String(year));
        const res = await fetch(`/api/search?${params}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results);
          setSearchTotal(data.total ?? data.results.length);
          setSearchOffset(data.results.length);
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

  async function addToCliplist(cliplistId: number, result: SearchResult) {
    try {
      const body = {
        type: result.type,
        videoId: result.videoId,
        timestamp: result.timestamp,
        endTimestamp: result.endTimestamp,
        title: result.title,
        detail: result.detail,
        tags: result.tags,
      };
      const res = await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const itemIdRef = { current: (await res.json()).id as number };
        pushHistory({
          label: `${t("history.addClip")} — ${(result.title ?? "").slice(0, 30)}`,
          undo: async () => {
            await fetch(`/api/cliplists/${cliplistId}/items`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: itemIdRef.current }) });
            await refreshAfterItemChange(cliplistId);
          },
          redo: async () => {
            const r = await fetch(`/api/cliplists/${cliplistId}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            if (r.ok) itemIdRef.current = (await r.json()).id;
            await refreshAfterItemChange(cliplistId);
          },
        });
      }
      setAddToDropdown({ index: -1, open: false });
      // Refresh cliplists if on that tab
      if (tab === "cliplists") loadCliplists();
    } catch {}
  }

  async function openCliplist(id: number) {
    // Reset the slide-creation form when switching between cliplists — a stale
    // insert index or leftover title would silently target the wrong list.
    setShowSlideForm(false);
    setSlideTitle(""); setSlideDetail(""); setSlideDuration(5); setSlideHold(false);
    setSlideColor(""); setSlideImage(""); setSlideInsertIdx(-1); setBulkMode(false); setBulkText(""); setBulkStatus("");
    try {
      const res = await fetch(`/api/cliplists/${id}`);
      if (res.ok) setSelectedCliplist(await res.json());
    } catch {}
  }

  async function deleteCliplist(id: number) {
    const cl = cliplists.find((c) => c.id === id);
    if (selectedCliplist?.id === id) setSelectedCliplist(null);
    enqueueDelete(
      cl?.name ?? `#${id}`,
      async () => {
        await fetch(`/api/cliplists/${id}`, { method: "DELETE" });
        await loadCliplists();
      },
      () => {},
      { cliplists: [id] },
    );
  }

  async function renameCliplist(id: number, newName: string) {
    if (!newName.trim()) return;
    await fetch(`/api/cliplists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setEditingCliplistId(null);
    await loadCliplists();
    if (selectedCliplist?.id === id) {
      setSelectedCliplist((prev) => prev ? { ...prev, name: newName.trim() } : null);
    }
  }

  async function addSlide(cliplistId: number) {
    if (!slideTitle.trim()) return;
    try {
      const items = selectedCliplist?.id === cliplistId ? selectedCliplist.items : [];
      const afterIdx = slideInsertIdx >= 0 && slideInsertIdx < items.length ? slideInsertIdx : null;
      const body: Record<string, unknown> = {
        type: "slide",
        title: slideTitle.trim(),
        detail: slideDetail.trim() || null,
        endTimestamp: slideHold ? null : slideDuration,
        color: slideColor || null,
        imageUrl: slideImage.trim() || null,
        ...(afterIdx !== null && items[afterIdx] ? { position: items[afterIdx].position + 1 } : {}),
      };
      const res = await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const created = await res.json();
      const itemIdRef = { current: created.id as number };
      pushHistory({
        label: `${t("history.newSlide")} — ${body.title as string}`,
        undo: async () => {
          await fetch(`/api/cliplists/${cliplistId}/items`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: itemIdRef.current }) });
          await refreshAfterItemChange(cliplistId);
        },
        redo: async () => {
          const r = await fetch(`/api/cliplists/${cliplistId}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          if (r.ok) itemIdRef.current = (await r.json()).id;
          await refreshAfterItemChange(cliplistId);
        },
      });
      // Quick-add: keep the form open, clear text fields, and continue
      // inserting after the slide just created.
      setSlideTitle("");
      setSlideDetail("");
      setSlideImage("");
      setShowSlideForm(true);
      // Refresh the current cliplist view and point the insert position at
      // the newly created slide so consecutive adds stay in sequence.
      if (selectedCliplist?.id === cliplistId) {
        const r2 = await fetch(`/api/cliplists/${cliplistId}`);
        if (r2.ok) {
          const fresh = await r2.json();
          setSelectedCliplist(fresh);
          const idx = (fresh.items as Array<{ id: number }>).findIndex((i) => i.id === created.id);
          setSlideInsertIdx(idx >= 0 ? idx : -1);
        }
      }
      await loadCliplists();
    } catch {}
  }

  async function addBulkSlides(cliplistId: number) {
    const slides = parseBulkSlides(bulkText);
    if (slides.length === 0) return;
    const items = selectedCliplist?.id === cliplistId ? selectedCliplist.items : [];
    let afterPos: number | null =
      slideInsertIdx >= 0 && slideInsertIdx < items.length && items[slideInsertIdx]
        ? items[slideInsertIdx].position
        : null;
    let added = 0;
    const createdBodies: Record<string, unknown>[] = [];
    const idRef = { current: [] as number[] };
    for (const s of slides) {
      const body: Record<string, unknown> = {
        type: "slide",
        title: s.title,
        detail: s.detail,
        endTimestamp: s.endTimestamp,
      };
      if (afterPos !== null) { body.position = afterPos + 1; afterPos = afterPos + 1; }
      const res = await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) { added++; createdBodies.push(body); idRef.current.push((await res.json()).id); }
    }
    if (added > 0) pushHistory({
      label: `${added} ${t("history.bulkSlides")}`,
      undo: async () => {
        for (const id of idRef.current)
          await fetch(`/api/cliplists/${cliplistId}/items`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: id }) });
        await refreshAfterItemChange(cliplistId);
      },
      redo: async () => {
        const ids: number[] = [];
        for (const body of createdBodies) {
          const r = await fetch(`/api/cliplists/${cliplistId}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          if (r.ok) ids.push((await r.json()).id);
        }
        idRef.current = ids;
        await refreshAfterItemChange(cliplistId);
      },
    });
    setBulkText("");
    setBulkStatus(`${added} ${t("cliplist.slidesAdded")}`);
    setTimeout(() => setBulkStatus(""), 4000);
    if (selectedCliplist?.id === cliplistId) {
      const r2 = await fetch(`/api/cliplists/${cliplistId}`);
      if (r2.ok) setSelectedCliplist(await r2.json());
    }
    await loadCliplists();
  }

  async function duplicateSlideItem(cliplistId: number, item: SelectedCliplistItem) {
    const body = {
      type: "slide",
      title: item.title,
      detail: item.detail,
      endTimestamp: item.endTimestamp,
      color: item.color ?? null,
      imageUrl: item.imageUrl ?? null,
      position: item.position + 1,
    };
    const res = await fetch(`/api/cliplists/${cliplistId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    const itemIdRef = { current: (await res.json()).id as number };
    pushHistory({
      label: `${t("history.duplicateSlide")} — ${item.title.slice(0, 30)}`,
      undo: async () => {
        await fetch(`/api/cliplists/${cliplistId}/items`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: itemIdRef.current }) });
        await refreshAfterItemChange(cliplistId);
      },
      redo: async () => {
        const r = await fetch(`/api/cliplists/${cliplistId}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (r.ok) itemIdRef.current = (await r.json()).id;
        await refreshAfterItemChange(cliplistId);
      },
    });
    if (selectedCliplist?.id === cliplistId) {
      const res = await fetch(`/api/cliplists/${cliplistId}`);
      if (res.ok) setSelectedCliplist(await res.json());
    }
    await loadCliplists();
  }

  async function removeClipItem(cliplistId: number, itemId: number) {
    const snapshot = selectedCliplist?.items.find((i) => i.id === itemId);
    enqueueDelete(
      snapshot?.title?.slice(0, 40) ?? `#${itemId}`,
      async () => {
        const delRes = await fetch(`/api/cliplists/${cliplistId}/items`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId }),
        });
        if (delRes.ok && snapshot) {
          const item = snapshot as SelectedCliplistItem & { tags?: string[] };
          const reinsertBody = {
            type: item.type,
            videoId: item.videoId,
            timestamp: item.timestamp,
            endTimestamp: item.endTimestamp,
            title: item.title,
            detail: item.detail,
            tags: item.tags ?? [],
            color: item.color ?? null,
            imageUrl: item.imageUrl ?? null,
            position: item.position,
          };
          const itemIdRef = { current: itemId };
          pushHistory({
            label: `${t("history.removedItem")} — ${(item.title ?? "").slice(0, 30)}`,
            undo: async () => {
              const r = await fetch(`/api/cliplists/${cliplistId}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reinsertBody) });
              if (r.ok) itemIdRef.current = (await r.json()).id;
              await refreshAfterItemChange(cliplistId);
            },
            redo: async () => {
              await fetch(`/api/cliplists/${cliplistId}/items`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: itemIdRef.current }) });
              await refreshAfterItemChange(cliplistId);
            },
          });
        }
        if (selectedCliplist?.id === cliplistId) {
          setSelectedCliplist((prev) => {
            if (!prev) return prev;
            return { ...prev, items: prev.items.filter((i) => i.id !== itemId) };
          });
        }
        await loadCliplists();
      },
      () => {},
      { items: [itemId] },
    );
  }

  async function updateSlideItem(cliplistId: number, itemId: number) {
    if (!editSlideTitle.trim()) return;
    const before = selectedCliplist?.items.find((i) => i.id === itemId);
    try {
      const newFields = {
        title: editSlideTitle.trim(),
        detail: editSlideDetail.trim() || null,
        endTimestamp: editSlideHold ? null : editSlideDuration,
        color: editSlideColor || null,
        imageUrl: editSlideImage.trim() || null,
      };
      const res = await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, ...newFields }),
      });
      if (!res.ok) return; // keep the form open so the user can retry
      if (before) {
        pushHistory({
          label: `${t("history.editedItem")} — ${newFields.title.slice(0, 30)}`,
          undo: async () => {
            await fetch(`/api/cliplists/${cliplistId}/items`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId, title: before.title, detail: before.detail, endTimestamp: before.endTimestamp, color: before.color ?? null, imageUrl: before.imageUrl ?? null }),
            });
            await refreshAfterItemChange(cliplistId);
          },
          redo: async () => {
            await fetch(`/api/cliplists/${cliplistId}/items`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId, ...newFields }),
            });
            await refreshAfterItemChange(cliplistId);
          },
        });
      }
      setEditingSlideId(null);
      if (selectedCliplist?.id === cliplistId) {
        const res = await fetch(`/api/cliplists/${cliplistId}`);
        if (res.ok) setSelectedCliplist(await res.json());
      }
      await loadCliplists();
    } catch {}
  }

  async function updateClipItem(cliplistId: number, itemId: number) {
    if (!editClipTitle.trim()) return;
    const before = selectedCliplist?.items.find((i) => i.id === itemId);
    try {
      const newFields = {
        title: editClipTitle.trim(),
        detail: editClipDetail.trim() || null,
        timestamp: Math.max(0, editClipStart),
        endTimestamp: Math.max(0, editClipEnd),
      };
      const res = await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, ...newFields }),
      });
      if (!res.ok) return; // keep the form open so the user can retry
      if (before) {
        pushHistory({
          label: `${t("history.editedItem")} — ${newFields.title.slice(0, 30)}`,
          undo: async () => {
            await fetch(`/api/cliplists/${cliplistId}/items`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId, title: before.title, detail: before.detail, timestamp: before.timestamp, endTimestamp: before.endTimestamp }),
            });
            await refreshAfterItemChange(cliplistId);
          },
          redo: async () => {
            await fetch(`/api/cliplists/${cliplistId}/items`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId, ...newFields }),
            });
            await refreshAfterItemChange(cliplistId);
          },
        });
      }
      setEditingClipId(null);
      if (selectedCliplist?.id === cliplistId) {
        const res = await fetch(`/api/cliplists/${cliplistId}`);
        if (res.ok) setSelectedCliplist(await res.json());
      }
      await loadCliplists();
    } catch {}
  }

  function handleDropOnItem(targetId: number) {
    if (!selectedCliplist || dragItemId === null || dragItemId === targetId) return;
    const items = [...selectedCliplist.items];
    const prevOrder = items.map((i) => i.id);
    const from = items.findIndex((i) => i.id === dragItemId);
    if (from === -1) return;
    const [moved] = items.splice(from, 1);
    const to = items.findIndex((i) => i.id === targetId);
    items.splice(to, 0, moved);
    setSelectedCliplist({ ...selectedCliplist, items });
    setDragArmedId(null);
    setDragItemId(null);
    setDragOverItemId(null);
    const cliplistId = selectedCliplist.id;
    const afterOrder = items.map((i) => i.id);
    void reorderClipItems(cliplistId, afterOrder).then((ok) => {
      if (!ok) return;
      pushHistory({
        label: t("history.reorder"),
        undo: async () => { await fetch(`/api/cliplists/${cliplistId}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: prevOrder }) }); await refreshAfterItemChange(cliplistId); },
        redo: async () => { await fetch(`/api/cliplists/${cliplistId}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: afterOrder }) }); await refreshAfterItemChange(cliplistId); },
      });
    });
  }

  async function reorderClipItems(cliplistId: number, orderedIds: number[]): Promise<boolean> {
    try {
      const res = await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: orderedIds }),
      });
      if (!res.ok) throw new Error("reorder failed");
      await loadCliplists();
      return true;
    } catch {
      openCliplist(cliplistId); // refetch to roll back optimistic order
      return false;
    }
  }

  const playlistActive = playlistVideos.length > 0 || playlistLoading;

  return (
    <div className="min-h-screen flex flex-col relative">
      <div className="relative z-10 flex flex-col min-h-screen">
      <header className="border-b border-border px-6 py-4 shrink-0">
        <div className="mx-auto w-full flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{t("app.title")}</h1>
            <p className="text-sm text-muted">{t("app.subtitle")}</p>
          </div>
          {session?.user && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted">{session.user.name}</span>
              <button
                onClick={toggleLanguage}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-hover"
                title={language === "en" ? "Mudar para Português" : "Switch to English"}
              >
                {language === "en" ? "PT" : "EN"}
              </button>
              <button
                onClick={() => signOut({ callbackUrl: "/signin" })}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-hover"
              >
                {t("app.signOut")}
              </button>
              </div>
            )}

            {/* Load more + total */}
            {searchResults.length > 0 && (
              <div className="mt-3 flex flex-col items-center gap-2">
                <p className="text-[10px] text-muted">{searchTotal} {t("search.results")}</p>
                {searchOffset < searchTotal && (
                  <button
                    onClick={async () => {
                      setSearchLoadingMore(true);
                      try {
                        const params = new URLSearchParams({ q: searchQuery.trim(), limit: String(SEARCH_LIMIT), offset: String(searchOffset) });
                        if (searchTypeFilter) params.set("type", searchTypeFilter);
                        if (searchFolderFilter) params.set("folderId", String(searchFolderFilter));
                        if (searchYearFilter) params.set("year", String(searchYearFilter));
                        const res = await fetch(`/api/search?${params}`);
                        if (res.ok) {
                          const data = await res.json();
                          setSearchResults(prev => [...prev, ...data.results]);
                          setSearchOffset(prev => prev + data.results.length);
                          setSearchTotal(data.total ?? searchTotal);
                        }
                      } finally {
                        setSearchLoadingMore(false);
                      }
                    }}
                    disabled={searchLoadingMore}
                    className="px-4 py-1.5 rounded-lg border border-border bg-surface text-xs text-muted hover:text-foreground hover:border-accent/50 transition-colors"
                  >
                    {searchLoadingMore ? t("app.loading") : t("search.loadMore")}
                  </button>
                )}
                {searchOffset >= searchTotal && (
                  <p className="text-[10px] text-muted">{t("search.noMore")}</p>
                )}
              </div>
            )}
          </div>
      </header>

      <div className="mx-auto w-full px-6 pt-6">
        <nav className="flex gap-1 border-b border-border">
          {([
            { key: "import", label: t("tab.import"), icon: "+" },
            { key: "search", label: t("tab.search"), icon: "\u2315" },
            { key: "cliplists", label: t("tab.cliplists"), icon: "\ud83d\udccb" },
            { key: "settings", label: t("tab.settings"), icon: "\u2699\ufe0f" },
            { key: "help", label: t("tab.help"), icon: "?" },
          ] as const).map((tabItem) => (
            <button
              key={tabItem.key}
              data-tour={tabItem.key === "import" ? "import-tab" : tabItem.key === "search" ? "search-tab" : undefined}
              onClick={() => switchToTab(tabItem.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === tabItem.key
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              <span className="mr-1.5">{tabItem.icon}</span>
              {tabItem.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mx-auto w-full px-6 py-6 flex-1 flex gap-6">
        {/* ── SIDEBAR: Folders ── */}
        <aside data-tour="sidebar-folders" className="w-52 shrink-0">
          <div className="sticky top-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">{t("sidebar.folders")}</h2>
              <button
                onClick={() => setShowCreateFolder(true)}
                className="text-muted hover:text-accent transition-colors"
                title={t("sidebar.newFolder")}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            <div className="space-y-0.5">
              {/* All Videos */}
              <button
                onClick={() => { setShowAllVideos(!showAllVideos); setSelectedFolderId(null); }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  showAllVideos
                    ? "bg-accent/10 text-accent font-medium"
                    : "text-muted hover:text-foreground hover:bg-surface"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{t("sidebar.allVideos")}</span>
                  <span className="text-[10px] text-muted/60">{showAllVideos ? allVideos.length : videos.length}</span>
                </div>
              </button>

              <button
                onClick={() => setShowTagBrowser(true)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors hover:bg-surface-hover text-muted hover:text-foreground w-full text-left"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span>{t("sidebar.tags")}</span>
              </button>

              {/* Folder list */}
              {folderList.filter((folder) => !pendingFolderIds.includes(folder.id)).map((folder) => (
                <div key={folder.id} className="group">
                  {editingFolderId === folder.id ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); renameFolder(folder.id); }}
                      className="flex items-center gap-1"
                    >
                      <input
                        autoFocus
                        value={editingFolderName}
                        onChange={(e) => setEditingFolderName(e.target.value)}
                        onBlur={() => renameFolder(folder.id)}
                        className="flex-1 rounded px-2 py-1 text-sm bg-background border border-accent outline-none"
                      />
                    </form>
                  ) : (
                    <button
                      onClick={() => { setSelectedFolderId(folder.id); setShowAllVideos(false); }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedFolderId === folder.id
                          ? "bg-accent/10 text-accent font-medium"
                          : "text-muted hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate">{folder.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted/60">{folder.videoCount}</span>
                          <div className="flex items-center gap-0.5">
                            <span
                              onClick={async (e) => {
                                e.stopPropagation();
                                openShareDialog(folder.id);
                              }}
                              className={`p-0.5 rounded cursor-pointer transition-colors ${
                                sharedFolderCopied === folder.id
                                  ? "text-accent"
                                  : "text-muted hover:text-accent"
                              }`}
                              title={sharedFolderCopied === folder.id ? t("share.copied") : t("share.link")}
                            >
                              {sharedFolderCopied === folder.id ? (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              ) : (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                              )}
                            </span>
                            <span
                              onClick={(e) => { e.stopPropagation(); setEditingFolderId(folder.id); setEditingFolderName(folder.name); }}
                              className="text-muted hover:text-foreground cursor-pointer p-0.5"
                              title={t("sidebar.rename")}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </span>
                            <span
                              onClick={(e) => { e.stopPropagation(); deleteFolder(folder.id); }}
                              className="text-muted hover:text-danger cursor-pointer p-0.5"
                              title="Delete"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  )}
                </div>
              ))}

              {/* Create folder form */}
              {showCreateFolder && (
                <form
                  onSubmit={(e) => { e.preventDefault(); createFolder(); }}
                  className="flex items-center gap-1 mt-1"
                >
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Folder name"
                    className="flex-1 rounded px-2 py-1 text-sm bg-background border border-border focus:border-accent outline-none"
                  />
                  <button
                    type="submit"
                    disabled={creatingFolder || !newFolderName.trim()}
                    className="text-accent disabled:opacity-30"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreateFolder(false); setNewFolderName(""); }}
                    className="text-muted hover:text-foreground"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </form>
              )}

              {/* Shared folders */}
              <div className="mt-6 pt-6 border-t border-border/50">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  {t("share.sharedFolders")}
                </h3>

                <div className="space-y-0.5">
                  {(() => {
                    const shared = folderList.filter((f) => f.shareToken);
                    if (shared.length === 0) {
                      return (
                        <p className="text-[10px] text-muted/60 px-1 py-2">
                          No shared folders.
                        </p>
                      );
                    }
                    return shared.map((folder) => (
                      <div key={folder.id} className="group flex items-center justify-between px-3 py-1.5 rounded-lg text-sm text-muted hover:bg-surface-hover transition-colors">
                        <span
                          onClick={() => setSelectedFolderId(folder.id)}
                          className="truncate text-xs cursor-pointer"
                        >
                          {folder.name}
                        </span>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch(`/api/folders/${folder.id}/share`, { method: "POST" });
                                if (!res.ok) return;
                                const { url } = await res.json();
                                await navigator.clipboard.writeText(url);
                                setSharedFolderCopied(folder.id);
                                setTimeout(() => setSharedFolderCopied(null), 2000);
                              } catch {}
                            }}
                            className={`p-0.5 rounded transition-colors ${
                              sharedFolderCopied === folder.id
                                ? "text-accent"
                                : "text-muted hover:text-accent"
                            }`}
                            title={sharedFolderCopied === folder.id ? t("share.copied") : t("share.link")}
                          >
                            {sharedFolderCopied === folder.id ? (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => {
                              enqueueDelete(
                                t("undo.shareLink"),
                                async () => {
                                  try {
                                    await fetch(`/api/folders/${folder.id}/share`, { method: "DELETE" });
                                    await loadFolders();
                                  } catch {}
                                },
                                () => {},
                              );
                            }}
                            className="p-0.5 rounded text-muted hover:text-danger transition-colors"
                            title="Unshare"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="flex-1 min-w-0">
        {/* ── IMPORT TAB ── */}
        {tab === "import" && (
          <div>
            <form onSubmit={handleSubmit} className="mb-6">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("import.urlPlaceholder")}
                  data-tour="import-input"
                  className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  disabled={loading || playlistLoading}
                />
                <button
                  type="submit"
                  disabled={loading || playlistLoading || !url.trim()}
                  className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? t("import.adding") : playlistLoading ? t("app.loading") : t("video.import")}
                </button>
              </div>
              <label className="flex items-center gap-2 mt-2 text-xs text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={extractKeyMoments}
                  onChange={(e) => setExtractKeyMoments(e.target.checked)}
                  className="rounded border-border accent-accent"
                />
                {t("video.extractKeyMoments")}
              </label>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/60">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.webm,.mov,.mkv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleLocalUpload(f);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || loading || playlistLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-accent hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  {t("upload.pick")}
                </button>
                {uploading && (
                  <span className="text-xs text-muted flex items-center gap-1.5">
                    <span className="h-3 w-3 animate-spin rounded-full border border-muted/30 border-t-accent inline-block" />
                    {t("upload.uploading")}
                  </span>
                )}
              </div>
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </form>

            {/* ── INLINE PLAYLIST ── */}
            {playlistActive && (
              <div className="mb-6 rounded-lg border border-border bg-surface">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <h3 className="text-sm font-medium">
                    {playlistLoading
                      ? t("import.loadingPlaylist")
                      : importedIds.size > 0
                        ? `${playlistVideos.length} videos — ${importedIds.size} already imported, ${playlistVideos.length - importedIds.size} new`
                        : `${playlistVideos.length} videos in playlist`}
                  </h3>
                  <button onClick={cancelPlaylist} className="text-xs text-muted hover:text-foreground transition-colors">
                    {t("import.cancelPlaylist")}
                  </button>
                </div>

                {playlistError && <p className="px-4 py-2 text-xs text-danger">{playlistError}</p>}

                {!playlistLoading && playlistVideos.length > 0 && (
                  <>
                    <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
                      <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={playlistSelected.size === playlistVideos.filter((v) => !importedIds.has(v.id)).length && playlistVideos.some((v) => !importedIds.has(v.id))}
                          onChange={toggleSelectAll}
                          className="rounded border-border accent-accent"
                        />
                        {playlistSelected.size}/{playlistVideos.filter((v) => !importedIds.has(v.id)).length} new selected
                      </label>
                      <button
                        onClick={importSelectedVideos}
                        disabled={playlistImporting || playlistSelected.size === 0}
                        className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {playlistImportProgress
                          ? `Importing ${playlistImportProgress.done}/${playlistImportProgress.total}...`
                          : playlistImporting
                            ? "Importing..."
                            : `Import ${playlistSelected.size} video${playlistSelected.size !== 1 ? "s" : ""}`}
                      </button>
                    </div>

                    {/* Folder picker + key moments toggle */}
                    <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50">
                      <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={extractKeyMoments}
                          onChange={(e) => setExtractKeyMoments(e.target.checked)}
                          className="rounded border-border accent-accent"
                        />
                        {t("import.keyMoments")}
                      </label>
                      <div className="w-px h-3 bg-border/50" />
                      <span className="text-[10px] uppercase tracking-wider text-muted/60 shrink-0">{t("folder.addTo")}</span>
                      <div className="relative" data-folder-dropdown>
                        <button
                          type="button"
                          onClick={() => setPlaylistFolderDropdownOpen(!playlistFolderDropdownOpen)}
                          className="flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-hover/30 px-2.5 py-1 text-xs text-foreground hover:border-border transition-colors"
                        >
                          <svg className="w-3 h-3 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                          {playlistTargetFolder === null
                            ? t("folder.noFolder")
                            : folderList.find((f) => f.id === playlistTargetFolder)?.name ?? "Select..."}
                          <svg className="w-3 h-3 text-muted/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                        </button>
                        {playlistFolderDropdownOpen && (
                          <div className="absolute z-50 top-full left-0 mt-1 w-56 rounded-lg border border-border bg-surface shadow-lg py-1">
                            <button
                              type="button"
                              onClick={() => { setPlaylistTargetFolder(null); setPlaylistFolderDropdownOpen(false); }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover/50 transition-colors ${
                                playlistTargetFolder === null ? "text-accent font-medium" : "text-foreground"
                              }`}
                            >
                              {t("folder.noFolder")}
                            </button>
                            {folderList.map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => { setPlaylistTargetFolder(f.id); setPlaylistFolderDropdownOpen(false); setPlaylistNewFolderName(""); }}
                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover/50 transition-colors ${
                                  playlistTargetFolder === f.id ? "text-accent font-medium" : "text-foreground"
                                }`}
                              >
                                {f.name}
                              </button>
                            ))}
                            {folderList.length > 0 && <div className="my-1 border-t border-border/40" />}
                            {playlistNewFolderName !== "" || playlistTargetFolder === -1 ? (
                              <div className="px-3 py-1.5">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    autoFocus
                                    type="text"
                                    value={playlistNewFolderName}
                                    onChange={(e) => setPlaylistNewFolderName(e.target.value)}
                                    onKeyDown={async (e) => {
                                      if (e.key === "Enter" && playlistNewFolderName.trim()) {
                                        setPlaylistCreatingFolder(true);
                                        try {
                                          const res = await fetch("/api/folders", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ name: playlistNewFolderName.trim() }),
                                          });
                                          if (res.ok) {
                                            const folder = await res.json();
                                            await loadFolders();
                                            setPlaylistTargetFolder(folder.id);
                                            setPlaylistNewFolderName("");
                                            setPlaylistFolderDropdownOpen(false);
                                          }
                                        } finally {
                                          setPlaylistCreatingFolder(false);
                                        }
                                      } else if (e.key === "Escape") {
                                        setPlaylistTargetFolder(null);
                                        setPlaylistNewFolderName("");
                                      }
                                    }}
                                    placeholder={t("folder.newFolderName")}
                                    disabled={playlistCreatingFolder}
                                    className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent"
                                  />
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!playlistNewFolderName.trim()) return;
                                      setPlaylistCreatingFolder(true);
                                      try {
                                        const res = await fetch("/api/folders", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ name: playlistNewFolderName.trim() }),
                                        });
                                        if (res.ok) {
                                          const folder = await res.json();
                                          await loadFolders();
                                          setPlaylistTargetFolder(folder.id);
                                          setPlaylistNewFolderName("");
                                          setPlaylistFolderDropdownOpen(false);
                                        }
                                      } finally {
                                        setPlaylistCreatingFolder(false);
                                      }
                                    }}
                                    disabled={!playlistNewFolderName.trim() || playlistCreatingFolder}
                                    className="text-accent hover:text-accent-hover disabled:opacity-30"
                                  >
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" /></svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setPlaylistTargetFolder(null); setPlaylistNewFolderName(""); }}
                                    className="text-muted hover:text-foreground"
                                  >
                                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setPlaylistTargetFolder(-1)}
                                className="w-full text-left px-3 py-1.5 text-xs text-muted hover:text-foreground hover:bg-surface-hover/50 transition-colors flex items-center gap-1.5"
                              >
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                                {t("sidebar.newFolder")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="max-h-96 overflow-y-auto divide-y divide-border/50">
                      {playlistVideos.map((v) => {
                        const alreadyImported = importedIds.has(v.id);
                        return (
                          <label
                            key={v.id}
                            className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                              alreadyImported
                                ? "opacity-50 cursor-default"
                                : playlistSelected.has(v.id)
                                  ? "bg-accent/5 cursor-pointer"
                                  : "hover:bg-surface-hover/50 cursor-pointer"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={playlistSelected.has(v.id)}
                              disabled={alreadyImported}
                              onChange={() => togglePlaylistVideo(v.id)}
                              className="rounded border-border accent-accent shrink-0"
                            />
                            <div className="relative w-24 h-14 shrink-0">
                              <Image
                                src={v.thumbnail}
                                alt={v.title}
                                fill
                                className="object-cover rounded"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs text-foreground line-clamp-2">{v.title}</span>
                              {alreadyImported && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded">
                                  {t("video.imported")}
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {fetching ? (
              <p className="text-center text-muted py-12">{t("app.loading")}</p>
            ) : selectedFolderId !== null ? (
              folderVideosLoading ? (
                <p className="text-center text-muted py-12">{t("app.loading")}</p>
              ) : folderVideos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-16 text-center">
                  <p className="text-muted">{t("video.noFolderVideos")}</p>
                  <p className="text-xs text-muted/60 mt-1">{t("video.noFolderVideosHint")}</p>
                </div>
              ) : (
                <>
                  {/* Select all bar */}
                  <div className="flex items-center justify-between mb-4">
                    <label className="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => {
                          if (allSelected) setSelectedVideoIds(new Set());
                          else setSelectedVideoIds(new Set(currentVideoList.map((v) => v.id)));
                        }}
                        className="rounded border-border accent-accent"
                      />
                      {selectedVideoIds.size > 0
                        ? `${selectedVideoIds.size} ${t("video.selected")}`
                        : `${t("video.selectAll")} (${currentVideoList.length})`}
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
                        <button onClick={() => { if (translatedLang) clearTitleTranslations(); else translateTitles(); }}
                          disabled={translating}
                          className={`px-2.5 py-1.5 text-[10px] font-medium transition-all ${translatedLang ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}>
                          {translating ? "..." : translatedLang ? "EN →" : "PT →"}
                        </button>
                      </div>
                      <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
                      <button
                        onClick={() => setViewMode("grid")}
                        className={`p-1.5 rounded transition-colors ${viewMode === "grid" ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
                        title={t("video.thumbnailView")}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setViewMode("list")}
                        className={`p-1.5 rounded transition-colors ${viewMode === "list" ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
                        title={t("video.detailListView")}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                      </button>
                    </div>
                    </div>
                  </div>
                  {viewMode === "grid" ? (
                  <div data-tour="video-grid" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {gridVideos.map((video) => (
                    <Link
                      key={video.id}
                      href={`/video/${video.id}`}
                      className="group rounded-lg border border-border bg-surface hover:border-accent/50 transition-colors overflow-hidden"
                    >
                      {video.thumbnailUrl && (
                        <div className="aspect-video w-full overflow-hidden bg-muted relative">
                          <Image src={video.thumbnailUrl} alt={video.title ?? "Video"} fill className="object-cover group-hover:scale-105 transition-transform duration-300" />
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleVideoSelection(video.id); }}
                            className="absolute top-2 left-2 w-5 h-5 rounded border border-white/40 bg-black/30 backdrop-blur-sm flex items-center justify-center transition-colors hover:bg-black/50"
                          >
                            {selectedVideoIds.has(video.id) && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        </div>
                      )}
                      <div className="p-3 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-sm font-medium line-clamp-2">{translatedTitles.get(video.id) || (video.title ?? "Untitled")}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded ${(video.momentCount ?? 0) > 0 ? "text-amber-500 bg-amber-500/10" : "text-muted/50 bg-surface-hover/50"}`} title={`${video.momentCount ?? 0} key moment${(video.momentCount ?? 0) !== 1 ? "s" : ""}`}>
                              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
                              {video.momentCount ?? 0}
                            </span>
                            {video.year != null && (
                              <span className="shrink-0 text-[9px] font-medium text-muted/70 bg-surface-hover px-1.5 py-0.5 rounded">{video.year}</span>
                            )}
                            {video.channel != null && (
                              <span className="shrink-0 max-w-[120px] truncate text-[9px] font-medium text-muted/70 bg-surface-hover px-1.5 py-0.5 rounded" title={video.channel}>{video.channel}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {/* Remove from folder */}
                          {selectedFolderId !== null && (
                            <button
                              onClick={(e) => { e.preventDefault(); removeVideoFromFolder(selectedFolderId, video.id); }}
                              className="text-muted hover:text-accent transition-colors p-1 rounded"
                              title={t("sidebar.removeFromFolder")}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.preventDefault(); handleDelete(video.id); }}
                            className="text-muted hover:text-danger transition-colors p-1 rounded"
                            title={t("video.bulkDelete")}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
                  ) : (
                  <div className="flex flex-col divide-y divide-border/50 rounded-lg border border-border overflow-hidden">
                    {gridVideos.map((video) => (
                    <Link
                      key={video.id}
                      href={`/video/${video.id}`}
                      className="group flex items-center gap-4 px-4 py-3 bg-surface hover:bg-surface-hover transition-colors"
                    >
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleVideoSelection(video.id); }}
                        className="w-5 h-5 shrink-0 rounded border border-border bg-background flex items-center justify-center transition-colors hover:border-accent"
                      >
                        {selectedVideoIds.has(video.id) && (
                          <svg className="w-3 h-3 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      {video.thumbnailUrl && (
                        <div className="relative w-40 h-[56px] shrink-0 overflow-hidden rounded bg-muted">
                          <Image src={video.thumbnailUrl} alt={video.title ?? "Video"} fill className="object-cover" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium truncate">{translatedTitles.get(video.id) || (video.title ?? "Untitled")}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          {(video.annotationCount ?? 0) > 0 && (
                            <span className="text-[9px] font-medium text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">{video.annotationCount} {t("video.annotations")}</span>
                          )}
                          {(video.sceneCount ?? 0) > 0 && (
                            <span className="text-[9px] font-medium text-purple-500 bg-purple-500/10 px-1.5 py-0.5 rounded">{video.sceneCount} {t("video.scenes")}</span>
                          )}
                          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${(video.momentCount ?? 0) > 0 ? "text-amber-500 bg-amber-500/10" : "text-muted/50 bg-surface-hover/50"}`}>{video.momentCount ?? 0} {t("video.moments")}</span>
                          {video.hasTranscript && (
                            <span className="text-[9px] font-medium text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">{t("video.transcript")}</span>
                          )}
                          {video.year != null && (
                            <span className="text-[9px] font-medium text-muted/70 bg-surface-hover px-1.5 py-0.5 rounded">{video.year}</span>
                          )}
                          {video.channel != null && (
                            <span className="max-w-[140px] truncate text-[9px] font-medium text-muted/70 bg-surface-hover px-1.5 py-0.5 rounded" title={video.channel}>{video.channel}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {selectedFolderId !== null && (
                          <button
                            onClick={(e) => { e.preventDefault(); removeVideoFromFolder(selectedFolderId, video.id); }}
                            className="text-muted hover:text-accent transition-colors p-1.5 rounded"
                            title={t("sidebar.removeFromFolder")}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.preventDefault(); handleDelete(video.id); }}
                          className="text-muted hover:text-danger transition-colors p-1.5 rounded"
                          title={t("video.bulkDelete")}
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
                </>
              )
            ) : videos.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-16 text-center">
                <p className="text-muted">{t("video.noVideos")}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <label className="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => {
                        if (allSelected) setSelectedVideoIds(new Set());
                        else setSelectedVideoIds(new Set(currentVideoList.map((v) => v.id)));
                      }}
                      className="rounded border-border accent-accent"
                    />
                    {selectedVideoIds.size > 0
                      ? `${selectedVideoIds.size} ${t("video.selected")}`
                      : `${t("video.selectAll")} (${currentVideoList.length})`}
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
                      <button onClick={() => { if (translatedLang) clearTitleTranslations(); else translateTitles(); }}
                        disabled={translating}
                        className={`px-2.5 py-1.5 text-[10px] font-medium transition-all ${translatedLang ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}>
                        {translating ? "..." : translatedLang ? "EN →" : "PT →"}
                      </button>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
                    <button
                      onClick={() => setViewMode("grid")}
                      className={`p-1.5 rounded transition-colors ${viewMode === "grid" ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
                      title={t("video.thumbnailView")}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setViewMode("list")}
                      className={`p-1.5 rounded transition-colors ${viewMode === "list" ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
                      title={t("video.detailListView")}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </button>
                  </div>
                  </div>
                </div>
                {viewMode === "grid" ? (
                <div data-tour="video-grid" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {gridVideos.map((video) => (
                  <Link
                    key={video.id}
                    href={`/video/${video.id}`}
                    className="group rounded-lg border border-border bg-surface hover:border-accent/50 transition-colors overflow-hidden"
                  >
                    {video.thumbnailUrl && (
                      <div className="aspect-video w-full overflow-hidden bg-muted relative">
                        <Image
                          src={video.thumbnailUrl}
                          alt={video.title ?? "Video"}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleVideoSelection(video.id); }}
                          className="absolute top-2 left-2 w-5 h-5 rounded border border-white/40 bg-black/30 backdrop-blur-sm flex items-center justify-center transition-colors hover:bg-black/50"
                        >
                          {selectedVideoIds.has(video.id) && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </div>
                    )}
                    <div className="p-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium line-clamp-2">{translatedTitles.get(video.id) || (video.title ?? "Untitled")}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          {(video.momentCount ?? 0) > 0 && (
                            <span className="shrink-0 text-[9px] font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded flex items-center gap-0.5" title={`${video.momentCount} key moment${video.momentCount !== 1 ? "s" : ""}`}>
                              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
                              {video.momentCount}
                            </span>
                          )}
                          {video.year != null && (
                            <span className="shrink-0 text-[9px] font-medium text-muted/70 bg-surface-hover px-1.5 py-0.5 rounded">{video.year}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {/* Folder button */}
                        {folderList.length > 0 && (
                          <div className="relative" data-folder-dropdown>
                            <button
                              onClick={(e) => { e.preventDefault(); setFolderDropdown({ videoId: video.id, open: folderDropdown.videoId === video.id ? !folderDropdown.open : true }); }}
                              className="text-muted hover:text-accent transition-colors p-1 rounded"
                              title={t("folder.addTo")}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                            </button>
                            {folderDropdown.open && folderDropdown.videoId === video.id && (
                              <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface shadow-xl z-50 py-1">
                                <div className="px-3 py-1.5 text-[10px] text-muted/60 font-medium uppercase tracking-wider">{t("folder.addTo")}</div>
                                {folderList.filter((folder) => !pendingFolderIds.includes(folder.id)).map((folder) => (
                                  <button
                                    key={folder.id}
                                    onClick={(e) => { e.preventDefault(); addVideoToFolder(folder.id, video.id); }}
                                    className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent/10 transition-colors"
                                  >
                                    {folder.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          onClick={(e) => { e.preventDefault(); handleDelete(video.id); }}
                          className="text-muted hover:text-danger transition-colors p-1 rounded"
                          title={t("video.bulkDelete")}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </Link>
                ))}
                </div>
                ) : (
                <div className="flex flex-col divide-y divide-border/50 rounded-lg border border-border overflow-hidden">
                  {gridVideos.map((video) => (
                    <Link
                      key={video.id}
                      href={`/video/${video.id}`}
                      className="group flex items-center gap-4 px-4 py-3 bg-surface hover:bg-surface-hover transition-colors"
                    >
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleVideoSelection(video.id); }}
                        className="w-5 h-5 shrink-0 rounded border border-border bg-background flex items-center justify-center transition-colors hover:border-accent"
                      >
                        {selectedVideoIds.has(video.id) && (
                          <svg className="w-3 h-3 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      {video.thumbnailUrl && (
                        <div className="relative w-40 h-[56px] shrink-0 overflow-hidden rounded bg-muted">
                          <Image src={video.thumbnailUrl} alt={video.title ?? "Video"} fill className="object-cover" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium truncate">{translatedTitles.get(video.id) || (video.title ?? "Untitled")}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          {(video.annotationCount ?? 0) > 0 && (
                            <span className="text-[9px] font-medium text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">{video.annotationCount} {t("video.annotations")}</span>
                          )}
                          {(video.sceneCount ?? 0) > 0 && (
                            <span className="text-[9px] font-medium text-purple-500 bg-purple-500/10 px-1.5 py-0.5 rounded">{video.sceneCount} {t("video.scenes")}</span>
                          )}
                          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${(video.momentCount ?? 0) > 0 ? "text-amber-500 bg-amber-500/10" : "text-muted/50 bg-surface-hover/50"}`}>{video.momentCount ?? 0} {t("video.moments")}</span>
                          {video.hasTranscript && (
                            <span className="text-[9px] font-medium text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">{t("video.transcript")}</span>
                          )}
                          {video.year != null && (
                            <span className="text-[9px] font-medium text-muted/70 bg-surface-hover px-1.5 py-0.5 rounded">{video.year}</span>
                          )}
                          {video.channel != null && (
                            <span className="max-w-[140px] truncate text-[9px] font-medium text-muted/70 bg-surface-hover px-1.5 py-0.5 rounded" title={video.channel}>{video.channel}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {folderList.length > 0 && (
                          <div className="relative" data-folder-dropdown>
                            <button
                              onClick={(e) => { e.preventDefault(); setFolderDropdown({ videoId: video.id, open: folderDropdown.videoId === video.id ? !folderDropdown.open : true }); }}
                              className="text-muted hover:text-accent transition-colors p-1.5 rounded"
                              title={t("folder.addTo")}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                            </button>
                            {folderDropdown.open && folderDropdown.videoId === video.id && (
                              <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface shadow-xl z-50 py-1">
                                <div className="px-3 py-1.5 text-[10px] text-muted/60 font-medium uppercase tracking-wider">{t("folder.addTo")}</div>
                                {folderList.filter((folder) => !pendingFolderIds.includes(folder.id)).map((folder) => (
                                  <button
                                    key={folder.id}
                                    onClick={(e) => { e.preventDefault(); addVideoToFolder(folder.id, video.id); }}
                                    className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent/10 transition-colors"
                                  >
                                    {folder.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                          <button
                            onClick={(e) => { e.preventDefault(); handleDelete(video.id); }}
                            className="text-muted hover:text-danger transition-colors p-1.5 rounded"
                            title={t("video.bulkDelete")}
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
                </>
            )}
          </div>
        )}

        {/* ── BULK ACTION BAR ── */}
        {(selectedVideoIds.size > 0 || bulkDeleteProgress) && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-border bg-surface shadow-2xl px-5 py-3 flex items-center gap-4">
            {bulkDeleteProgress ? (
              <div className="flex items-center gap-3 min-w-[280px]">
                <div className="flex-1 h-2 rounded-full bg-surface-hover overflow-hidden">
                  <div
                    className="h-full rounded-full bg-danger transition-all duration-300"
                    style={{ width: `${(bulkDeleteProgress.done / bulkDeleteProgress.total) * 100}%` }}
                  />
                </div>
                <span className="text-sm text-muted whitespace-nowrap">{t("video.bulkDeleting")} {bulkDeleteProgress.done}/{bulkDeleteProgress.total}</span>
              </div>
            ) : (
              <>
                <span className="text-sm font-medium">{selectedVideoIds.size} video{selectedVideoIds.size !== 1 ? "s" : ""} selected</span>
                <div className="relative" data-folder-dropdown>
                  <button
                    onClick={() => setBulkFolderDropdown(!bulkFolderDropdown)}
                    className="text-sm px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors"
                  >
                    {t("video.bulkAddToFolder")}
                  </button>
                  {bulkFolderDropdown && (
                    <div className="absolute bottom-full mb-2 left-0 w-48 rounded-lg border border-border bg-surface shadow-xl z-50 py-1">
                      <div className="px-3 py-1.5 text-[10px] text-muted/60 font-medium uppercase tracking-wider">{t("folder.select")}</div>
                      {folderList.filter((folder) => !pendingFolderIds.includes(folder.id)).map((folder) => (
                        <button
                          key={folder.id}
                          onClick={() => bulkAddToFolder(folder.id)}
                          className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent/10 transition-colors"
                        >
                          {folder.name}
                        </button>
                      ))}
                      {folderList.length === 0 && (
                        <div className="px-3 py-2 text-sm text-muted">{t("folder.noFolders")}</div>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={bulkDeleteSelected}
                  className="text-sm px-3 py-1.5 rounded-lg bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
                >
                  {t("video.bulkDelete")}
                </button>
                <button
                  onClick={() => setSelectedVideoIds(new Set())}
                  className="text-sm text-muted hover:text-foreground transition-colors"
                >
                  Deselect all
                </button>
              </>
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
                placeholder={t("search.placeholder")}
                autoFocus
                className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                </div>
              )}
              {searchQuery && !pinnedSearches.includes(searchQuery) && (
                <button
                  onClick={() => { const next = [...pinnedSearches, searchQuery]; setPinnedSearches(next); fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aiKeys: {}, pinnedSearches: next }) }); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-accent transition-colors"
                  title={t("search.pinSearch")}
                >
                  📌
                </button>
              )}
            </div>

            {!searchQuery && pinnedSearches.length > 0 && (
              <div className="mb-4">
                <p className="text-[10px] text-muted uppercase tracking-wider mb-2">{t("search.pinnedSearches")}</p>
                <div className="flex flex-wrap gap-2">
                  {pinnedSearches.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSearch(q)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:border-accent hover:bg-accent/10 transition-colors"
                    >
                      <span>{q}</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); const next = pinnedSearches.filter((s) => s !== q); setPinnedSearches(next); fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aiKeys: {}, pinnedSearches: next }) }); }}
                        className="text-muted hover:text-danger cursor-pointer"
                      >
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Type filter chips + folder + year dropdowns */}
            {searchQuery.trim().length >= 2 && (
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
                  {[
                    { key: null, label: t("search.allTypes") },
                    { key: "annotation", label: t("search.annotations") },
                    { key: "scene", label: t("search.scenes") },
                    { key: "key_moment", label: t("search.keyMoments") },
                  ].map(({ key, label }) => (
                    <button
                      key={key ?? "all"}
                      onClick={() => { setSearchTypeFilter(key); handleSearch(searchQuery, { type: key }); }}
                      className={`px-2 py-1 text-[10px] rounded-md transition-colors ${searchTypeFilter === key ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <select
                  value={searchFolderFilter ?? ""}
                  onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setSearchFolderFilter(v); handleSearch(searchQuery, { folder: v }); }}
                  className="px-2 py-1 text-[10px] rounded-lg border border-border bg-surface"
                >
                  <option value="">{t("search.allFolders")}</option>
                  {folderList.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                {uniqueYears.length > 0 && (
                  <select
                    value={searchYearFilter ?? ""}
                    onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setSearchYearFilter(v); handleSearch(searchQuery, { year: v }); }}
                    className="px-2 py-1 text-[10px] rounded-lg border border-border bg-surface"
                  >
                    <option value="">{t("search.allYears")}</option>
                    {uniqueYears.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <p className="text-sm text-muted text-center py-8">{t("search.noResults")}</p>
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
                        <div className="relative shrink-0 w-28 h-16">
                          <Image src={r.videoThumbnail} alt="" fill className="object-cover rounded" />
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
                        {r.videoYear != null && <span className="ml-1 text-[10px] text-muted/60">({r.videoYear})</span>}
                        {r.videoChannel != null && <span className="ml-1 text-[10px] text-muted/50">- {r.videoChannel}</span>}
                      </p>
                      {r.folderName && (
                        <p className="text-[10px] text-accent/60 shrink-0">
                          {t("search.inFolder").replace("{folder}", r.folderName)}
                        </p>
                      )}
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
                            {t("search.addToCliplist")}
                          </div>
                          {visibleCliplists.length === 0 ? (
                            <div className="px-3 py-2 text-[10px] text-muted">{t("search.noCliplists")}</div>
                          ) : (
                            visibleCliplists.map((cl) => (
                              <button
                                key={cl.id}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  addToCliplist(cl.id, r);
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
                              {t("search.newCliplist")}
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
                {cliplistsLoading ? t("app.loading") : `${cliplists.length} ${t("cliplist.name")}${cliplists.length !== 1 ? "s" : ""}`}
              </h2>
              <button
                onClick={() => setShowCreateCliplist(true)}
                className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-all flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                {t("cliplist.newCliplist")}
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
                    placeholder={t("cliplist.name")}
                    autoFocus
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none mb-2"
                  />
                  <input
                    type="text"
                    value={newCliplistDesc}
                    onChange={(e) => setNewCliplistDesc(e.target.value)}
                    placeholder={t("cliplist.description")}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none mb-3"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={creatingCliplist || !newCliplistName.trim()}
                      className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all"
                    >
                      {creatingCliplist ? t("cliplist.creating") : t("cliplist.create")}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowCreateCliplist(false); setNewCliplistName(""); setNewCliplistDesc(""); }}
                      className="rounded-lg border border-border px-4 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                    >
                      {t("cliplist.cancelCreate")}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {cliplistsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : selectedCliplist ? (
              /* ── Single cliplist view ── */
              <div>
                <button
                  onClick={() => setSelectedCliplist(null)}
                  className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors mb-4"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  {t("cliplist.back")}
                </button>

                <div className="rounded-xl border border-border bg-surface overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="min-w-0 flex-1">
                      {editingCliplistId === selectedCliplist.id ? (
                        <form onSubmit={(e) => { e.preventDefault(); renameCliplist(selectedCliplist.id, editingCliplistName); }} className="flex items-center gap-2">
                          <input
                            autoFocus
                            type="text"
                            value={editingCliplistName}
                            onChange={(e) => setEditingCliplistName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") setEditingCliplistId(null); }}
                            className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm font-semibold focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
                          />
                          <button type="submit" disabled={!editingCliplistName.trim()}
                            className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all">
                            {t("cliplist.saveRename")}
                          </button>
                          <button type="button" onClick={() => setEditingCliplistId(null)}
                            className="rounded px-2 py-1 text-[10px] text-muted hover:text-foreground transition-colors">
                            {t("cliplist.cancelRename")}
                          </button>
                        </form>
                      ) : (
                        <>
                          <h3 className="text-sm font-semibold">{selectedCliplist.name}</h3>
                          {selectedCliplist.description && (
                            <p className="text-[10px] text-muted mt-0.5">{selectedCliplist.description}</p>
                          )}
                          <p className="text-[10px] text-muted/50 mt-0.5">{selectedCliplist.items.length} item{selectedCliplist.items.length !== 1 ? "s" : ""}</p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setShowSlideForm(!showSlideForm); setSlideTitle(""); setSlideDetail(""); setSlideDuration(5); setEditingSlideId(null); setSlideInsertIdx(-1); setBulkMode(false); setBulkText(""); setBulkStatus(""); }}
                        className="text-xs text-muted hover:text-accent transition-colors"
                        title={t("cliplist.addSlideBetween")}
                      >
                        + {t("cliplist.new")}
                      </button>
                      {editingCliplistId !== selectedCliplist.id && (
                        <button
                          onClick={() => { setEditingCliplistId(selectedCliplist.id); setEditingCliplistName(selectedCliplist.name); }}
                          className="text-xs text-muted hover:text-accent transition-colors"
                        >
                          {t("sidebar.rename")}
                        </button>
                      )}
                      {selectedCliplist.items.length > 0 && (
                        <button
                          onClick={() => setSlideshowItems(selectedCliplist.items)}
                          className="rounded-lg bg-accent px-3 py-1.5 text-[10px] font-medium text-white hover:bg-accent-hover active:scale-95 transition-all flex items-center gap-1.5"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          {t("cliplist.play")}
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          if (sharing) return;
                          setSharing(true);
                          try {
                            const res = await fetch(`/api/cliplists/${selectedCliplist.id}/share`, { method: "POST" });
                            if (!res.ok) return;
                            const { url } = await res.json();
                            await navigator.clipboard.writeText(url);
                            setShareCopied(true);
                            setTimeout(() => setShareCopied(false), 2000);
                          } catch {}
                          setSharing(false);
                        }}
                        className={`text-xs transition-colors ${shareCopied ? "text-accent" : "text-muted hover:text-accent"}`}
                        title={shareCopied ? t("cliplist.copied") : t("cliplist.share")}
                      >
                        {shareCopied ? (
                          <span className="text-[10px] font-medium">{t("cliplist.copied")}</span>
                        ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                        )}
                      </button>
                      <button
                        onClick={() => deleteCliplist(selectedCliplist.id)}
                        className="text-xs text-danger/60 hover:text-danger transition-colors"
                      >
                        {t("cliplist.delete")}
                      </button>
                    </div>
                  </div>

                  {/* Inline slide form */}
                  {showSlideForm && (
                    <div className="border-b border-border bg-surface-hover/20 px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={slideInsertIdx}
                          onChange={(e) => setSlideInsertIdx(Number(e.target.value))}
                          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none max-w-[40%] shrink-0"
                          title={t("cliplist.insertAt")}
                        >
                          <option value={-1}>{t("cliplist.insertEnd")}</option>
                          {selectedCliplist.items.filter((it) => !pendingItemIds.includes(it.id)).map((it, i) => (
                            <option key={it.id} value={i}>
                              {(it.type === "slide" ? t("cliplist.slideBadge") : formatTs(it.timestamp)) + " · " + (it.title.length > 24 ? it.title.slice(0, 24) + "…" : it.title)}
                            </option>
                          ))}
                        </select>
                        <span className="text-[9px] text-muted/50 shrink-0">{t("cliplist.insertAfterHint")}</span>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => { setBulkMode(!bulkMode); setBulkStatus(""); }}
                          className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${bulkMode ? "border-accent text-accent bg-accent/10" : "border-border text-muted hover:text-foreground"}`}
                        >
                          {t("cliplist.bulkAdd")}
                        </button>
                      </div>

                      {bulkMode ? (
                        <>
                          <textarea
                            autoFocus
                            value={bulkText}
                            onChange={(e) => setBulkText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addBulkSlides(selectedCliplist.id); } }}
                            rows={5}
                            placeholder={t("cliplist.bulkPlaceholder")}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none resize-y"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={!parseBulkSlides(bulkText).length}
                              onClick={() => addBulkSlides(selectedCliplist.id)}
                              className="rounded-lg bg-accent px-3 py-1.5 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all"
                            >
                              {t("cliplist.bulkImport")}
                            </button>
                            <span className="text-[10px] text-muted">{parseBulkSlides(bulkText).length} {t("cliplist.slidesDetected")}</span>
                            {bulkStatus && <span className="text-[10px] text-accent">{bulkStatus}</span>}
                          </div>
                        </>
                      ) : (
                        <form
                          onSubmit={(e) => { e.preventDefault(); addSlide(selectedCliplist.id); }}
                          className="space-y-2"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus
                              type="text"
                              value={slideTitle}
                              onChange={(e) => setSlideTitle(e.target.value)}
                              placeholder={t("cliplist.slideTitle")}
                              className="flex-1 min-w-0 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                            />
                            <input
                              type="text"
                              value={slideDetail}
                              onChange={(e) => setSlideDetail(e.target.value)}
                              placeholder={t("cliplist.slideSubtitle")}
                              className="hidden sm:block flex-1 min-w-0 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <div className="flex items-center gap-1">
                              {[5, 10, 15, 30, 60].map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => { setSlideDuration(d); setSlideHold(false); }}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${!slideHold && slideDuration === d ? "bg-accent text-white" : "text-muted hover:text-foreground border border-border"}`}
                                >
                                  {d}s
                                </button>
                              ))}
                              {!slideHold && (
                                <input
                                  type="number"
                                  min={1}
                                  max={3600}
                                  value={slideDuration}
                                  onChange={(e) => setSlideDuration(Math.max(1, Number(e.target.value)))}
                                  className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-xs text-center focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              )}
                              <label className="flex items-center gap-1 ml-1 cursor-pointer">
                                <input type="checkbox" checked={slideHold} onChange={(e) => setSlideHold(e.target.checked)} className="accent-accent h-3 w-3" />
                                <span className="text-[10px] text-muted">{t("cliplist.holdSlide")}</span>
                              </label>
                            </div>
                                  <div className="flex items-center gap-1" title={t("cliplist.theme")}>
                                    {SLIDE_COLORS.map((c) => (
                                      <button
                                        key={c || "none"}
                                        type="button"
                                        onClick={() => setSlideColor(c)}
                                        title={c || t("cliplist.noTheme")}
                                        aria-label={`${t("cliplist.theme")}: ${c || t("cliplist.noTheme")}`}
                                        className={`w-4 h-4 rounded-full border transition-all ${slideColor === c ? "ring-2 ring-accent ring-offset-1 ring-offset-surface scale-110" : "border-border/60"} ${c ? "" : "bg-gradient-to-br from-white/10 to-transparent"}`}
                                        style={c ? { backgroundColor: c } : undefined}
                                      />
                                    ))}
                                  </div>
                            <input
                              type="url"
                              value={slideImage}
                              onChange={(e) => setSlideImage(e.target.value)}
                              placeholder={t("cliplist.imageUrl")}
                              className="flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 py-1 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                            />
                            <button
                              type="submit"
                              disabled={!slideTitle.trim()}
                              className="rounded-lg bg-accent px-3 py-1.5 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all shrink-0"
                            >
                              {t("cliplist.addSlide")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowSlideForm(false);
                                setSlideTitle(""); setSlideDetail(""); setSlideDuration(5); setSlideHold(false);
                                setSlideColor(""); setSlideImage(""); setSlideInsertIdx(-1); setBulkMode(false); setBulkText("");
                              }}
                              className="text-[10px] text-muted hover:text-foreground transition-colors shrink-0"
                            >
                              {t("cliplist.cancelSlide")}
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}

                  {selectedCliplist.items.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-muted">{t("cliplist.noItems")}</div>
                  ) : (
                    <div className="divide-y divide-border/50 max-h-[60vh] overflow-y-auto">
                      {selectedCliplist.items.filter((item) => !pendingItemIds.includes(item.id)).map((item) => (
                        <div key={item.id}
                          draggable={dragArmedId === item.id}
                          onDragStart={(e) => { setDragItemId(item.id); e.dataTransfer.effectAllowed = "move"; }}
                          onDragOver={(e) => { e.preventDefault(); if (dragOverItemId !== item.id) setDragOverItemId(item.id); }}
                          onDragLeave={() => setDragOverItemId((prev) => (prev === item.id ? null : prev))}
                          onDrop={(e) => { e.preventDefault(); handleDropOnItem(item.id); }}
                          onDragEnd={() => { setDragArmedId(null); setDragItemId(null); setDragOverItemId(null); }}
                          className={`flex items-center gap-3 px-4 py-2.5 transition-colors group/item ${
                            dragOverItemId === item.id && dragItemId !== null && dragItemId !== item.id
                              ? "bg-accent/10"
                              : "hover:bg-surface-hover/50"
                          }`}
                        >
                          {editingSlideId !== item.id && editingClipId !== item.id && (
                            <button
                              onMouseDown={() => setDragArmedId(item.id)}
                              onTouchStart={() => setDragArmedId(item.id)}
                              className="-ml-1 p-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted/30 hover:text-accent opacity-0 group-hover/item:opacity-100 transition-all"
                              title={t("cliplist.reorder")}
                            >
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
                            </button>
                          )}
                          {item.type === "slide" ? (
                            editingSlideId === item.id ? (
                              /* ── Slide edit form ── */
                              <form
                                onSubmit={(e) => { e.preventDefault(); updateSlideItem(selectedCliplist.id, item.id); }}
                                className="w-full space-y-2 py-1"
                              >
                                <div className="flex items-center gap-2">
                                  <input
                                    autoFocus
                                    type="text"
                                    value={editSlideTitle}
                                    onChange={(e) => setEditSlideTitle(e.target.value)}
                                    className="flex-1 min-w-0 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                                  />
                                  <button
                                    type="submit"
                                    disabled={!editSlideTitle.trim()}
                                    className="rounded-lg bg-accent px-3 py-1.5 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all shrink-0"
                                  >
                                    {t("cliplist.saveSlide")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingSlideId(null)}
                                    className="text-[10px] text-muted hover:text-foreground transition-colors shrink-0"
                                  >
                                    {t("cliplist.cancelEdit")}
                                  </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                  <input
                                    type="text"
                                    value={editSlideDetail}
                                    onChange={(e) => setEditSlideDetail(e.target.value)}
                                    placeholder={t("cliplist.editSubtitle")}
                                    className="flex-1 min-w-[140px] rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                                  />
                                  {!editSlideHold && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      {[5, 10, 15, 30, 60].map((d) => (
                                        <button
                                          key={d}
                                          type="button"
                                          onClick={() => setEditSlideDuration(d)}
                                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${editSlideDuration === d ? "bg-accent text-white" : "text-muted hover:text-foreground border border-border"}`}
                                        >
                                          {d}s
                                        </button>
                                      ))}
                                      <input
                                        type="number"
                                        min={1}
                                        max={3600}
                                        value={editSlideDuration}
                                        onChange={(e) => setEditSlideDuration(Math.max(1, Number(e.target.value)))}
                                        className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-xs text-center focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      />
                                    </div>
                                  )}
                                  <label className="flex items-center gap-1 cursor-pointer shrink-0">
                                    <input type="checkbox" checked={editSlideHold} onChange={(e) => setEditSlideHold(e.target.checked)} className="accent-accent h-3 w-3" />
                                    <span className="text-[10px] text-muted">{t("cliplist.holdSlide")}</span>
                                  </label>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                  <div className="flex items-center gap-1" title={t("cliplist.theme")}>
                                    {SLIDE_COLORS.map((c) => (
                                      <button
                                        key={c || "none"}
                                        type="button"
                                        onClick={() => setEditSlideColor(c)}
                                        title={c || t("cliplist.noTheme")}
                                        aria-label={`${t("cliplist.theme")}: ${c || t("cliplist.noTheme")}`}
                                        className={`w-4 h-4 rounded-full border transition-all ${editSlideColor === c ? "ring-2 ring-accent ring-offset-1 ring-offset-surface scale-110" : "border-border/60"} ${c ? "" : "bg-gradient-to-br from-white/10 to-transparent"}`}
                                        style={c ? { backgroundColor: c } : undefined}
                                      />
                                    ))}
                                  </div>
                                  <input
                                    type="url"
                                    value={editSlideImage}
                                    onChange={(e) => setEditSlideImage(e.target.value)}
                                    placeholder={t("cliplist.imageUrl")}
                                    className="flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 py-1 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                                  />
                                </div>
                              </form>
                            ) : (
                            /* ── Slide card ── */
                            <div className="flex items-center gap-3 w-full">
                              <div className="w-full flex items-center gap-3 py-1">
                                <div className="w-20 h-12 shrink-0 rounded bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center border border-accent/10">
                                  <svg className="w-5 h-5 text-accent/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1l2.5-1.5A1 1 0 0121 7v10a1 1 0 01-1.5.86L17 16v1a2 2 0 01-2 2z" />
                                  </svg>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <span className="text-[9px] uppercase font-medium text-purple-400 bg-purple-500/10 px-1 py-0.5 rounded">{t("cliplist.slideBadge")}</span>
                                    {item.endTimestamp == null ? (
                                      <span className="text-[9px] font-mono text-accent/70">{t("cliplist.holdBadge")}</span>
                                    ) : (
                                      <span className="text-[9px] font-mono text-muted/50">{item.endTimestamp}s</span>
                                    )}
                                    {item.color && (
                                      <span className="w-2.5 h-2.5 rounded-full border border-border/60 inline-block" style={{ backgroundColor: item.color }} title={item.color} />
                                    )}
                                    {item.imageUrl && (
                                      <svg className="w-3 h-3 text-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                    )}
                                  </div>
                                  <p className="text-xs font-medium truncate">{item.title}</p>
                                  {item.detail && (
                                    <p className="text-[10px] text-muted truncate">{item.detail}</p>
                                  )}
                                </div>
                              </div>
                                <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => duplicateSlideItem(selectedCliplist.id, item)}
                                  className="p-1 rounded text-muted/40 hover:text-accent hover:bg-accent/10 transition-all opacity-0 group-hover/item:opacity-100"
                                  title={t("cliplist.duplicate")}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                </button>
                                <button
                                  onClick={() => { setEditingSlideId(item.id); setEditSlideTitle(item.title); setEditSlideDetail(item.detail ?? ""); setEditSlideDuration(item.endTimestamp ?? 5); setEditSlideHold(item.endTimestamp == null); setEditSlideColor(item.color ?? ""); setEditSlideImage(item.imageUrl ?? ""); }}
                                  className="p-1 rounded text-muted/40 hover:text-accent hover:bg-accent/10 transition-all opacity-0 group-hover/item:opacity-100"
                                  title={t("cliplist.editSlide")}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                </button>
                                <button
                                  onClick={() => removeClipItem(selectedCliplist.id, item.id)}
                                  className="p-1 rounded text-muted/40 hover:text-danger hover:bg-danger/10 transition-all opacity-0 group-hover/item:opacity-100"
                                  title={t("cliplist.removeItem")}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </div>
                            </div>
                          )
                        ) : (
                          <>
                          {editingClipId === item.id ? (
                            /* ── Clip edit form ── */
                            <form
                              onSubmit={(e) => { e.preventDefault(); updateClipItem(selectedCliplist.id, item.id); }}
                              className="w-full space-y-2 py-1"
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  autoFocus
                                  type="text"
                                  value={editClipTitle}
                                  onChange={(e) => setEditClipTitle(e.target.value)}
                                  placeholder={t("cliplist.slideTitle")}
                                  className="flex-1 min-w-0 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                                />
                                <button
                                  type="submit"
                                  disabled={!editClipTitle.trim() || editClipEnd <= editClipStart}
                                  className="rounded-lg bg-accent px-3 py-1.5 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all shrink-0"
                                >
                                  {t("cliplist.saveSlide")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingClipId(null)}
                                  className="text-[10px] text-muted hover:text-foreground transition-colors shrink-0"
                                >
                                  {t("cliplist.cancelEdit")}
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editClipDetail}
                                  onChange={(e) => setEditClipDetail(e.target.value)}
                                  placeholder={t("cliplist.editSubtitle")}
                                  className="flex-1 min-w-0 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                                />
                                <label className="flex items-center gap-1 shrink-0">
                                  <span className="text-[9px] text-muted">{t("cliplist.startSec")}</span>
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={editClipStart}
                                    onChange={(e) => setEditClipStart(Math.max(0, Number(e.target.value)))}
                                    className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-center focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </label>
                                <label className="flex items-center gap-1 shrink-0">
                                  <span className="text-[9px] text-muted">{t("cliplist.endSec")}</span>
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={editClipEnd}
                                    onChange={(e) => setEditClipEnd(Math.max(0, Number(e.target.value)))}
                                    className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-center focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </label>
                              </div>
                            </form>
                          ) : (
                          <>
                          {item.videoThumbnail && (
                            <div className="relative shrink-0 w-20 h-12">
                              <Image src={item.videoThumbnail} alt="" fill className="object-cover rounded" />
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
                            onClick={() => { setEditingClipId(item.id); setEditClipTitle(item.title); setEditClipDetail(item.detail ?? ""); setEditClipStart(item.timestamp); setEditClipEnd(item.endTimestamp ?? item.timestamp + 30); }}
                            className="p-1 rounded text-muted/40 hover:text-accent hover:bg-accent/10 transition-all opacity-0 group-hover/item:opacity-100"
                            title={t("cliplist.editItem")}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button
                            onClick={() => removeClipItem(selectedCliplist.id, item.id)}
                            className="p-1 rounded text-muted/40 hover:text-danger hover:bg-danger/10 transition-all opacity-0 group-hover/item:opacity-100"
                            title={t("cliplist.removeItem")}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                          </>
                          )}
                          </>
                        )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ── Cliplist grid ── */
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleCliplists.map((cl) => (
                  editingCliplistId === cl.id ? (
                    <div key={cl.id} className="rounded-xl border border-accent bg-surface p-4">
                      <form
                        onSubmit={(e) => { e.preventDefault(); renameCliplist(cl.id, editingCliplistName); }}
                        className="space-y-2"
                      >
                        <input
                          autoFocus
                          type="text"
                          value={editingCliplistName}
                          onChange={(e) => setEditingCliplistName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Escape") setEditingCliplistId(null); }}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-semibold focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
                        />
                        <div className="flex items-center gap-2">
                          <button type="submit" disabled={!editingCliplistName.trim()}
                            className="rounded-md bg-accent px-3 py-1 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all">
                            {t("cliplist.saveRename")}
                          </button>
                          <button type="button" onClick={() => setEditingCliplistId(null)}
                            className="rounded-md px-3 py-1 text-[10px] text-muted hover:text-foreground transition-colors">
                            {t("cliplist.cancelRename")}
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : (
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
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] font-mono text-muted/50 mt-0.5">{cl.itemCount}</span>
                        <span
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingCliplistId(cl.id); setEditingCliplistName(cl.name); }}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all p-0.5 rounded cursor-pointer"
                          title={t("sidebar.rename")}
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </span>
                        <span
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteCliplist(cl.id); }}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-all p-0.5 rounded cursor-pointer"
                          title={t("cliplist.delete")}
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 text-[9px] text-muted/40">
                      <span>{new Date(cl.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {tab === "settings" && (
          <div>
            {!session ? (
              <div className="rounded-lg border border-dashed border-border py-16 text-center">
                <p className="text-muted text-sm">{t("settings.notSignedIn")}</p>
                <a href="/signin" className="text-xs text-accent hover:text-accent-hover mt-2 inline-block transition-colors">
                  {t("settings.signIn")}
                </a>
              </div>
            ) : settingsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header */}
                <div>
                  <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">{t("settings.aiProviders")}</h2>
                  <p className="text-xs text-muted/60 mt-1">
                    {t("settings.description")}
                  </p>
                </div>

                {/* Provider cards */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { id: "groq", name: "Groq", model: "Llama 3.3 70B", color: "bg-purple-500", keyPrefix: "gsk_", free: true },
                    { id: "mistral", name: "Mistral", model: "Mistral Small 4", color: "bg-orange-400", keyPrefix: "jUX", free: true },
                    { id: "openrouter", name: "OpenRouter", model: "Nemotron Ultra", color: "bg-cyan-500", keyPrefix: "sk-or-", free: true },
                    { id: "gemini", name: "Google Gemini", model: "Gemini 2.5 Flash", color: "bg-blue-500", keyPrefix: "AIza", free: true },
                    { id: "cerebras", name: "Cerebras", model: "Gemma 4 31B", color: "bg-pink-500", keyPrefix: "csk-", free: true },
                    { id: "github", name: "GitHub Models", model: "GPT-4o", color: "bg-gray-500", keyPrefix: "ghp_", free: true },
                    { id: "anthropic", name: "Anthropic", model: "Claude Sonnet 4", color: "bg-orange-600", keyPrefix: "sk-ant-" },
                    { id: "openai", name: "OpenAI", model: "GPT-4.1", color: "bg-emerald-500", keyPrefix: "sk-" },
                  ].map((p) => {
                    const isConfigured = configuredProviders.has(p.id);
                    const isPreferred = settings.preferredProvider === p.id;
                    const test = testResults[p.id];
                    const inputValue = settings.aiKeys[p.id] ?? "";

                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl border bg-surface p-4 transition-all ${
                          isPreferred ? "border-accent/50 ring-1 ring-accent/20" : "border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${p.color}`} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <h3 className="text-sm font-semibold">{p.name}</h3>
                                {p.free && (
                                  <span className="text-[9px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">{t("settings.free")}</span>
                                )}
                              </div>
                              <p className="text-[10px] text-muted/60">{p.model}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {isConfigured && (
                              <button
                                onClick={() => {
                                  const newKeys = { ...settings.aiKeys };
                                  delete newKeys[p.id];
                                  const newSettings = { ...settings, aiKeys: newKeys };
                                  setSettings(newSettings);
                                  setConfiguredProviders(prev => { const next = new Set(prev); next.delete(p.id); return next; });
                                  saveSettings(newSettings);
                                }}
                                className="text-[10px] text-danger/60 hover:text-danger transition-colors"
                                title={t("settings.removeKey")}
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={() => {
                                saveSettings({
                                  ...settings,
                                  preferredProvider: isPreferred ? null : p.id,
                                });
                              }}
                              className={`p-1 rounded transition-colors ${
                                isPreferred
                                  ? "text-accent bg-accent/10"
                                  : "text-muted/40 hover:text-accent hover:bg-accent/5"
                              }`}
                              title={isPreferred ? t("settings.unsetPreferred") : t("settings.preferred")}
                            >
                              <svg className="w-3.5 h-3.5" fill={isPreferred ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* API Key input */}
                        <div className="space-y-2">
                          <div className="relative">
                            <input
                              type="password"
                              value={inputValue}
                              onChange={(e) => {
                                const newKeys = { ...settings.aiKeys, [p.id]: e.target.value };
                                const newSettings = { ...settings, aiKeys: newKeys };
                                setSettings(newSettings);
                                // Debounced save
                                if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
                                settingsSaveTimerRef.current = setTimeout(() => {
                                  // If input is empty, remove the key
                                  if (!e.target.value.trim()) {
                                    const cleaned = { ...newSettings.aiKeys };
                                    delete cleaned[p.id];
                                    const cleanedSettings = { ...newSettings, aiKeys: cleaned };
                                    setSettings(cleanedSettings);
                                    setConfiguredProviders(prev => { const next = new Set(prev); next.delete(p.id); return next; });
                                    saveSettings(cleanedSettings);
                                  } else {
                                    saveSettings(newSettings);
                                  }
                                }, 800);
                              }}
                              placeholder={isConfigured ? t("settings.keySaved") : t("settings.enterKey").replace("{provider}", p.name).replace("{prefix}", p.keyPrefix)}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
                            />
                          </div>

                          {/* Test button + result */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => testProvider(p.id)}
                              disabled={!isConfigured || test?.testing}
                              className="rounded-lg border border-border px-2.5 py-1 text-[10px] font-medium text-muted hover:text-foreground hover:border-accent/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                              {test?.testing ? t("settings.testing") : t("settings.test")}
                            </button>
                            {test && !test.testing && (
                              <span className={`text-[10px] font-medium ${test.success ? "text-emerald-500" : "text-danger"}`}>
                                {test.success ? t("settings.connected") : t("settings.failed")}
                              </span>
                            )}
                            {isConfigured && !test && (
                              <span className="text-[10px] text-emerald-500/60 font-medium">{t("settings.configured")}</span>
                            )}
                          </div>
                          {/* Warning banner when test fails */}
                          {test && !test.testing && !test.success && (
                            <div className="mt-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[10px] text-danger/80 leading-relaxed">
                                  {test.error?.slice(0, 80) ?? t("settings.connectionFailed")} &mdash; {t("settings.keyNotUsed")}
                                </p>
                                <button
                                  onClick={() => {
                                    const newKeys = { ...settings.aiKeys };
                                    delete newKeys[p.id];
                                    const newSettings = { ...settings, aiKeys: newKeys };
                                    setSettings(newSettings);
                                    setConfiguredProviders(prev => { const next = new Set(prev); next.delete(p.id); return next; });
                                    setTestResults(prev => { const next = { ...prev }; delete next[p.id]; return next; });
                                    saveSettings(newSettings);
                                  }}
                                  className="shrink-0 text-[10px] text-danger/60 hover:text-danger font-medium transition-colors"
                                >
                                  {t("settings.removeKey")}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Status bar */}
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-muted">
                      {t("settings.providersConfigured").replace("{count}", String(configuredProviders.size))}
                    </span>
                    {settings.preferredProvider && (
                      <span className="text-[10px] text-accent font-medium">
                        {t("settings.preferredLabel").replace("{provider}", settings.preferredProvider)}
                      </span>
                    )}
                    {settingsSaving && (
                      <span className="text-[10px] text-muted/50 animate-pulse">Saving...</span>
                    )}
                  </div>
                  {configuredProviders.size > 0 && (
                    <button
                      onClick={() => {
                        if (confirm("Remove all API keys?")) {
                          setConfiguredProviders(new Set());
                          saveSettings({ aiKeys: {}, preferredProvider: null });
                        }
                      }}
                      className="text-[10px] text-danger/60 hover:text-danger transition-colors"
                    >
                      {t("settings.clearAll")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {/* ── HELP TAB ── */}
        {tab === "help" && (
          <div>
            <div className="mb-4">
              <button
                onClick={() => setShowTour(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent hover:bg-accent/20 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t("tour.startButton")}
              </button>
            </div>
            <HelpSection />
          </div>
        )}
      </main>
      </div>

      {/* ── Share Folder Dialog ── */}
      {shareDialogOpen && shareDialogFolderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShareDialogOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Share Folder</h3>
              <button onClick={() => setShareDialogOpen(false)} className="text-muted hover:text-foreground transition-colors p-1 rounded">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Share link */}
            <div className="mb-4">
              <label className="text-[10px] font-medium text-muted uppercase tracking-wider mb-1 block">Share Link</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={shareLink}
                  readOnly
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono text-muted truncate"
                />
                <button
                  onClick={handleCopyShareLink}
                  className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                    sharedFolderCopied === shareDialogFolderId
                      ? "bg-accent text-white"
                      : "bg-accent/10 text-accent hover:bg-accent/20"
                  }`}
                >
                  {sharedFolderCopied === shareDialogFolderId ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {/* Shared users list */}
            <div className="mb-4">
              <label className="text-[10px] font-medium text-muted uppercase tracking-wider mb-1 block">
                People with access ({shareList.length})
              </label>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {shareListLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  </div>
                ) : shareList.length === 0 ? (
                  <p className="text-xs text-muted/60 text-center py-3">No one has been invited yet</p>
                ) : (
                  shareList.map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-lg bg-background px-3 py-2 border border-border/50">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs truncate">{s.email}</p>
                        <span className={`text-[9px] font-medium ${s.permission === "edit" ? "text-accent" : "text-muted/60"}`}>
                          {s.permission === "edit" ? "Can edit" : "Can view"}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoveShare(s.email)}
                        className="shrink-0 p-1 rounded text-muted/40 hover:text-danger transition-colors"
                        title="Remove"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Add user form */}
            <form onSubmit={handleAddShare} className="mt-4">
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={newShareEmail}
                  onChange={(e) => setNewShareEmail(e.target.value)}
                  placeholder="email@example.com"
                  required
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                />
                <select
                  value={newSharePermission}
                  onChange={(e) => setNewSharePermission(e.target.value as "view" | "edit")}
                  className="rounded-lg border border-border bg-background px-2 py-2 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                >
                  <option value="view">View</option>
                  <option value="edit">Edit</option>
                </select>
                <button
                  type="submit"
                  disabled={addingShare || !newShareEmail.trim()}
                  className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all"
                >
                  {addingShare ? "Adding..." : "Invite"}
                </button>
              </div>
              <label className="mt-2 flex items-center gap-1.5 text-[10px] text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveEmailForFuture}
                  onChange={(e) => setSaveEmailForFuture(e.target.checked)}
                  className="h-3 w-3 accent-accent"
                />
                Save this email for future shares
              </label>
              {savedEmails.length > 0 && (
                <div className="mt-3">
                  <label className="text-[10px] font-medium text-muted uppercase tracking-wider mb-1 block">
                    Saved emails
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {savedEmails.map((email) => (
                      <span
                        key={email}
                        className="inline-flex items-center gap-1 rounded-full bg-background border border-border/60 px-2 py-1 text-[10px] text-muted"
                      >
                        <button
                          type="button"
                          onClick={() => setNewShareEmail(email)}
                          className="hover:text-foreground transition-colors"
                          title="Use this email"
                        >
                          {email}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveSavedEmail(email)}
                          className="text-muted/40 hover:text-danger transition-colors"
                          title="Remove saved email"
                        >
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ── Video Playlist overlay ── */}
      {slideshowItems && (
        <VideoPlaylistPlayer items={slideshowItems} onClose={() => setSlideshowItems(null)} />
      )}

      {/* ── Undo/redo history panel ── */}
      <HistoryPanel />

      {/* ── Tag browser modal ── */}
      {showTagBrowser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowTagBrowser(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">{t("sidebar.tags")}</h3>
              <button onClick={() => setShowTagBrowser(false)} className="text-muted hover:text-foreground transition-colors p-1 rounded">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {globalTagsLoading ? (
              <p className="text-xs text-muted text-center py-8">{t("app.loading")}</p>
            ) : globalTags.length === 0 ? (
              <p className="text-xs text-muted text-center py-8">No tags found</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {globalTags.map(({ tag, count }) => (
                  <button
                    key={tag}
                    onClick={() => { setSearchQuery(`#${tag}`); handleSearch(`#${tag}`); setTab("search"); setShowTagBrowser(false); }}
                    className="px-3 py-1.5 text-xs rounded-lg border border-border hover:border-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5"
                  >
                    <span>#{tag}</span>
                    <span className="text-[10px] text-muted">({count})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Cmd+K global search overlay ── */}
      {showCmdK && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/30 backdrop-blur-sm" onClick={() => setShowCmdK(false)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
            <input
              ref={cmdKInputRef}
              type="text"
              placeholder="Search everything..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowCmdK(false);
                if (e.key === "Enter") {
                  const val = (e.target as HTMLInputElement).value;
                  if (val.trim()) { handleSearch(val); setTab("search"); }
                  setShowCmdK(false);
                }
              }}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p className="text-[10px] text-muted mt-2">Press Enter to search · Esc to close</p>
          </div>
        </div>
      )}

      {/* ── Undo toast ── */}
      {pendingDelete && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-xl">
          <span className="text-xs text-foreground truncate max-w-[240px]">
            <span className="text-muted">{t("undo.prefix")}</span> — {pendingDelete.label}
          </span>
          <button
            onClick={undoPendingDelete}
            className="text-xs font-medium text-accent hover:text-accent-hover transition-colors shrink-0"
          >
            {t("undo.button")}
          </button>
          <button
            onClick={flushPendingDelete}
            className="p-1 rounded text-muted/50 hover:text-foreground transition-colors shrink-0"
            title={t("undo.dismiss")}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}
      {showTour && (
        <GuidedTour
          steps={DASHBOARD_TOUR_STEPS}
          storageKey="vestigia-dashboard-tour"
          onComplete={() => { completeTour("vestigia-dashboard-tour"); setShowTour(false); }}
        />
      )}
      </div>
    </div>
  );
}
