import { useSyncExternalStore, useEffect } from "react";

// Session-scoped undo/redo history with inverse operations. Entries are
// pushed only after an action COMMITS on the server; undo()/redo() run the
// stored inverses. In-memory only — cleared on reload.

export interface HistoryEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface HistoryState {
  entries: HistoryEntry[];
  pointer: number; // index of the last executed entry (-1 = pristine)
  busy: boolean;
}

const MAX_ENTRIES = 50;

let state: HistoryState = { entries: [], pointer: -1, busy: false };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(patch: Partial<HistoryState>) {
  state = { ...state, ...patch };
  emit();
}

export function pushHistory(entry: HistoryEntry) {
  const entries = [...state.entries.slice(0, state.pointer + 1), entry].slice(-MAX_ENTRIES);
  set({ entries, pointer: entries.length - 1 });
}

export function canUndo(): boolean {
  return !state.busy && state.pointer >= 0;
}

export function canRedo(): boolean {
  return !state.busy && state.pointer < state.entries.length - 1;
}

export async function undoHistory(): Promise<boolean> {
  if (!canUndo()) return false;
  const entry = state.entries[state.pointer];
  set({ busy: true });
  try {
    await entry.undo();
    set({ pointer: state.pointer - 1 });
    return true;
  } finally {
    set({ busy: false });
  }
}

export async function redoHistory(): Promise<boolean> {
  if (!canRedo()) return false;
  const entry = state.entries[state.pointer + 1];
  set({ busy: true });
  try {
    await entry.redo();
    set({ pointer: state.pointer + 1 });
    return true;
  } finally {
    set({ busy: false });
  }
}

// Jump back/forward so the given entry becomes the last executed one.
export async function jumpTo(index: number): Promise<boolean> {
  let moved = false;
  while (state.pointer > index && (await undoHistory())) moved = true;
  while (state.pointer < index && (await redoHistory())) moved = true;
  return moved;
}

function getSnapshot(): HistoryState {
  return state;
}

const SERVER_SNAPSHOT: HistoryState = { entries: [], pointer: -1, busy: false };

export function useHistory(): HistoryState & { canUndo: boolean; canRedo: boolean } {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnapshot,
    () => SERVER_SNAPSHOT,
  );
  return {
    ...s,
    canUndo: !s.busy && s.pointer >= 0,
    canRedo: !s.busy && s.pointer < s.entries.length - 1,
  };
}

export function useHistoryHotkeys() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      // Native text undo wins while typing in form fields
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !(e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) return;
      e.preventDefault();
      if (e.key === "y" || (e.shiftKey && (e.key === "z" || e.key === "Z"))) void redoHistory();
      else void undoHistory();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
