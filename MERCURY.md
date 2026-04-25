# mcode (this project)

Mercury 2 (Inception Labs) を使った Claude Code / Codex 風の CLI コーディングエージェント。
TypeScript + Node.js 20+。`mcode-cli` として npm 公開予定。

## 構成

- `src/index.ts` … エントリ
- `src/cli.ts` … commander で argv パース、one-shot or REPL 切替
- `src/repl.ts` … REPL ループ。スラッシュコマンド・カスタムコマンド・履歴
- `src/input.ts` … raw-mode TTY 入力。横線UI＋ライブ候補。CJK幅対応。
- `src/agent.ts` … エージェントループ（tool_calls 解決、フック呼び出し）
- `src/client.ts` … Mercury API（OpenAI 互換）クライアント
- `src/ui.ts` … 出力フォーマット（バナー・rule・toolCall・approvalBox）
- `src/approval.ts` … 危険操作の承認プロンプト
- `src/memory.ts` … MERCURY.md / .mcode/MCODE.md 読込、plan-mode addendum
- `src/usage.ts` … トークン/コスト集計
- `src/commands.ts` … `.mcode/commands/*.md` のカスタムコマンド読込
- `src/hooks.ts` … `.mcode/hooks.json` の Pre/PostToolUse フック
- `src/diff.ts` … LCS unified diff
- `src/tools/{readFile,writeFile,editFile,bash,listDir,grep}.ts`

## ビルド/起動

- `npm run build` で `dist/` に出力
- `npm link` でグローバル `mcode` コマンドを更新
- `npm run dev` で tsx ホットラン

## 開発ルール

- ESM (`"type": "module"`)。import 末尾は `.js`（ts-node 互換）
- tsconfig は strict、target ES2022、moduleResolution bundler
- 依存最小: chalk, commander, dotenv, prompts のみ
- 新機能を入れる前に: 関連ソースを read_file で確認、影響範囲を把握
- 変更後は `npm run build` でコンパイル確認
- README.md の該当セクションも更新

## 既知の制約

- mercury-2 のみ利用可（mercury-coder は新規アカウント不可）
- `prompts` は承認プロンプトのみで使用、入力は自前実装
- 複数行入力は未対応（v0.4 候補）
