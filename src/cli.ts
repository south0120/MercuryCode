import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, SESSIONS_DIR } from "./config.js";
import { MercuryClient } from "./client.js";
import { createSession, runTurn, type AgentOptions } from "./agent.js";
import { runRepl } from "./repl.js";
import { ui } from "./ui.js";
import {
  loadPlugins,
  pluginSkillsDirs,
  pluginMcpFiles,
  pluginCommandsDirs,
  pluginHookFiles,
} from "./plugins.js";
import { loadSkills, skillsCatalog, type Skill } from "./skills.js";
import { makeInvokeSkillTool } from "./tools/invokeSkill.js";
import { makeFimCompleteTool } from "./tools/fimComplete.js";
import { makeEditWithAiTool } from "./tools/editWithAi.js";
import { loadMcpConfig, startAllMcpServers, shutdownMcp, type McpConnection } from "./mcp.js";
import type { Tool } from "./tools/index.js";
import { runBootstrap, printBootstrap, initProjectDir } from "./init.js";
import { runPluginCli } from "./pluginCli.js";

export interface CliFlags {
  yolo: boolean;
  readOnly: boolean;
  session?: string;
  file?: string;
  model?: string;
  maxTurns: number;
  plan: boolean;
  // commander maps `--no-mcp` to a boolean field named `mcp` (default true)
  mcp: boolean;
  editorModel: boolean;
  autoInit: boolean;
  stream: boolean;
}

const VERSION = "0.1.0";

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("mcode")
    .description("Mercury 2 coding agent — like Claude Code, powered by Inception Labs Mercury")
    .version(VERSION)
    .argument("[prompt...]", "task prompt (omit to launch REPL)")
    .option("-y, --yolo", "auto-approve writes and bash", false)
    .option("--read-only", "disable write/edit/bash tools", false)
    .option("-s, --session <name>", "persist conversation to ~/.mcode/sessions/<name>.json")
    .option("-f, --file <path>", "read prompt from file")
    .option("-m, --model <id>", "model id", "mercury-2")
    .option("--max-turns <n>", "max agent loop turns", (v) => parseInt(v, 10), 20)
    .option("--plan", "plan mode: AI proposes plan before any write/bash", false)
    .option("--no-mcp", "skip starting MCP servers")
    .option(
      "--no-editor-model",
      "don't register Mercury Edit 2 tools (fim_complete, edit_with_ai)",
    )
    .option(
      "--no-auto-init",
      "skip auto-creating .mcode/ for this run",
    )
    .option(
      "--no-stream",
      "disable streaming output (wait for full response)",
    )
    .allowExcessArguments(false);

  program.parse(argv);
  const opts = program.opts<CliFlags>();
  const positional = program.args;

  // `mcode plugin <subcommand>` — marketplace + install. Doesn't need API key.
  if (positional[0] === "plugin") {
    const code = await runPluginCli(positional.slice(1));
    process.exitCode = code;
    return;
  }

  // `mcode init` — explicit project scaffolding. Doesn't need API key.
  if (positional[0] === "init" && positional.length === 1) {
    const created = initProjectDir(process.cwd(), { withMercuryMd: true });
    if (created.length === 0) {
      ui.info("`.mcode/` already initialized in this directory.");
    } else {
      ui.info(`✓ initialized .mcode/ — created ${created.length} files`);
      for (const p of created) ui.info("  " + p.replace(process.cwd() + "/", ""));
    }
    return;
  }

  const cfg = await loadConfig();
  const client = new MercuryClient(cfg.apiKey);

  // Always ensure ~/.mcode/ exists; auto-init project .mcode/ when interactive.
  const isInteractive = process.stdin.isTTY && !opts.file && positional.length === 0;
  const bootstrap = runBootstrap({
    cwd: process.cwd(),
    autoInitProject: opts.autoInit !== false,
    isInteractive,
  });
  printBootstrap(bootstrap);

  const sessionFile = opts.session ? join(SESSIONS_DIR, `${opts.session}.json`) : undefined;

  // Plugins → skills → MCP, all extensibility loaded here.
  const plugins = loadPlugins();
  if (plugins.length) {
    ui.info(`plugins: ${plugins.map((p) => p.manifest.name).join(", ")}`);
  }

  const skills: Skill[] = loadSkills(pluginSkillsDirs(plugins));

  const extraTools: Tool[] = [];
  if (skills.length) {
    extraTools.push(makeInvokeSkillTool(skills));
    ui.info(`skills: ${skills.map((s) => s.name).join(", ")}`);
  }

  if (opts.editorModel !== false && !opts.readOnly) {
    extraTools.push(makeFimCompleteTool(client));
    extraTools.push(makeEditWithAiTool(client));
    ui.info(`editor-model: mercury-edit-2 (fim_complete, edit_with_ai)`);
  }

  let mcpConnections: McpConnection[] = [];
  if (opts.mcp !== false) {
    const mcpConfig = loadMcpConfig(pluginMcpFiles(plugins));
    if (Object.keys(mcpConfig).length) {
      mcpConnections = await startAllMcpServers(mcpConfig);
      for (const conn of mcpConnections) {
        extraTools.push(...conn.tools);
        ui.info(`mcp: ${conn.serverName} (${conn.tools.length} tools)`);
      }
    }
  }

  const agentOpts: AgentOptions = {
    client,
    model: opts.model || cfg.defaultModel || "mercury-2",
    yolo: opts.yolo,
    readOnly: opts.readOnly,
    maxTurns: opts.maxTurns,
    sessionFile,
    planMode: opts.plan,
    extraTools,
    skillsCatalog: skillsCatalog(skills),
    pluginCommandsDirs: pluginCommandsDirs(plugins),
    pluginHookFiles: pluginHookFiles(plugins),
    stream: opts.stream !== false,
  };

  let prompt = "";
  if (opts.file) {
    prompt = readFileSync(opts.file, "utf8");
  } else if (positional.length) {
    prompt = positional.join(" ");
  } else if (!process.stdin.isTTY) {
    prompt = await readStdin();
  }

  const cleanup = async () => {
    await shutdownMcp(mcpConnections);
  };

  try {
    if (!prompt.trim()) {
      await runRepl(agentOpts);
    } else {
      const session = createSession(agentOpts);
      await runTurn(session, prompt);
    }
  } catch (e) {
    ui.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}
