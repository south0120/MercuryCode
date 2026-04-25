import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Tool } from "./index.js";

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
    const c = String(args.content ?? "");
    const preview = c.split("\n").slice(0, 6).join("\n");
    return `write ${args.path}\n---\n${preview}${c.length > preview.length ? "\n…" : ""}`;
  },
  async run(args) {
    const path = resolve(process.cwd(), String(args.path));
    const content = String(args.content ?? "");
    mkdirSync(dirname(path), { recursive: true });
    const existed = existsSync(path);
    writeFileSync(path, content, "utf8");
    return { ok: true, path, bytes: Buffer.byteLength(content), overwrote: existed };
  },
};
