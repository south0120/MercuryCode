import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
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
import { runPluginsTui } from "./pluginsTui.js";
import { popUndo, peekUndo } from "./undo.js";
import { detectProjectKind } from "./projectKind.js";
import { spawn } from "node:child_process";

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
      ...builtins.map((b) => ({
        name: b.name,
        description: b.description,
        source: "builtin" as const,
        subcommands: BUILTIN_SUBCOMMANDS[b.name],
      })),
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

// Subcommand declarations consumed by the slash picker so users can drill down
// with arrow-key selection (e.g. /plugin → marketplace → add).
const BUILTIN_SUBCOMMANDS: Record<string, SlashCommand[]> = {
  plugin: [
    { name: "list", description: "show installed plugins" },
    { name: "install", description: "install a plugin (interactive picker if no arg)" },
    { name: "uninstall", description: "remove an installed plugin (picker if no arg)" },
    { name: "browse", description: "list plugins from registered marketplaces" },
    {
      name: "marketplace",
      description: "manage marketplaces",
      subcommands: [
        { name: "add", description: "register a marketplace (owner/repo, URL, or ./path)" },
        { name: "list", description: "registered marketplaces" },
        { name: "remove", description: "unregister a marketplace" },
        { name: "update", description: "git-pull marketplace cache(s)" },
      ],
    },
    { name: "help", description: "show /plugin command help" },
  ],
  skill: [
    { name: "new", description: "create a new skill (guided)" },
    { name: "list", description: "show registered skills" },
    { name: "edit", description: "open a skill in $EDITOR" },
  ],
  mcp: [
    { name: "active", description: "show active MCP tools (loaded at startup)" },
    { name: "list", description: "show configured servers in ~/.mcode/mcp.json" },
    { name: "add", description: "add a server (preset picker: brave-search/github/...)" },
    { name: "remove", description: "remove a configured server" },
  ],
};

// ─── /mcp add — interactive MCP server configurator ──────────────────────────

interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface McpUserConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

const MCP_USER_PATH = () => join(homedir(), ".mcode", "mcp.json");

function readUserMcpConfig(): McpUserConfig {
  const path = MCP_USER_PATH();
  if (!existsSync(path)) return { mcpServers: {} };
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    if (!json.mcpServers) json.mcpServers = {};
    return json;
  } catch {
    return { mcpServers: {} };
  }
}

function writeUserMcpConfig(cfg: McpUserConfig): void {
  const path = MCP_USER_PATH();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
}

interface McpPreset {
  id: string;
  label: string;
  description: string;
  build: () => Promise<{ name: string; spec: McpServerEntry } | null>;
}

