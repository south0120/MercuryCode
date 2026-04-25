// Single-step undo for write_file / edit_file / edit_with_ai / fim_complete (apply=true).
// Snapshots the file content BEFORE the mutation. /undo restores the snapshot and clears it.
// Cleared after each successful pop so /undo /undo is a no-op (by design — git is the multi-step layer).

import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface UndoRecord {
  path: string;
  existed: boolean;          // false → restoration deletes the file
  content: string | null;    // null when !existed
  tool: string;              // which tool created this snapshot
  ts: string;                // ISO timestamp
}

const UNDO_FILE = () => join(homedir(), ".mcode", "undo", "last.json");

function ensureDir() {
  mkdirSync(dirname(UNDO_FILE()), { recursive: true });
}

/** Snapshot the current state of `path` so it can be restored on /undo. */
export function pushUndo(path: string, tool: string): void {
  ensureDir();
  let existed = false;
  let content: string | null = null;
  if (existsSync(path)) {
    try {
      const st = statSync(path);
      if (st.isFile()) {
        existed = true;
        content = readFileSync(path, "utf8");
      }
    } catch {
      // can't read: treat as non-existent for safety
    }
  }
  const rec: UndoRecord = { path, existed, content, tool, ts: new Date().toISOString() };
  writeFileSync(UNDO_FILE(), JSON.stringify(rec, null, 2));
}

export interface UndoResult {
  path: string;
  action: "restored" | "deleted-newly-created";
  tool: string;
}

/** Restore the most recent snapshot. Returns null if there's nothing to undo. */
export function popUndo(): UndoResult | null {
  const file = UNDO_FILE();
  if (!existsSync(file)) return null;
  let rec: UndoRecord;
  try {
    rec = JSON.parse(readFileSync(file, "utf8")) as UndoRecord;
  } catch {
    unlinkSync(file);
    return null;
  }
  if (rec.existed && rec.content !== null) {
    mkdirSync(dirname(rec.path), { recursive: true });
    writeFileSync(rec.path, rec.content, "utf8");
    unlinkSync(file);
    return { path: rec.path, action: "restored", tool: rec.tool };
  }
  // The file was newly created by the tool — undo by deleting it.
  if (existsSync(rec.path)) {
    try {
      unlinkSync(rec.path);
    } catch {}
  }
  unlinkSync(file);
  return { path: rec.path, action: "deleted-newly-created", tool: rec.tool };
}

/** Check whether an undo is available without consuming it. */
export function peekUndo(): { path: string; tool: string; ts: string } | null {
  const file = UNDO_FILE();
  if (!existsSync(file)) return null;
  try {
    const rec = JSON.parse(readFileSync(file, "utf8")) as UndoRecord;
    return { path: rec.path, tool: rec.tool, ts: rec.ts };
  } catch {
    return null;
  }
}
