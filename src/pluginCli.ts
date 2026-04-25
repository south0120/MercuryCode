import chalk from "chalk";
import {
  addMarketplace,
  listMarketplaces,
  removeMarketplace,
  updateMarketplace,
  browseMarketplace,
  getMarketplace,
  findPluginInRegistry,
} from "./marketplace.js";
import { installPlugin, uninstallPlugin, listInstalledPlugins } from "./installer.js";
import { ui } from "./ui.js";

/**
 * `mcode plugin <subcommand>` — non-REPL CLI surface for marketplace/install ops.
 * Designed for CI scripts and dotfile bootstraps where the REPL isn't suitable.
 * Returns a process exit code (0 = success).
 */
export async function runPluginCli(argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
    printHelp();
    return 0;
  }
  try {
    switch (sub) {
      case "list":
        for (const n of listInstalledPlugins()) console.log(n);
        return 0;

      case "install": {
        if (!rest[0]) {
          ui.error("usage: mcode plugin install <name>[@<marketplace>]");
          return 1;
        }
        const [name, mp] = rest[0].split("@");
        const found = findPluginInRegistry(name, mp);
        const r = await installPlugin(found.plugin, found.marketplace);
        console.log(`installed ${found.plugin.name}${r.version ? ` v${r.version}` : ""} → ${r.destDir}`);
        return 0;
      }

      case "uninstall":
        if (!rest[0]) {
          ui.error("usage: mcode plugin uninstall <name>");
          return 1;
        }
        if (uninstallPlugin(rest[0])) {
          console.log(`uninstalled ${rest[0]}`);
          return 0;
        }
        ui.error(`not installed: ${rest[0]}`);
        return 1;

      case "browse": {
        const mpName = rest[0];
        const all = listMarketplaces();
        if (mpName) {
          const mp = getMarketplace(mpName);
          if (!mp) {
            ui.error(`unknown marketplace: ${mpName}`);
            console.log(
              all.length
                ? `  registered: ${all.map((m) => m.name).join(", ")}`
                : "  (no marketplaces yet; mcode plugin marketplace add <owner/repo>)",
            );
            return 1;
          }
          const plugins = browseMarketplace(mp.name);
          console.log(`\n=== ${mp.name} ===`);
          for (const p of plugins) {
            console.log(`  ${p.name.padEnd(28)} ${p.description ?? ""}`);
          }
          console.log(`\ninstall with: mcode plugin install <name>@${mp.name}`);
          return 0;
        }
        if (!all.length) {
          ui.error("no marketplaces registered");
          console.log("  Add one with:");
          console.log("    mcode plugin marketplace add owner/repo     # any GitHub repo");
          console.log("    mcode plugin marketplace add ./local/path   # local dir");
          console.log("    mcode plugin marketplace add https://...git # any git URL");
          return 1;
        }
        for (const mp of all) {
          console.log(`\n=== ${mp.name} ===`);
          for (const p of browseMarketplace(mp.name)) {
            console.log(`  ${p.name.padEnd(28)} ${p.description ?? ""}`);
          }
          console.log(`  install with: mcode plugin install <name>@${mp.name}`);
        }
        return 0;
      }

      case "marketplace": {
        const mpSub = rest[0] ?? "list";
        const mpRest = rest.slice(1);
        if (mpSub === "add") {
          if (!mpRest[0]) {
            ui.error("usage: mcode plugin marketplace add <source>");
            return 1;
          }
          const r = await addMarketplace(mpRest[0]);
          console.log(`added marketplace '${r.name}' (cache: ${r.cache_dir})`);
          return 0;
        }
        if (mpSub === "list") {
          for (const m of listMarketplaces()) {
            const src =
              m.source.source === "github"
                ? `github:${m.source.repo}`
                : m.source.source === "url"
                  ? `url:${m.source.url}`
                  : `local:${m.source.path}`;
            console.log(`${m.name}\t${src}`);
          }
          return 0;
        }
        if (mpSub === "remove") {
          if (!mpRest[0]) {
            ui.error("usage: mcode plugin marketplace remove <name>");
            return 1;
          }
          if (removeMarketplace(mpRest[0])) {
            console.log(`removed marketplace '${mpRest[0]}'`);
            return 0;
          }
          ui.error(`unknown marketplace: ${mpRest[0]}`);
          return 1;
        }
        if (mpSub === "update") {
          const targets = mpRest[0] ? [mpRest[0]] : listMarketplaces().map((m) => m.name);
          for (const n of targets) {
            try {
              await updateMarketplace(n);
              console.log(`updated ${n}`);
            } catch (e) {
              ui.error(`${n}: ${(e as Error).message}`);
            }
          }
          return 0;
        }
        ui.error(`unknown marketplace subcommand: ${mpSub}`);
        return 1;
      }

      default:
        ui.error(`unknown subcommand: ${sub}`);
        printHelp();
        return 1;
    }
  } catch (e) {
    ui.error((e as Error).message);
    return 1;
  }
}

function printHelp(): void {
  console.log(
    [
      "Usage: mcode plugin <subcommand>",
      "",
      "  list                          installed plugins (one per line)",
      "  install <name>[@<mp>]         install a plugin from a registered marketplace",
      "  uninstall <name>              remove an installed plugin",
      "  browse [marketplace]          list plugins from one or all marketplaces",
      "",
      "  marketplace add <source>      register a marketplace (owner/repo, URL, or ./path)",
      "  marketplace list              registered marketplaces",
      "  marketplace remove <name>     unregister a marketplace",
      "  marketplace update [name]     git-pull marketplace cache(s)",
      "",
      `Tip: use ${chalk.cyan("--no-mcp --no-editor-model --no-stream")} for cleaner CI output`,
    ].join("\n"),
  );
}
