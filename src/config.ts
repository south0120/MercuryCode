import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import prompts from "prompts";

const HOME_DIR = join(homedir(), ".mcode");
const LEGACY_HOME_DIR = join(homedir(), ".merc");
const CONFIG_PATH = join(HOME_DIR, "config.json");
const LEGACY_CONFIG_PATH = join(LEGACY_HOME_DIR, "config.json");
export const SESSIONS_DIR = join(HOME_DIR, "sessions");

export interface MercConfig {
  apiKey: string;
  defaultModel?: string;
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function readSavedConfig(): Partial<MercConfig> {
  const path = existsSync(CONFIG_PATH)
    ? CONFIG_PATH
    : existsSync(LEGACY_CONFIG_PATH)
      ? LEGACY_CONFIG_PATH
      : null;
  if (!path) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg: MercConfig) {
  ensureDir(HOME_DIR);
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {}
}

export async function loadConfig(): Promise<MercConfig> {
  loadDotenv({ path: join(process.cwd(), ".env"), quiet: true });
  loadDotenv({ path: join(homedir(), "Mercury", ".env"), quiet: true });

  const envKey =
    process.env.INCEPTION_API_KEY || process.env.MCODE_API_KEY || process.env.MERC_API_KEY;
  const saved = readSavedConfig();

  let apiKey = envKey || saved.apiKey;

  if (!apiKey) {
    const { key } = await prompts({
      type: "password",
      name: "key",
      message: "Inception Labs API key (sk_...)",
    });
    if (!key) {
      console.error("mcode: no API key provided");
      process.exit(1);
    }
    apiKey = key as string;
    saveConfig({ apiKey, defaultModel: saved.defaultModel });
    console.error(`mcode: saved key to ${CONFIG_PATH}`);
  }

  ensureDir(SESSIONS_DIR);

  return { apiKey, defaultModel: saved.defaultModel || "mercury-2" };
}
