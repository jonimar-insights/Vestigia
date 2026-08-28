"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  id: number;
  title: string | null;
  display: string;
  className?: string;
  onRename: (id: number, title: string) => void;
}

/** Inline-editable card title: pencil toggles an input, Enter/blur commits, Escape cancels. */
export default function EditableTitle({ id, title, display, className, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    const trimmed = val.trim();
    if (trimmed === (title ?? "")) return;
    onRename(id, trimmed);
  }

  return (
    <div className="flex items-center gap-1 min-w-0">
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setVal(title ?? ""); setEditing(false); }
          }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className={`${className ?? ""} w-full px-1.5 py-0.5 -mx-1.5 border border-accent rounded bg-background focus:outline-none select-text`}
        />
      ) : (
        <>
          <h3 className={`${className ?? ""} flex-1 min-w-0`}>{display}</h3>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setVal(title ?? ""); setEditing(true); }}
            className="shrink-0 text-muted/40 hover:text-accent transition-colors p-0.5 rounded"
            title="Edit title"
            aria-label={`Edit title for ${display}`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}