import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  // Relative paths inside the plugin directory (mcode-native fields).
  commands?: string;
  skills?: string;
  hooks?: string;
  mcp?: string;
  [k: string]: unknown;
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

// Look in both Claude Code and mcode-native locations for the manifest.
function findManifest(pluginRoot: string): PluginManifest | null {
  const candidates = [
    join(pluginRoot, ".claude-plugin", "plugin.json"), // Claude Code format
    join(pluginRoot, "plugin.json"),                    // mcode native
  ];
  for (const path of candidates) {
    const m = readJson<PluginManifest>(path);
    if (m && m.name) return m;
  }
  return null;
}

function scanPluginsDir(dir: string, source: "project" | "user"): LoadedPlugin[] {
  if (!existsSync(dir)) return [];
  const out: LoadedPlugin[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "cache" || entry.startsWith(".")) continue;
    const sub = join(dir, entry);
    try {
      const st = statSync(sub);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const manifest = findManifest(sub);
    if (!manifest) continue;
    out.push({ manifest, rootDir: sub, source });
  }
  return out;
}

export function loadPlugins(): LoadedPlugin[] {
  const project = scanPluginsDir(join(process.cwd(), ".mcode", "plugins"), "project");
  const user = scanPluginsDir(join(homedir(), ".mcode", "plugins"), "user");
  const seen = new Set(project.map((p) => p.manifest.name));
  return [...project, ...user.filter((p) => !seen.has(p.manifest.name))];
}

// Helpers that try manifest field first, then well-known default locations
// (supporting both Claude Code's `.mcp.json` / `hooks/hooks.json` AND
// mcode's flat `mcp.json` / `hooks.json`).

function existingPath(...paths: (string | null | undefined)[]): string | null {
  for (const p of paths) if (p && existsSync(p)) return p;
  return null;
}

export function pluginCommandsDirs(plugins: LoadedPlugin[]): string[] {
  return plugins.flatMap((p) => {
    const path = existingPath(
      p.manifest.commands ? join(p.rootDir, p.manifest.commands) : null,
      join(p.rootDir, "commands"),
    );
    return path ? [path] : [];
  });
}

export function pluginSkillsDirs(plugins: LoadedPlugin[]): string[] {
  return plugins.flatMap((p) => {
    const path = existingPath(
      p.manifest.skills ? join(p.rootDir, p.manifest.skills) : null,
      join(p.rootDir, "skills"),
    );
    return path ? [path] : [];
  });
}

export function pluginHookFiles(plugins: LoadedPlugin[]): string[] {
  return plugins.flatMap((p) => {
    const path = existingPath(
      p.manifest.hooks ? join(p.rootDir, p.manifest.hooks) : null,
      join(p.rootDir, "hooks", "hooks.json"), // Claude Code format
      join(p.rootDir, "hooks.json"),           // mcode flat
    );
    return path ? [path] : [];
  });
}

export function pluginMcpFiles(plugins: LoadedPlugin[]): string[] {
  return plugins.flatMap((p) => {
    const path = existingPath(
      p.manifest.mcp ? join(p.rootDir, p.manifest.mcp) : null,
      join(p.rootDir, ".mcp.json"), // Claude Code format
      join(p.rootDir, "mcp.json"),   // mcode native
    );
    return path ? [path] : [];
  });
}
