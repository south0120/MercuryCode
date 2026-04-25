import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Tool } from "./index.js";

export const listDirTool: Tool = {
  name: "list_dir",
  description: "List files and subdirectories in a directory (non-recursive).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path (default: cwd)" },
    },
    required: [],
  },
  describe(args) {
    return `ls ${args.path ?? "."}`;
  },
  async run(args) {
    const path = resolve(process.cwd(), String(args.path ?? "."));
    const entries = readdirSync(path);
    const items = entries.map((name) => {
      try {
        const st = statSync(join(path, name));
        return { name, type: st.isDirectory() ? "dir" : "file", size: st.size };
      } catch {
        return { name, type: "unknown", size: 0 };
      }
    });
    return { path, entries: items };
  },
};
