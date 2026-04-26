import { emitKeypressEvents } from "node:readline";
import { readdirSync, statSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import chalk from "chalk";

export interface SlashCommand {
  name: string;
  description: string;
  source?: "builtin" | "custom";
  /** Nested subcommands shown when the user types `/<this> <partial>`. */
  subcommands?: SlashCommand[];
}

export interface ReadInputOptions {
  commands: SlashCommand[];
  history: string[];
  promptSymbol?: string;
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function visualWidth(s: string): number {
  const plain = stripAnsi(s);
  let n = 0;
  for (const ch of plain) {
    const code = ch.codePointAt(0) || 0;
    if (
      code >= 0x1100 &&
      (code <= 0x115f ||
        (code >= 0x2e80 && code <= 0x9fff) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x20000 && code <= 0x2fffd))
    ) {
      n += 2;
    } else if (code >= 0x20) {
      n += 1;
    }
  }
  return n;
}

function termWidth(): number {
  const w = process.stdout.columns || 80;
  return Math.max(20, w);
}

function rule(): string {
  return chalk.gray("─".repeat(termWidth()));
}

function fuzzy(query: string, name: string): boolean {
  if (!query) return true;
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n.startsWith(q)) return true;
  // subsequence match
  let i = 0;
  for (const ch of n) {
    if (ch === q[i]) i++;
    if (i >= q.length) return true;
  }
  return false;
}

