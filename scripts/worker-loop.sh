#!/usr/bin/env bash
# ヘッドレスの Claude Code をワーカーとしてループ実行する（pm2 で常駐させる想定）。
# 1サイクル＝ claude -p を1回実行（worker-prompt.md に従い指示を1件処理 or idle）。
# 外側のこのループが繰り返すことで「常時指示待ち」を実現する。
set -u

export PATH="$HOME/.local/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROMPT_FILE="${WORKER_PROMPT:-$SCRIPT_DIR/worker-prompt.md}"
WORK_DIR="${WORKER_CWD:-$HOME}"

if ! command -v claude >/dev/null 2>&1; then
  echo "[worker] ERROR: claude が見つかりません (PATH=$PATH)"; exit 1
fi
[ -f "$PROMPT_FILE" ] || { echo "[worker] ERROR: プロンプトがありません: $PROMPT_FILE"; exit 1; }

cd "$WORK_DIR" || exit 1
echo "[worker] start: cwd=$WORK_DIR prompt=$PROMPT_FILE claude=$(command -v claude)"

PROMPT="$(cat "$PROMPT_FILE")"
# 1サイクルの最大実行時間（秒）。ゲートウェイ再起動等で固まっても必ず復帰させる安全網。
MAX_SECONDS="${WORKER_MAX_SECONDS:-300}"
PERMISSION_MODE="${WORKER_PERMISSION_MODE:-bypassPermissions}"
# 追加の claude 引数（例: タスクワーカーで --disallowedTools Bash ...）。空白区切り。
EXTRA_ARGS="${WORKER_EXTRA_ARGS:-}"
echo "[worker] permission=$PERMISSION_MODE extra=[$EXTRA_ARGS]"
while true; do
  # shellcheck disable=SC2086
  timeout --signal=TERM "$MAX_SECONDS" \
    claude -p "$PROMPT" \
      --permission-mode "$PERMISSION_MODE" \
      $EXTRA_ARGS \
      --append-system-prompt "あなたはバックグラウンドの常駐リモートワーカーとして headless 実行されています。" \
      < /dev/null \
    || echo "[worker] claude 終了/タイムアウト ($?)。再接続します。"
  sleep 1
done
