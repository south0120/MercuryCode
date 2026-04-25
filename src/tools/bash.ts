import { spawn } from "node:child_process";
import chalk from "chalk";
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
    const cmd = chalk.bold.whiteBright("$ " + String(args.command));
    const where = args.cwd ? "\n" + chalk.gray("  cwd: " + String(args.cwd)) : "";
    return cmd + where;
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

      // Live-stream output to user's terminal with a subtle gutter so it's
      // visually distinct from the agent's narrative. Each line is prefixed
      // with `│ ` (gray); stderr is also red.
      const streamWrite = (data: Buffer, isErr: boolean) => {
        if (!process.stdout.isTTY) return; // skip in pipes/CI
        const text = data.toString();
        const lines = text.split(/(?<=\n)/); // keep trailing newlines intact
        const out = lines
          .map((l) => {
            if (l === "") return "";
            const stripped = l.endsWith("\n") ? l.slice(0, -1) : l;
            const colored = isErr ? chalk.red(stripped) : stripped;
            const trailing = l.endsWith("\n") ? "\n" : "";
            return chalk.gray("│ ") + colored + trailing;
          })
          .join("");
        process.stdout.write(out);
      };

      child.stdout.on("data", (d) => {
        stdout += d.toString();
        streamWrite(d, false);
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
        streamWrite(d, true);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        // Ensure a trailing newline so the next agent line doesn't run on.
        if (process.stdout.isTTY && (stdout || stderr) && !(stdout + stderr).endsWith("\n")) {
          process.stdout.write("\n");
        }
        const trim = (s: string) => (s.length > 8000 ? s.slice(0, 8000) + "\n…[truncated]" : s);
        resolve({
          exit_code: code ?? -1,
          signal: signal || null,
          stdout: trim(stdout),
          stderr: trim(stderr),
          _streamed: process.stdout.isTTY === true,
        });
      });
    });
  },
};
