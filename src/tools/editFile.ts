import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import type { Tool } from "./index.js";
import { unifiedDiff } from "../diff.js";
import { pushUndo } from "../undo.js";
import { checkSyntax } from "../syntaxCheck.js";

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Deterministic exact-string replacement: find one unique occurrence of old_string and replace with new_string. Use ONLY when both strings are exactly known and a literal match is intended (e.g., bumping a version constant, swapping a single import). For refactors, renames-across-file, JSDoc additions, structural rewrites, or any change you'd describe in natural language, prefer edit_with_ai.",
  requiresApproval: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" },
      old_string: { type: "string", description: "Exact string to find (must be unique in file)" },
      new_string: { type: "string", description: "Replacement string" },
    },
    required: ["path", "old_string", "new_string"],
  },
  describe(args) {
    const path = String(args.path);
    const oldStr = String(args.old_string ?? "");
    const newStr = String(args.new_string ?? "");
    const abs = resolve(process.cwd(), path);
    const header = chalk.bold("File: ") + chalk.cyan(path);
    if (existsSync(abs)) {
      try {
        const before = readFileSync(abs, "utf8");
        const idx = before.indexOf(oldStr);
        if (idx >= 0) {
          const after = before.slice(0, idx) + newStr + before.slice(idx + oldStr.length);
          return header + "\n\n" + unifiedDiff(before, after);
        }
      } catch {}
    }
    return header + "\n" + chalk.red("- " + truncate(oldStr)) + "\n" + chalk.green("+ " + truncate(newStr));
  },
  async run(args) {
    const path = resolve(process.cwd(), String(args.path));
    const oldStr = String(args.old_string ?? "");
    const newStr = String(args.new_string ?? "");
    if (!oldStr) throw new Error("old_string is empty");
    const before = readFileSync(path, "utf8");
    const idx = before.indexOf(oldStr);
    if (idx < 0) throw new Error("old_string not found in file");
    if (before.indexOf(oldStr, idx + 1) >= 0)
      throw new Error("old_string appears multiple times; provide more context");
    const after = before.slice(0, idx) + newStr + before.slice(idx + oldStr.length);
    pushUndo(path, "edit_file");
    writeFileSync(path, after, "utf8");
    const syntax = await checkSyntax(path);
    return {
      ok: true,
      path,
      syntax_warning: syntax.ok ? undefined : syntax.reason,
    };
  },
};

function truncate(s: string, n = 80) {
  const oneLine = s.replace(/\n/g, "\\n");
  return oneLine.length > n ? oneLine.slice(0, n - 1) + "…" : oneLine;
}
