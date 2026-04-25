import { spawn } from "node:child_process";
import type { Tool } from "./index.js";

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
  run(args) {
    return new Promise((resolve) => {
      const pattern = String(args.pattern);
      const cwd = args.path ? String(args.path) : process.cwd();
      const rgArgs = ["--line-number", "--no-heading", "--color=never", "-S", pattern];
      if (args.glob) rgArgs.push("--glob", String(args.glob));
      const child = spawn("rg", rgArgs, { cwd });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => {
        const trimmed = stdout.split("\n").slice(0, 200).join("\n");
        resolve({
          exit_code: code ?? -1,
          matches: trimmed,
          truncated: stdout.split("\n").length > 200,
          stderr: stderr.slice(0, 1000),
        });
      });
      child.on("error", (err) => {
        resolve({ exit_code: -1, matches: "", error: String(err) });
      });
    });
  },
};
