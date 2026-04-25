import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectKind =
  | "node"
  | "python"
  | "rust"
  | "go"
  | "deno"
  | "ruby"
  | "java"
  | "unknown";

export interface ProjectInfo {
  kind: ProjectKind;
  testCmd?: string;
  buildCmd?: string;
  runCmd?: string;
  /** Path to the manifest file that drove detection. */
  marker?: string;
}

export function detectProjectKind(cwd: string = process.cwd()): ProjectInfo {
  // Node / npm: try to detect actual scripts
  const pkgJson = join(cwd, "package.json");
  if (existsSync(pkgJson)) {
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(readFileSync(pkgJson, "utf8")).scripts ?? {}) as Record<string, string>;
    } catch {}
    const has = (k: string) => typeof scripts[k] === "string";
    return {
      kind: "node",
      testCmd: has("test") ? "npm test" : undefined,
      buildCmd: has("build") ? "npm run build" : undefined,
      runCmd: has("dev") ? "npm run dev" : has("start") ? "npm start" : undefined,
      marker: pkgJson,
    };
  }

  if (existsSync(join(cwd, "deno.json")) || existsSync(join(cwd, "deno.jsonc"))) {
    return {
      kind: "deno",
      testCmd: "deno test",
      buildCmd: "deno check **/*.ts",
      runCmd: "deno run --allow-all main.ts",
      marker: join(cwd, "deno.json"),
    };
  }

  if (existsSync(join(cwd, "Cargo.toml"))) {
    return {
      kind: "rust",
      testCmd: "cargo test",
      buildCmd: "cargo build",
      runCmd: "cargo run",
      marker: join(cwd, "Cargo.toml"),
    };
  }

  if (existsSync(join(cwd, "go.mod"))) {
    return {
      kind: "go",
      testCmd: "go test ./...",
      buildCmd: "go build ./...",
      runCmd: "go run .",
      marker: join(cwd, "go.mod"),
    };
  }

  if (existsSync(join(cwd, "pyproject.toml"))) {
    return {
      kind: "python",
      testCmd: "pytest -q",
      // Use ruff if hinted, else basic syntax check via py_compile
      buildCmd: undefined,
      runCmd: "python3 -m main",
      marker: join(cwd, "pyproject.toml"),
    };
  }
  if (existsSync(join(cwd, "requirements.txt")) || existsSync(join(cwd, "Pipfile"))) {
    return {
      kind: "python",
      testCmd: "pytest -q",
      runCmd: "python3 main.py",
      marker: existsSync(join(cwd, "Pipfile")) ? join(cwd, "Pipfile") : join(cwd, "requirements.txt"),
    };
  }

  if (existsSync(join(cwd, "Gemfile"))) {
    return { kind: "ruby", testCmd: "bundle exec rspec", marker: join(cwd, "Gemfile") };
  }

  if (existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) {
    return {
      kind: "java",
      testCmd: "./gradlew test",
      buildCmd: "./gradlew build",
      marker: join(cwd, "build.gradle"),
    };
  }

  return { kind: "unknown" };
}
