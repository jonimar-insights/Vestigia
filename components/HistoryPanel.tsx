"use client";

import { useState } from "react";
import { useHistory, useHistoryHotkeys, jumpTo } from "@/lib/history";
import { useLanguage } from "@/components/LanguageProvider";

export default function HistoryPanel() {
  const { entries, pointer, canUndo, canRedo } = useHistory();
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  useHistoryHotkeys();

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 left-4 z-[55] flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-xs text-muted hover:text-foreground hover:border-accent/40 transition-all shadow-lg"
        title={t("history.panel")}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span className="hidden sm:inline">{t("history.panel")}</span>
        {entries.length > 0 && (
          <span className="text-[9px] font-mono bg-accent/15 text-accent rounded px-1 py-0.5">
            {pointer + 1}/{entries.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-16 left-4 z-[55] w-72 max-h-[50vh] flex flex-col rounded-xl border border-border bg-surface shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">{t("history.panel")}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => jumpTo(pointer - 1)}
                disabled={!canUndo}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${canUndo ? "text-accent hover:bg-accent/10" : "text-muted/30 cursor-not-allowed"}`}
              >
                {t("history.undo")}
              </button>
              <button
                onClick={() => jumpTo(pointer + 1)}
                disabled={!canRedo}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${canRedo ? "text-accent hover:bg-accent/10" : "text-muted/30 cursor-not-allowed"}`}
              >
                {t("history.redo")}
              </button>
            </div>
          </div>
          <div className="overflow-y-auto scrollbar-thin">
            {entries.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-muted">{t("history.empty")}</div>
            ) : (
              entries.map((e, i) => (
                <button
                  key={i}
                  onClick={() => jumpTo(i)}
                  disabled={i === pointer}
                  className={`w-full text-left px-3 py-2 border-b border-border/40 last:border-b-0 transition-colors flex items-center gap-2 ${
                    i === pointer ? "bg-accent/10" : i > pointer ? "opacity-40 hover:opacity-70 hover:bg-surface-hover" : "hover:bg-surface-hover"
                  }`}
                  title={i === pointer ? t("history.current") : i > pointer ? t("history.redoTo") : t("history.undoTo")}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${i <= pointer ? "bg-accent" : "bg-border"}`}
                  />
                  <span className="text-[11px] truncate">{e.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
