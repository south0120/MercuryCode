import chalk from "chalk";

const ART = `
  ███╗   ███╗ ██████╗ ██████╗ ██████╗ ███████╗
  ████╗ ████║██╔════╝██╔═══██╗██╔══██╗██╔════╝
  ██╔████╔██║██║     ██║   ██║██║  ██║█████╗
  ██║╚██╔╝██║██║     ██║   ██║██║  ██║██╔══╝
  ██║ ╚═╝ ██║╚██████╗╚██████╔╝██████╔╝███████╗
  ╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
`;

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

function rule(label?: string, color: (s: string) => string = chalk.gray): string {
  const w = termWidth();
  if (!label) return color("─".repeat(w));
  const inner = ` ${label} `;
  const remaining = Math.max(0, w - 4 - visualLength(inner));
  return color("──") + chalk.bold(inner) + color("─".repeat(remaining)) + color("──");
}

export const ui = {
  banner(meta: { model: string; cwd: string; yolo: boolean; readOnly: boolean }) {
    console.log(chalk.cyan(ART));
    console.log(
      chalk.bold("  Mercury 2 Coding Agent") +
        chalk.gray("  v0.1.0  ·  Inception Labs"),
    );
    const flags = [
      meta.yolo ? chalk.yellow("yolo") : null,
      meta.readOnly ? chalk.yellow("read-only") : null,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      chalk.gray(
        `  model ${chalk.white(meta.model)}  ·  cwd ${chalk.white(meta.cwd)}${flags ? "  ·  " + flags : ""}`,
      ),
    );
    console.log(chalk.gray(`  /help for commands, /exit to quit, Ctrl-C to interrupt\n`));
  },

  rule(label?: string, color: (s: string) => string = chalk.gray): string {
    return rule(label, color);
  },

  assistant(text: string | null) {
    if (!text) return;
    console.log(chalk.cyan("● ") + text);
  },

  toolCall(name: string, args: Record<string, unknown>) {
    const summary = Object.entries(args)
      .map(([k, v]) => {
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}=${s.length > 60 ? s.slice(0, 57) + "..." : s}`;
      })
      .join(" ");
    console.log("\n" + chalk.yellow(`⏵ ${name}`) + chalk.gray(` ${summary}`));
  },

  toolResult(name: string, result: unknown, ok: boolean) {
    const mark = ok ? chalk.green("✓") : chalk.red("✗");
    let preview = "";
    if (typeof result === "string") {
      preview = result.split("\n").slice(0, 8).join("\n");
      if (result.length > 400) preview = preview.slice(0, 400) + "…";
    } else {
      preview = JSON.stringify(result).slice(0, 200);
    }
    const indented = preview.split("\n").map((l) => chalk.gray("  " + l)).join("\n");
    console.log(`${mark} ${chalk.gray(name)}\n${indented}`);
  },

  approvalBox(toolName: string, detail: string) {
    console.log("\n" + rule(`⚠ approval required · ${toolName}`, chalk.yellow));
    for (const line of detail.split("\n").slice(0, 24)) {
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
