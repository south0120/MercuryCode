import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export type HookEvent = "PreToolUse" | "PostToolUse" | "SessionStart" | "SessionEnd";

export interface HookEntry {
  matcher?: string; // tool name regex; default = all
  command: string; // shell command to run
  timeout_ms?: number;
}

export interface HookConfig {
  PreToolUse?: HookEntry[];
  PostToolUse?: HookEntry[];
  SessionStart?: HookEntry[];
  SessionEnd?: HookEntry[];
}

function readJson(path: string): HookConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as HookConfig;
  } catch {
    return {};
  }
}

export function loadHooks(): HookConfig {
  const project = readJson(join(process.cwd(), ".mcode", "hooks.json"));
  const user = readJson(join(homedir(), ".mcode", "hooks.json"));
  const merged: HookConfig = {};
  for (const key of ["PreToolUse", "PostToolUse", "SessionStart", "SessionEnd"] as const) {
    merged[key] = [...(user[key] || []), ...(project[key] || [])];
  }
  return merged;
}

export interface HookContext {
  event: HookEvent;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  cwd: string;
}

export interface HookResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  block: boolean; // exit code 2 means block
}

export async function runHooks(
  config: HookConfig,
  ctx: HookContext,
): Promise<HookResult[]> {
  const entries = config[ctx.event] || [];
  const matched = entries.filter((e) => {
    if (!e.matcher) return true;
    if (!ctx.toolName) return true;
    try {
      return new RegExp(e.matcher).test(ctx.toolName);
    } catch {
      return e.matcher === ctx.toolName;
    }
  });
  const results: HookResult[] = [];
  for (const entry of matched) {
    results.push(await runOne(entry, ctx));
  }
  return results;
}

function runOne(entry: HookEntry, ctx: HookContext): Promise<HookResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", entry.command], { cwd: ctx.cwd });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), entry.timeout_ms ?? 30_000);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const payload = JSON.stringify({
      event: ctx.event,
      tool_name: ctx.toolName,
      tool_input: ctx.toolInput,
      tool_output: ctx.toolOutput,
      cwd: ctx.cwd,
    });
    child.stdin.write(payload);
    child.stdin.end();
    child.on("close", (code) => {
      clearTimeout(timeout);
      const c = code ?? -1;
      resolve({ exit_code: c, stdout, stderr, block: c === 2 });
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ exit_code: -1, stdout: "", stderr: "hook spawn failed", block: false });
    });
  });
}
