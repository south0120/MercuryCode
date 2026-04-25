import { runCli } from "./cli.js";

runCli(process.argv).catch((err) => {
  console.error("merc:", err?.message ?? err);
  process.exit(1);
});
