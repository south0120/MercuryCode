import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "./index.js";
import type { MercuryClient } from "../client.js";

/**
 * Fill-in-Middle code completion via Mercury Edit 2 (`v1/fim/completions`).
 * Inserts model-generated code between an explicit prefix and suffix in a file.
 *
 * Use when the agent knows where new code should go and wants a fast, focused
 * autocomplete-style insertion. For freeform "modify this file" instructions,
 * prefer `edit_with_ai` instead.
 */
export function makeFimCompleteTool(client: MercuryClient): Tool {
  return {
    name: "fim_complete",
    description:
      "Fill-in-Middle code completion at a specific line:column. Powered by Mercury Edit 2 — typically <500ms. Use for cursor-position completion where surrounding code is the strongest signal (e.g., finishing a recursive call, completing an import list, expanding a partially-typed expression). Returns generated text by default; pass apply=true to write it back into the file. Not for structural changes — use edit_with_ai for those.",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path (relative to cwd or absolute)" },
        line: { type: "integer", description: "1-based line number where insertion occurs (insertion point is BEFORE the column on this line)" },
        column: { type: "integer", description: "1-based column on that line", default: 1 },
        max_tokens: { type: "integer", description: "Generation budget (default 256)", default: 256 },
        apply: { type: "boolean", description: "If true, write the completion into the file at the insertion point. Default: false (return text only).", default: false },
      },
      required: ["path", "line"],
    },
    describe(args) {
      return `fim_complete ${args.path}:${args.line}:${args.column ?? 1}${args.apply ? " (apply=true)" : ""}`;
    },
    async run(args) {
      const path = resolve(process.cwd(), String(args.path));
      const line = Math.max(1, Number(args.line) | 0);
      const col = Math.max(1, Number(args.column ?? 1) | 0);
      const maxTokens = Number(args.max_tokens ?? 256);
      const apply = Boolean(args.apply);

      const content = readFileSync(path, "utf8");
      const lines = content.split(/\r?\n/);
      if (line > lines.length + 1) {
        throw new Error(`line ${line} out of range (file has ${lines.length} lines)`);
      }

      // Build prefix / suffix split at (line, col).
      const before: string[] = [];
      let preTail = "";
      let sufHead = "";
      for (let i = 0; i < lines.length; i++) {
        if (i + 1 < line) {
          before.push(lines[i]);
        } else if (i + 1 === line) {
          const c = Math.min(col - 1, lines[i].length);
          preTail = lines[i].slice(0, c);
          sufHead = lines[i].slice(c);
        }
      }
      const after = lines.slice(line);
      const prefix = (before.length ? before.join("\n") + "\n" : "") + preTail;
      const suffix = sufHead + (after.length ? "\n" + after.join("\n") : "");

      const res = await client.fim({
        model: "mercury-edit-2",
        prompt: prefix,
        suffix,
        max_tokens: maxTokens,
      });
      const completion = res.choices?.[0]?.text ?? "";

      if (!apply) {
        return { completion, tokens: res.usage?.completion_tokens ?? null };
      }

      const merged = prefix + completion + suffix;
      writeFileSync(path, merged, "utf8");
      return {
        ok: true,
        path,
        inserted_bytes: Buffer.byteLength(completion),
        completion,
      };
    },
  };
}
