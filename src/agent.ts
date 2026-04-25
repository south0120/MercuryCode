import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MercuryClient, type ChatMessage } from "./client.js";
import { selectTools, toToolSchemas, toolByName, type Tool } from "./tools/index.js";
import { buildSystemPrompt } from "./memory.js";
import { ui } from "./ui.js";
import { confirmAction, makeApprovalState, type ApprovalState } from "./approval.js";
import { add as addUsage, newUsage, type UsageTotals } from "./usage.js";
import { loadHooks, runHooks, type HookConfig } from "./hooks.js";
import chalk from "chalk";

export interface AgentOptions {
  client: MercuryClient;
  model: string;
  yolo: boolean;
  readOnly: boolean;
  maxTurns: number;
  sessionFile?: string;
  planMode?: boolean;
  extraTools?: Tool[];
  skillsCatalog?: string;
  pluginCommandsDirs?: string[];
  pluginHookFiles?: string[];
}

export interface AgentSession {
  options: AgentOptions;
  approval: ApprovalState;
  tools: Tool[];
  messages: ChatMessage[];
  usage: UsageTotals;
  hooks: HookConfig;
}

export function createSession(options: AgentOptions): AgentSession {
  const baseTools = selectTools({ readOnly: options.readOnly });
  const tools = [...baseTools, ...(options.extraTools ?? [])];
  const messages: ChatMessage[] = [];

  if (options.sessionFile && existsSync(options.sessionFile)) {
    try {
      const saved = JSON.parse(readFileSync(options.sessionFile, "utf8")) as ChatMessage[];
      messages.push(...saved);
    } catch {
      // ignore corrupt session
    }
  }

  if (!messages.some((m) => m.role === "system")) {
    messages.push({
      role: "system",
      content: buildSystemPrompt({
        planMode: options.planMode,
        extraInstructions: options.skillsCatalog,
      }),
    });
  }

  return {
    options,
    approval: makeApprovalState(options.yolo),
    tools,
    messages,
    usage: newUsage(),
    hooks: loadHooks(options.pluginHookFiles ?? []),
  };
}

export function rebuildSystem(session: AgentSession): void {
  const sys = buildSystemPrompt({
    planMode: session.options.planMode,
    extraInstructions: session.options.skillsCatalog,
  });
  const idx = session.messages.findIndex((m) => m.role === "system");
  if (idx >= 0) session.messages[idx] = { role: "system", content: sys };
  else session.messages.unshift({ role: "system", content: sys });
}

function persist(session: AgentSession) {
  if (!session.options.sessionFile) return;
  mkdirSync(dirname(session.options.sessionFile), { recursive: true });
  writeFileSync(
    session.options.sessionFile,
    JSON.stringify(session.messages, null, 2),
    "utf8",
  );
}

export async function runTurn(session: AgentSession, userPrompt: string): Promise<void> {
  session.messages.push({ role: "user", content: userPrompt });
  const schemas = toToolSchemas(session.tools);

  for (let turn = 0; turn < session.options.maxTurns; turn++) {
    const res = await session.options.client.chat({
      model: session.options.model,
      messages: session.messages,
      tools: schemas,
      tool_choice: "auto",
    });
    if (res.usage) {
      addUsage(session.usage, res.usage.prompt_tokens, res.usage.completion_tokens);
    }
    const msg = res.choices[0].message;
    session.messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      ui.assistant(msg.content);
      persist(session);
      return;
    }

    for (const call of msg.tool_calls) {
      const tool = toolByName(session.tools, call.function.name);
      if (!tool) {
        const err = `unknown tool: ${call.function.name}`;
        ui.error(err);
        session.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({ error: err }),
        });
        continue;
      }

      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (e) {
        const err = `bad JSON args: ${(e as Error).message}`;
        ui.error(err);
        session.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: tool.name,
          content: JSON.stringify({ error: err }),
        });
        continue;
      }

      ui.toolCall(tool.name, args);

      // Pre-tool hook
      const preResults = await runHooks(session.hooks, {
        event: "PreToolUse",
        toolName: tool.name,
        toolInput: args,
        cwd: process.cwd(),
      });
      const blocked = preResults.find((r) => r.block);
      if (blocked) {
        const reason = (blocked.stderr || blocked.stdout || "blocked by hook").trim();
        console.log(chalk.red(`✘ blocked by PreToolUse hook: ${reason}`));
        session.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: tool.name,
          content: JSON.stringify({ error: `blocked by hook: ${reason}` }),
        });
        continue;
      }

      if (tool.requiresApproval) {
        const decision = await confirmAction(session.approval, tool.name, tool.describe(args));
        if (decision === "reject") {
          session.messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: tool.name,
            content: JSON.stringify({ error: "user rejected the action" }),
          });
          continue;
        }
      }

      try {
        const result = await tool.run(args);
        ui.toolResult(tool.name, result, true);
        session.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: tool.name,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
        await runHooks(session.hooks, {
          event: "PostToolUse",
          toolName: tool.name,
          toolInput: args,
          toolOutput: result,
          cwd: process.cwd(),
        });
      } catch (e) {
        const err = (e as Error).message;
        ui.toolResult(tool.name, err, false);
        session.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: tool.name,
          content: JSON.stringify({ error: err }),
        });
      }
    }
    persist(session);
  }

  ui.error(`max turns (${session.options.maxTurns}) reached without final answer`);
  persist(session);
}