const MCP_PRESETS: McpPreset[] = [
  {
    id: "brave-search",
    label: "Brave Search",
    description: "Web search via Brave Search API (needs BRAVE_API_KEY)",
    async build() {
      const fromEnv = process.env.BRAVE_API_KEY;
      const { key } = await prompts({
        type: "password",
        name: "key",
        message: fromEnv
          ? "BRAVE_API_KEY (leave blank to use $BRAVE_API_KEY from your shell)"
          : "BRAVE_API_KEY (sign up at https://api.search.brave.com)",
      });
      const finalKey = (key as string) || fromEnv;
      if (!finalKey) {
        ui.error("BRAVE_API_KEY required");
        return null;
      }
      return {
        name: "brave-search",
        spec: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-brave-search"],
          env: { BRAVE_API_KEY: finalKey },
        },
      };
    },
  },
  {
    id: "filesystem",
    label: "Filesystem",
    description: "Sandboxed file operations on a chosen directory",
    async build() {
      const { path } = await prompts({
        type: "text",
        name: "path",
        message: "Allowed directory path",
        initial: process.cwd(),
      });
      if (!path) return null;
      return {
        name: "filesystem",
        spec: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", String(path)],
        },
      };
    },
  },
  {
    id: "fetch",
    label: "Fetch",
    description: "HTTP GET arbitrary URLs (returns markdown). Requires `uvx`.",
    async build() {
      return {
        name: "fetch",
        spec: { command: "uvx", args: ["mcp-server-fetch"] },
      };
    },
  },
  {
    id: "context7",
    label: "Context7",
    description: "Up-to-date library docs (Next.js, React, Vercel SDK, etc.) — no key",
    async build() {
      return {
        name: "context7",
        spec: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      };
    },
  },
  {
    id: "playwright",
    label: "Playwright",
    description: "Browser automation, screenshots, DOM queries — no key",
    async build() {
      return {
        name: "playwright",
        spec: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
      };
    },
  },
  {
    id: "memory",
    label: "Memory",
    description: "Persistent knowledge graph across sessions — no key",
    async build() {
      return {
        name: "memory",
        spec: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
      };
    },
  },
  {
    id: "sequential-thinking",
    label: "Sequential Thinking",
    description: "Structured reasoning helper for complex tasks — no key",
    async build() {
      return {
        name: "sequential-thinking",
        spec: { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
      };
    },
  },
  {
    id: "github",
    label: "GitHub",
    description: "Read/write repos, issues, PRs (needs GITHUB_PERSONAL_ACCESS_TOKEN)",
    async build() {
      const fromEnv = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN;
      const { token } = await prompts({
        type: "password",
        name: "token",
        message: fromEnv
          ? "GITHUB_PERSONAL_ACCESS_TOKEN (leave blank to use $GITHUB_TOKEN from shell)"
          : "GITHUB_PERSONAL_ACCESS_TOKEN (https://github.com/settings/tokens)",
      });
      const finalToken = (token as string) || fromEnv;
      if (!finalToken) {
        ui.error("token required");
        return null;
      }
      return {
        name: "github",
        spec: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: finalToken },
        },
      };
    },
  },
  {
    id: "custom",
    label: "Custom",
    description: "Manually specify command + args + env",
    async build() {
      const { name } = await prompts({ type: "text", name: "name", message: "Server name" });
      if (!name) return null;
      const { command } = await prompts({ type: "text", name: "command", message: "Executable (e.g. npx)" });
      if (!command) return null;
      const { argsLine } = await prompts({
        type: "text",
        name: "argsLine",
        message: "Args (space-separated, optional)",
      });
      const { envLine } = await prompts({
        type: "text",
        name: "envLine",
        message: "Env vars (KEY=VAL space-separated, optional)",
      });
      const args = argsLine ? String(argsLine).split(/\s+/).filter(Boolean) : undefined;
      const env: Record<string, string> = {};
      if (envLine) {
        for (const pair of String(envLine).split(/\s+/).filter(Boolean)) {
          const eq = pair.indexOf("=");
          if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
      }
      return {
        name: String(name),
        spec: {
          command: String(command),
          ...(args ? { args } : {}),
          ...(Object.keys(env).length ? { env } : {}),
        },
      };
    },
  },
];

async function mcpAddInteractive(idHint?: string): Promise<void> {
  let preset: McpPreset | undefined;
  if (idHint) {
    preset = MCP_PRESETS.find((p) => p.id === idHint);
    if (!preset) {
      ui.error(`unknown preset: ${idHint}`);
      ui.info("  available: " + MCP_PRESETS.map((p) => p.id).join(", "));
      return;
    }
  } else {
    const { picked } = await prompts({
      type: "select",
      name: "picked",
      message: chalk.bold("Choose an MCP server to add"),
      choices: MCP_PRESETS.map((p) => ({
        title: chalk.cyan(p.label.padEnd(14)) + chalk.gray(p.description),
        value: p.id,
      })),
    });
    if (!picked) return;
    preset = MCP_PRESETS.find((p) => p.id === picked);
    if (!preset) return;
  }
  const built = await preset.build();
  if (!built) return;
  const cfg = readUserMcpConfig();
  if (!cfg.mcpServers) cfg.mcpServers = {};
  if (cfg.mcpServers[built.name]) {
    const { confirm } = await prompts({
      type: "confirm",
      name: "confirm",
      message: `'${built.name}' already exists in mcp.json — overwrite?`,
      initial: false,
    });
    if (!confirm) return;
  }
  cfg.mcpServers[built.name] = built.spec;
  writeUserMcpConfig(cfg);
  ui.info(`✓ added ${chalk.cyan(built.name)} to ~/.mcode/mcp.json`);
  ui.info(chalk.yellow("  restart mcode to load this server's tools"));
}

