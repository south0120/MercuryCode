import chalk from "chalk";
import { MarkdownStream } from "./markdown.js";

const ART = `
  ███╗   ███╗███████╗██████╗  ██████╗██╗   ██╗██████╗ ██╗   ██╗
  ████╗ ████║██╔════╝██╔══██╗██╔════╝██║   ██║██╔══██╗╚██╗ ██╔╝
  ██╔████╔██║█████╗  ██████╔╝██║     ██║   ██║██████╔╝ ╚████╔╝
  ██║╚██╔╝██║██╔══╝  ██╔══██╗██║     ██║   ██║██╔══██╗  ╚██╔╝
  ██║ ╚═╝ ██║███████╗██║  ██║╚██████╗╚██████╔╝██║  ██║   ██║
  ╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝
`;

// Mercury-themed water-cyan gradient stops: pale cyan → cyan → deeper water blue.
// Each block char is colored according to its horizontal position in the line.
const GRADIENT_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [220, 248, 255]],
  [0.4, [0, 220, 255]],
  [0.7, [80, 200, 255]],
  [1.0, [88, 140, 255]],
];

function lerpGradient(t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, t));
  for (let i = 1; i < GRADIENT_STOPS.length; i++) {
    const [t1, c1] = GRADIENT_STOPS[i];
    if (u <= t1) {
      const [t0, c0] = GRADIENT_STOPS[i - 1];
      const k = (u - t0) / (t1 - t0 || 1);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  return GRADIENT_STOPS[GRADIENT_STOPS.length - 1][1];
}

function gradientArt(art: string): string {
  const lines = art.split("\n");
  const maxLen = Math.max(...lines.map((l) => l.length));
  return lines
    .map((line) => {
      if (!line.trim()) return line;
      const chars = [...line];
      return chars
        .map((ch, i) => {
          if (ch === " ") return ch;
          const t = maxLen > 1 ? i / (maxLen - 1) : 0;
          const [r, g, b] = lerpGradient(t);
          return chalk.rgb(r, g, b)(ch);
        })
        .join("");
    })
    .join("\n");
}

function termWidth(): number {
  const w = process.stdout.columns || 80;
  return Math.max(20, w);
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function visualLength(s: string): number {
  const plain = stripAnsi(s);
  let n = 0;
  for (const ch of plain) {
    const code = ch.codePointAt(0) || 0;
    if (
      code >= 0x1100 &&
      (code <= 0x115f ||
        (code >= 0x2e80 && code <= 0x9fff) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x20000 && code <= 0x2fffd))
    ) {
      n += 2;
    } else if (code >= 0x20) {
      n += 1;
    }
  }
  return n;
}

let activeMd: MarkdownStream | null = null;

function rule(label?: string, color: (s: string) => string = chalk.gray): string {
  const w = termWidth();
  if (!label) return color("─".repeat(w));
  const inner = ` ${label} `;
  const remaining = Math.max(0, w - 4 - visualLength(inner));
  return color("──") + chalk.bold(inner) + color("─".repeat(remaining)) + color("──");
}

// ─── Per-tool color theme ─────────────────────────────────────────────────────

interface ToolMeta {
  verb: string;
  color: (s: string) => string;
}

const TOOL_META: Record<string, ToolMeta> = {
  bash:          { verb: "Run",     color: chalk.magentaBright },
  read_file:     { verb: "Read",    color: chalk.cyanBright },
  write_file:    { verb: "Write",   color: chalk.greenBright },
  edit_file:     { verb: "Edit",    color: chalk.yellowBright },
  list_dir:      { verb: "List",    color: chalk.cyan },
  grep:          { verb: "Search",  color: chalk.cyan },
  invoke_skill:  { verb: "Skill",   color: chalk.magenta },
  fim_complete:  { verb: "FIM",     color: chalk.yellowBright },
  edit_with_ai:  { verb: "AIEdit",  color: chalk.yellowBright },
};

function metaFor(name: string): ToolMeta {
  if (TOOL_META[name]) return TOOL_META[name];
  if (name.startsWith("mcp__")) return { verb: "MCP", color: chalk.blueBright };
  return { verb: "Tool", color: chalk.yellow };
}

function formatPrimaryArg(name: string, args: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  switch (name) {
    case "bash":
      return chalk.bold.whiteBright("$ " + s(args.command));
    case "read_file":
    case "list_dir":
      return chalk.cyan(s(args.path ?? "."));
    case "write_file": {
      const path = s(args.path);
      const bytes = Buffer.byteLength(s(args.content ?? ""));
      return chalk.cyan(path) + chalk.gray(`  ${bytes}B`);
    }
    case "edit_file":
      return chalk.cyan(s(args.path));
    case "grep":
      return chalk.bold(s(args.pattern)) + (args.path ? chalk.gray(" in " + s(args.path)) : "");
    case "invoke_skill":
      return chalk.magenta("/" + s(args.name));
    default:
      return Object.entries(args)
        .slice(0, 3)
        .map(([k, v]) => {
          const val = typeof v === "string" ? v : JSON.stringify(v);
          const trim = val.length > 60 ? val.slice(0, 57) + "..." : val;
          return chalk.gray(k + "=") + chalk.white(trim);
        })
        .join(" ");
  }
}

function formatToolResult(name: string, result: unknown): string {
  if (typeof result === "string") {
    const lines = result.split("\n").slice(0, 10);
    return lines.map((l) => chalk.gray("  ") + l).join("\n");
  }
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    // bash-style result with stdout/stderr/exit_code
    if ("stdout" in r || "stderr" in r || "exit_code" in r) {
      const exit = typeof r.exit_code === "number" ? r.exit_code : -1;
      const stdout = typeof r.stdout === "string" ? r.stdout.trimEnd() : "";
      const stderr = typeof r.stderr === "string" ? r.stderr.trimEnd() : "";
      const streamed = (r as Record<string, unknown>)._streamed === true;
      const parts: string[] = [];
      if (exit !== 0) parts.push(chalk.red(`  exit ${exit}`));
      else parts.push(chalk.gray(`  exit 0`));
      // When output was already live-streamed to the terminal, don't re-print it here.
      if (!streamed) {
        if (stdout) parts.push(stdout.split("\n").slice(0, 12).map((l) => "  " + l).join("\n"));
        if (stderr) parts.push(chalk.red(stderr.split("\n").slice(0, 8).map((l) => "  " + l).join("\n")));
      }
      return parts.join("\n");
    }
    if ("error" in r) {
      return chalk.red("  " + String(r.error));
    }
    if ("ok" in r && r.ok) {
      const path = "path" in r ? chalk.cyan(String(r.path)) : "";
      const bytes = "bytes" in r ? chalk.gray(`  ${r.bytes}B`) : "";
      return "  " + path + bytes;
    }
  }
  const fallback = JSON.stringify(result);
  const trim = fallback.length > 200 ? fallback.slice(0, 197) + "…" : fallback;
  return chalk.gray("  " + trim);
}

