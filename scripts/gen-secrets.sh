#!/usr/bin/env bash
# .env のトークン類（MCP_TOKEN / GATEWAY_API_TOKEN / SESSION_SECRET）を生成して埋める。
# 既に値がある項目は上書きしない。
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { cp .env.example .env; echo "[gen-secrets] .env を .env.example から作成しました"; }

fill() {
  local key="$1"
  local cur
  cur="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2-)"
  if [ -z "$cur" ]; then
    local val
    val="$(openssl rand -hex 32)"
    # macOS/Linux 両対応の sed
    sed -i.bak -E "s|^${key}=.*|${key}=${val}|" .env && rm -f .env.bak
    echo "[gen-secrets] ${key} を生成しました"
  else
    echo "[gen-secrets] ${key} は既存のためスキップ"
  fi
}

fill MCP_TOKEN
fill GATEWAY_API_TOKEN
fill SESSION_SECRET

echo "[gen-secrets] 完了。次は PUBLIC_URL / ALLOWED_EMAILS / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を .env で設定してください。"
