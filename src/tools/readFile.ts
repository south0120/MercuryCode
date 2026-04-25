import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "./index.js";

const MAX_BYTES = 1_000_000;

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a UTF-8 text file (up to 1MB). Use absolute or cwd-relative paths.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path (absolute or relative to cwd)" },
    },
    required: ["path"],
  },
  describe(args) {
    return `read ${args.path}`;
  },
  async run(args) {
    const path = resolve(process.cwd(), String(args.path));
    const st = statSync(path);
    if (!st.isFile()) throw new Error(`not a file: ${path}`);
    if (st.size > MAX_BYTES) throw new Error(`file too large: ${st.size} bytes (max ${MAX_BYTES})`);
    return readFileSync(path, "utf8");
  },
};
