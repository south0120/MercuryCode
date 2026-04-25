# mcode

Mercury 2 製のコーディングエージェント CLI。Claude Code / Codex 風の体験を、Inception Labs の高速 dLLM `mercury-2` で。

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
