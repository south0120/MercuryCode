import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  // Relative paths inside the plugin directory.
  commands?: string; // dir of *.md
  skills?: string; // dir of <name>/SKILL.md or *.md
  hooks?: string; // path to hooks.json
  mcp?: string; // path to mcp.json
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  rootDir: string;
  source: "project" | "user";
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function scanPluginsDir(dir: string, source: "project" | "user"): LoadedPlugin[] {
  if (!existsSync(dir)) return [];
  const out: LoadedPlugin[] = [];
  for (const entry of readdirSync(dir)) {
    const sub = join(dir, entry);
    try {
      const st = statSync(sub);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const manifestPath = join(sub, "plugin.json");
    const manifest = readJson<PluginManifest>(manifestPath);
    if (!manifest || !manifest.name) continue;
    out.push({ manifest, rootDir: sub, source });
  }
  return out;
}

export function loadPlugins(): LoadedPlugin[] {
  const project = scanPluginsDir(join(process.cwd(), ".mcode", "plugins"), "project");
  const user = scanPluginsDir(join(homedir(), ".mcode", "plugins"), "user");
  // Project plugins override user plugins by name.
  const seen = new Set(project.map((p) => p.manifest.name));
  return [...project, ...user.filter((p) => !seen.has(p.manifest.name))];
}

export function pluginCommandsDirs(plugins: LoadedPlugin[]): string[] {
  return plugins
    .map((p) => (p.manifest.commands ? join(p.rootDir, p.manifest.commands) : null))
    .filter((p): p is string => Boolean(p));
}

export function pluginSkillsDirs(plugins: LoadedPlugin[]): string[] {
  return plugins
    .map((p) => (p.manifest.skills ? join(p.rootDir, p.manifest.skills) : null))
    .filter((p): p is string => Boolean(p));
}

export function pluginHookFiles(plugins: LoadedPlugin[]): string[] {
  return plugins
    .map((p) => (p.manifest.hooks ? join(p.rootDir, p.manifest.hooks) : null))
    .filter((p): p is string => Boolean(p));
}

export function pluginMcpFiles(plugins: LoadedPlugin[]): string[] {
  return plugins
    .map((p) => (p.manifest.mcp ? join(p.rootDir, p.manifest.mcp) : null))
    .filter((p): p is string => Boolean(p));
}
