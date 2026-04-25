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
import {
  addMarketplace,
  listMarketplaces,
  getMarketplace,
  removeMarketplace,
  updateMarketplace,
  browseMarketplace,
  findPluginInRegistry,
} from "./marketplace.js";
import { installPlugin, uninstallPlugin, listInstalledPlugins } from "./installer.js";

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
        const allNames = [...builtins.map((b) => b.name), ...customCommands.map((c) => c.name)];
        const close = suggestClose(head, allNames).slice(0, 4);
        if (close.length) {
          ui.info(`  did you mean: ${close.map((n) => chalk.cyan("/" + n)).join("  ")} ?`);
        } else {
          ui.info(`  type ${chalk.cyan("/help")} to see available commands`);
        }
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

// ─── /plugin subcommand router ─────────────────────────────────────────────────

async function runPluginSubcommand(arg: string): Promise<void> {
  const tokens = arg.trim().split(/\s+/).filter(Boolean);
  const sub = tokens[0] ?? "help";
  const rest = tokens.slice(1);

  try {
    switch (sub) {
      case "help":
      case "":
        printPluginHelp();
        return;

      case "list": {
        const installed = listInstalledPlugins();
        if (!installed.length) ui.info("(no plugins installed in ~/.mcode/plugins/)");
        else for (const n of installed) console.log(`  ${chalk.magenta(n)}`);
        return;
      }

      case "install": {
        if (!rest[0]) {
          ui.error("usage: /plugin install <name>[@<marketplace>]");
          return;
        }
        const [name, mp] = rest[0].split("@");
        const found = findPluginInRegistry(name, mp);
        ui.info(`installing ${found.plugin.name} from ${found.marketplace.name}…`);
        const r = await installPlugin(found.plugin, found.marketplace);
        ui.info(
          `✓ installed ${chalk.cyan(found.plugin.name)}${r.version ? chalk.gray(" v" + r.version) : ""} → ${r.destDir}`,
        );
        ui.info(chalk.yellow("  restart mcode to load tools/skills from this plugin"));
        return;
      }

      case "uninstall": {
        if (!rest[0]) {
          ui.error("usage: /plugin uninstall <name>");
          return;
        }
        if (uninstallPlugin(rest[0])) ui.info(`✓ uninstalled ${rest[0]}`);
        else ui.error(`not installed: ${rest[0]}`);
        return;
      }

      case "browse": {
        const mpName = rest[0];
        const targets = mpName ? [getMarketplace(mpName)].filter(Boolean) : listMarketplaces();
        if (!targets.length) {
          ui.info("(no marketplaces — use /plugin marketplace add <source>)");
          return;
        }
        for (const mp of targets) {
          console.log("\n" + chalk.bold.magenta(`┌─ ${mp!.name}`));
          try {
            for (const p of browseMarketplace(mp!.name)) {
              console.log(
                `  ${chalk.cyan("• " + p.name.padEnd(28))}${chalk.gray(p.description ?? "")}`,
              );
            }
          } catch (e) {
            ui.error("  " + (e as Error).message);
          }
        }
        return;
      }

      case "marketplace": {
        const mpSub = rest[0] ?? "list";
        const mpRest = rest.slice(1);
        if (mpSub === "add") {
          if (!mpRest[0]) {
            ui.error("usage: /plugin marketplace add <source>");
            return;
          }
          ui.info(`adding marketplace ${mpRest[0]}…`);
          const r = await addMarketplace(mpRest[0]);
          ui.info(`✓ marketplace ${chalk.cyan(r.name)} added (cache: ${r.cache_dir})`);
        } else if (mpSub === "list") {
          const all = listMarketplaces();
          if (!all.length) {
            ui.info("(no marketplaces — /plugin marketplace add <source>)");
            return;
          }
          for (const m of all) {
            const src =
              m.source.source === "github"
                ? `github:${m.source.repo}`
                : m.source.source === "url"
                  ? `url:${m.source.url}`
                  : `local:${m.source.path}`;
            console.log(`  ${chalk.cyan(m.name.padEnd(20))} ${chalk.gray(src)}`);
          }
        } else if (mpSub === "remove") {
          if (!mpRest[0]) {
            ui.error("usage: /plugin marketplace remove <name>");
            return;
          }
          if (removeMarketplace(mpRest[0])) ui.info(`✓ removed marketplace ${mpRest[0]}`);
          else ui.error(`unknown marketplace: ${mpRest[0]}`);
        } else if (mpSub === "update") {
          const targets = mpRest[0] ? [mpRest[0]] : listMarketplaces().map((m) => m.name);
          if (!targets.length) {
            ui.info("(no marketplaces to update)");
            return;
          }
          for (const n of targets) {
            ui.info(`updating ${n}…`);
            try {
              await updateMarketplace(n);
              ui.info(`✓ ${n}`);
            } catch (e) {
              ui.error(`${n}: ${(e as Error).message}`);
            }
          }
        } else {
          ui.error(`unknown marketplace subcommand: ${mpSub}`);
          printPluginHelp();
        }
        return;
      }

      default:
        ui.error(`unknown subcommand: ${sub}`);
        printPluginHelp();
    }
  } catch (e) {
    ui.error((e as Error).message);
  }
}

function printPluginHelp(): void {
  console.log(
    [
      `  ${chalk.cyan("/plugin list".padEnd(36))} ${chalk.gray("installed plugins")}`,
      `  ${chalk.cyan("/plugin install <name>[@<mp>]".padEnd(36))} ${chalk.gray("install plugin from a marketplace")}`,
      `  ${chalk.cyan("/plugin uninstall <name>".padEnd(36))} ${chalk.gray("remove an installed plugin")}`,
      `  ${chalk.cyan("/plugin browse [marketplace]".padEnd(36))} ${chalk.gray("list plugins from registered marketplaces")}`,
      `  ${chalk.cyan("/plugin marketplace add <source>".padEnd(36))} ${chalk.gray("owner/repo, https://..., or ./path")}`,
      `  ${chalk.cyan("/plugin marketplace list".padEnd(36))} ${chalk.gray("registered marketplaces")}`,
      `  ${chalk.cyan("/plugin marketplace remove <name>".padEnd(36))} ${chalk.gray("unregister a marketplace")}`,
      `  ${chalk.cyan("/plugin marketplace update [name]".padEnd(36))} ${chalk.gray("git-pull marketplace cache(s)")}`,
    ].join("\n"),
  );
}

// ─── did-you-mean for unknown commands ─────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function suggestClose(query: string, names: string[]): string[] {
  const q = query.toLowerCase();
  const scored = names.map((n) => {
    const lower = n.toLowerCase();
    let score = levenshtein(q, lower);
    if (lower.startsWith(q)) score -= 2; // prefix match boost
    if (lower.includes(q)) score -= 1; // substring match boost
    return { name: n, score };
  });
  return scored
    .filter((x) => x.score <= 3)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.name);
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
      name: "plugin",
      description: "manage plugins (list/install/uninstall/browse/marketplace)",
      async run({ arg }) {
        await runPluginSubcommand(arg);
        return "continue";
      },
    },
    {
      name: "reload-plugins",
      description: "re-scan plugin directories (restart mcode for full effect)",
      async run() {
        const ps = loadPlugins();
        ui.info(`scanned plugins: ${ps.map((p) => p.manifest.name).join(", ") || "(none)"}`);
        ui.info(chalk.yellow("note: tools/skills/hooks require restart to fully reload"));
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
