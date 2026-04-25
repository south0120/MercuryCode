import { spawn } from "node:child_process";
import { extname } from "node:path";
import { readFileSync } from "node:fs";

export interface SyntaxCheckResult {
  ok: boolean;
  reason?: string;
  // null when no checker is applicable for this extension.
  checked: boolean;
}

const TIMEOUT_MS = 5_000;

function runOnce(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -127, stderr: "(spawn failed)" });
    });
  });
}

/**
 * Cheap, fast syntax-only check for the given file. Skips files we have no
 * checker for. Never throws — returns { ok: false, reason } on failure.
 *
 * Note: this is *syntax* only, not type checking. Type errors are intentionally
 * out of scope here (would require tsc which is too slow per-edit).
 */
export async function checkSyntax(path: string): Promise<SyntaxCheckResult> {
  const ext = extname(path).toLowerCase();
  // JSON: parse with the JS engine.
  if (ext === ".json") {
    try {
      JSON.parse(readFileSync(path, "utf8"));
      return { ok: true, checked: true };
    } catch (e) {
      return { ok: false, reason: (e as Error).message, checked: true };
    }
  }
  // JS / MJS / CJS: node --check
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    const { code, stderr } = await runOnce("node", ["--check", path]);
    if (code === 0) return { ok: true, checked: true };
    if (code === -127) return { ok: true, checked: false };
    return { ok: false, reason: stderr.split("\n").slice(0, 3).join("\n"), checked: true };
  }
  // TS / TSX: node --check on the .ts file works for surface-level syntax in many cases,
  // but legitimate TS-only constructs will trip it. Use it as a soft gate only.
  if (ext === ".ts" || ext === ".tsx" || ext === ".cts" || ext === ".mts") {
    const { code, stderr } = await runOnce("node", ["--check", path]);
    if (code === 0) return { ok: true, checked: true };
    if (code === -127) return { ok: true, checked: false };
    // Filter out errors that are TS-specific syntax (type annotations etc.); we tolerate those.
    if (/SyntaxError: Unexpected token .?:/.test(stderr) ||
        /SyntaxError: Missing initializer in const declaration/.test(stderr) ||
        /interface|type [A-Z]/.test(stderr)) {
      return { ok: true, checked: false };
    }
    return { ok: false, reason: stderr.split("\n").slice(0, 3).join("\n"), checked: true };
  }
  // Python: py_compile via python3
  if (ext === ".py") {
    const { code, stderr } = await runOnce("python3", [
      "-c",
      `import py_compile,sys; py_compile.compile(${JSON.stringify(path)}, doraise=True)`,
    ]);
    if (code === 0) return { ok: true, checked: true };
    if (code === -127) return { ok: true, checked: false };
    return { ok: false, reason: stderr.split("\n").slice(0, 3).join("\n"), checked: true };
  }
  return { ok: true, checked: false };
}
