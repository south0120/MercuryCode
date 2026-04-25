import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  body: string;
  source: "project" | "user" | "plugin";
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

function loadSkillFile(path: string, source: Skill["source"]): Skill | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(raw);
  const name = meta.name || meta.id;
  const description = meta.description || meta.desc;
  if (!name || !description) return null;
  return { name, description, body, source, path };
}

function scanSkillsDir(dir: string, source: Skill["source"]): Skill[] {
  if (!existsSync(dir)) return [];
  const out: Skill[] = [];
  for (const entry of readdirSync(dir)) {
    const sub = join(dir, entry);
    let s: Skill | null = null;
    try {
      const st = statSync(sub);
      if (st.isDirectory()) {
        const file = join(sub, "SKILL.md");
        if (existsSync(file)) s = loadSkillFile(file, source);
      } else if (st.isFile() && entry.endsWith(".md")) {
        s = loadSkillFile(sub, source);
      }
    } catch {
      continue;
    }
    if (s) out.push(s);
  }
  return out;
}

export function loadSkills(extraDirs: string[] = []): Skill[] {
  const project = scanSkillsDir(join(process.cwd(), ".mcode", "skills"), "project");
  const user = scanSkillsDir(join(homedir(), ".mcode", "skills"), "user");
  const plugin = extraDirs.flatMap((d) => scanSkillsDir(d, "plugin"));
  // De-duplicate by name; project shadows plugin shadows user.
  const map = new Map<string, Skill>();
  for (const s of [...user, ...plugin, ...project]) map.set(s.name, s);
  return [...map.values()];
}

export function skillsCatalog(skills: Skill[]): string {
  if (!skills.length) return "";
  const lines = skills.map(
    (s) => `- ${s.name} (${s.source}): ${s.description}`,
  );
  return ["\n# Available skills (call invoke_skill(name) to load detailed instructions)", ...lines].join(
    "\n",
  );
}
