# Copy & content for mcode LP

## Hero

**H1**: Coding agent at the speed of diffusion.

**Sub**: mcode pairs **Mercury 2** — Inception Labs' diffusion LLM — with a Claude Code–class CLI. Fast where it counts, conservative where it matters.

**CTA primary**: Get started

**CTA secondary** (text link): View on GitHub →

**Stat strip**: `300ms typical edit  ·  32K context  ·  MIT licensed  ·  100% local CLI`

---

## Section 2 — Why diffusion?

**H2**: Why diffusion changes the loop.

**Body** (two paragraphs):

> Most LLMs write code one token at a time. Diffusion writes a whole region at once and refines it. The practical effect is that single-file edits — rename across file, add JSDoc, restructure, idiomatic refactor — return in roughly **300 milliseconds** instead of seconds.

> mcode leans on this. The agent picks `edit_with_ai` for structural changes and reaches for `edit_file` only when an exact-string replacement is intended. The result is a tighter feedback loop and far less waiting on the model.

Right column: `assets/diffusion-process.png` (the 4-frame noise → code visualization).

---

## Section 3 — Watch it work

**H2**: A typical session.

(Use a stylized terminal mockup. Static HTML, no images. Show this transcript:)

```
$ mcode -y "rename multiply to mul in src/index.js, add JSDoc"

⏵ AIEdit src/index.js
✓ aiedit
  /src/index.js  +24 -8

⏵ Run    $ npm run build
│ > tsc
│ BUILD_OK
✓ run  exit 0

● Renamed multiply → mul (3 sites). JSDoc added to both functions.
  Build verified.

  elapsed: 2.6s
```

Below the mockup, italic caption (gray): "From prompt to verified build in under 3 seconds."

---

## Section 4 — What it does

Three cards (max). Each: heading + 2 lines + tiny code/CLI snippet.

**Card 1**: Agent that picks the right tool

> mcode reads files, runs commands, edits in place, and recovers. It picks `edit_with_ai` for structural changes and `edit_file` for exact replacements — without ceremony.

```bash
mcode -y "extract a helper from this duplicated logic"
```

**Card 2**: A marketplace, built in

> Browse and install plugins from any Claude Code-compatible marketplace. Skills, hooks, MCP servers — they all just work.

```bash
mcode plugin marketplace add wshobson/agents
mcode plugin install code-reviewer@wshobson
```

**Card 3**: Speak MCP fluently

> Brave Search, GitHub, filesystem — any MCP server connects via stdio. The agent gets the tools, you get an audit trail.

```json
{ "mcpServers": { "brave-search": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-brave-search"] } } }
```

---

## Section 5 — How it stays out of your way

**H2**: Quiet by default.

(Bulleted list, no icons:)

- Writes and shell commands ask for approval. `--yolo` only when you want it.
- `/undo` reverts the last edit. Save you from a bad LLM moment.
- Post-edit syntax check on `.ts/.js/.json/.py` — broken code surfaces immediately.
- Project-aware hooks: `mcode init` writes a `hooks.json` that auto-runs your `npm test` after edits.
- Read-only mode disables every write tool.

---

## Section 6 — Install

**H2**: Install in 30 seconds.

```bash
git clone https://github.com/south0120/MercuryCode.git
cd MercuryCode/mcode
npm install
npm run build
npm link
```

Then export your Inception Labs key and start the REPL:

```bash
export INCEPTION_API_KEY=sk_...
mcode
```

Below the install block, smaller paragraph: "Need a key? Sign up at [Inception Labs](https://inceptionlabs.ai). Mercury 2 costs roughly $1 per million tokens — about a tenth of frontier-class chat models."

---

## Footer

- Left: small mcode wordmark
- Center: "MIT — © 2026 mcode"
- Right: link "GitHub" → repo URL
