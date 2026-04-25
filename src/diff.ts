// Minimal LCS-based unified diff for visual edit_file approval.
import chalk from "chalk";

function lcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

export function unifiedDiff(oldStr: string, newStr: string, contextLines = 2): string {
  const a = oldStr.split("\n");
  const b = newStr.split("\n");
  const dp = lcs(a, b);

  type Op = { type: "ctx" | "del" | "add"; text: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: "ctx", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", text: a[i] });
      i++;
    } else {
      ops.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < a.length) ops.push({ type: "del", text: a[i++] });
  while (j < b.length) ops.push({ type: "add", text: b[j++] });

  const out: string[] = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === "ctx") {
      // Include only nearby context
      const nearChange = ops
        .slice(Math.max(0, k - contextLines), k + contextLines + 1)
        .some((o) => o.type !== "ctx");
      if (nearChange) out.push(chalk.gray("  " + op.text));
    } else if (op.type === "del") {
      out.push(chalk.red("- " + op.text));
    } else {
      out.push(chalk.green("+ " + op.text));
    }
  }
  return out.join("\n");
}
