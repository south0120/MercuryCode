import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";
import prompts from "prompts";
import { createSession, runTurn, rebuildSystem, type AgentOptions } from "./agent.js";
import { SESSIONS_DIR } from "./config.js";
import { ui } from "./ui.js";
import { selectTools } from "./tools/index.js";
import { summary as usageSummary } from "./usage.js";
import { loadCustomCommands, renderCommand, type CustomCommand } from "./commands.js";
import { appendProjectLearning } from "./memory.js";
import { readInput, type SlashCommand } from "./input.js";
import { loadPlugins } from "./plugins.js";
import { loadSkills } from "./skills.js";

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

  const customCommands = loadCustomCommands(homedir(), options.pluginCommandsDirs ?? []);
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
      name: "model",
      description: "switch active model (only models accessible to your account)",
      async run({ arg, session, options }) {
        // Direct set: /model <id>
        if (arg) {
          options.model = arg;
          ui.info(`✓ model: ${chalk.cyan(arg)}`);
          return "continue";
        }
        let models;
        try {
          models = await session.options.client.listModels();
        } catch (e) {
          ui.error((e as Error).message);
          return "continue";
        }
        // Filter: only tools-capable models qualify as agent main models.
        const toolsCapable = models.filter((m) => (m.supported_features ?? []).includes("tools"));

        // Probe accessibility (lazy, cached for the session).
        if (!session.modelProbe) session.modelProbe = new Map();
        const toProbe = toolsCapable.filter((m) => !session.modelProbe!.has(m.id));
        if (toProbe.length) {
          ui.info(`probing ${toProbe.length} model(s)…`);
          await Promise.all(
            toProbe.map(async (m) => {
              const ok = await session.options.client.probeModel(m.id);
              session.modelProbe!.set(m.id, ok);
            }),
          );
        }
        const accessible = toolsCapable.filter((m) => session.modelProbe!.get(m.id));
        if (!accessible.length) {
          ui.error("no models accessible with this API key");
          return "continue";
        }
        const choices = accessible.map((m) => {
          const ctx = m.context_length ? `${Math.round(m.context_length / 1000)}K ctx` : "";
          const current = m.id === options.model ? chalk.bold.yellow(" (current)") : "";
          return {
            title: `${chalk.cyan(m.id.padEnd(18))} ${chalk.gray(ctx.padEnd(8))} ${chalk.gray(m.name ?? "")}${current}`,
            value: m.id,
          };
        });
        const initial = Math.max(0, accessible.findIndex((m) => m.id === options.model));
        const { picked } = await prompts({
          type: "select",
          name: "picked",
          message: chalk.bold("Select model"),
          choices,
          initial,
        });
        if (!picked) return "continue";
        options.model = String(picked);
        ui.info(`✓ model switched to ${chalk.cyan(options.model)}`);
        return "continue";
      },
    },
    {
      name: "models",
      description: "list models accessible to your API key (probes each)",
      async run({ session }) {
        try {
          const models = await session.options.client.listModels();
          if (!session.modelProbe) session.modelProbe = new Map();
          const toProbe = models.filter((m) => !session.modelProbe!.has(m.id));
          if (toProbe.length) {
            ui.info(`probing ${toProbe.length} model(s)…`);
            await Promise.all(
              toProbe.map(async (m) => {
                const ok = await session.options.client.probeModel(m.id);
                session.modelProbe!.set(m.id, ok);
              }),
            );
          }
          for (const m of models) {
            const tools = (m.supported_features ?? []).includes("tools");
            const accessible = session.modelProbe!.get(m.id);
            const tag = accessible
              ? (tools ? chalk.green("● accessible · tools") : chalk.yellow("● accessible · no-tools"))
              : chalk.gray("○ not accessible");
            const ctx = m.context_length ? chalk.gray(`${Math.round(m.context_length / 1000)}K`) : "";
            const cur = m.id === session.options.model ? chalk.bold.yellow(" ← current") : "";
            console.log(`  ${chalk.cyan(m.id.padEnd(18))} ${tag.padEnd(28)}  ${ctx.padStart(6)}  ${chalk.gray(m.name ?? "")}${cur}`);
          }
        } catch (e) {
          ui.error((e as Error).message);
        }
        return "continue";
      },
    },
    {
      name: "skills",
      description: "list registered skills",
      async run() {
        const sk = loadSkills();
        if (!sk.length) ui.info("(no skills found in .mcode/skills/ or ~/.mcode/skills/)");
        for (const s of sk) {
          console.log(`  ${chalk.magenta(s.name)} ${chalk.gray(`[${s.source}]`)} — ${s.description}`);
        }
        return "continue";
      },
    },
    {
      name: "plugins",
      description: "list installed plugins",
      async run() {
        const ps = loadPlugins();
        if (!ps.length) ui.info("(no plugins in .mcode/plugins/ or ~/.mcode/plugins/)");
        for (const p of ps) {
          console.log(
            `  ${chalk.magenta(p.manifest.name)}@${p.manifest.version ?? "0.0.0"} ${chalk.gray(`[${p.source}]`)} — ${p.manifest.description ?? ""}`,
          );
        }
        return "continue";
      },
    },
    {
      name: "mcp",
      description: "list active MCP tools (loaded at startup; restart to apply config changes)",
      async run({ session }) {
        const mcpTools = session.tools.filter((t) => t.name.startsWith("mcp__"));
        if (!mcpTools.length) ui.info("(no MCP tools loaded — see .mcode/mcp.json)");
        for (const t of mcpTools) {
          console.log(`  ${chalk.cyan(t.name)} — ${t.description.slice(0, 100)}`);
        }
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
