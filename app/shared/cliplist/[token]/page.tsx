"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface SharedItem {
  id: number;
  type: string;
  videoId: number;
  timestamp: number;
  endTimestamp: number | null;
  title: string;
  detail: string | null;
  tags: string[];
  videoTitle: string | null;
  videoThumbnail: string | null;
  youtubeId: string | null;
}

interface SharedCliplist {
  id: number;
  name: string;
  description: string | null;
  items: SharedItem[];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SharedCliplistPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<SharedCliplist | null>(null);
  const [error, setError] = useState(false);

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

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <header className="mb-10">
        <p className="text-xs text-muted uppercase tracking-widest mb-2">Shared Cliplist</p>
        <h1 className="text-3xl font-bold mb-2">{data.name}</h1>
        {data.description && (
          <p className="text-muted text-sm">{data.description}</p>
        )}
        <p className="text-xs text-muted mt-3">{data.items.length} items</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.items.map((item) => (
          <a
            key={item.id}
            href={
              item.youtubeId
                ? `https://youtube.com/watch?v=${item.youtubeId}&t=${Math.floor(item.timestamp)}`
                : undefined
            }
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-surface border border-border rounded-xl overflow-hidden hover:bg-surface-hover transition-colors group"
          >
            <div className="relative aspect-video bg-foreground/5">
              {item.videoThumbnail ? (
                <img
                  src={item.videoThumbnail}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted text-sm">
                  No thumbnail
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                <svg className="w-10 h-10 text-white drop-shadow-lg opacity-80 group-hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[11px] px-1.5 py-0.5 rounded font-mono">
                {formatTime(item.timestamp)}
              </span>
            </div>
            <div className="p-3">
              <h3 className="font-semibold text-sm leading-snug mb-1 line-clamp-2">
                {item.title}
              </h3>
              {item.detail && (
                <p className="text-xs text-muted line-clamp-2">{item.detail}</p>
              )}
              {item.videoTitle && (
                <p className="text-[11px] text-muted/60 mt-1.5 truncate">
                  {item.videoTitle}
                </p>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
