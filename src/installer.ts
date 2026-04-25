import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { gitClone } from "./git.js";
import {
  readCatalogFromDir,
  type MarketplacePlugin,
  type RegisteredMarketplace,
} from "./marketplace.js";

const PLUGIN_CACHE_DIR = () => join(homedir(), ".mcode", "plugins", "cache");
const PLUGINS_DIR = () => join(homedir(), ".mcode", "plugins");

function cacheKeyForPlugin(plugin: MarketplacePlugin): string {
  if (typeof plugin.source === "string") {
    throw new Error("relative-path plugin source has no separate cache key");
  }
  const s = plugin.source as { source: string; repo?: string; url?: string };
  if (s.source === "github") return `plugin_github__${s.repo!.replace(/\//g, "__")}`;
  if (s.source === "url") return `plugin_url__${s.url!.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 80)}`;
  throw new Error(`unsupported plugin source: ${s.source}`);
}

function resolveSourceDir(plugin: MarketplacePlugin, mp: RegisteredMarketplace): string {
  if (typeof plugin.source === "string") {
    // Relative path inside the marketplace's cache directory.
    let rel = plugin.source.startsWith("./") ? plugin.source.slice(2) : plugin.source;
    const cat = readCatalogFromDir(mp.cache_dir);
    const pluginRoot = cat.metadata?.pluginRoot
      ? cat.metadata.pluginRoot.replace(/^\.\//, "").replace(/\/$/, "")
      : "";
    if (pluginRoot && !rel.startsWith(pluginRoot + "/") && rel !== pluginRoot) {
      rel = pluginRoot + "/" + rel;
    }
    return resolve(mp.cache_dir, rel);
  }
  return join(PLUGIN_CACHE_DIR(), cacheKeyForPlugin(plugin));
}

async function ensurePluginCache(plugin: MarketplacePlugin, mp: RegisteredMarketplace): Promise<string> {
  const dir = resolveSourceDir(plugin, mp);
  if (typeof plugin.source === "string") {
    if (!existsSync(dir)) throw new Error(`plugin path not found in marketplace cache: ${dir}`);
    return dir;
  }
  if (existsSync(dir)) return dir;
  const s = plugin.source as { source: string; repo?: string; url?: string; ref?: string };
  let url: string;
  if (s.source === "github") url = `https://github.com/${s.repo}.git`;
  else if (s.source === "url") url = s.url!;
  else throw new Error(`unsupported plugin source type: ${s.source}`);
  mkdirSync(PLUGIN_CACHE_DIR(), { recursive: true });
  await gitClone(url, dir, { ref: s.ref, depth: 1 });
  return dir;
}

function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === ".git") continue; // skip git metadata
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) copyFileSync(s, d);
  }
}

export interface InstallResult {
  destDir: string;
  version: string | null;
  sourceDir: string;
}

export async function installPlugin(
  plugin: MarketplacePlugin,
  mp: RegisteredMarketplace,
): Promise<InstallResult> {
  const sourceDir = await ensurePluginCache(plugin, mp);
  const st = statSync(sourceDir);
  if (!st.isDirectory()) throw new Error(`plugin source is not a directory: ${sourceDir}`);
  const destDir = join(PLUGINS_DIR(), plugin.name);
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  copyDirRecursive(sourceDir, destDir);
  return { destDir, version: plugin.version ?? null, sourceDir };
}

export function uninstallPlugin(name: string): boolean {
  const dir = join(PLUGINS_DIR(), name);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function listInstalledPlugins(): string[] {
  const dir = PLUGINS_DIR();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "cache" && !e.name.startsWith("."))
    .map((e) => e.name);
}
