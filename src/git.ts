import { spawn } from "node:child_process";

export interface GitOptions {
  cwd?: string;
  ref?: string;
  depth?: number;
}

function run(args: string[], opts: { cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(" ")} failed (exit ${code}): ${stderr.trim()}`));
    });
    child.on("error", reject);
  });
}

export async function gitClone(repoUrl: string, dest: string, opts: GitOptions = {}): Promise<void> {
  const args = ["clone"];
  if (opts.depth) args.push("--depth", String(opts.depth));
  if (opts.ref) args.push("--branch", opts.ref);
  args.push(repoUrl, dest);
  await run(args);
}

export async function gitPull(dir: string): Promise<void> {
  await run(["pull", "--ff-only"], { cwd: dir });
}

export async function gitHeadSha(dir: string): Promise<string> {
  return (await run(["rev-parse", "HEAD"], { cwd: dir })).trim();
}

export async function gitCheckout(dir: string, ref: string): Promise<void> {
  await run(["fetch", "origin", ref], { cwd: dir });
  await run(["checkout", ref], { cwd: dir });
}