async function mcpRemoveInteractive(nameHint?: string): Promise<void> {
  const cfg = readUserMcpConfig();
  const names = Object.keys(cfg.mcpServers ?? {});
  if (!names.length) {
    ui.info("(no servers configured)");
    return;
  }
  let name = nameHint;
  if (!name) {
    const { picked } = await prompts({
      type: "select",
      name: "picked",
      message: "Pick a server to remove",
      choices: names.map((n) => ({ title: n, value: n })),
    });
    if (!picked) return;
    name = String(picked);
  }
  if (!cfg.mcpServers?.[name]) {
    ui.error(`not found: ${name}`);
    return;
  }
  delete cfg.mcpServers[name];
  writeUserMcpConfig(cfg);
  ui.info(`✓ removed ${chalk.cyan(name)} (restart mcode to apply)`);
}

// ─── /skill new — guided skill creator ───────────────────────────────────────

async function createSkillInteractive(client: import("./client.js").MercuryClient): Promise<void> {
  const { name } = await prompts({
    type: "text",
    name: "name",
    message: chalk.bold("Skill name (kebab-case, e.g. refactor-cleanup)"),
    validate: (v) => (/^[a-z][a-z0-9-]*$/.test(String(v ?? "")) ? true : "lowercase + hyphen only"),
  });
  if (!name) return;

  const { scope } = await prompts({
    type: "select",
    name: "scope",
    message: "Where should this skill live?",
    choices: [
      { title: "User-global (~/.mcode/skills/) — available everywhere", value: "user" },
      { title: "Project (.mcode/skills/) — only in this project", value: "project" },
    ],
    initial: 0,
  });
  if (!scope) return;

  const { description } = await prompts({
    type: "text",
    name: "description",
    message: "When should the AI invoke this skill? (one specific sentence)",
    validate: (v) => (String(v ?? "").length >= 10 ? true : "describe the trigger in at least 10 chars"),
  });
  if (!description) return;

  const { mode } = await prompts({
    type: "select",
    name: "mode",
    message: "Skill body",
    choices: [
      { title: "Generate with Mercury 2 from a brief", value: "ai" },
      { title: "Write it myself (multi-line, finish with empty line)", value: "manual" },
    ],
    initial: 0,
  });
  if (!mode) return;

  let body = "";
  if (mode === "ai") {
    const { brief } = await prompts({
      type: "text",
      name: "brief",
      message: "Brief: what should the skill instruct the AI to do?",
    });
    if (!brief) return;
    ui.info("generating skill body with mercury-2…");
    const sys =
      "You write SKILL.md bodies for an AI coding assistant. Output ONLY the body markdown — no frontmatter, no surrounding fences, no preface. Keep it focused: what to do, what NOT to do, concrete steps. 60–250 words.";
    const res = await client.chat({
      model: "mercury-2",
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: `Skill name: ${name}\nTrigger: ${description}\nBrief: ${brief}\n\nWrite the SKILL.md body.`,
        },
      ],
    });
    body = res.choices[0].message.content?.trim() ?? "";
  } else {
    ui.info("Enter the skill body. Press Enter twice (empty line) to finish:");
    const lines: string[] = [];
    while (true) {
      const { line } = await prompts({ type: "text", name: "line", message: "│" });
      if (line === undefined) return;
      if (line === "") break;
      lines.push(line);
    }
    body = lines.join("\n");
  }

  if (!body.trim()) {
    ui.error("empty body — aborting");
    return;
  }

  const home =
    scope === "project"
      ? join(process.cwd(), ".mcode", "skills", name)
      : join(homedir(), ".mcode", "skills", name);
  mkdirSync(home, { recursive: true });
  const file = join(home, "SKILL.md");
  const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
  writeFileSync(file, content);
  ui.info(`✓ created ${chalk.cyan(file)}`);
  ui.info(chalk.yellow("  restart mcode to register the new skill"));
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
        let target = rest[0];
        if (!target) {
          // Interactive picker: gather plugins from all marketplaces.
          const all = listMarketplaces();
          if (!all.length) {
            ui.error("no marketplaces registered");
            ui.info("  add one first: /plugin marketplace add <owner/repo>");
            return;
          }
          const choices: Array<{ title: string; value: string }> = [];
          for (const mp of all) {
            try {
              for (const p of browseMarketplace(mp.name)) {
                choices.push({
                  title:
                    chalk.cyan(p.name.padEnd(28)) +
                    chalk.gray("@" + mp.name.padEnd(20)) +
                    "  " +
                    chalk.gray(p.description ?? ""),
                  value: `${p.name}@${mp.name}`,
                });
              }
            } catch {
              // skip broken marketplace
            }
          }
          if (!choices.length) {
            ui.error("no plugins found in registered marketplaces");
            return;
          }
          const { picked } = await prompts({
            type: "autocomplete",
            name: "picked",
            message: chalk.bold("Pick a plugin to install (type to filter)"),
            choices,
            limit: 15,
            suggest: async (input: string, cs: Array<{ title: string; value?: unknown }>) =>
              cs.filter((c) =>
                fuzzyContains(input, stripAnsi(c.title)),
              ),
          });
          if (!picked) {
            ui.info("(install cancelled)");
            return;
          }
          target = String(picked);
        }
        const [name, mp] = target.split("@");
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
        let target = rest[0];
        if (!target) {
          const installed = listInstalledPlugins();
          if (!installed.length) {
            ui.error("no plugins installed");
            return;
          }
          const { picked } = await prompts({
            type: "autocomplete",
            name: "picked",
            message: chalk.bold("Pick a plugin to uninstall"),
            choices: installed.map((n) => ({ title: chalk.magenta(n), value: n })),
            limit: 15,
            suggest: async (input: string, cs: Array<{ title: string; value?: unknown }>) =>
              cs.filter((c) => fuzzyContains(input, stripAnsi(c.title))),
          });
          if (!picked) {
            ui.info("(uninstall cancelled)");
            return;
          }
          target = String(picked);
        }
        if (uninstallPlugin(target)) ui.info(`✓ uninstalled ${target}`);
        else ui.error(`not installed: ${target}`);
        return;
      }

      case "browse": {
        const mpName = rest[0];
        const all = listMarketplaces();
        if (mpName) {
          const mp = getMarketplace(mpName);
          if (!mp) {
            ui.error(`unknown marketplace: ${mpName}`);
            ui.info(
              all.length
                ? `  registered: ${all.map((m) => chalk.cyan(m.name)).join(", ")}`
                : `  (no marketplaces yet — try: ${chalk.cyan("/plugin marketplace add <owner/repo>")})`,
            );
            return;
          }
          const plugins = browseMarketplace(mp.name);
          console.log("\n" + chalk.bold.magenta(`┌─ ${mp.name}`));
          for (const p of plugins) {
            console.log(`  ${chalk.cyan("• " + p.name.padEnd(28))}${chalk.gray(p.description ?? "")}`);
          }
          console.log(chalk.gray(`  install with: /plugin install <name>@${mp.name}`));
          return;
        }
        if (!all.length) {
          ui.error("no marketplaces registered yet");
          console.log(
            `  Add one to start browsing. Examples:\n` +
              `    ${chalk.cyan("/plugin marketplace add owner/repo")}    ${chalk.gray("# any GitHub repo with .claude-plugin/marketplace.json")}\n` +
              `    ${chalk.cyan("/plugin marketplace add ./local/path")} ${chalk.gray("# a local marketplace dir")}\n` +
              `    ${chalk.cyan("/plugin marketplace add https://...git")} ${chalk.gray("# any git URL")}\n`,
          );
          return;
        }
        for (const mp of all) {
          console.log("\n" + chalk.bold.magenta(`┌─ ${mp.name}`));
          try {
            for (const p of browseMarketplace(mp.name)) {
              console.log(`  ${chalk.cyan("• " + p.name.padEnd(28))}${chalk.gray(p.description ?? "")}`);
            }
            console.log(chalk.gray(`  install with: /plugin install <name>@${mp.name}`));
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

function humanAge(d: Date): string {
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

// Copy text to the system clipboard via the platform-native helper.
async function copyToClipboard(text: string): Promise<void> {
  const tools = process.platform === "darwin"
    ? [["pbcopy", []]]
    : process.platform === "win32"
      ? [["clip", []]]
      : [
          ["wl-copy", []],
          ["xclip", ["-selection", "clipboard"]],
          ["xsel", ["--clipboard", "--input"]],
        ];
  for (const [cmd, args] of tools as Array<[string, string[]]>) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
        child.stdin.write(text);
        child.stdin.end();
      });
      return;
    } catch {
      continue;
    }
  }
  throw new Error("no clipboard helper available (install pbcopy / xclip / wl-copy)");
}

