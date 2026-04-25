import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  MercuryClient,
  type ChatMessage,
  type ToolCall,
} from "./client.js";
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
  stream?: boolean;
}

export interface AgentSession {
  options: AgentOptions;
  approval: ApprovalState;
  tools: Tool[];
  messages: ChatMessage[];
  usage: UsageTotals;
  hooks: HookConfig;
  // Cached model accessibility probe results (populated lazily by /model command)
  modelProbe?: Map<string, boolean>;
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

async function runNonStreaming(
  session: AgentSession,
  schemas: ReturnType<typeof toToolSchemas>,
): Promise<ChatMessage> {
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
  if (msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
    ui.assistant(msg.content);
  }
  return msg;
}

async function runStreaming(
  session: AgentSession,
  schemas: ReturnType<typeof toToolSchemas>,
): Promise<ChatMessage> {
  const stream = session.options.client.chatStream({
    model: session.options.model,
    messages: session.messages,
    tools: schemas,
    tool_choice: "auto",
  });

  let opened = false;
  let content = "";
  // tool_calls accumulated by index
  const tcByIndex: Map<number, ToolCall> = new Map();

  for await (const chunk of stream) {
    if (chunk.usage) {
      addUsage(session.usage, chunk.usage.prompt_tokens, chunk.usage.completion_tokens);
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;

    if (delta.content) {
      if (!opened) {
        ui.assistantOpen();
        opened = true;
      }
      ui.assistantWrite(delta.content);
      content += delta.content;
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        let cur = tcByIndex.get(idx);
        if (!cur) {
          cur = {
            id: tc.id ?? "",
            type: "function",
            function: { name: "", arguments: "" },
          };
          tcByIndex.set(idx, cur);
        }
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      }
    }
  }

  if (opened) ui.assistantClose();

  const tool_calls = [...tcByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v);

  return {
    role: "assistant",
    content: content || null,
    tool_calls: tool_calls.length ? tool_calls : undefined,
  };
}

/**
 * Expand `@path/to/file` mentions in the prompt by inlining file contents.
 * Only paths that resolve to existing readable files (≤256KB) are expanded.
 * Anything else (decorators, email handles, missing paths) passes through unchanged.
 */
function expandFileMentions(prompt: string): { text: string; expanded: string[] } {
  const expanded: string[] = [];
  const out = prompt.replace(/@([\w./@~-]+)/g, (raw, p1: string) => {
    // Strip a leading ~/ to homedir
    const candidate = p1.startsWith("~/") ? p1.replace(/^~/, process.env.HOME ?? "") : p1;
    const abs = resolve(process.cwd(), candidate);
    try {
      const st = statSync(abs);
      if (!st.isFile()) return raw;
      if (st.size > 256_000) return raw;
      const body = readFileSync(abs, "utf8");
      expanded.push(p1);
      return `\n\n[file ${p1}]\n\`\`\`\n${body}\n\`\`\`\n`;
    } catch {
      return raw;
    }
  });
  return { text: out, expanded };
}

export async function runTurn(session: AgentSession, userPrompt: string): Promise<void> {
  const { text: expandedPrompt, expanded } = expandFileMentions(userPrompt);
  if (expanded.length) {
    ui.info(`@-expanded: ${expanded.map((p) => "@" + p).join(", ")}`);
  }
  session.messages.push({ role: "user", content: expandedPrompt });
  const schemas = toToolSchemas(session.tools);

  for (let turn = 0; turn < session.options.maxTurns; turn++) {
    const msg = session.options.stream === false
      ? await runNonStreaming(session, schemas)
      : await runStreaming(session, schemas);
    session.messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
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
