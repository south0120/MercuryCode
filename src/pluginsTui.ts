// Claude Code-style /plugins TUI: tabbed browser with search.
// Uses raw-mode TTY + alternate screen buffer; restores terminal on exit.
import { emitKeypressEvents } from "node:readline";
import chalk from "chalk";
import {
  listMarketplaces,
  browseMarketplace,
  getMarketplace,
  addMarketplace,
  removeMarketplace,
  updateMarketplace,
  type MarketplacePlugin,
  type RegisteredMarketplace,
  findPluginInRegistry,
} from "./marketplace.js";
import {
  listInstalledPlugins,
  installPlugin,
  uninstallPlugin,
} from "./installer.js";

type TabId = "discover" | "installed" | "marketplaces";
const TABS: TabId[] = ["discover", "installed", "marketplaces"];
const TAB_LABEL: Record<TabId, string> = {
  discover: "Discover",
  installed: "Installed",
  marketplaces: "Marketplaces",
};

interface DiscoverItem {
  plugin: MarketplacePlugin;
  marketplace: RegisteredMarketplace;
  installed: boolean;
}

interface State {
  tab: TabId;
  search: string;
  cursor: number;
  scroll: number;
  discover: DiscoverItem[];
  installed: string[];
  marketplaces: RegisteredMarketplace[];
  errors: string[];
  status: string;
  detail: { item: DiscoverItem | string | RegisteredMarketplace; tab: TabId } | null;
  exit: boolean;
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function termSize(): { cols: number; rows: number } {
  return {
    cols: Math.max(40, process.stdout.columns || 80),
    rows: Math.max(15, process.stdout.rows || 24),
  };
}

function loadDiscover(): { items: DiscoverItem[]; errors: string[] } {
  const installed = new Set(listInstalledPlugins());
  const items: DiscoverItem[] = [];
  const errors: string[] = [];
  for (const mp of listMarketplaces()) {
    try {
      for (const p of browseMarketplace(mp.name)) {
        items.push({ plugin: p, marketplace: mp, installed: installed.has(p.name) });
      }
    } catch (e) {
      errors.push(`${mp.name}: ${(e as Error).message}`);
    }
  }
  return { items, errors };
}

function reloadAll(): Pick<State, "discover" | "installed" | "marketplaces" | "errors"> {
  const d = loadDiscover();
  return {
    discover: d.items,
    installed: listInstalledPlugins(),
    marketplaces: listMarketplaces(),
    errors: d.errors,
  };
}

function filterDiscover(items: DiscoverItem[], q: string): DiscoverItem[] {
  if (!q) return items;
  const lq = q.toLowerCase();
  return items.filter(
    (i) =>
      i.plugin.name.toLowerCase().includes(lq) ||
      (i.plugin.description ?? "").toLowerCase().includes(lq) ||
      i.marketplace.name.toLowerCase().includes(lq),
  );
}

function filterInstalled(names: string[], q: string): string[] {
  if (!q) return names;
  const lq = q.toLowerCase();
  return names.filter((n) => n.toLowerCase().includes(lq));
}

function filterMarketplaces(mps: RegisteredMarketplace[], q: string): RegisteredMarketplace[] {
  if (!q) return mps;
  const lq = q.toLowerCase();
  return mps.filter((m) => m.name.toLowerCase().includes(lq));
}

export async function runPluginsTui(): Promise<void> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  const initial = reloadAll();
  const state: State = {
    tab: "discover",
    search: "",
    cursor: 0,
    scroll: 0,
    discover: initial.discover,
    installed: initial.installed,
    marketplaces: initial.marketplaces,
    errors: initial.errors,
    status: "",
    detail: null,
    exit: false,
  };

