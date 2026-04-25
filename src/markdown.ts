// Streaming markdown renderer for terminal output.
// Buffers tokens until newline, then emits each completed line with ANSI styling.
// Tracks fenced code blocks (```) so their contents render verbatim with a left
// gutter and aren't interpreted as markdown.
import chalk from "chalk";

const FENCE_RE = /^```/;
const CODE_PLACEHOLDER_PREFIX = "MD-CODE-";
const CODE_PLACEHOLDER_SUFFIX = "";
const CODE_PLACEHOLDER_RE = /MD-CODE-(\d+)/g;

export class MarkdownStream {
  private buffer = "";
  private inFence = false;
  private fenceLang = "";

  write(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const nl = this.buffer.indexOf("\n");
      if (nl < 0) break;
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      this.emit(line);
    }
  }

  end(): void {
    if (this.buffer) this.emit(this.buffer);
    this.buffer = "";
    if (this.inFence) {
      process.stdout.write(chalk.gray("└─\n"));
      this.inFence = false;
      this.fenceLang = "";
    }
  }

  private emit(line: string): void {
    if (this.inFence) {
      if (FENCE_RE.test(line.trim())) {
        process.stdout.write(chalk.gray(`└─${this.fenceLang ? " " + this.fenceLang : ""}\n`));
        this.inFence = false;
        this.fenceLang = "";
        return;
      }
      process.stdout.write(chalk.gray("│ ") + chalk.cyan(line) + "\n");
      return;
    }
    if (FENCE_RE.test(line.trim())) {
      this.fenceLang = line.trim().slice(3).trim();
      process.stdout.write(chalk.gray(`┌─${this.fenceLang ? " " + this.fenceLang : ""}\n`));
      this.inFence = true;
      return;
    }
    process.stdout.write(formatLine(line) + "\n");
  }
}

function formatLine(line: string): string {
  if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
    return chalk.gray("─".repeat(40));
  }
  const h = line.match(/^(#{1,6})\s+(.+)$/);
  if (h) {
    const level = h[1].length;
    const text = applyInline(h[2]);
    if (level === 1) return chalk.bold.cyan("▎ ") + chalk.bold.underline(text);
    if (level === 2) return chalk.bold.cyan("▎ ") + chalk.bold(text);
    if (level === 3) return chalk.cyan("▎ ") + chalk.bold(text);
    return chalk.gray("▎ ") + chalk.bold.gray(text);
  }
  const q = line.match(/^\s*>\s?(.*)$/);
  if (q) return chalk.gray("│ ") + chalk.italic.gray(applyInline(q[1]));
  const b = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (b) return b[1] + chalk.cyan("• ") + applyInline(b[3]);
  const n = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (n) return n[1] + chalk.cyan(n[2] + ".") + " " + applyInline(n[3]);
  return applyInline(line);
}

function applyInline(s: string): string {
  const placeholders: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_, t) => {
    placeholders.push(chalk.cyan(t));
    return `${CODE_PLACEHOLDER_PREFIX}${placeholders.length - 1}${CODE_PLACEHOLDER_SUFFIX}`;
  });

  // Bold first (greedy non-conflicting), then italic.
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, (_, t) => chalk.bold(t));
  s = s.replace(/__([^_\n]+?)__/g, (_, t) => chalk.bold(t));
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, (_, pre, t) => pre + chalk.italic(t));
  s = s.replace(/(^|[^_a-zA-Z0-9])_([^_\s][^_]*?)_(?![_a-zA-Z0-9])/g, (_, pre, t) => pre + chalk.italic(t));
  s = s.replace(/~~([^~\n]+?)~~/g, (_, t) => chalk.strikethrough(t));
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) =>
    chalk.underline.cyan(text) + chalk.gray(` ${url}`),
  );
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s)]+)/g, (_, pre, url) => pre + chalk.underline.cyan(url));

  s = s.replace(CODE_PLACEHOLDER_RE, (_, n) => placeholders[Number(n)]);
  return s;
}
