import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { detectProjectKind } from "./projectKind.js";

const USER_MCODE_MD = `# Global mcode memory

This file is automatically loaded into the system prompt every time mcode runs.
Use it for **personal preferences and conventions that apply across every project**.

## Examples

- Reply in Japanese when I write in Japanese.
- Prefer TypeScript over JavaScript for new code.
- After editing a file, always run the project's test or type-check command.
- When making git commits, write the message in the same language as the surrounding context.
`;

const PROJECT_MCODE_MD = `# Project learnings

This file is automatically loaded into the system prompt when mcode runs in this project.
mcode can append entries here via the \`/learn TEXT\` REPL command (or \`appendProjectLearning()\` API).

## Initial notes

- Build:  \`npm run build\` (or whatever fits this project)
- Tests:  \`npm test\`
- Run:    \`npm run dev\`

Add anything mcode should remember the next time it works on this code:
- ...
`;

const PROJECT_MERCURY_MD = `# Project: <fill in name>

One-line description of what this project does.

## Stack

- Language / framework / key deps

## Conventions

- File layout
- Style rules
- Things mcode should NEVER do here

## How to verify changes

- \`<build command>\`
- \`<test command>\`
`;

function hooksTemplateFor(buildCmd: string | undefined, testCmd: string | undefined): string {
  const post: Array<{ matcher: string; command: string; timeout_ms?: number }> = [];
  if (buildCmd) {
    post.push({
      matcher: "write_file|edit_file|edit_with_ai",
      command: `${buildCmd} 2>&1 | tail -20 >&2 || echo '[mcode hook] build failed' >&2`,
      timeout_ms: 90_000,
    });
  }
  if (testCmd && testCmd !== buildCmd) {
    post.push({
      matcher: "write_file|edit_file|edit_with_ai",
      command: `${testCmd} 2>&1 | tail -10 >&2 || echo '[mcode hook] tests failed' >&2`,
      timeout_ms: 120_000,
    });
  }
  const obj = {
    PreToolUse: [
      {
        matcher: "bash",
        command:
          "jq -r '.tool_input.command' | grep -qE '^(rm -rf /|sudo rm|mkfs|dd if=)' && { echo 'destructive command blocked' >&2; exit 2; } || exit 0",
      },
    ],
    PostToolUse: post,
    SessionStart: [],
    SessionEnd: [],
  };
  return JSON.stringify(obj, null, 2) + "\n";
}

const MCP_TEMPLATE = `{
  "mcpServers": {}
}
`;

const PROJECT_GITIGNORE = `# mcode local state — opt-in: remove this entry to commit shared learnings
MCODE.md
`;

export interface BootstrapResult {
  homeCreated: string[];
  projectCreated: string[];
  alreadyInitialized: boolean;
}

/**
 * Ensure the user-global ~/.mcode/ skeleton exists. Idempotent.
 * Always runs at startup; silent unless something was actually created.
 */
export function ensureUserHome(): string[] {
  const root = join(homedir(), ".mcode");
  const created: string[] = [];

  const dirs = ["skills", "plugins", "commands", "sessions"];
  for (const sub of [".", ...dirs]) {
    const p = sub === "." ? root : join(root, sub);
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true });
      created.push(p);
    }
  }

  const memoryPath = join(root, "MCODE.md");
  if (!existsSync(memoryPath)) {
    writeFileSync(memoryPath, USER_MCODE_MD);
    created.push(memoryPath);
  }
  return created;
}

/**
 * Detect whether the cwd looks like a real project that warrants a `.mcode/`.
 * Returns true if .git, package.json, pyproject.toml, Cargo.toml, go.mod,
 * deno.json, build.gradle, or any common project marker is present.
 */
export function isProjectDir(cwd: string): boolean {
  const markers = [
    ".git",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "deno.json",
    "build.gradle",
    "build.gradle.kts",
    "Gemfile",
    "composer.json",
    "Pipfile",
    "requirements.txt",
  ];
  return markers.some((m) => existsSync(join(cwd, m)));
}

/**
 * Create `.mcode/` skeleton in `cwd`. Idempotent.
 * Returns the list of created paths (empty if `.mcode/` already exists).
 */
export function initProjectDir(cwd: string, opts: { withMercuryMd?: boolean } = {}): string[] {
  const root = join(cwd, ".mcode");
  const created: string[] = [];

  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
    created.push(root);
  }
  for (const sub of ["commands", "skills"]) {
    const p = join(root, sub);
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true });
      created.push(p);
    }
  }

  const proj = detectProjectKind(cwd);
  const files: Array<[string, string]> = [
    [join(root, "hooks.json"), hooksTemplateFor(proj.buildCmd, proj.testCmd)],
    [join(root, "mcp.json"), MCP_TEMPLATE],
    [join(root, "MCODE.md"), PROJECT_MCODE_MD],
    [join(root, ".gitignore"), PROJECT_GITIGNORE],
  ];
  for (const [path, body] of files) {
    if (!existsSync(path)) {
      writeFileSync(path, body);
      created.push(path);
    }
  }

  if (opts.withMercuryMd) {
    const mercury = join(cwd, "MERCURY.md");
    if (!existsSync(mercury)) {
      writeFileSync(mercury, PROJECT_MERCURY_MD);
      created.push(mercury);
    }
  }

  return created;
}

/**
 * Run startup bootstrap. Always ensures ~/.mcode/ silently.
 * Optionally auto-creates `.mcode/` in cwd when `autoInitProject` is true and
 * the cwd looks like a project. Returns the BootstrapResult so cli.ts can
 * surface a one-line summary.
 */
export function runBootstrap(opts: {
  cwd: string;
  autoInitProject: boolean;
  isInteractive: boolean;
}): BootstrapResult {
  const homeCreated = ensureUserHome();
  let projectCreated: string[] = [];
  let alreadyInitialized = true;

  const projectDir = join(opts.cwd, ".mcode");
  if (!existsSync(projectDir)) {
    alreadyInitialized = false;
    if (opts.autoInitProject && opts.isInteractive && isProjectDir(opts.cwd)) {
      projectCreated = initProjectDir(opts.cwd, { withMercuryMd: true });
    }
  }

  return { homeCreated, projectCreated, alreadyInitialized };
}

/**
 * Pretty-print the bootstrap result to stderr/stdout. Caller can choose to
 * skip if the result is uninteresting.
 */
export function printBootstrap(result: BootstrapResult): void {
  if (result.homeCreated.length) {
    const home = result.homeCreated[0];
    console.log(chalk.gray(`✓ initialized ${home} (+${result.homeCreated.length - 1} more)`));
  }
  if (result.projectCreated.length) {
    console.log(chalk.green(`✓ initialized .mcode/ in this project`));
    for (const p of result.projectCreated.slice(0, 6)) {
      console.log(chalk.gray("    " + p.replace(process.cwd() + "/", "")));
    }
    if (result.projectCreated.length > 6) {
      console.log(chalk.gray(`    … (+${result.projectCreated.length - 6} more)`));
    }
  }
}
