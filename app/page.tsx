"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import VideoPlaylistPlayer, { ClipItem, formatTs } from "@/components/VideoPlaylistPlayer";
import { useLanguage } from "@/components/LanguageProvider";
import HelpSection from "@/components/HelpSection";
import LandingBackground from "@/components/LandingBackground";

interface Video {
  id: number;
  youtubeUrl: string;
  youtubeId: string;
  title: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  annotationCount?: number;
  sceneCount?: number;
  momentCount?: number;
  hasTranscript?: boolean;
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

interface CliplistWithItems extends Cliplist {
  items: ClipItem[];
}

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

export default function Home() {
  const { data: session } = useSession();
  const { t, language, toggleLanguage } = useLanguage();
  const [tab, setTab] = useState<Tab>("import");

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractKeyMoments, setExtractKeyMoments] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [fetching, setFetching] = useState(true);

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
  const [editingSlideId, setEditingSlideId] = useState<number | null>(null);
  const [editSlideTitle, setEditSlideTitle] = useState("");
  const [editSlideDetail, setEditSlideDetail] = useState("");
  const [editSlideDuration, setEditSlideDuration] = useState(5);
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
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // ── Share dialog state ──
  const [shareDialogFolderId, setShareDialogFolderId] = useState<number | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareList, setShareList] = useState<Array<{ id: number; email: string; permission: string }>>([]);
  const [shareListLoading, setShareListLoading] = useState(false);
  const [newShareEmail, setNewShareEmail] = useState("");
  const [newSharePermission, setNewSharePermission] = useState<"view" | "edit">("view");
  const [addingShare, setAddingShare] = useState(false);
  const [appUsers, setAppUsers] = useState<Array<{ email: string; name: string | null }>>([]);
  const [appUsersLoading, setAppUsersLoading] = useState(false);
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

  async function handleDelete(id: number) {
    if (!confirm("Delete this video and all its annotations?")) return;
    await fetch(`/api/videos/${id}`, { method: "DELETE" });
    await loadVideos();
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
    if (!confirm("Delete this folder? Videos will not be deleted.")) return;
    await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
    if (selectedFolderId === folderId) setSelectedFolderId(null);
    await loadFolders();
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
    // Load Google-authenticated users for suggestions
    setAppUsersLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) setAppUsers(await res.json());
    } catch {}
    setAppUsersLoading(false);
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

  async function handleRemoveSavedEmail(email: string) {
    try {
      await fetch(`/api/users/saved-emails?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      setSavedEmails((prev) => prev.filter((e) => e !== email));
    } catch {}
  }

  async function handleRemoveShare(email: string) {
    if (!shareDialogFolderId) return;
    try {
      await fetch(`/api/folders/${shareDialogFolderId}/shares?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      await loadShareList(shareDialogFolderId);
      await loadFolders();
    } catch {}
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

  async function removeVideoFromFolder(folderId: number, videoId: number) {
    await fetch(`/api/folders/${folderId}/videos`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
    });
    await loadFolders();
    await loadVideos();
    if (selectedFolderId === folderId) await loadFolderVideos(folderId);
    setFolderDropdown({ videoId: -1, open: false });
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
    if (!confirm(`Delete ${ids.length} video${ids.length !== 1 ? "s" : ""} and all their data?`)) return;
    setBulkDeleteProgress({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i++) {
      await fetch(`/api/videos/${ids[i]}`, { method: "DELETE" });
      setBulkDeleteProgress({ done: i + 1, total: ids.length });
    }
    setBulkDeleteProgress(null);
    setSelectedVideoIds(new Set());
    await loadVideos();
    if (selectedFolderId !== null) await loadFolderVideos(selectedFolderId);
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

  const currentVideoList = selectedFolderId !== null ? folderVideos : videos;
  const allSelected = currentVideoList.length > 0 && currentVideoList.every((v) => selectedVideoIds.has(v.id));

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

  async function addToCliplist(cliplistId: number, result: SearchResult) {
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
      await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "slide",
          title: slideTitle.trim(),
          detail: slideDetail.trim() || null,
          endTimestamp: slideDuration,
        }),
      });
      setSlideTitle("");
      setSlideDetail("");
      setSlideDuration(5);
      setShowSlideForm(false);
      // Refresh the current cliplist view
      if (selectedCliplist?.id === cliplistId) {
        const res = await fetch(`/api/cliplists/${cliplistId}`);
        if (res.ok) setSelectedCliplist(await res.json());
      }
      await loadCliplists();
    } catch {}
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

  async function updateSlideItem(cliplistId: number, itemId: number) {
    if (!editSlideTitle.trim()) return;
    try {
      await fetch(`/api/cliplists/${cliplistId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          title: editSlideTitle.trim(),
          detail: editSlideDetail.trim() || null,
          endTimestamp: editSlideDuration,
        }),
      });
      setEditingSlideId(null);
      if (selectedCliplist?.id === cliplistId) {
        const res = await fetch(`/api/cliplists/${cliplistId}`);
        if (res.ok) setSelectedCliplist(await res.json());
      }
      await loadCliplists();
    } catch {}
  }

  const playlistActive = playlistVideos.length > 0 || playlistLoading;

  return (
    <div className="min-h-screen flex flex-col relative">
      <LandingBackground />
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

      <div className="mx-auto w-full px-6 py-6 flex-1 flex gap-6">
        {/* ── SIDEBAR: Folders ── */}
        <aside className="w-52 shrink-0">
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
                onClick={() => setSelectedFolderId(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedFolderId === null
                    ? "bg-accent/10 text-accent font-medium"
                    : "text-muted hover:text-foreground hover:bg-surface"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{t("sidebar.allVideos")}</span>
                  <span className="text-[10px] text-muted/60">{videos.length}</span>
                </div>
              </button>

              {/* Folder list */}
              {folderList.map((folder) => (
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
                      onClick={() => setSelectedFolderId(folder.id)}
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
                            onClick={async () => {
                              try {
                                await fetch(`/api/folders/${folder.id}/share`, { method: "DELETE" });
                                await loadFolders();
                              } catch {}
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
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {folderVideos.map((video) => (
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
                            <span className={`shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded flex items-center gap-0.5 ${(video.momentCount ?? 0) > 0 ? "text-amber-500 bg-amber-500/10" : "text-muted/50 bg-surface-hover/50"}`} title={`${video.momentCount ?? 0} key moment${(video.momentCount ?? 0) !== 1 ? "s" : ""}`}>
                              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
                              {video.momentCount ?? 0}
                            </span>
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
                    {folderVideos.map((video) => (
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
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {videos.map((video) => (
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
                                {folderList.map((folder) => (
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
                  {videos.map((video) => (
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
                                {folderList.map((folder) => (
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
                      {folderList.map((folder) => (
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
            </div>

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
                            {t("search.addToCliplist")}
                          </div>
                          {cliplists.length === 0 ? (
                            <div className="px-3 py-2 text-[10px] text-muted">{t("search.noCliplists")}</div>
                          ) : (
                            cliplists.map((cl) => (
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
                        onClick={() => { setShowSlideForm(!showSlideForm); setSlideTitle(""); setSlideDetail(""); setSlideDuration(5); setEditingSlideId(null); }}
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
                    <div className="border-b border-border bg-surface-hover/20 px-4 py-3">
                      <form
                        onSubmit={(e) => { e.preventDefault(); addSlide(selectedCliplist.id); }}
                        className="flex items-center gap-2"
                      >
                        <input
                          autoFocus
                          type="text"
                          value={slideTitle}
                          onChange={(e) => setSlideTitle(e.target.value)}
                          placeholder={t("cliplist.slideTitle")}
                          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                        />
                        <input
                          type="text"
                          value={slideDetail}
                          onChange={(e) => setSlideDetail(e.target.value)}
                          placeholder={t("cliplist.slideSubtitle")}
                          className="hidden sm:block flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={1}
                            max={120}
                            value={slideDuration}
                            onChange={(e) => setSlideDuration(Math.max(1, Number(e.target.value)))}
                            className="w-14 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-center focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-[10px] text-muted">sec</span>
                        </div>
                        <button
                          type="submit"
                          disabled={!slideTitle.trim()}
                          className="rounded-lg bg-accent px-3 py-1.5 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all"
                        >
                          {t("cliplist.addSlide")}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowSlideForm(false); setSlideTitle(""); setSlideDetail(""); setSlideDuration(5); setEditingSlideId(null); }}
                          className="text-[10px] text-muted hover:text-foreground transition-colors"
                        >
                          {t("cliplist.cancelSlide")}
                        </button>
                      </form>
                    </div>
                  )}

                  {selectedCliplist.items.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-muted">{t("cliplist.noItems")}</div>
                  ) : (
                    <div className="divide-y divide-border/50 max-h-[60vh] overflow-y-auto">
                      {selectedCliplist.items.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover/50 transition-colors group/item">
                          {item.type === "slide" ? (
                            editingSlideId === item.id ? (
                              /* ── Slide edit form ── */
                              <form
                                onSubmit={(e) => { e.preventDefault(); updateSlideItem(selectedCliplist.id, item.id); }}
                                className="flex items-center gap-2 w-full"
                              >
                                <input
                                  autoFocus
                                  type="text"
                                  value={editSlideTitle}
                                  onChange={(e) => setEditSlideTitle(e.target.value)}
                                  className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                                />
                                <input
                                  type="text"
                                  value={editSlideDetail}
                                  onChange={(e) => setEditSlideDetail(e.target.value)}
                                  placeholder={t("cliplist.editSubtitle")}
                                  className="hidden sm:block flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                                />
                                <div className="flex items-center gap-1 shrink-0">
                                  <input
                                    type="number"
                                    min={1}
                                    max={120}
                                    value={editSlideDuration}
                                    onChange={(e) => setEditSlideDuration(Math.max(1, Number(e.target.value)))}
                                    className="w-14 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-center focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <span className="text-[10px] text-muted">sec</span>
                                </div>
                                <button
                                  type="submit"
                                  disabled={!editSlideTitle.trim()}
                                  className="rounded-lg bg-accent px-3 py-1.5 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-all"
                                >
                                  {t("cliplist.saveSlide")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingSlideId(null)}
                                  className="text-[10px] text-muted hover:text-foreground transition-colors"
                                >
                                  {t("cliplist.cancelEdit")}
                                </button>
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
                                    {item.endTimestamp && (
                                      <span className="text-[9px] font-mono text-muted/50">{item.endTimestamp}s</span>
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
                                  onClick={() => { setEditingSlideId(item.id); setEditSlideTitle(item.title); setEditSlideDetail(item.detail ?? ""); setEditSlideDuration(item.endTimestamp ?? 5); }}
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
                            onClick={() => removeClipItem(selectedCliplist.id, item.id)}
                            className="p-1 rounded text-muted/40 hover:text-danger hover:bg-danger/10 transition-all opacity-0 group-hover/item:opacity-100"
                            title={t("cliplist.removeItem")}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                          </>)}
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
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingCliplistId(cl.id); setEditingCliplistName(cl.name); }}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all p-0.5 rounded"
                          title={t("sidebar.rename")}
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
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
          <HelpSection />
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
      </div>
    </div>
  );
}
