import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { createSession, runTurn, rebuildSystem, type AgentOptions } from "./agent.js";
import { SESSIONS_DIR } from "./config.js";
import { ui } from "./ui.js";
import { selectTools } from "./tools/index.js";
import { summary as usageSummary } from "./usage.js";
import { loadCustomCommands, renderCommand, type CustomCommand } from "./commands.js";
import { appendProjectLearning } from "./memory.js";
import { readInput, type SlashCommand } from "./input.js";

interface BuiltinCommand {
  name: string;
  description: string;
  run: (ctx: BuiltinCtx) => Promise<"continue" | "exit">;
}

interface BuiltinCtx {
  arg: string;
  session: ReturnType<typeof createSession>;
  options: AgentOptions;
}

export async function runRepl(options: AgentOptions): Promise<void> {
  const session = createSession(options);
  ui.banner({
    model: options.model,
    cwd: process.cwd(),
    yolo: options.yolo,
    readOnly: options.readOnly,
  });
  if (options.planMode) ui.info("plan mode: ON");

  const customCommands = loadCustomCommands(homedir());
  if (customCommands.length) {
    ui.info(`custom commands: ${customCommands.map((c) => "/" + c.name).join(" ")}`);
  }

  const builtins = makeBuiltins();
  const history: string[] = [];

  while (true) {
    const slashCommands: SlashCommand[] = [
      ...builtins.map((b) => ({ name: b.name, description: b.description, source: "builtin" as const })),
      ...customCommands.map((c) => ({ name: c.name, description: c.description, source: "custom" as const })),
    ];

    let line: string | undefined;
    try {
      line = await readInput({ commands: slashCommands, history });
    } catch {
      break;
    }
    if (line === undefined) {
      ui.info("bye.");
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (history[history.length - 1] !== trimmed) history.push(trimmed);

    if (trimmed.startsWith("/")) {
      const [head, ...rest] = trimmed.slice(1).split(/\s+/);
      const arg = rest.join(" ").trim();
      const isBuiltin = builtins.find((b) => b.name === head);
      const isCustom = customCommands.find((c) => c.name === head);
      if (!isBuiltin && !isCustom) {
        ui.error(`unknown command: /${head}`);
        continue;
      }
      const action = await dispatch(
        isBuiltin ? "builtin" : "custom",
        head,
        arg,
        { session, options, builtins, customCommands },
      );
      if (action === "exit") return;
      continue;
    }

    try {
      await runTurn(session, trimmed);
    } catch (e) {
      ui.error((e as Error).message);
    }
  }
}

// ─── dispatch ──────────────────────────────────────────────────────────────────

interface DispatchCtx {
  session: ReturnType<typeof createSession>;
  options: AgentOptions;
  builtins: BuiltinCommand[];
  customCommands: CustomCommand[];
}

async function dispatch(
  kind: "builtin" | "custom",
  name: string,
  arg: string,
  ctx: DispatchCtx,
): Promise<"continue" | "exit"> {
  if (kind === "builtin") {
    const b = ctx.builtins.find((x) => x.name === name)!;
    return await b.run({ arg, session: ctx.session, options: ctx.options });
  }
  const cc = ctx.customCommands.find((x) => x.name === name)!;
  const rendered = renderCommand(cc, arg);
  ui.info(`(invoking custom command: /${cc.name})`);
  try {
    await runTurn(ctx.session, rendered);
  } catch (e) {
    ui.error((e as Error).message);
  }
  return "continue";
}

// ─── built-in commands ─────────────────────────────────────────────────────────

function makeBuiltins(): BuiltinCommand[] {
  return [
    {
      name: "help",
      description: "show this help",
      async run() {
        for (const b of makeBuiltins()) {
          console.log(`  ${chalk.cyan("/" + b.name).padEnd(14)} ${chalk.gray(b.description)}`);
        }
        return "continue";
      },
    },
    {
      name: "exit",
      description: "quit",
      async run() {
        ui.info("bye.");
        return "exit";
      },
    },
    {
      name: "quit",
      description: "alias for /exit",
      async run() {
        return "exit";
      },
    },
    {
      name: "clear",
      description: "clear screen",
      async run() {
        process.stdout.write("\x1b[2J\x1b[H");
        return "continue";
      },
    },
    {
      name: "reset",
      description: "clear conversation history",
      async run({ session }) {
        session.messages.length = 0;
        rebuildSystem(session);
        ui.info("history cleared.");
        return "continue";
      },
    },
    {
      name: "tools",
      description: "list available tools",
      async run({ options }) {
        for (const t of selectTools({ readOnly: options.readOnly })) {
          console.log(`  ${chalk.yellow(t.name)}${t.requiresApproval ? chalk.gray(" (approval)") : ""} — ${t.description}`);
        }
        return "continue";
      },
    },
    {
      name: "save",
      description: "save session: /save NAME",
      async run({ arg, session }) {
        if (!arg) {
          ui.error("usage: /save NAME");
          return "continue";
        }
        const path = join(SESSIONS_DIR, `${arg}.json`);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(session.messages, null, 2));
        ui.info(`saved → ${path}`);
        return "continue";
      },
    },
    {
      name: "load",
      description: "load session: /load NAME",
      async run({ arg, session }) {
        if (!arg) {
          ui.error("usage: /load NAME");
          return "continue";
        }
        const path = join(SESSIONS_DIR, `${arg}.json`);
        if (!existsSync(path)) {
          ui.error(`no such session: ${arg}`);
          return "continue";
        }
        const loaded = JSON.parse(readFileSync(path, "utf8"));
        session.messages.length = 0;
        session.messages.push(...loaded);
        ui.info(`loaded ${loaded.length} messages from ${arg}`);
        return "continue";
      },
    },
    {
      name: "sessions",
      description: "list saved sessions",
      async run() {
        try {
          const items = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
          if (!items.length) ui.info("(no saved sessions)");
          else for (const it of items) console.log("  " + it.replace(/\.json$/, ""));
        } catch {
          ui.info("(no sessions dir)");
        }
        return "continue";
      },
    },
    {
      name: "yolo",
      description: "toggle auto-approve writes/bash",
      async run({ session }) {
        session.approval.yolo = !session.approval.yolo;
        ui.info(`yolo: ${session.approval.yolo ? chalk.green("ON") : chalk.gray("OFF")}`);
        return "continue";
      },
    },
    {
      name: "plan",
      description: "toggle plan mode",
      async run({ session, options }) {
        options.planMode = !options.planMode;
        rebuildSystem(session);
        ui.info(`plan mode: ${options.planMode ? chalk.green("ON") : chalk.gray("OFF")}`);
        return "continue";
      },
    },
    {
      name: "cost",
      description: "show token usage and estimated cost",
      async run({ session }) {
        console.log(usageSummary(session.usage));
        return "continue";
      },
    },
    {
      name: "tokens",
      description: "alias for /cost",
      async run({ session }) {
        console.log(usageSummary(session.usage));
        return "continue";
      },
    },
    {
      name: "learn",
      description: "append a learning to .mcode/MCODE.md: /learn TEXT",
      async run({ arg, session }) {
        if (!arg) {
          ui.error("usage: /learn TEXT");
          return "continue";
        }
        const path = appendProjectLearning(arg);
        rebuildSystem(session);
        ui.info(`learned → ${path}`);
        return "continue";
      },
    },
  ];
}
