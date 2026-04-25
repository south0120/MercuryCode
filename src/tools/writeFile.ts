import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import chalk from "chalk";
import type { Tool } from "./index.js";
import { pushUndo } from "../undo.js";
import { checkSyntax } from "../syntaxCheck.js";

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Create or overwrite a file with the given UTF-8 content. Creates parent directories.",
  requiresApproval: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path (absolute or relative to cwd)" },
      content: { type: "string", description: "Full file contents to write" },
    },
    required: ["path", "content"],
  },
  describe(args) {
    const path = String(args.path);
    const content = String(args.content ?? "");
    const lines = content.split("\n");
    const bytes = Buffer.byteLength(content);
    const exists = (() => {
      try { return existsSync(resolve(process.cwd(), path)); } catch { return false; }
    })();
    const action = exists ? chalk.yellowBright("overwrite") : chalk.greenBright("create");
    const header =
      chalk.bold("File: ") + chalk.cyan(path) +
      chalk.gray(`  (${action}, ${bytes}B, ${lines.length} lines)`);
    const previewLines = lines.slice(0, 8).map((l) => chalk.gray("  │ ") + l);
    const more = lines.length > 8 ? chalk.gray(`  │ … (+${lines.length - 8} more lines)`) : "";
    return [header, "", ...previewLines, more].filter(Boolean).join("\n");
  },
  async run(args) {
    const path = resolve(process.cwd(), String(args.path));
    const content = String(args.content ?? "");
    mkdirSync(dirname(path), { recursive: true });
    const existed = existsSync(path);
    pushUndo(path, "write_file");
    writeFileSync(path, content, "utf8");
    const syntax = await checkSyntax(path);
    return {
      ok: true,
      path,
      bytes: Buffer.byteLength(content),
      overwrote: existed,
      syntax_warning: syntax.ok ? undefined : syntax.reason,
    };
  },
};
