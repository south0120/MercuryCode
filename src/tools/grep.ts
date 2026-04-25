import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Tool } from "./index.js";

/** Simple glob to RegExp conversion: supports '*' wildcard only. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexStr = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regexStr);
}

/** Recursively walk directory, yielding file paths, excluding common dirs. */
async function* walk(dir: string, excludes: Set<string>): AsyncIterable<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludes.has(entry.name)) continue;
      yield* walk(fullPath, excludes);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

export const grepTool: Tool = {
  name: "grep",
  description:
    "Search files in cwd for a regex pattern (uses ripgrep when available). Returns matching lines.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern" },
      path: { type: "string", description: "Path to search (default: cwd)" },
      glob: { type: "string", description: "File glob to limit, e.g. '*.ts'" },
    },
    required: ["pattern"],
  },
  describe(args) {
    return `grep ${args.pattern}${args.glob ? ` (${args.glob})` : ""}${args.path ? ` in ${args.path}` : ""}`;
  },
  async run(args) {
    const pattern = String(args.pattern);
    const cwd = args.path ? String(args.path) : process.cwd();
    const rgArgs = ["--line-number", "--no-heading", "--color=never", "-S", pattern];
    if (args.glob) rgArgs.push("--glob", String(args.glob));
    const child = spawn("rg", rgArgs, { cwd });
    let stdout = "";
    let stderr = "";
    // Spawn fires both 'error' (ENOENT) and 'close' when the binary is missing.
    // Use a flag set synchronously in the error handler so close skips its resolve.
    let spawnErrored = false;
    return new Promise((resolve) => {
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => {
        if (spawnErrored) return; // error handler will resolve via fallback
        const lines = stdout.split("\n");
        const trimmed = lines.slice(0, 200).join("\n");
        resolve({
          exit_code: code ?? -1,
          matches: trimmed,
          truncated: lines.length > 200,
          stderr: stderr.slice(0, 1000),
        });
      });
      child.on("error", async (err) => {
        spawnErrored = true; // synchronous set — runs before any pending close handler
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          resolve({ exit_code: -1, matches: "", error: String(err) });
          return;
        }
        // Fallback: Node.js regex search when rg is not installed.
        try {
          // Smart-case: if pattern is all lowercase (no uppercase letters), match case-insensitively.
          const hasUpper = /[A-Z]/.test(pattern);
          const regex = new RegExp(pattern, hasUpper ? "" : "i");
          const globRegex = args.glob ? globToRegExp(String(args.glob)) : null;
          const excludeDirs = new Set(["node_modules", ".git", "dist", ".next", ".cache"]);
          const matches: string[] = [];
          for await (const filePath of walk(cwd, excludeDirs)) {
            if (globRegex && !globRegex.test(path.basename(filePath))) continue;
            let content: string;
            try {
              content = await fs.readFile(filePath, "utf8");
            } catch {
              continue; // skip unreadable / permission-denied files
            }
            // Heuristic: skip likely-binary content (NUL bytes in first 1KB)
            if (content.slice(0, 1024).includes("\0")) continue;
            const lines = content.split(/\r?\n/);
            // Output paths relative to cwd to match rg's default formatting.
            const rel = path.relative(cwd, filePath);
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                matches.push(`${rel}:${i + 1}:${lines[i]}`);
                if (matches.length >= 200) break;
              }
            }
            if (matches.length >= 200) break;
          }
          resolve({
            exit_code: 0,
            matches: matches.join("\n"),
            truncated: matches.length >= 200,
            stderr: "",
            fallback: "node-regex",
          });
        } catch (e) {
          resolve({ exit_code: -1, matches: "", error: String(e) });
        }
      });
    });
  },
};
