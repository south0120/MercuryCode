import { spawn } from "node:child_process";
import type { Tool } from "./index.js";

const TIMEOUT_MS = 120_000;

export const bashTool: Tool = {
  name: "bash",
  description:
    "Run a shell command. Returns stdout, stderr, and exit code. 120s timeout. Use for tests, builds, scripts.",
  requiresApproval: true,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command line" },
      cwd: { type: "string", description: "Working directory (default: cwd)" },
    },
    required: ["command"],
  },
  describe(args) {
    return `bash$ ${args.command}${args.cwd ? `\n  in ${args.cwd}` : ""}`;
  },
  run(args) {
    return new Promise((resolve) => {
      const cmd = String(args.command);
      const cwd = args.cwd ? String(args.cwd) : process.cwd();
      const child = spawn("bash", ["-lc", cmd], { cwd });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, TIMEOUT_MS);
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        const trim = (s: string) => (s.length > 8000 ? s.slice(0, 8000) + "\n…[truncated]" : s);
        resolve({
          exit_code: code ?? -1,
          signal: signal || null,
          stdout: trim(stdout),
          stderr: trim(stderr),
        });
      });
    });
  },
};