// ─── public UI surface ────────────────────────────────────────────────────────

export const ui = {
  banner(meta: { model: string; cwd: string; yolo: boolean; readOnly: boolean }) {
    console.log(gradientArt(ART));
    console.log(
      chalk.bold("  Mercury 2 Coding Agent") +
        chalk.gray("  v0.1.0  ·  Inception Labs"),
    );
    const flags = [
      meta.yolo ? chalk.bgYellow.black(" YOLO ") : null,
      meta.readOnly ? chalk.bgYellow.black(" READ-ONLY ") : null,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      chalk.gray(
        `  model ${chalk.white(meta.model)}  ·  cwd ${chalk.white(meta.cwd)}${flags ? "  " + flags : ""}`,
      ),
    );
    console.log(chalk.gray(`  /help for commands, /exit to quit, Ctrl-C to interrupt\n`));
  },

  rule(label?: string, color: (s: string) => string = chalk.gray): string {
    return rule(label, color);
  },

  assistant(text: string | null) {
    if (!text) return;
    process.stdout.write(chalk.cyan("● "));
    const md = new MarkdownStream();
    md.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
    md.end();
  },

  // Streaming assistant output. The MarkdownStream renders complete lines as
  // they arrive (token-buffered until a newline). Long unterminated lines stay
  // buffered until close.
  assistantOpen() {
    process.stdout.write(chalk.cyan("● "));
    activeMd = new MarkdownStream();
  },
  assistantWrite(chunk: string) {
    if (activeMd) activeMd.write(chunk);
    else process.stdout.write(chunk);
  },
  assistantClose() {
    if (activeMd) {
      activeMd.end();
      activeMd = null;
    } else {
      process.stdout.write("\n");
    }
  },

  toolCall(name: string, args: Record<string, unknown>) {
    const meta = metaFor(name);
    const verb = meta.color(meta.verb.padEnd(6));
    console.log(`\n${chalk.gray("⏵")} ${verb} ${formatPrimaryArg(name, args)}`);
  },

  toolResult(name: string, result: unknown, ok: boolean) {
    const meta = metaFor(name);
    const mark = ok ? chalk.green("✓") : chalk.red("✗");
    const tag = chalk.gray(meta.verb.toLowerCase());
    console.log(`${mark} ${tag}`);
    console.log(formatToolResult(name, result));
  },

  approvalBox(toolName: string, detail: string) {
    const meta = metaFor(toolName);
    const title =
      chalk.bgYellow.black.bold(" APPROVAL ") +
      "  " +
      meta.color(meta.verb) +
      chalk.gray(" · " + toolName);
    console.log("\n" + title);
    console.log(rule(undefined, chalk.yellow));
    for (const line of detail.split("\n").slice(0, 30)) {
      console.log("  " + line);
    }
    console.log(rule(undefined, chalk.yellow));
  },

  error(msg: string) {
    console.error(chalk.red("✗ ") + msg);
  },
  info(msg: string) {
    console.log(chalk.gray(msg));
  },
};
