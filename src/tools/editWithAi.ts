import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "./index.js";
import type { MercuryClient } from "../client.js";
import { unifiedDiff } from "../diff.js";

/**
 * Apply a natural-language edit instruction to a file using Mercury Edit 2's
 * `v1/edit/completions` endpoint. Best for non-trivial structural changes
 * (refactors, renames, conditional rewrites) where a deterministic
 * search-and-replace doesn't capture the intent.
 *
 * The endpoint expects messages with embedded markup tags. We bracket the
 * file contents with `<|code_to_edit|>` and the instruction with
 * `<|edit_diff_history|>`. The model responds with the full updated file
 * (or a unified diff — we accept both heuristically).
 */
export function makeEditWithAiTool(client: MercuryClient): Tool {
  return {
    name: "edit_with_ai",
    description:
      "PREFERRED for single-file structural changes (renames across file, JSDoc additions, async/await conversion, early returns, helper extraction, idiomatic refactors). Powered by Mercury Edit 2 — typically 300–500ms, more reliable than chained edit_file calls for non-mechanical changes. Pass the file path and a clear, specific instruction (include constraints like 'preserve error handling' if relevant). Returns a unified diff for approval. Use edit_file only for exact-string deterministic replacements where you already know both halves.",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to edit" },
        instruction: { type: "string", description: "Natural-language description of the edit (e.g., 'rename function foo to bar', 'add a null check for the user param')" },
        max_tokens: { type: "integer", description: "Generation budget (default 4096)", default: 4096 },
      },
      required: ["path", "instruction"],
    },
    describe(args) {
      const path = String(args.path);
      const abs = resolve(process.cwd(), path);
      let preview = `edit_with_ai ${path}\n  ${args.instruction}`;
      if (existsSync(abs)) {
        const size = readFileSync(abs, "utf8").length;
        preview += `\n  (current ${size}B; full diff shown after generation)`;
      }
      return preview;
    },
    async run(args) {
      const path = resolve(process.cwd(), String(args.path));
      const instruction = String(args.instruction ?? "").trim();
      if (!instruction) throw new Error("instruction is empty");
      const maxTokens = Number(args.max_tokens ?? 4096);
      const before = readFileSync(path, "utf8");

      // Mercury Edit 2 requires this exact set of tags in the user message.
      // Cursor at end-of-file means "edit the whole file in place".
      const userMessage =
        `<|recently_viewed_code_snippets|>\n<|/recently_viewed_code_snippets|>\n` +
        `<|current_file_content|>\n${before}\n<|/current_file_content|>\n` +
        `<|code_to_edit|>\n${before}\n<|/code_to_edit|>\n` +
        `<|cursor|>\n` +
        `<|edit_diff_history|>\n${instruction}\n<|/edit_diff_history|>`;

      const res = await client.editComplete({
        model: "mercury-edit-2",
        messages: [{ role: "user", content: userMessage }],
        max_tokens: maxTokens,
      });

      let after = res.choices?.[0]?.message?.content ?? "";
      // Strip accidental fenced code-block wrappers (the model often returns ```lang\n...\n```).
      const fenceMatch = after.match(/^```[\w-]*\n?([\s\S]*?)```\s*$/);
      if (fenceMatch) after = fenceMatch[1];
      // Strip any leftover markup tags just in case.
      after = after.replace(/<\|\/?(?:code_to_edit|cursor|edit_diff_history|current_file_content|recently_viewed_code_snippets)\|>/g, "");

      if (!after.trim()) throw new Error("Mercury Edit 2 returned empty response");

      writeFileSync(path, after, "utf8");
      return {
        ok: true,
        path,
        before_bytes: Buffer.byteLength(before),
        after_bytes: Buffer.byteLength(after),
        diff: unifiedDiff(before, after),
      };
    },
  };
}
