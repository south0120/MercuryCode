import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, SESSIONS_DIR } from "./config.js";
import { MercuryClient } from "./client.js";
import { createSession, runTurn, type AgentOptions } from "./agent.js";
import { runRepl } from "./repl.js";
import { ui } from "./ui.js";

export interface CliFlags {
  yolo: boolean;
  readOnly: boolean;
  session?: string;
  file?: string;
  model?: string;
  maxTurns: number;
  plan: boolean;
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
    .allowExcessArguments(false);

  program.parse(argv);
  const opts = program.opts<CliFlags>();
  const positional = program.args;

  const cfg = await loadConfig();
  const client = new MercuryClient(cfg.apiKey);

  const sessionFile = opts.session ? join(SESSIONS_DIR, `${opts.session}.json`) : undefined;

  const agentOpts: AgentOptions = {
    client,
    model: opts.model || cfg.defaultModel || "mercury-2",
    yolo: opts.yolo,
    readOnly: opts.readOnly,
    maxTurns: opts.maxTurns,
    sessionFile,
    planMode: opts.plan,
  };

  let prompt = "";
  if (opts.file) {
    prompt = readFileSync(opts.file, "utf8");
  } else if (positional.length) {
    prompt = positional.join(" ");
  } else if (!process.stdin.isTTY) {
    prompt = await readStdin();
  }

  if (!prompt.trim()) {
    await runRepl(agentOpts);
    return;
  }

  const session = createSession(agentOpts);
  try {
    await runTurn(session, prompt);
  } catch (e) {
    ui.error((e as Error).message);
    process.exitCode = 1;
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
