"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import VideoPlaylistPlayer, { ClipItem } from "@/components/VideoPlaylistPlayer";

interface SharedCliplist {
  id: number;
  name: string;
  description: string | null;
  items: ClipItem[];
}

export default function SharedCliplistPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<SharedCliplist | null>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    fetch(`/api/shared/cliplist/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, [token]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted text-lg">Cliplist not found.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  if (playing && data.items.length > 0) {
    return (
      <VideoPlaylistPlayer items={data.items} onClose={() => setPlaying(false)} preclassified />
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-24 text-center">
      <p className="text-xs text-muted uppercase tracking-widest mb-3">Shared Cliplist</p>
      <h1 className="text-4xl font-bold mb-3">{data.name}</h1>
      {data.description && (
        <p className="text-muted text-sm mb-6">{data.description}</p>
      )}
      <p className="text-xs text-muted mb-8">{data.items.length} items</p>

      <button
        onClick={() => setPlaying(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-medium text-white hover:bg-accent-hover active:scale-95 transition-all"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        Play Cliplist
      </button>
    </div>
  );
}
