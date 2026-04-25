---
name: using-mcode
description: When to dispatch a coding task to mcode (Mercury 2) vs handle it directly. Use when planning multi-step work, batch boilerplate, mass scaffolding, or any task where speed/cost trade-offs matter. Includes verified strengths, known weak spots, and the dispatch→review→commit workflow.
---

# When to use mcode

mcode は Inception Labs の Mercury 2 を使った高速 dLLM ベースのコーディングエージェント。汎用 LLM より **数倍速く、トークン単価が桁違いに安い**（$0.25/M prompt, $0.75/M completion）。

「速さで殴れる」場面が得意。逆に **検証必要な細部** や **環境依存の知識** は弱め。適材適所で。

## ✅ mcode に投げて良いタスク

- **スキャフォールド系**: ボイラープレート生成（CRUD、テストケースの雛形、JSON Schema、API ラッパー）
- **大量の単純編集**: README の章追加、コメント追加、import 整理、変数リネーム
- **1ファイル完結のロジック**: 既存パターンに沿った関数追加、ライブラリの薄いラッパー
- **マイグレーション一次案**: 古い API → 新 API の機械的書き換え（後で人間レビュー前提）
- **テスト下書き**: 関数仕様から最小ハッピーパスのテストを起こす
- **ドキュメント生成**: コードから README の章を起こす、JSDoc を追加

これらは「正しさのバーが低い」または「下書き → レビュー」前提で安全に高速化できる。

## ⚠️ mcode に投げると痛い目に遭うタスク

- **イベントセマンティクスや並行性**: `spawn` の error/close、Promise resolve の競合、async 順序など
- **バージョン依存**: ライブラリの最新 API 仕様（mcode は学習データ古め）
- **複数ファイル横断のリファクタ**: 依存関係や型推論をまたぐ判断
- **ビルド/型エラーのデバッグ**: tsc / TypeScript のエラーメッセージから根本原因を当てる作業
- **設計判断**: アーキテクチャ、抽象化レベル、責務分離
- **macOS 特有の挙動**, raw mode TTY、ANSI sequences のような環境依存
- **セキュリティ・認可・サンドボックス**: 微妙な失敗が静かに通ってしまう領域

これらは Claude Code / Codex に直接やらせるか、mcode の出力を必ず動作テスト + レビューする。

## 🎯 標準ワークフロー

```
1. ディスパッチ:   bash で `mcode -y "..."` 起動 (one-shot)
                  または tmux ペインの mcode に send-keys
2. mcode 実行:     read → edit/write → bash (build/test) → 報告
3. レビュー:       git diff で差分確認、コードを読む
4. 動作テスト:     ユニットテスト or 直接 import して実行
5. 修正:          指摘点を Claude Code (私) が Edit で反映
6. コミット:       commit message に「mcode 起案 / レビュー指摘」を記載
```

レビューポイントの定型:
- **競合・タイミング**: Promise の resolve 競合、イベントの発火順
- **エッジケース**: 空入力、ファイル不在、権限エラー、バイナリ
- **整合性**: 既存の挙動 (e.g. rg の smart-case) との乖離
- **出力フォーマット**: 既存ツールと同形式か（相対 vs 絶対パス等）
- **依存追加**: package.json をいじっていないか、必要最小限か

## 📦 ディスパッチパターン

### 単発 one-shot（最速、結果回収しやすい）

```bash
mcode -y --no-mcp "タスク文"
```

→ 完了したら `git diff` を見てレビュー。

### 並列バッチ（独立タスク複数）

```bash
mcode -y "task A" &
mcode -y "task B" &
wait
git status
```

各タスクが別ファイルを触る前提。同一ファイルを触ると競合する。

### tmux pane 経由（live で見せたい時）

```bash
tmux send-keys -t mcode-dev:dev.0 "task" C-m
# 進捗を別途 capture-pane で監視
```

mcode を `/yolo` 状態で起動しておけば自律進行。

### プロンプト書き方のコツ

- **要件を箇条書き**で具体的に（mcode は曖昧さに弱い）
- **既存ファイルへの参照**を明示（`src/foo.ts を読んで…`）
- **完了条件を含める**（`npm run build でコンパイル成功を確認まで`）
- **依存追加禁止**を明記したい時は明示（`新しい npm パッケージは追加しない`）

## 🚫 投げる前のセルフチェック

以下に該当するなら **直接やる**:

- 1 ファイルの 100 行以上の構造改修
- 既存テストが落ちる可能性のある変更
- 型システムの細部に依存する修正
- エラーメッセージから原因を推理する debugging
- パフォーマンス最適化（測定 → 改善のループ）
- CI/CD 設定、ビルドツール設定の変更

## 💰 コスト感

- Mercury 2: **$1/M token 程度** で済む
- 高品質汎用モデル比で数十倍安い
- なので「失敗してもやり直せばいい」タスクには気軽に投げて良い
- 重要判断は高品質モデルで再レビューする 2 段構えが理想

## 🔁 実績ベースの更新

このスキルは使いながら更新する。失敗パターン・成功パターンを `/learn` で `.mcode/MCODE.md` にも蓄積していき、定期的にここに反映する。
