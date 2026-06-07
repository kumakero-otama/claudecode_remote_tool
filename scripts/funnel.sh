#!/usr/bin/env bash
# web コンテナ(127.0.0.1:8080) を Tailscale Funnel でインターネット公開する。
# 認証はアプリ側(Google OAuth + パスキー)で担保。
#
# 注意: このホストの 443(ルート) は別アプリ(StepBy)が使用中のため、
#       本ツールは衝突を避けて 8443 番で「追加」公開する（443の設定は触らない）。
#       公開URL: https://<MagicDNS名>:8443
set -euo pipefail

FUNNEL_PORT="${FUNNEL_PORT:-8443}"   # Funnel公開ポート(443/8443/10000のいずれか)
LOCAL_PORT="${1:-8080}"              # 転送先(webコンテナ)

echo "[funnel] :${FUNNEL_PORT} → 127.0.0.1:${LOCAL_PORT} を追加公開します（443のStepByは変更しません）..."
tailscale funnel --bg --https="${FUNNEL_PORT}" "${LOCAL_PORT}"
echo
echo "[funnel] 現在の公開状態:"
tailscale funnel status || true
echo
DNSNAME="$(tailscale status --json | grep -m1 '"DNSName"' | sed -E 's/.*"DNSName": *"([^"]*)\.".*/\1/')"
echo "公開URL: https://${DNSNAME}:${FUNNEL_PORT}"
echo "この :${FUNNEL_PORT} の公開だけ停止するには: tailscale funnel --https=${FUNNEL_PORT} off"
