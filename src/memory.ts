import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BASE_SYSTEM = `You are mcode, a CLI coding assistant powered by Mercury 2.
You help the user write, edit, and run code through tool calls.

Operating principles:
- Use the provided tools to inspect and modify the workspace.
- Prefer reading existing files before writing. Always confirm paths exist via list_dir / read_file when uncertain.
- Make small, verifiable changes. After edits, run a relevant command (test/build/script) via bash when sensible.
- When the task is complete, reply with a concise plain-text summary (no tool call) of what changed and how to run it.
- Reply in Japanese when the user writes in Japanese; otherwise match their language.
- Be concise. Skip apologies and prefaces. No marketing tone.
- Never invent file contents — read first.

Tool selection (single-file mutations):
- For ANY non-trivial single-file change describable in natural language (rename across file, JSDoc, async/await conversion, early returns, helper extraction, idiomatic refactor), call edit_with_ai with a specific instruction. It is faster (~300ms) and more reliable than chaining edit_file calls.
- Use edit_file ONLY when you already know the exact old_string and new_string verbatim (e.g., version bumps, single-line constant swaps, replacing one specific import line).
- Use write_file only for new files or full rewrites where the existing content is irrelevant.
- For cursor-style autocomplete (finishing a recursive call, expanding a partial expression at a known location), call fim_complete.
- For multi-file refactors, drive yourself with read_file + edit_with_ai per file. edit_with_ai cannot see other files.`;

const PLAN_MODE_ADDENDUM = `\n# Plan mode (active)
Before invoking any write_file / edit_file / bash tool, FIRST output a numbered plan of the steps you intend to take and STOP (no tool calls in the same turn). Wait for the user's confirmation. Read-only inspection (read_file / list_dir / grep) may run during planning to gather facts. Once the user approves the plan, execute the steps with tools.`;

export interface MemoryOptions {
  planMode?: boolean;
  extraInstructions?: string;
}

function readIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function buildSystemPrompt(opts: MemoryOptions = {}): string {
  const projectMercury = join(process.cwd(), "MERCURY.md");
  const projectLearned = join(process.cwd(), ".mcode", "MCODE.md");
  const userGlobal = join(homedir(), ".mcode", "MCODE.md");

  const parts: string[] = [BASE_SYSTEM];
  parts.push(`\nWorking directory: ${process.cwd()}`);

  const userMemo = readIfExists(userGlobal);
  if (userMemo) parts.push(`\n# User memory (~/.mcode/MCODE.md)\n${userMemo}`);

  const projMemo = readIfExists(projectMercury);
  if (projMemo) parts.push(`\n# Project memory (MERCURY.md)\n${projMemo}`);

  const learned = readIfExists(projectLearned);
  if (learned) parts.push(`\n# Project learnings (.mcode/MCODE.md)\n${learned}`);

  if (opts.planMode) parts.push(PLAN_MODE_ADDENDUM);
  if (opts.extraInstructions) parts.push(`\n${opts.extraInstructions}`);

  return parts.join("\n");
}

export function appendProjectLearning(text: string): string {
  const path = join(process.cwd(), ".mcode", "MCODE.md");
  mkdirSync(dirname(path), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const entry = `- (${stamp}) ${text.trim()}`;
  const prev = existsSync(path) ? readFileSync(path, "utf8") : "# Learnings\n\n";
  writeFileSync(path, prev + (prev.endsWith("\n") ? "" : "\n") + entry + "\n", "utf8");
  return path;
}