export function readInput(opts: ReadInputOptions): Promise<string | undefined> {
  const { commands, history } = opts;
  const promptStr = opts.promptSymbol ?? chalk.bold.cyan("› ");

  return new Promise((resolve) => {
    let buffer = "";
    let cursor = 0; // index into buffer (chars, not visual cols)
    let selectedIdx = 0;
    let renderedLines = 0;
    let cursorRowInBlock = 0; // visual row offset of terminal cursor inside the rendered block (0 = top rule)
    let historyIdx = history.length; // pointing past end == "no recall"
    let savedDraft = ""; // current input saved when navigating history

    // Ctrl+R reverse-search overlay state. When non-null, render swaps to a
    // search line and key handling treats most chars as query input.
    let search: { query: string; matchIdx: number } | null = null;

    const stdin = process.stdin;
    const stdout = process.stdout;

    function findSearchMatch(query: string, startFrom: number): number {
      // Walk newest-first (history end → start), return -1 if no match.
      for (let i = startFrom; i >= 0; i--) {
        if (history[i].toLowerCase().includes(query.toLowerCase())) return i;
      }
      return -1;
    }

    async function openExternalEditor(): Promise<void> {
      const editor = process.env.EDITOR || process.env.VISUAL || "nano";
      const tmp = join(tmpdir(), `mcode-prompt-${Date.now()}.md`);
      try {
        writeFileSync(tmp, buffer, "utf8");
      } catch {
        return;
      }
      // Suspend our raw-mode rendering, hand the terminal to the editor.
      stdin.setRawMode?.(false);
      stdin.pause();
      stdout.write("\x1b[?25h"); // show cursor
      try {
        await new Promise<void>((res, rej) => {
          const child = spawn(editor, [tmp], { stdio: "inherit" });
          child.on("close", () => res());
          child.on("error", rej);
        });
      } catch {}
      try {
        const updated = readFileSync(tmp, "utf8");
        buffer = updated.replace(/\n+$/, "");
        cursor = buffer.length;
      } catch {}
      try {
        unlinkSync(tmp);
      } catch {}
      stdin.setRawMode?.(true);
      stdin.resume();
      stdout.write("\x1b[?25l"); // hide cursor
      // Force full re-render on a new line so we don't overlap editor's last frame.
      renderedLines = 0;
      cursorRowInBlock = 0;
      stdout.write("\n");
      render(true);
    }

    function suggestions(): SlashCommand[] {
      if (!buffer.startsWith("/")) return [];
      if (buffer.includes("\n")) return [];
      // Tokens (preserve trailing empty if buffer ends with a space).
      const trailingSpace = / $/.test(buffer);
      const parts = buffer.slice(1).split(/\s+/).filter((p, i, arr) => p !== "" || i === arr.length - 1);
      // Walk into nested subcommands using the leading exact-name parts.
      let level: SlashCommand[] = commands;
      let i = 0;
      for (; i < parts.length - 1; i++) {
        const match = level.find((c) => c.name === parts[i]);
        if (!match || !match.subcommands?.length) {
          // No further nesting; if a trailing space exists at this point, no sub-suggestions.
          return [];
        }
        level = match.subcommands;
      }
      let partial = parts[i] ?? "";
      if (trailingSpace && partial !== "") {
        // Trailing space means we have a complete word and want children of THAT word.
        const match = level.find((c) => c.name === partial);
        if (match && match.subcommands?.length) {
          level = match.subcommands;
          partial = "";
        }
      }
      return level.filter((c) => fuzzy(partial, c.name)).slice(0, 12);
    }

    /** Tab-complete a path-like word at cursor. Returns updated buffer/cursor or null. */
    function tryCompletePath(
      buf: string,
      cur: number,
    ): { buffer: string; cursor: number } | null {
      const before = buf.slice(0, cur);
      const after = buf.slice(cur);
      const wordStart = Math.max(
        before.lastIndexOf(" ") + 1,
        before.lastIndexOf("\t") + 1,
        before.lastIndexOf("\n") + 1,
      );
      const afterWS = after.search(/[\s]/);
      const wordEnd = afterWS < 0 ? buf.length : cur + afterWS;
      const word = buf.slice(wordStart, wordEnd);
      if (!word) return null;
      // Only path-like tokens. Allow optional @ prefix (used for @file inline include).
      let pathPart = word;
      let prefix = "";
      if (pathPart.startsWith("@")) {
        prefix = "@";
        pathPart = pathPart.slice(1);
      }
      if (!/[/.~]/.test(pathPart)) return null;
      // Expand ~ to HOME
      let normalized = pathPart;
      if (normalized.startsWith("~/")) {
        normalized = (process.env.HOME ?? "") + normalized.slice(1);
      }
      const dir = dirname(normalized) || ".";
      const base = basename(normalized);
      const absDir = isAbsolute(dir) ? dir : resolvePath(process.cwd(), dir);
      let entries: string[];
      try {
        entries = readdirSync(absDir);
      } catch {
        return null;
      }
      const matches = entries.filter((e) => e.startsWith(base));
      if (!matches.length) return null;
      // Longest common prefix
      let common = matches[0];
      for (let i = 1; i < matches.length; i++) {
        let k = 0;
        while (k < common.length && k < matches[i].length && common[k] === matches[i][k]) k++;
        common = common.slice(0, k);
        if (!common) break;
      }
      if (common.length <= base.length) {
        // Already at common prefix; nothing further to insert. Surface count.
        return null;
      }
      // Append "/" if the unique match is a directory
      let appended = common;
      if (matches.length === 1) {
        try {
          const st = statSync(resolvePath(absDir, common));
          if (st.isDirectory()) appended += "/";
        } catch {}
      }
      // Build the new path string preserving ~ prefix if user used it
      const replacement =
        normalized !== pathPart && pathPart.startsWith("~/")
          ? "~/" + pathPart.slice(2, pathPart.length - base.length) + appended
          : pathPart.slice(0, pathPart.length - base.length) + appended;
      const newWord = prefix + replacement;
      const newBuffer = buf.slice(0, wordStart) + newWord + buf.slice(wordEnd);
      return { buffer: newBuffer, cursor: wordStart + newWord.length };
    }

    function applySuggestion(picked: SlashCommand): string {
      // Replace the partial under cursor with the picked name.
      const parts = buffer.slice(1).split(/\s+/);
      // If buffer ends with space, the "partial" is empty trailing slot.
      if (/ $/.test(buffer)) parts.push("");
      parts[parts.length - 1] = picked.name;
      const next = "/" + parts.join(" ");
      // If picked has subcommands, append a space so the user can keep typing/picking.
      return picked.subcommands?.length ? next + " " : next;
    }

    function clearRendered() {
      if (renderedLines === 0) return;
      // Cursor is currently on row `cursorRowInBlock` of the block (0 = top rule).
      // Move up to top of block (row 0), then erase from there to end of screen.
      stdout.write("\r");
      if (cursorRowInBlock > 0) stdout.write(`\x1b[${cursorRowInBlock}A`);
      stdout.write("\x1b[J");
    }

    const CONT_PREFIX = chalk.gray("· ");

    function linePrefix(idx: number): string {
      return idx === 0 ? promptStr : CONT_PREFIX;
    }

    function render(initial = false) {
      if (!initial) clearRendered();

      // Reverse-search overlay replaces the normal input frame.
      if (search) {
        const matchText = search.matchIdx >= 0 ? history[search.matchIdx] : "";
        const label =
          chalk.cyan("(reverse-i-search)") +
          chalk.gray("`") +
          chalk.bold(search.query || " ") +
          chalk.gray("`: ");
        const out = [rule(), label + matchText, rule()].join("\r\n");
        process.stdout.write(out);
        const cursorCol = visualWidth(stripAnsi(label) + matchText);
        process.stdout.write("\r");
        process.stdout.write(`\x1b[1A`);
        if (cursorCol > 0) process.stdout.write(`\x1b[${cursorCol}C`);
        renderedLines = 3;
        cursorRowInBlock = 1;
        return;
      }

      const w = termWidth();
      const sugs = suggestions();
      const inputLines = buffer.split("\n");

      const lines: string[] = [];
      lines.push(rule());
      for (let i = 0; i < inputLines.length; i++) {
        lines.push(linePrefix(i) + inputLines[i]);
      }
      for (let i = 0; i < sugs.length; i++) {
        const s = sugs[i];
        const sel = i === selectedIdx;
        const arrow = sel ? chalk.cyan("▶ ") : "  ";
        const tag = sel ? chalk.bold.cyan("/" + s.name) : chalk.cyan("/" + s.name);
        const desc = chalk.gray("  " + s.description);
        lines.push(arrow + tag + desc);
      }
      lines.push(rule());

      // Use \r\n explicitly: in raw mode, plain \n only does LF, not CR.
      stdout.write(lines.join("\r\n"));

      // Compute visual rows occupied by each input line (handles wrap).
      const inputRows: number[] = inputLines.map((l, i) => {
        const vis = visualWidth(linePrefix(i) + l);
        return Math.max(1, Math.ceil(vis / w));
      });
      const totalInputRows = inputRows.reduce((a, b) => a + b, 0);
      const totalVisualLines = 1 /* top rule */ + totalInputRows + sugs.length + 1 /* bottom rule */;

      // Find which input line the cursor lives on.
      const beforeCursor = buffer.slice(0, cursor);
      const cursorLineIdx = (beforeCursor.match(/\n/g) || []).length;
      const colChars = beforeCursor.length - (beforeCursor.lastIndexOf("\n") + 1);
      const partialLine = inputLines[cursorLineIdx].slice(0, colChars);
      const cursorVisX = visualWidth(linePrefix(cursorLineIdx) + partialLine);
      const cursorWrapRow = Math.floor(cursorVisX / w);
      const cursorCol = cursorVisX % w;

      // Sum visual rows of input lines BEFORE the cursor's line.
      let rowsBeforeCursorLine = 0;
      for (let i = 0; i < cursorLineIdx; i++) rowsBeforeCursorLine += inputRows[i];

      const targetRow = 1 + rowsBeforeCursorLine + cursorWrapRow;

      const upBy = totalVisualLines - 1 - targetRow;
      stdout.write("\r");
      if (upBy > 0) stdout.write(`\x1b[${upBy}A`);
      if (cursorCol > 0) stdout.write(`\x1b[${cursorCol}C`);

      renderedLines = totalVisualLines;
      cursorRowInBlock = targetRow;
    }

    function moveCursorBelowAll() {
      // Cursor is at row `cursorRowInBlock` inside the block of size renderedLines.
      // Move down to just below the bottom rule, then emit a newline so subsequent
      // output starts on a fresh line (preserving the rendered block above).
      const linesBelow = Math.max(0, renderedLines - 1 - cursorRowInBlock);
      stdout.write("\r");
      if (linesBelow > 0) stdout.write(`\x1b[${linesBelow}B`);
      stdout.write("\r\n");
    }

    function done(value: string | undefined) {
      moveCursorBelowAll();
      try {
        stdin.setRawMode?.(false);
      } catch {}
      stdin.pause();
      stdin.removeListener("keypress", onKey);
      resolve(value);
    }

    function recallHistory(delta: number) {
      if (history.length === 0) return;
      const newIdx = Math.max(0, Math.min(history.length, historyIdx + delta));
      if (newIdx === historyIdx) return;
      if (historyIdx === history.length) savedDraft = buffer;
      historyIdx = newIdx;
      buffer = newIdx === history.length ? savedDraft : history[newIdx];
      cursor = buffer.length;
      selectedIdx = 0;
      render();
    }

    const onKey = (
      ch: string | undefined,
      key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string },
    ) => {
      if (!key) return;

      // ── Reverse-search overlay key handling ─────────────────────────────
      if (search) {
        if (key.ctrl && key.name === "c") {
          search = null;
          render();
          return;
        }
        if (key.name === "return") {
          // Accept and submit
          if (search.matchIdx >= 0) {
            buffer = history[search.matchIdx];
            cursor = buffer.length;
          }
          search = null;
          done(buffer);
          return;
        }
        if (key.name === "escape" || key.name === "tab") {
          // Accept and continue editing
          if (search.matchIdx >= 0) {
            buffer = history[search.matchIdx];
            cursor = buffer.length;
          }
          search = null;
          render();
          return;
        }
        if (key.ctrl && key.name === "r") {
          // cycle to next older match
          if (search.matchIdx > 0) {
            const next = findSearchMatch(search.query, search.matchIdx - 1);
            if (next >= 0) search.matchIdx = next;
          }
          render();
          return;
        }
        if (key.name === "backspace") {
          search.query = search.query.slice(0, -1);
          search.matchIdx = findSearchMatch(search.query, history.length - 1);
          render();
          return;
        }
        const seq = ch ?? key.sequence ?? "";
        if (seq && !key.ctrl && !key.meta && seq.length >= 1) {
          const printable = Array.from(seq).filter((c) => c.codePointAt(0)! >= 0x20).join("");
          if (printable) {
            search.query += printable;
            search.matchIdx = findSearchMatch(search.query, history.length - 1);
            render();
          }
        }
        return;
      }

      // ── Normal mode ──────────────────────────────────────────────────────
      // Ctrl-C / Ctrl-D on empty buffer → cancel
      if ((key.ctrl && key.name === "c") || (key.ctrl && key.name === "d" && !buffer)) {
        done(undefined);
        return;
      }
      // Ctrl+R: enter reverse-search mode
      if (key.ctrl && key.name === "r") {
        search = { query: "", matchIdx: history.length - 1 };
        render();
        return;
      }
      // Ctrl+G: open the current buffer in $EDITOR (async, non-blocking handler)
      if (key.ctrl && key.name === "g") {
        void openExternalEditor();
        return;
      }
      // Newline insertion: Ctrl+Enter, Ctrl+J, Option+Enter, Shift+Enter (terminal-dependent)
      if (
        (key.ctrl && (key.name === "j" || key.name === "return" || key.name === "enter")) ||
        (key.meta && key.name === "return") ||
        (key.shift && key.name === "return")
      ) {
        buffer = buffer.slice(0, cursor) + "\n" + buffer.slice(cursor);
        cursor++;
        selectedIdx = 0;
        render();
        return;
      }
      // Plain Enter → submit (or accept selected suggestion if it advances the input)
      if (key.name === "return") {
        const sugs = suggestions();
        if (sugs.length > 0 && buffer.startsWith("/")) {
          const sel = sugs[selectedIdx];
          const expanded = applySuggestion(sel);
          // If pick adds nesting (trailing space + has subcommands), don't submit yet.
          if (expanded !== buffer && expanded.endsWith(" ")) {
            buffer = expanded;
            cursor = buffer.length;
            selectedIdx = 0;
            render();
            return;
          }
          // Otherwise: if pick equals buffer, submit; if pick differs, expand and submit.
          buffer = expanded;
          cursor = buffer.length;
          done(buffer);
          return;
        }
        done(buffer);
        return;
      }
      // Tab → slash suggestion expansion if available, else file-path completion.
      if (key.name === "tab") {
        const sugs = suggestions();
        if (sugs.length > 0) {
          const sel = sugs[selectedIdx];
          const expanded = applySuggestion(sel);
          buffer = expanded.endsWith(" ") ? expanded : expanded + " ";
          cursor = buffer.length;
          selectedIdx = 0;
          render();
          return;
        }
        const completed = tryCompletePath(buffer, cursor);
        if (completed) {
          buffer = completed.buffer;
          cursor = completed.cursor;
          render();
        }
        return;
      }
      // Esc → if suggestions open, dismiss; else no-op
      if (key.name === "escape") {
        if (suggestions().length) {
          // simulate dismiss by clearing slash trigger — too aggressive; just no-op
        }
        return;
      }
      // Arrow up/down → suggestion nav, or history if no suggestions
      if (key.name === "up") {
        const sugs = suggestions();
        if (sugs.length) {
          selectedIdx = (selectedIdx - 1 + sugs.length) % sugs.length;
          render();
        } else {
          recallHistory(-1);
        }
        return;
      }
      if (key.name === "down") {
        const sugs = suggestions();
        if (sugs.length) {
          selectedIdx = (selectedIdx + 1) % sugs.length;
          render();
        } else {
          recallHistory(+1);
        }
        return;
      }
      // Left/Right
      if (key.name === "left") {
        if (cursor > 0) {
          cursor--;
          render();
        }
        return;
      }
      if (key.name === "right") {
        if (cursor < buffer.length) {
          cursor++;
          render();
        }
        return;
      }
      // Home/End
      if (key.name === "home" || (key.ctrl && key.name === "a")) {
        cursor = 0;
        render();
        return;
      }
      if (key.name === "end" || (key.ctrl && key.name === "e")) {
        cursor = buffer.length;
        render();
        return;
      }
      // Backspace
      if (key.name === "backspace") {
        if (cursor > 0) {
          buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
          cursor--;
          selectedIdx = 0;
          render();
        }
        return;
      }
      // Ctrl-W: delete word
      if (key.ctrl && key.name === "w") {
        if (cursor > 0) {
          const left = buffer.slice(0, cursor);
          const m = left.match(/(\S+\s*|\s+)$/);
          const cut = m ? m[0].length : 1;
          buffer = buffer.slice(0, cursor - cut) + buffer.slice(cursor);
          cursor -= cut;
          render();
        }
        return;
      }
      // Ctrl-U: delete to line start
      if (key.ctrl && key.name === "u") {
        buffer = buffer.slice(cursor);
        cursor = 0;
        render();
        return;
      }
      // Ctrl-L: redraw screen
      if (key.ctrl && key.name === "l") {
        process.stdout.write("\x1b[2J\x1b[H");
        renderedLines = 0;
        render(true);
        return;
      }

      // Printable characters (single grapheme assumed) and pasted text
      const seq = ch ?? key.sequence ?? "";
      if (seq && !key.ctrl && !key.meta) {
        // Filter out control chars
        const printable = Array.from(seq).filter((c) => c.codePointAt(0)! >= 0x20).join("");
        if (!printable) return;
        buffer = buffer.slice(0, cursor) + printable + buffer.slice(cursor);
        cursor += printable.length;
        selectedIdx = 0;
        render();
      }
    };

    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKey);

    render(true);
  });
}
