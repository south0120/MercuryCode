import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CustomCommand {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  body: string; // template, may contain $ARGUMENTS
  source: "project" | "user";
  path: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { meta: {}, body: raw };
  const [, fm, body] = m;
  const meta: Record<string, string> = {};
  for (const line of fm.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) meta[key] = val;
  }
  return { meta, body: body.trim() };
}

function loadDir(dir: string, source: "project" | "user"): CustomCommand[] {
  if (!existsSync(dir)) return [];
  const out: CustomCommand[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const path = join(dir, f);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const { meta, body } = parseFrontmatter(raw);
    const name = f.replace(/\.md$/, "");
    out.push({
      name,
      description: meta.description || meta.desc || "(custom command)",
      argumentHint: meta["argument-hint"] || meta.argumentHint,
      allowedTools: meta["allowed-tools"]
        ? meta["allowed-tools"].split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      body,
      source,
      path,
    });
  }
  return out;
}

export function loadCustomCommands(home: string): CustomCommand[] {
  const project = loadDir(join(process.cwd(), ".mcode", "commands"), "project");
  const user = loadDir(join(home, ".mcode", "commands"), "user");
  // project shadows user with same name
  const seen = new Set(project.map((c) => c.name));
  return [...project, ...user.filter((c) => !seen.has(c.name))];
}

export function renderCommand(cmd: CustomCommand, args: string): string {
  if (cmd.body.includes("$ARGUMENTS")) {
    return cmd.body.replace(/\$ARGUMENTS/g, args);
  }
  return args ? `${cmd.body}\n\nArguments: ${args}` : cmd.body;
}
