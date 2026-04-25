#!/usr/bin/env node
import("../dist/index.js").catch((err) => {
  console.error("mcode: failed to start:", err);
  process.exit(1);
});
