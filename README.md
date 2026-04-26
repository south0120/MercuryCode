# mcode

A coding agent CLI powered by Mercury 2 — Claude Code / Codex–style experience built on Inception Labs' fast diffusion LLM `mercury-2`.

> [Landing page](https://south0120.github.io/MercuryCode/) · [日本語版 README](./README.ja.md)

## Quickstart

```bash
# 1. Set API key (or save via interactive input on first launch to ~/.mcode/config.json)
export INCEPTION_API_KEY=sk_...

# 2. One-shot smoke test (auto-approve writes & shell)
mcode -y "create hello.py that prints 'Hello, world!' and verify by running it"

# 3. Interactive mode (REPL)
mcode
```

## Initialization

mcode auto-creates state files so you don't have to:

| Path | When created | Purpose |
|---|---|---|
| `~/.mcode/` (with `skills/`, `plugins/`, `commands/`, `sessions/`, `MCODE.md`) | First launch ever | Global config, your personal skills/plugins/commands, conversation history, global memory |
| `~/.mcode/config.json` | First time you supply an API key | API key (chmod 600) |
| `.mcode/` in cwd (with `commands/`, `skills/`, `hooks.json`, `mcp.json`, `MCODE.md`, `.gitignore`) + `MERCURY.md` | First REPL launch in a project (has `.git`, `package.json`, etc.) | Project-local commands/skills/hooks/mcp/memory |

Run `mcode init` to scaffold the project skeleton explicitly (idempotent). Use `--no-auto-init` to disable for one run.

## Install

mcode is currently distributed via GitHub. npm publication will happen once the API stabilizes.

```bash
git clone https://github.com/south0120/MercuryCode.git
cd MercuryCode/mcode
npm install
npm run build
npm link        # → `mcode` is now on your $PATH
```

Hot-reload during development: `npm run dev "your prompt"` (uses `tsx` to run from source without rebuilding).

## API key

Set using one of the following:

- Environment variable `INCEPTION_API_KEY=sk_...`
- `.env` in cwd with `INCEPTION_API_KEY=sk_...`
- Interactive input on first launch (automatically saved to `~/.mcode/config.json` with permission 600)

## Usage

```bash
# One-shot (writes require approval prompt)
mcode "create fizzbuzz.py that prints 1..15"

# Auto-approval (for CI / fast iteration)
mcode -y "add a Usage section to README.md"

# REPL mode
mcode

# Prompt from file
mcode -f spec.md

# Persistent conversation history
mcode -s feature-x "design the auth endpoint"
mcode -s feature-x "now write the tests"

# Read-only mode
mcode --read-only "explain this project's structure"
```

## REPL commands

When a line starts with `/` alone, a fuzzy-search picker opens.

| Command | Action |
|---|---|
| `/help` | Show help |
| `/exit` | Exit |
| `/clear` | Clear screen |
| `/reset` | Clear conversation history |
| `/tools` | List available tools |
| `/save NAME` | Save history to `~/.mcode/sessions/NAME.json` |
| `/load NAME` | Load history |
| `/sessions` | List saved sessions |
| `/yolo` | Toggle auto-approval ON/OFF |
| `/plan` | Toggle plan mode (show steps before execution) ON/OFF |
| `/cost` `/tokens` | Show token consumption and estimated cost for this session |
| `/learn TEXT` | Append learned content to `.mcode/MCODE.md` |
| `/undo` | Revert the most recent write/edit (single step) |
| `/test` | Run the project's tests (auto-detected from package.json/Cargo.toml/etc.) |
| `/build` | Run the project's build (auto-detected) |
| `/resume <name>` | Load a saved session and continue from there |
| `/branch [name]` (alias `/fork`) | Snapshot the current conversation as a named session |
| `/copy [N]` | Copy the Nth-latest assistant response to the clipboard |
| `/diff` | Show git uncommitted changes (working tree vs HEAD) |
| `/export [filename]` | Export the current conversation as Markdown |
| `/compact [focus]` | Compress the conversation by summarizing older turns |
| `/effort [low\|medium\|high\|max\|auto]` | Set Mercury reasoning effort |
| `/recap` | One-line summary of the current session |
| `/btw <question>` | Side question without polluting main history |
| `/rewind` | Rewind to before the last user prompt |
| `/theme [dark\|light\|highcontrast\|mercury]` | Switch color theme |
| `! <cmd>` | Run a shell command directly (no AI involvement) |
| `Ctrl+G` | Open the current prompt in `$EDITOR` |
| `Ctrl+R` | Reverse-search command history |
| `/model [id]` | Switch the active model (no arg = interactive picker; tools-capable filter) |
| `/models` | List all available Mercury models with capabilities |
| `/skills` | List registered skills |
| `/plugins` | List installed plugins |
| `/mcp active` | Show active MCP tools (loaded at startup) |
| `/mcp list` | Show configured servers in `~/.mcode/mcp.json` |
| `/mcp add` | Interactive picker: Brave Search / Filesystem / Fetch / GitHub / Custom |
| `/mcp remove [name]` | Remove a configured server |

Multi-line input: press **Ctrl+Enter** (or **Ctrl+J** / **Option+Enter**) to insert a newline; plain **Enter** submits.

Inline file references: write `@path/to/file` in any prompt and mcode will read the file and inline its contents into the message before sending. Skipped silently if the path doesn't exist or is binary/oversized.

## Custom commands

Place a Markdown file under `.mcode/commands/<name>.md` or `~/.mcode/commands/<name>.md` and it will be registered automatically as `/name`.

```markdown
---
description: short description
argument-hint: [optional hint]
allowed-tools: read_file,bash
---

Prompt body. Use $ARGUMENTS to interpolate user-supplied args.
```

Sample commands are in `examples/.mcode/commands/`.

## Hooks

PreToolUse / PostToolUse / SessionStart / SessionEnd can be configured in `.mcode/hooks.json` or `~/.mcode/hooks.json`.

```json
{
  "PreToolUse": [
    { "matcher": "bash", "command": "validate.sh" }
  ]
}
```

- `matcher`: regex for tool name (defaults to all)
- `command`: executed via bash; receives JSON `{event, tool_name, tool_input, tool_output, cwd}` on stdin
- Returning exit code `2` blocks the tool execution

## Plan mode

`mcode --plan "..."` or turning `/plan` ON inside REPL makes the AI present a **step plan** before calling write/bash tools, waiting for user approval.

## Extensions: Skills / Plugins / MCP

### Skills

Place a front-matter Markdown file at `.mcode/skills/<name>/SKILL.md` (or `~/.mcode/skills/<name>/SKILL.md`). The AI can load the skill text via `invoke_skill(name)` when needed.

```markdown
---
name: refactor-cleanup
description: When the user asks to clean up or refactor existing code
---

Skill body (detailed instructions for the AI)
```

In REPL, `/skills` lists them.

### Plugins

mcode can install plugins from **marketplaces** (Claude Code-compatible). After registering a marketplace you can `install`/`uninstall`/`browse` plugins via REPL or CLI.

```bash
# CLI
mcode plugin marketplace add wshobson/agents      # owner/repo, full URL, or ./path
mcode plugin browse
mcode plugin install code-reviewer@wshobson
mcode plugin list
mcode plugin uninstall code-reviewer

# REPL (same surface, prefixed with /)
/plugin marketplace add wshobson/agents
/plugin install code-reviewer
```

Marketplaces are stored at `~/.mcode/marketplaces.json`; their git clones land in `~/.mcode/plugins/cache/`. Plugin install copies the source dir to `~/.mcode/plugins/<name>/`.

#### Plugin manifest (Claude Code-compatible)

A plugin bundle can be placed under `.mcode/plugins/<name>/` (or installed via marketplace) and may contain commands, skills, hooks, and MCP definitions. mcode reads either `.claude-plugin/plugin.json` (Claude Code format) or root-level `plugin.json` (mcode native), and both well-known component locations: `commands/` `skills/<name>/SKILL.md` `hooks/hooks.json` (or `hooks.json`) `.mcp.json` (or `mcp.json`).

```json
{
  "name": "sample-plugin",
  "version": "0.1.0",
  "description": "...",
  "commands": "commands",
  "skills": "skills",
  "hooks": "hooks.json",
  "mcp": "mcp.json"
}
```

Sample: `examples/.mcode/plugins/sample-plugin/`. In REPL, `/plugins` lists them.

### MCP (Model Context Protocol)

Configure an MCP server in `.mcode/mcp.json` (or `~/.mcode/mcp.json`). It launches via stdio and automatically registers tools as `mcp__<server>__<tool>`.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

Disable with `--no-mcp`; list connected tools via `/mcp`.

#### Popular MCP servers

Drop these into `~/.mcode/mcp.json` (global) or `.mcode/mcp.json` (per project). Sample at `examples/.mcode/mcp.json`.

| Server | Use case | Setup |
|---|---|---|
| **brave-search** | Web search via Brave Search API | Get a free key at <https://brave.com/search/api>, set `BRAVE_API_KEY` |
| **filesystem** | Sandboxed file operations on a chosen dir | No key needed, pass the dir as last arg |
| **fetch** | HTTP GET arbitrary URLs (returns text/markdown) | Requires `uv` (`pip install uv`) — uses `uvx mcp-server-fetch` |
| **github** | Read repos, issues, PRs from GitHub | Set `GITHUB_PERSONAL_ACCESS_TOKEN` |
| **slack / postgres / sqlite / time** | Various | See <https://github.com/modelcontextprotocol/servers> |

Example for Brave web search:

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "sk_..." }
    }
  }
}
```

After this, mcode auto-registers `mcp__brave_search__brave_web_search` and the agent can search the web mid-conversation.

## Tools

| Tool | Backed by | Approval |
|---|---|---|
| `read_file` | Node | Not required |
| `list_dir` | Node | Not required |
| `grep` | ripgrep + Node fallback | Not required |
| `write_file` | Node | Required (`-y` skips) |
| `edit_file` | Node (deterministic search/replace) | Required |
| `bash` | Node | Required |
| `fim_complete` | **Mercury Edit 2** (`v1/fim/completions`) | Required |
| `edit_with_ai` | **Mercury Edit 2** (`v1/edit/completions`) | Required |
| `invoke_skill` | local | Not required |
| `mcp__<server>__<tool>` | configured MCP server | Required |

### Editor model (Mercury Edit 2)

mcode automatically registers two editor tools backed by Inception Labs' code-specialized **Mercury Edit 2** model:

- **`fim_complete`** — fast fill-in-middle insertion at a given `line:column`. Best for autocomplete-style additions where surrounding context is the strongest signal.
- **`edit_with_ai`** — apply a natural-language instruction to a whole file (refactor, rename, restructure). Returns a unified diff.

The main agent (`mercury-2`) decides when to call them. Disable with `--no-editor-model`.

## Project memory

If a `MERCURY.md` exists in the cwd, its contents are injected into the system prompt. Write project-specific rules (language/style/constraints) there for automatic reference.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for shipped milestones (v0.1–v0.3) and the planned trajectory toward v1.0 (streaming, subagent parallelism, plugin marketplace, multi-model gateway, etc.).

## License

MIT