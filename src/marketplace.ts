import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gitClone, gitPull } from "./git.js";

const MCODE_HOME = () => join(homedir(), ".mcode");
const MARKETPLACES_FILE = () => join(MCODE_HOME(), "marketplaces.json");
const PLUGIN_CACHE_DIR = () => join(MCODE_HOME(), "plugins", "cache");

// Source spec types ──────────────────────────────────────────────────────────

export type GithubSource = { source: "github"; repo: string; ref?: string };
export type UrlSource = { source: "url"; url: string; ref?: string };
export type LocalSource = { source: "local"; path: string };
export type MarketplaceSourceSpec = GithubSource | UrlSource | LocalSource;

export type PluginSourceSpec =
  | string
  | GithubSource
  | UrlSource
  | { source: "git-subdir"; url: string; path: string; ref?: string; sha?: string }
  | { source: "npm"; package: string; version?: string; registry?: string };

export interface RegisteredMarketplace {
  name: string;
  source: MarketplaceSourceSpec;
  added_at: string;
  cache_dir: string;
}

export interface MarketplacePlugin {
  name: string;
  source: PluginSourceSpec;
  description?: string;
  version?: string;
  author?: { name: string; email?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  category?: string;
  tags?: string[];
  keywords?: string[];
  [k: string]: unknown;
}

export interface MarketplaceCatalog {
  name: string;
  owner?: { name: string; email?: string };
  metadata?: { description?: string; version?: string; pluginRoot?: string };
  plugins: MarketplacePlugin[];
}

type RegistryFile = Record<string, RegisteredMarketplace>;

// Registry I/O ───────────────────────────────────────────────────────────────

function readRegistry(): RegistryFile {
  const path = MARKETPLACES_FILE();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeRegistry(reg: RegistryFile): void {
  mkdirSync(MCODE_HOME(), { recursive: true });
  writeFileSync(MARKETPLACES_FILE(), JSON.stringify(reg, null, 2));
}

// Source string parsing ──────────────────────────────────────────────────────

export function parseMarketplaceSource(input: string): MarketplaceSourceSpec {
  const trimmed = input.trim();
  // ~/path or absolute or ./relative — local
  if (trimmed.startsWith("/") || trimmed.startsWith("~/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    const path = trimmed.startsWith("~") ? trimmed.replace(/^~/, process.env.HOME ?? "") : trimmed;
    return { source: "local", path };
  }
  // owner/repo → github
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return { source: "github", repo: trimmed };
  }
  // full git URL
  if (/^(https?:\/\/|git@|git:\/\/|ssh:\/\/)/.test(trimmed)) {
    return { source: "url", url: trimmed };
  }
  throw new Error(`unrecognized marketplace source: ${input}`);
}

function cacheSlug(spec: MarketplaceSourceSpec): string {
  if (spec.source === "github") return `github__${spec.repo.replace(/\//g, "__")}`;
  if (spec.source === "url") return `url__${spec.url.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 80)}`;
  if (spec.source === "local") return `local__${spec.path.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 80)}`;
  throw new Error("unsupported source");
}

function cacheDirFor(spec: MarketplaceSourceSpec): string {
  return spec.source === "local" ? spec.path : join(PLUGIN_CACHE_DIR(), cacheSlug(spec));
}

async function ensureCache(spec: MarketplaceSourceSpec): Promise<string> {
  const dir = cacheDirFor(spec);
  if (existsSync(dir)) return dir;
  if (spec.source === "local") throw new Error(`local marketplace path not found: ${spec.path}`);
  mkdirSync(PLUGIN_CACHE_DIR(), { recursive: true });
  const url = spec.source === "github" ? `https://github.com/${spec.repo}.git` : spec.url;
  await gitClone(url, dir, { ref: spec.ref, depth: 1 });
  return dir;
}

// Catalog reading ────────────────────────────────────────────────────────────

export function readCatalogFromDir(dir: string): MarketplaceCatalog {
  const candidates = [
    join(dir, ".claude-plugin", "marketplace.json"),
    join(dir, "marketplace.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    let raw: string;
    try {
      raw = readFileSync(p, "utf8");
    } catch (e) {
      throw new Error(`failed reading ${p}: ${(e as Error).message}`);
    }
    let json: MarketplaceCatalog;
    try {
      json = JSON.parse(raw) as MarketplaceCatalog;
    } catch (e) {
      throw new Error(`failed parsing ${p}: ${(e as Error).message}`);
    }
    if (!json.name || !Array.isArray(json.plugins)) {
      throw new Error(`invalid marketplace.json at ${p}: missing 'name' or 'plugins' array`);
    }
    return json;
  }
  throw new Error(`no marketplace.json found in ${dir} (looked for .claude-plugin/marketplace.json and marketplace.json)`);
}

// Public API ─────────────────────────────────────────────────────────────────

export async function addMarketplace(input: string, name?: string): Promise<RegisteredMarketplace> {
  const spec = parseMarketplaceSource(input);
  const dir = await ensureCache(spec);
  const cat = readCatalogFromDir(dir);
  const finalName = name || cat.name;
  const reg = readRegistry();
  reg[finalName] = {
    name: finalName,
    source: spec,
    added_at: new Date().toISOString(),
    cache_dir: dir,
  };
  writeRegistry(reg);
  return reg[finalName];
}

export function listMarketplaces(): RegisteredMarketplace[] {
  return Object.values(readRegistry());
}

export function getMarketplace(name: string): RegisteredMarketplace | null {
  return readRegistry()[name] ?? null;
}

export function removeMarketplace(name: string): boolean {
  const reg = readRegistry();
  if (!reg[name]) return false;
  delete reg[name];
  writeRegistry(reg);
  return true;
}

export async function updateMarketplace(name: string): Promise<void> {
  const reg = readRegistry();
  const entry = reg[name];
  if (!entry) throw new Error(`unknown marketplace: ${name}`);
  if (entry.source.source === "local") return;
  await gitPull(entry.cache_dir);
}

export function browseMarketplace(name: string): MarketplacePlugin[] {
  const entry = getMarketplace(name);
  if (!entry) throw new Error(`unknown marketplace: ${name}`);
  return readCatalogFromDir(entry.cache_dir).plugins;
}

export function findPluginInRegistry(
  pluginName: string,
  marketplaceName?: string,
): { plugin: MarketplacePlugin; marketplace: RegisteredMarketplace } {
  const reg = readRegistry();
  if (marketplaceName) {
    const mp = reg[marketplaceName];
    if (!mp) throw new Error(`unknown marketplace: ${marketplaceName}`);
    const plugin = readCatalogFromDir(mp.cache_dir).plugins.find((p) => p.name === pluginName);
    if (!plugin) {
      throw new Error(`plugin '${pluginName}' not found in marketplace '${marketplaceName}'`);
    }
    return { plugin, marketplace: mp };
  }
  const matches: Array<{ plugin: MarketplacePlugin; marketplace: RegisteredMarketplace }> = [];
  for (const mp of Object.values(reg)) {
    try {
      const cat = readCatalogFromDir(mp.cache_dir);
      const plugin = cat.plugins.find((p) => p.name === pluginName);
      if (plugin) matches.push({ plugin, marketplace: mp });
    } catch {
      // skip broken marketplaces
    }
  }
  if (matches.length === 0) {
    throw new Error(`plugin '${pluginName}' not found in any registered marketplace`);
  }
  if (matches.length > 1) {
    const names = matches.map((m) => m.marketplace.name).join(", ");
    throw new Error(`plugin '${pluginName}' ambiguous (in ${names}); specify @<marketplace>`);
  }
  return matches[0];
}
