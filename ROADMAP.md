# mcode roadmap

Status as of v0.3. Items marked ✅ are shipped. Order within each phase is suggested but flexible.

## Shipped (v0.1 – v0.3)

- ✅ One-shot & REPL modes, session persistence
- ✅ Built-in tools: `read_file` `write_file` `edit_file` `bash` `list_dir` `grep`
- ✅ Approval modes: per-action / `--yolo` / `--read-only`
- ✅ Project memory: `MERCURY.md`, `.mcode/MCODE.md`
- ✅ Custom commands (`.mcode/commands/*.md`) with frontmatter
- ✅ Hooks (`.mcode/hooks.json`) — `PreToolUse` / `PostToolUse`
- ✅ Plan mode (`--plan`)
- ✅ Token / cost tracking (`/cost`)
- ✅ Plugins (`.mcode/plugins/<name>/plugin.json`) bundling commands/skills/hooks/mcp
- ✅ Skills (`.mcode/skills/<name>/SKILL.md`) loaded as `invoke_skill` tool
- ✅ MCP client (stdio) via `@modelcontextprotocol/sdk`, tools auto-registered as `mcp__<server>__<tool>`
- ✅ Raw-mode TTY input with horizontal-rule UI, live slash-command suggestions, CJK width handling
- ✅ Color-coded tool calls / approval boxes
- ✅ `grep` Node-regex fallback when `rg` is missing
- ✅ Mercury Edit 2 integration: `fim_complete` (FIM at line:col) and `edit_with_ai` (NL → file rewrite)
- ✅ Auto-bootstrap `~/.mcode/` skeleton + `mcode init` for project `.mcode/`

## v0.4 — Daily-driver UX (current)

The goal: make mcode comfortable enough to be your default for greenfield scaffolding.

- ✅ **Streaming output** — render assistant tokens incrementally as they arrive (SSE)
- ✅ **Inline file references** — `@path/to/file` in prompt auto-inlines file contents
- ✅ **In-session model switching** — `/model` picker probes account-accessible Mercury models
- ✅ **Multi-line input** — Ctrl+Enter / Ctrl+J / Option+Enter inserts newline; multi-line render
- ✅ **Did-you-mean for unknown slash commands** — Levenshtein-based hint
- ✅ **Markdown rendering** — streaming MD → ANSI (headers, bold/italic, code blocks, links, lists, blockquotes)
- ✅ **Documented popular MCP servers** — brave-search, fetch, github, filesystem with copy-paste config
- ✅ **Plugin marketplace (Phase 1 MVP)** — `mcode plugin marketplace add/list/remove/update`, `plugin install/uninstall/browse`. GitHub & local sources, Claude Code marketplace.json compatibility, CLI + REPL surfaces
- ✅ **Trust floor (Phase A)** — API retry layer, `/undo`, syntax check post-edit, `/test` `/build` shortcuts, project-kind-aware hooks template at `mcode init`
- ✅ **Friction reducers (Phase B)** — streaming bash output, repeated-failure detection + learn hints, file-path Tab completion, `/sessions` metadata + `/resume`
- **Multi-line paste detection** — auto-handle pasted multi-line content
- **Tab completion** — file path completion inside prompts (when input contains a `/path/like/this`)
- **Improved diff in approval** — side-by-side or syntax-highlighted diff for `edit_file`, with line-anchor context
- **`/undo`** — revert the last `write_file` / `edit_file` if the user changes their mind
- **Auto-resume** — `mcode` with no args in a directory that has a recent session offers to resume

## v0.5 — Power features

- **Subagent parallelism** — `mcode dispatch --parallel "task1" "task2"` runs N mcode workers simultaneously, collects diffs, presents merged review
- **`web_fetch` tool** — GET a URL, return text/markdown
- **`glob` tool** — separate from grep, returns matching paths only
- **`task` tool** — let the agent enqueue follow-up tasks for itself or for a subagent
- **Streaming tool execution** — surface `bash` stdout in real time during long-running commands
- **Per-tool denylists** — `--deny "rm -rf"` / `.mcode/deny.json` for guardrails beyond approval prompt
- **Custom slash commands with bash**: `!`-prefixed inline command execution inside command body (Claude Code parity)

## v0.6 — Ecosystem & extensibility polish

- **TUI mode** — Ink-based optional UI: status bar, queue view, tool history pane, persistent input
- **Plugin marketplace** — `mcode plugin install <name|url>` from a curated index or git URL
- **Skills auto-trigger** — match user prompt against skill descriptions, suggest `invoke_skill` proactively
- **MCP server templates** — `mcode mcp add <name>` registers commonly-used servers (filesystem, github, slack, postgres)
- **Multi-model gateway** — abstraction over providers; allow `--model claude-sonnet-4` etc. via Vercel AI Gateway or LiteLLM
- **Conversation forking** — `/fork` branch the current session, A/B test approaches

## v0.7 — Production readiness

- **`mcode publish` workflow** — npm publish to `mcode-cli` package on the public registry
- **Unit + integration test suite** — Vitest, with mocked Mercury and real-MCP fixtures
- **CI on GitHub Actions** — build, test, lint on every PR
- **Telemetry (opt-in)** — anonymous tool usage stats to inform priorities
- **Documentation site** — `docs/` with usage, plugin authoring, MCP integration guides
- **Versioned plugin API** — guarantee compatibility across mcode releases

## v1.0 — Stable

- **Stable plugin API** — semver-protected hooks, command frontmatter, MCP integration
- **Stable session format** — versioned, forward/backward compatible
- **Performance budget** — cold start < 500 ms, first-token < 300 ms over wifi
- **Hardening** — audit log, sandbox option for `bash`, prompt-injection mitigations
- **Localization** — English / Japanese error messages, with framework for more

## Beyond v1.0 — speculative

- **Voice mode** — STT input → mcode → TTS reply (Mercury's speed makes this viable)
- **Daemon + multi-client** — long-running server, multiple terminals attach to the same agent state
- **Browser companion** — DOM-aware coding pair when editing web apps
- **Distributed subagents** — dispatch to remote mcode workers (Vercel Sandbox, GitHub Codespaces)

## Cross-cutting always-on items

These aren't tied to a specific version — keep doing them every release.

- Reduce dependencies; prefer stdlib
- Improve error messages; users should never see a raw stack trace
- Update `using-mcode` skill with new wins/losses observed
- Track Mercury 2 model updates; switch defaults when a faster/cheaper variant ships

---

## How to contribute to the roadmap

- File an issue with the `roadmap` label proposing a new item or arguing to deprioritize one
- Open a draft PR for the v0.4 items — these are scoped enough to start tomorrow
- Skills, plugins, and MCP servers can be developed *outside* this repo and listed in v0.6 marketplace work