  return new Promise<void>((resolve) => {
    let stopped = false;

    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      stdin.removeListener("keypress", onKey);
      try {
        stdin.setRawMode?.(false);
      } catch {}
      stdin.pause();
      stdout.write("\x1b[?25h"); // show cursor
      stdout.write("\x1b[?1049l"); // leave alt screen
      stdout.write("\n");
      resolve();
    };

    function listLength(): number {
      if (state.tab === "discover") return filterDiscover(state.discover, state.search).length;
      if (state.tab === "installed") return filterInstalled(state.installed, state.search).length;
      return filterMarketplaces(state.marketplaces, state.search).length;
    }

    function clampCursor() {
      const n = listLength();
      if (n === 0) {
        state.cursor = 0;
        state.scroll = 0;
        return;
      }
      if (state.cursor >= n) state.cursor = n - 1;
      if (state.cursor < 0) state.cursor = 0;
    }

    function viewportRows(): number {
      const { rows } = termSize();
      // Reserve: header (3) + tabs (2) + count (2) + search (3) + footer (3) = ~13 rows.
      return Math.max(3, rows - 13);
    }

    function ensureCursorVisible() {
      const view = viewportRows();
      // Each item takes ~2 rows (title + description). Estimate.
      const itemRows = 3;
      const visibleItems = Math.max(1, Math.floor(view / itemRows));
      if (state.cursor < state.scroll) state.scroll = state.cursor;
      if (state.cursor >= state.scroll + visibleItems) state.scroll = state.cursor - visibleItems + 1;
    }

    function render() {
      stdout.write("\x1b[2J\x1b[H"); // clear screen + home
      const { cols } = termSize();

      // ── Tab bar ──────────────────────────────────────────────────────
      const tabLine = TABS.map((t) => {
        const lbl = ` ${TAB_LABEL[t]} `;
        return t === state.tab
          ? chalk.bgWhite.black.bold(lbl)
          : chalk.gray(lbl);
      }).join(" ");
      const errSuffix = state.errors.length
        ? "  " + chalk.red(`Errors (${state.errors.length})`)
        : "";
      stdout.write(`  ${tabLine}${errSuffix}\n\n`);
      stdout.write(chalk.gray("─".repeat(cols)) + "\n\n");

      // ── Search box & count ──────────────────────────────────────────
      let total = 0;
      let label = "";
      if (state.tab === "discover") {
        total = state.discover.length;
        label = "Discover plugins";
      } else if (state.tab === "installed") {
        total = state.installed.length;
        label = "Installed plugins";
      } else {
        total = state.marketplaces.length;
        label = "Marketplaces";
      }
      const visible = listLength();
      stdout.write(
        chalk.bold(label) + chalk.gray(`  (${visible}/${total})`) + "\n\n",
      );
      stdout.write(
        chalk.gray("┌─ ") +
          chalk.cyan("Search ") +
          chalk.gray("·") +
          " " +
          (state.search || chalk.gray("type to filter…")) +
          "\n\n",
      );

      // ── Body ──────────────────────────────────────────────────────────
      if (state.detail) {
        renderDetail(state.detail);
      } else if (state.tab === "discover") {
        renderDiscover();
      } else if (state.tab === "installed") {
        renderInstalled();
      } else {
        renderMarketplaces();
      }

      // ── Status & footer ──────────────────────────────────────────────
      stdout.write("\n");
      if (state.status) stdout.write(chalk.yellow(state.status) + "\n");
      stdout.write(chalk.gray("─".repeat(cols)) + "\n");
      stdout.write(footerHints() + "\n");
    }

    function footerHints(): string {
      if (state.detail) {
        return chalk.gray(
          "Esc/Enter back" +
            (state.detail.tab === "discover" ? "  ·  i install" : "") +
            (state.detail.tab === "installed" ? "  ·  d uninstall" : "") +
            (state.detail.tab === "marketplaces" ? "  ·  u update  ·  r remove" : ""),
        );
      }
      const common = "type to search  ·  ↑↓ move  ·  Tab next pane  ·  Esc/q exit";
      if (state.tab === "discover")
        return chalk.gray("Enter details  ·  i install  ·  " + common);
      if (state.tab === "installed")
        return chalk.gray("Enter details  ·  d uninstall  ·  " + common);
      return chalk.gray(
        "Enter browse  ·  u update  ·  r remove  ·  a add (prompts shell)  ·  " + common,
      );
    }

    function renderDiscover() {
      const items = filterDiscover(state.discover, state.search);
      if (!items.length) {
        if (!state.discover.length) {
          stdout.write(chalk.gray("  (no marketplaces yet — switch to Marketplaces tab to add one)\n"));
        } else {
          stdout.write(chalk.gray("  (no matches)\n"));
        }
        return;
      }
      const view = viewportRows();
      const itemRows = 3;
      const visibleCount = Math.max(1, Math.floor(view / itemRows));
      const end = Math.min(items.length, state.scroll + visibleCount);
      for (let i = state.scroll; i < end; i++) {
        const it = items[i];
        const sel = i === state.cursor;
        const arrow = sel ? chalk.cyan("›") : " ";
        const tick = it.installed ? chalk.green("●") : chalk.gray("○");
        const name = sel ? chalk.bold.cyan(it.plugin.name) : chalk.cyan(it.plugin.name);
        const meta = chalk.gray(`· ${it.marketplace.name}`);
        const ver = it.plugin.version ? chalk.gray(` v${it.plugin.version}`) : "";
        const inst = it.installed ? chalk.green("  [installed]") : "";
        stdout.write(`${arrow} ${tick} ${name} ${meta}${ver}${inst}\n`);
        const desc = (it.plugin.description ?? "").slice(0, termSize().cols - 6);
        stdout.write(chalk.gray(`    ${desc}\n\n`));
      }
      if (end < items.length) stdout.write(chalk.gray(`  ↓ ${items.length - end} more below\n`));
      if (state.scroll > 0) stdout.write(chalk.gray(`  ↑ ${state.scroll} above\n`));
    }

    function renderInstalled() {
      const items = filterInstalled(state.installed, state.search);
      if (!items.length) {
        stdout.write(chalk.gray("  (no plugins installed)\n"));
        return;
      }
      const view = viewportRows();
      const visibleCount = Math.max(1, view);
      const end = Math.min(items.length, state.scroll + visibleCount);
      for (let i = state.scroll; i < end; i++) {
        const sel = i === state.cursor;
        const arrow = sel ? chalk.cyan("›") : " ";
        const name = sel ? chalk.bold.magenta(items[i]) : chalk.magenta(items[i]);
        stdout.write(`${arrow} ${chalk.gray("●")} ${name}\n`);
      }
    }

    function renderMarketplaces() {
      const items = filterMarketplaces(state.marketplaces, state.search);
      if (!items.length) {
        if (!state.marketplaces.length) {
          stdout.write(chalk.gray("  (no marketplaces — exit and run /plugin marketplace add <source>)\n"));
        } else {
          stdout.write(chalk.gray("  (no matches)\n"));
        }
        return;
      }
      const view = viewportRows();
      const visibleCount = Math.max(1, Math.floor(view / 2));
      const end = Math.min(items.length, state.scroll + visibleCount);
      for (let i = state.scroll; i < end; i++) {
        const m = items[i];
        const sel = i === state.cursor;
        const arrow = sel ? chalk.cyan("›") : " ";
        const name = sel ? chalk.bold.cyan(m.name) : chalk.cyan(m.name);
        const src =
          m.source.source === "github"
            ? `github:${m.source.repo}`
            : m.source.source === "url"
              ? `url:${m.source.url}`
              : `local:${m.source.path}`;
        stdout.write(`${arrow} ${chalk.gray("◆")} ${name}\n`);
        stdout.write(chalk.gray(`    ${src}\n\n`));
      }
    }

    function renderDetail(d: NonNullable<State["detail"]>) {
      stdout.write("\n");
      if (d.tab === "discover") {
        const it = d.item as DiscoverItem;
        stdout.write(chalk.bold.cyan(`  ${it.plugin.name}`) + chalk.gray(`  v${it.plugin.version ?? "—"}`) + "\n");
        stdout.write(chalk.gray(`  from ${it.marketplace.name}\n\n`));
        if (it.plugin.description) stdout.write(`  ${it.plugin.description}\n\n`);
        if (it.plugin.author) stdout.write(chalk.gray(`  author:   ${typeof it.plugin.author === "object" ? it.plugin.author.name : it.plugin.author}\n`));
        if (it.plugin.homepage) stdout.write(chalk.gray(`  homepage: ${it.plugin.homepage}\n`));
        if (it.plugin.repository) stdout.write(chalk.gray(`  repo:     ${it.plugin.repository}\n`));
        if (it.plugin.license) stdout.write(chalk.gray(`  license:  ${it.plugin.license}\n`));
        if (it.plugin.tags?.length) stdout.write(chalk.gray(`  tags:     ${it.plugin.tags.join(", ")}\n`));
        const src = JSON.stringify(it.plugin.source);
        stdout.write(chalk.gray(`  source:   ${src.length > 100 ? src.slice(0, 100) + "…" : src}\n`));
        stdout.write("\n  Press " + chalk.cyan("i") + " to install" + (it.installed ? chalk.green(" (already installed)") : "") + "\n");
      } else if (d.tab === "installed") {
        const name = d.item as string;
        stdout.write(chalk.bold.magenta(`  ${name}\n\n`));
        stdout.write(chalk.gray(`  ~/.mcode/plugins/${name}\n\n`));
        stdout.write("  Press " + chalk.cyan("d") + " to uninstall\n");
      } else {
        const m = d.item as RegisteredMarketplace;
        stdout.write(chalk.bold.cyan(`  ${m.name}\n\n`));
        stdout.write(chalk.gray(`  source: ${JSON.stringify(m.source)}\n`));
        stdout.write(chalk.gray(`  added:  ${m.added_at}\n`));
        stdout.write(chalk.gray(`  cache:  ${m.cache_dir}\n\n`));
        stdout.write("  Press " + chalk.cyan("u") + " to update or " + chalk.cyan("r") + " to remove\n");
      }
    }

    async function doInstall(it: DiscoverItem) {
      state.status = `installing ${it.plugin.name}…`;
      render();
      try {
        const found = findPluginInRegistry(it.plugin.name, it.marketplace.name);
        const r = await installPlugin(found.plugin, found.marketplace);
        state.status = `✓ installed ${it.plugin.name}${r.version ? " v" + r.version : ""} (restart mcode to load)`;
        const fresh = reloadAll();
        Object.assign(state, fresh);
      } catch (e) {
        state.status = `✗ ${(e as Error).message}`;
      }
      render();
    }

    async function doUninstall(name: string) {
      if (!uninstallPlugin(name)) {
        state.status = `not installed: ${name}`;
      } else {
        state.status = `✓ uninstalled ${name}`;
        const fresh = reloadAll();
        Object.assign(state, fresh);
      }
      render();
    }

    async function doMarketplaceUpdate(m: RegisteredMarketplace) {
      state.status = `updating ${m.name}…`;
      render();
      try {
        await updateMarketplace(m.name);
        state.status = `✓ updated ${m.name}`;
        const fresh = reloadAll();
        Object.assign(state, fresh);
      } catch (e) {
        state.status = `✗ ${(e as Error).message}`;
      }
      render();
    }

    async function doMarketplaceRemove(m: RegisteredMarketplace) {
      removeMarketplace(m.name);
      state.status = `✓ removed ${m.name}`;
      const fresh = reloadAll();
      Object.assign(state, fresh);
      state.detail = null;
      clampCursor();
      render();
    }

    function currentItemAtCursor(): unknown {
      if (state.tab === "discover") return filterDiscover(state.discover, state.search)[state.cursor];
      if (state.tab === "installed") return filterInstalled(state.installed, state.search)[state.cursor];
      return filterMarketplaces(state.marketplaces, state.search)[state.cursor];
    }

    const onKey = async (
      ch: string | undefined,
      key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string } | undefined,
    ) => {
      if (!key) return;
      // global exits
      if ((key.ctrl && key.name === "c") || (key.name === "escape" && !state.detail)) {
        cleanup();
        return;
      }
      if (key.name === "escape" && state.detail) {
        state.detail = null;
        render();
        return;
      }

      if (state.detail) {
        if (key.name === "return") {
          state.detail = null;
          render();
          return;
        }
        if (state.detail.tab === "discover" && (ch === "i" || ch === "I")) {
          await doInstall(state.detail.item as DiscoverItem);
          return;
        }
        if (state.detail.tab === "installed" && (ch === "d" || ch === "D")) {
          await doUninstall(state.detail.item as string);
          state.detail = null;
          render();
          return;
        }
        if (state.detail.tab === "marketplaces") {
          if (ch === "u" || ch === "U") {
            await doMarketplaceUpdate(state.detail.item as RegisteredMarketplace);
            return;
          }
          if (ch === "r" || ch === "R") {
            await doMarketplaceRemove(state.detail.item as RegisteredMarketplace);
            return;
          }
        }
        return;
      }

      if (key.name === "tab" && !key.shift) {
        const idx = TABS.indexOf(state.tab);
        state.tab = TABS[(idx + 1) % TABS.length];
        state.search = "";
        state.cursor = 0;
        state.scroll = 0;
        state.status = "";
        render();
        return;
      }
      if ((key.name === "tab" && key.shift) || (key.shift && key.name === "tab")) {
        const idx = TABS.indexOf(state.tab);
        state.tab = TABS[(idx - 1 + TABS.length) % TABS.length];
        state.search = "";
        state.cursor = 0;
        state.scroll = 0;
        state.status = "";
        render();
        return;
      }
      if (key.name === "up") {
        state.cursor = Math.max(0, state.cursor - 1);
        ensureCursorVisible();
        render();
        return;
      }
      if (key.name === "down") {
        state.cursor = Math.min(listLength() - 1, state.cursor + 1);
        ensureCursorVisible();
        render();
        return;
      }
      if (key.name === "pageup") {
        state.cursor = Math.max(0, state.cursor - 10);
        ensureCursorVisible();
        render();
        return;
      }
      if (key.name === "pagedown") {
        state.cursor = Math.min(listLength() - 1, state.cursor + 10);
        ensureCursorVisible();
        render();
        return;
      }
      if (key.name === "return") {
        const item = currentItemAtCursor();
        if (!item) return;
        state.detail = { item: item as never, tab: state.tab };
        render();
        return;
      }
      if (key.name === "backspace") {
        state.search = state.search.slice(0, -1);
        state.cursor = 0;
        state.scroll = 0;
        render();
        return;
      }
      // single-char actions on list rows
      if (state.tab === "discover" && (ch === "i" || ch === "I") && !state.search) {
        const it = currentItemAtCursor() as DiscoverItem | undefined;
        if (it) await doInstall(it);
        return;
      }
      if (state.tab === "installed" && (ch === "d" || ch === "D") && !state.search) {
        const n = currentItemAtCursor() as string | undefined;
        if (n) await doUninstall(n);
        return;
      }
      if (state.tab === "marketplaces" && !state.search) {
        if (ch === "u" || ch === "U") {
          const m = currentItemAtCursor() as RegisteredMarketplace | undefined;
          if (m) await doMarketplaceUpdate(m);
          return;
        }
        if (ch === "r" || ch === "R") {
          const m = currentItemAtCursor() as RegisteredMarketplace | undefined;
          if (m) await doMarketplaceRemove(m);
          return;
        }
      }
      if (ch === "q" && !state.search) {
        cleanup();
        return;
      }
      // typed character → search filter
      const seq = ch ?? key.sequence ?? "";
      if (seq && !key.ctrl && !key.meta && seq.length >= 1) {
        const printable = Array.from(seq).filter((c) => c.codePointAt(0)! >= 0x20).join("");
        if (printable) {
          state.search += printable;
          state.cursor = 0;
          state.scroll = 0;
          state.status = "";
          render();
        }
      }
    };

    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKey);
    stdout.write("\x1b[?1049h"); // alt screen
    stdout.write("\x1b[?25l"); // hide cursor
    render();
  });
}
