# mcode

Mercury 2 製のコーディングエージェント CLI。Claude Code / Codex 風の体験を、Inception Labs の高速 dLLM `mercury-2` で。

## Quickstart

```bash
# 1. API キー設定（または初回起動時の対話入力で ~/.mcode/config.json に保存）
export INCEPTION_API_KEY=sk_...

# 2. ワンショットで動作確認（書込み/実行を自動承認）
mcode -y "hello.py に 'Hello, world!' を出力する Python スクリプトを作って実行確認まで"

# 3. 対話モード（REPL）
mcode
```

## Install

```bash
git clone <this-repo> && cd mcode
npm install
npm run build
npm link        # → 任意ディレクトリで `mcode` が使える
```

## API key

以下のいずれかで設定:

- 環境変数 `INCEPTION_API_KEY=sk_...`
- cwd の `.env` に `INCEPTION_API_KEY=sk_...`
- 初回起動時の対話入力（自動で `~/.mcode/config.json` に保存・パーミッション 600）

## Usage

```bash
# ワンショット（書込みは承認プロンプト付き）
mcode "fizzbuzz.py を作って 1〜15 を出力"

# 自動承認（CI/速い反復向け）
mcode -y "READMEに使い方セクション追加して"

# REPL モード
mcode

# プロンプトをファイルから
mcode -f spec.md

# セッション履歴を残す
mcode -s feature-x "認証エンドポイント設計して"
mcode -s feature-x "テストも書いて"

# 読み取り専用モード
mcode --read-only "このプロジェクトの構造説明して"
```

## REPL コマンド

行頭で `/` 単独入力するとファジー検索ピッカーが開きます。

| コマンド | 動作 |
|---|---|
| `/help` | ヘルプ表示 |
| `/exit` | 終了 |
| `/clear` | 画面クリア |
| `/reset` | 会話履歴クリア |
| `/tools` | 利用可能ツール一覧 |
| `/save NAME` | 履歴を `~/.mcode/sessions/NAME.json` に保存 |
| `/load NAME` | 履歴を読み込み |
| `/sessions` | 保存済セッション一覧 |
| `/yolo` | 自動承認の ON/OFF |
| `/plan` | プランモード（実行前に手順提示）の ON/OFF |
| `/cost` `/tokens` | このセッションのトークン消費・推定費用 |
| `/learn TEXT` | 学んだ内容を `.mcode/MCODE.md` に追記 |

複数行入力は行末に `\` を付けて改行（次行が続きとして取り込まれます）。

## カスタムコマンド

`.mcode/commands/<name>.md` または `~/.mcode/commands/<name>.md` に Markdown を置くと自動で `/name` として登録されます。

```markdown
---
description: short description
argument-hint: [optional hint]
allowed-tools: read_file,bash
---

Prompt body. Use $ARGUMENTS to interpolate user-supplied args.
```

サンプルは `examples/.mcode/commands/` にあります。

## フック

`.mcode/hooks.json` または `~/.mcode/hooks.json` に PreToolUse / PostToolUse / SessionStart / SessionEnd を設定可能。

```json
{
  "PreToolUse": [
    { "matcher": "bash", "command": "validate.sh" }
  ]
}
```

- `matcher`: ツール名の正規表現（省略時は全マッチ）
- `command`: bash で実行。stdin に `{event, tool_name, tool_input, tool_output, cwd}` の JSON
- exit code `2` を返すとツール実行をブロック

## プランモード

`mcode --plan "..."` または REPL 内で `/plan` ON にすると、AI は書込み・bash 系を呼ぶ前に **手順案を必ず先に提示**してユーザー承認を待ちます。

## 拡張: Skills / Plugins / MCP

### Skills

`.mcode/skills/<name>/SKILL.md`（または `~/.mcode/skills/<name>/SKILL.md`）に frontmatter 付き Markdown を置くと、AI が必要に応じて `invoke_skill(name)` ツールでスキル本文を読み込みます。

```markdown
---
name: refactor-cleanup
description: When the user asks to clean up or refactor existing code
---

スキル本文（AI への詳細指示）
```

REPL: `/skills` で一覧。

### Plugins

`.mcode/plugins/<name>/plugin.json` で commands/skills/hooks/mcp をバンドル可能。

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

サンプル: `examples/.mcode/plugins/sample-plugin/`。REPL: `/plugins` で一覧。

### MCP (Model Context Protocol)

`.mcode/mcp.json`（または `~/.mcode/mcp.json`）に MCP サーバーを設定すると stdio で起動し、提供ツールを `mcp__<server>__<tool>` 名で自動登録します。

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

`--no-mcp` で無効化、`/mcp` で接続中ツール一覧。

## Tools (v0.1)

| ツール | 承認 |
|---|---|
| `read_file` | 不要 |
| `list_dir` | 不要 |
| `grep` | 不要 |
| `write_file` | 必要（`-y` で省略可） |
| `edit_file` | 必要 |
| `bash` | 必要 |

## Project memory

cwd に `MERCURY.md` があれば内容が system prompt に注入されます。プロジェクト固有のルール（言語/スタイル/制約）を書いておくと毎回参照されます。

## License

MIT
