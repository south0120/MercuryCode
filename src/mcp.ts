import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "./tools/index.js";

export interface McpServerSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export type McpConfig = Record<string, McpServerSpec>;

export interface McpConnection {
  serverName: string;
  client: Client;
  transport: StdioClientTransport;
  tools: Tool[];
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadMcpConfig(extraFiles: string[] = []): McpConfig {
  const merged: McpConfig = {};
  const candidates = [
    join(homedir(), ".mcode", "mcp.json"),
    join(process.cwd(), ".mcode", "mcp.json"),
    ...extraFiles,
  ];
  for (const path of candidates) {
    const c = readJson<{ mcpServers?: McpConfig } & McpConfig>(path);
    if (!c) continue;
    const servers = (c.mcpServers ?? c) as McpConfig;
    for (const [name, spec] of Object.entries(servers)) {
      if (spec && typeof spec === "object" && "command" in spec) merged[name] = spec as McpServerSpec;
    }
  }
  return merged;
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 56);
}

export async function connectMcpServer(
  serverName: string,
  spec: McpServerSpec,
): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args ?? [],
    env: { ...process.env, ...(spec.env ?? {}) } as Record<string, string>,
    cwd: spec.cwd,
  });
  const client = new Client(
    { name: "mcode", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  const list = await client.listTools();
  const tools: Tool[] = (list.tools ?? []).map((t) => {
    const localName = `mcp__${sanitizeName(serverName)}__${sanitizeName(t.name)}`;
    return {
      name: localName,
      description: `[${serverName}] ${t.description ?? t.name}`,
      requiresApproval: true,
      parameters: (t.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
      describe(args) {
        return `${localName}\n${JSON.stringify(args, null, 2).slice(0, 800)}`;
      },
      async run(args) {
        const result = await client.callTool({
          name: t.name,
          arguments: args as Record<string, unknown>,
        });
        return result;
      },
    };
  });
  return { serverName, client, transport, tools };
}

export async function startAllMcpServers(config: McpConfig): Promise<McpConnection[]> {
  const connections: McpConnection[] = [];
  for (const [name, spec] of Object.entries(config)) {
    try {
      const conn = await connectMcpServer(name, spec);
      connections.push(conn);
    } catch (e) {
      console.error(`[mcp] failed to connect '${name}': ${(e as Error).message}`);
    }
  }
  return connections;
}

export async function shutdownMcp(connections: McpConnection[]): Promise<void> {
  await Promise.all(
    connections.map(async (c) => {
      try {
        await c.client.close();
      } catch {}
    }),
  );
}