// Run a shell command and stream its output to the user's terminal directly,
// optionally with light syntax highlighting (currently: unified-diff coloring).
async function runShellAndPrint(cmd: string, opts: { color?: "diff" | "none" } = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const flushLine = (line: string) => {
      if (opts.color === "diff") {
        if (line.startsWith("+") && !line.startsWith("+++")) process.stdout.write(chalk.green(line) + "\n");
        else if (line.startsWith("-") && !line.startsWith("---")) process.stdout.write(chalk.red(line) + "\n");
        else if (line.startsWith("@@")) process.stdout.write(chalk.cyan(line) + "\n");
        else if (line.startsWith("diff ") || line.startsWith("index ")) process.stdout.write(chalk.bold(line) + "\n");
        else process.stdout.write(line + "\n");
      } else process.stdout.write(line + "\n");
    };
    const onData = (d: Buffer) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        flushLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", (code) => {
      if (buf) flushLine(buf);
      resolve(code ?? -1);
    });
    child.on("error", () => resolve(-1));
  });
}

// Run the auto-detected build/test command for the current project.
async function runProjectCommand(kind: "test" | "build"): Promise<void> {
  const info = detectProjectKind();
  if (info.kind === "unknown") {
    ui.error("could not detect project type (no package.json/Cargo.toml/etc.)");
    return;
  }
  const cmd = kind === "test" ? info.testCmd : info.buildCmd;
  if (!cmd) {
    ui.error(`no ${kind} command for ${info.kind} project (marker: ${info.marker})`);
    return;
  }
  ui.info(`${chalk.cyan(`$ ${cmd}`)} ${chalk.gray("(" + info.kind + ")")}`);
  await new Promise<void>((resolve) => {
    const child = spawn("bash", ["-lc", cmd], { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) ui.info(chalk.green(`✓ ${kind} succeeded`));
      else ui.error(`${kind} failed (exit ${code})`);
      resolve();
    });
    child.on("error", (e) => {
      ui.error((e as Error).message);
      resolve();
    });
  });
}

