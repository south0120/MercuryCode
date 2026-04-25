import type { ToolSchema } from "../client.js";
import { readFileTool } from "./readFile.js";
import { writeFileTool } from "./writeFile.js";
import { editFileTool } from "./editFile.js";
import { bashTool } from "./bash.js";
import { listDirTool } from "./listDir.js";
import { grepTool } from "./grep.js";

export interface Tool {
  name: string;
  description: string;
  requiresApproval: boolean;
  parameters: Record<string, unknown>;
  describe(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>): Promise<unknown> | unknown;
}

const ALL: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  listDirTool,
  grepTool,
];

const READ_ONLY = new Set(["read_file", "list_dir", "grep"]);

export function selectTools(opts: { readOnly?: boolean }): Tool[] {
  if (opts.readOnly) return ALL.filter((t) => READ_ONLY.has(t.name));
  return ALL;
}

export function toToolSchemas(tools: Tool[]): ToolSchema[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function toolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find((t) => t.name === name);
}
