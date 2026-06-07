#!/usr/bin/env bash
# このホストの Claude Code に、リモートゲートウェイMCPを登録する。
# 登録後、新しい Claude Code セッションで wait_for_instruction 等のツールが使える。
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "ERROR: .env がありません。先に scripts/gen-secrets.sh を実行してください。"; exit 1; }
MCP_TOKEN="$(grep -E '^MCP_TOKEN=' .env | head -1 | cut -d= -f2-)"
[ -n "$MCP_TOKEN" ] || { echo "ERROR: MCP_TOKEN が空です。"; exit 1; }

NAME="${1:-remote-gateway}"
URL="http://127.0.0.1:8765/mcp"

# 既存の同名を削除してから登録（user スコープ）
# 注意: --header は可変長引数のため、name/url を先に置き --header を末尾にする
claude mcp remove "$NAME" 2>/dev/null || true
claude mcp add --transport http --scope user \
  "$NAME" "$URL" \
  --header "Authorization: Bearer ${MCP_TOKEN}"

echo "[claude-mcp-add] 登録しました: $NAME -> $URL"
echo "確認: claude mcp list"