// Helpers used by the picker UIs.
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function fuzzyContains(needle: string, hay: string): boolean {
  if (!needle) return true;
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (h.includes(n)) return true;
  // fall back to subsequence match
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i >= n.length) return true;
  }
  return false;
}

function printPluginHelp(): void {
  console.log(
    [
      `  ${chalk.cyan("/plugin list".padEnd(36))} ${chalk.gray("installed plugins")}`,
      `  ${chalk.cyan("/plugin install".padEnd(36))} ${chalk.gray("interactive picker (fuzzy filter all marketplaces)")}`,
      `  ${chalk.cyan("/plugin install <name>[@<mp>]".padEnd(36))} ${chalk.gray("install plugin directly")}`,
      `  ${chalk.cyan("/plugin uninstall".padEnd(36))} ${chalk.gray("interactive picker (installed plugins)")}`,
      `  ${chalk.cyan("/plugin uninstall <name>".padEnd(36))} ${chalk.gray("remove an installed plugin directly")}`,
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
      description: "list saved sessions with metadata (most recent first)",
      async run() {
        try {
          const items = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
          if (!items.length) {
            ui.info("(no saved sessions)");
            return "continue";
          }
          const enriched = items
            .map((f) => {
              const path = join(SESSIONS_DIR, f);
              try {
                const stat = statSync(path);
                const msgs = JSON.parse(readFileSync(path, "utf8")) as Array<{
                  role: string;
                  content?: string | null;
                }>;
                const firstUser = msgs.find((m) => m.role === "user");
                return {
                  name: f.replace(/\.json$/, ""),
                  mtime: stat.mtime,
                  count: msgs.length,
                  prompt: (firstUser?.content ?? "").slice(0, 60).replace(/\n/g, " "),
                };
              } catch {
                return null;
              }
            })
            .filter(Boolean) as Array<{ name: string; mtime: Date; count: number; prompt: string }>;
          enriched.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
          for (const s of enriched) {
            const age = humanAge(s.mtime);
            console.log(
              `  ${chalk.cyan(s.name.padEnd(20))} ${chalk.gray(`${s.count} msg`.padEnd(8))} ${chalk.gray(age.padEnd(12))} ${chalk.gray(s.prompt)}`,
            );
          }
          ui.info(chalk.gray(`  resume with: /resume <name>`));
        } catch {
          ui.info("(no sessions dir)");
        }
        return "continue";
      },
    },
    {
      name: "resume",
      description: "load a saved session into the current REPL: /resume <name>",
      async run({ arg, session }) {
        const name = arg.trim();
        if (!name) {
          ui.error("usage: /resume <name>");
          return "continue";
        }
        const path = join(SESSIONS_DIR, `${name}.json`);
        if (!existsSync(path)) {
          ui.error(`no such session: ${name}`);
          return "continue";
        }
        const loaded = JSON.parse(readFileSync(path, "utf8"));
        session.messages.length = 0;
        session.messages.push(...loaded);
        // Wire up the session file so subsequent turns persist back to it.
        session.options.sessionFile = path;
        ui.info(`✓ resumed ${chalk.cyan(name)} (${loaded.length} messages)`);
        const lastUser = [...loaded].reverse().find((m: { role: string }) => m.role === "user");
        if (lastUser?.content) {
          ui.info(chalk.gray(`  last user prompt: ${String(lastUser.content).slice(0, 80)}…`));
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
      name: "skill",
      description: "create or manage skills (new / list / edit)",
      async run({ arg, session }) {
        const tokens = arg.trim().split(/\s+/).filter(Boolean);
        const sub = tokens[0] ?? "list";
        const rest = tokens.slice(1);
        if (sub === "new") {
          await createSkillInteractive(session.options.client);
          return "continue";
        }
        if (sub === "list") {
          const sk = loadSkills();
          if (!sk.length) ui.info("(no skills)");
          for (const s of sk) {
            console.log(`  ${chalk.magenta(s.name)} ${chalk.gray(`[${s.source}]`)} — ${s.description}`);
            console.log(chalk.gray(`    ${s.path}`));
          }
          return "continue";
        }
        if (sub === "edit") {
          const name = rest[0];
          if (!name) {
            ui.error("usage: /skill edit <name>");
            return "continue";
          }
          const sk = loadSkills().find((s) => s.name === name);
          if (!sk) {
            ui.error(`unknown skill: ${name}`);
            return "continue";
          }
          ui.info(`open in editor: ${sk.path}`);
          ui.info(chalk.gray("(use $EDITOR or open the file directly to edit)"));
          return "continue";
        }
        ui.error(`unknown subcommand: ${sub}`);
        ui.info("  try: /skill new | /skill list | /skill edit <name>");
        return "continue";
      },
    },
    {
      name: "plugins",
      description: "open the interactive plugin browser (Discover / Installed / Marketplaces)",
      async run() {
        await runPluginsTui();
        return "continue";
      },
    },
    {
      name: "mcp",
      description: "manage MCP servers (active / list / add / remove)",
      async run({ arg, session }) {
        const tokens = arg.trim().split(/\s+/).filter(Boolean);
        const sub = tokens[0] ?? "active";
        const rest = tokens.slice(1);
        try {
          if (sub === "active" || sub === "tools") {
            const mcpTools = session.tools.filter((t) => t.name.startsWith("mcp__"));
            if (!mcpTools.length) {
              ui.info("(no MCP tools loaded — try /mcp add to configure one, then restart)");
              return "continue";
            }
            for (const t of mcpTools) {
              console.log(`  ${chalk.cyan(t.name)} — ${t.description.slice(0, 100)}`);
            }
          } else if (sub === "list" || sub === "configured") {
            const cfg = readUserMcpConfig();
            const entries = Object.entries(cfg.mcpServers ?? {});
            if (!entries.length) {
              ui.info("(no servers in ~/.mcode/mcp.json — /mcp add to configure one)");
              return "continue";
            }
            for (const [name, spec] of entries) {
              const cmdline = `${spec.command}${(spec.args ?? []).length ? " " + (spec.args ?? []).join(" ") : ""}`;
              console.log(`  ${chalk.cyan(name.padEnd(18))} ${chalk.gray(cmdline)}`);
            }
          } else if (sub === "add") {
            await mcpAddInteractive(rest[0]);
          } else if (sub === "remove") {
            await mcpRemoveInteractive(rest[0]);
          } else {
            ui.error(`unknown subcommand: ${sub}`);
            ui.info("  try: /mcp active | list | add | remove");
          }
        } catch (e) {
          ui.error((e as Error).message);
        }
        return "continue";
      },
    },
    {
      name: "undo",
      description: "revert the most recent write/edit (single step)",
      async run() {
        const peek = peekUndo();
        if (!peek) {
          ui.info("(nothing to undo)");
          return "continue";
        }
        const r = popUndo();
        if (!r) {
          ui.info("(nothing to undo)");
          return "continue";
        }
        if (r.action === "deleted-newly-created") {
          ui.info(`✓ undo: deleted newly-created ${chalk.cyan(r.path)} (was created by ${r.tool})`);
        } else {
          ui.info(`✓ undo: restored ${chalk.cyan(r.path)} (last touched by ${r.tool})`);
        }
        return "continue";
      },
    },
    {
      name: "test",
      description: "run the project's tests (auto-detected)",
      async run() {
        await runProjectCommand("test");
        return "continue";
      },
    },
    {
      name: "build",
      description: "run the project's build (auto-detected)",
      async run() {
        await runProjectCommand("build");
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
    {
      name: "copy",
      description: "copy the Nth-latest assistant response to the clipboard (default: 1)",
      async run({ arg, session }) {
        const n = Math.max(1, parseInt(arg.trim() || "1", 10) || 1);
        const assistantTexts = session.messages
          .filter((m) => m.role === "assistant" && typeof m.content === "string" && m.content)
          .map((m) => m.content as string);
        if (n > assistantTexts.length) {
          ui.error(`only ${assistantTexts.length} assistant responses in history`);
          return "continue";
        }
        const text = assistantTexts[assistantTexts.length - n];
        try {
          await copyToClipboard(text);
          ui.info(`✓ copied response ${chalk.cyan("#" + n)} (${text.length} chars) to clipboard`);
        } catch (e) {
          ui.error("clipboard unavailable: " + (e as Error).message);
        }
        return "continue";
      },
    },
    {
      name: "diff",
      description: "show git uncommitted changes (working tree vs HEAD)",
      async run() {
        await runShellAndPrint("git diff --no-color HEAD", { color: "diff" });
        return "continue";
      },
    },
    {
      name: "export",
      description: "export the current conversation as markdown: /export [filename]",
      async run({ arg, session }) {
        const fname = (arg.trim() || `mcode-session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`).trim();
        const lines: string[] = [`# mcode session export`, ``, `> exported ${new Date().toISOString()}`, ``];
        for (const m of session.messages) {
          if (m.role === "system") continue;
          if (m.role === "user") {
            lines.push(`## User`, ``, String(m.content ?? ""), ``);
          } else if (m.role === "assistant") {
            lines.push(`## Assistant`, ``, String(m.content ?? ""), ``);
            if (m.tool_calls?.length) {
              for (const tc of m.tool_calls) {
                lines.push(`> tool: \`${tc.function.name}\``, ``, "```json", tc.function.arguments, "```", ``);
              }
            }
          } else if (m.role === "tool") {
            lines.push(`### Tool result (${m.name ?? "?"})`, ``, "```", String(m.content ?? ""), "```", ``);
          }
        }
        writeFileSync(fname, lines.join("\n"));
        ui.info(`✓ exported ${chalk.cyan(fname)} (${session.messages.length} messages)`);
        return "continue";
      },
    },
    {
      name: "compact",
      description: "compress the conversation by summarizing older turns: /compact [focus]",
      async run({ arg, session }) {
        const focus = arg.trim();
        const KEEP_LAST = 4; // keep the last N user/assistant messages verbatim
        const transcript = session.messages.filter((m) => m.role === "user" || m.role === "assistant");
        if (transcript.length <= KEEP_LAST + 2) {
          ui.info("(history is already short, nothing to compact)");
          return "continue";
        }
        const head = transcript.slice(0, transcript.length - KEEP_LAST);
        const tail = transcript.slice(transcript.length - KEEP_LAST);
        const summarizerPrompt = [
          "Summarize the following conversation concisely as a structured note.",
          "Preserve key decisions, file paths touched, libraries chosen, and unresolved TODOs.",
          "Output 200-400 words plain prose. No headings, no markdown bullets at the top level.",
          focus ? `Focus on: ${focus}` : "",
          "",
          "--- conversation ---",
          ...head.map((m) => `${m.role.toUpperCase()}: ${(m.content ?? "").toString().slice(0, 4000)}`),
        ].filter(Boolean).join("\n");
        ui.info("compacting…");
        const res = await session.options.client.chat({
          model: session.options.model,
          messages: [
            { role: "system", content: "You are a precise meeting-minutes summarizer." },
            { role: "user", content: summarizerPrompt },
          ],
        });
        const summary = res.choices[0]?.message?.content?.trim() ?? "";
        if (!summary) {
          ui.error("compact failed: empty summary");
          return "continue";
        }
        // Replace early conversation with a single synthetic message preserving system prompt.
        const sys = session.messages.find((m) => m.role === "system");
        session.messages.length = 0;
        if (sys) session.messages.push(sys);
        session.messages.push({
          role: "user",
          content: `[Compacted summary of earlier conversation]\n\n${summary}`,
        });
        for (const m of tail) session.messages.push(m);
        ui.info(`✓ compacted ${head.length} turns → 1 summary (${summary.length} chars)`);
        return "continue";
      },
    },
    {
      name: "effort",
      description: "set Mercury reasoning effort: /effort [low|medium|high|auto] (Mercury 2 may ignore)",
      async run({ arg, options }) {
        const v = arg.trim();
        if (!v) {
          ui.info(`current effort: ${chalk.cyan(options.effort ?? "auto")}`);
          return "continue";
        }
        if (!/^(low|medium|high|max|auto)$/.test(v)) {
          ui.error("usage: /effort low|medium|high|max|auto");
          return "continue";
        }
        options.effort = v === "auto" ? undefined : v;
        ui.info(`✓ effort: ${chalk.cyan(options.effort ?? "auto")}`);
        return "continue";
      },
    },
  ];
}
