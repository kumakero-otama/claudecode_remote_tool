#!/usr/bin/env bash
# ヘッドレスの Claude Code をワーカーとしてループ実行する（pm2 で常駐させる想定）。
# 1サイクル＝ claude -p を1回実行（プロンプト手順に従い指示を1件処理 or idle）。
# 外側のこのループが繰り返すことで「常時指示待ち」を実現する。
#
# セッション継続: WORKER_SESSION_ID を与えると、毎サイクル同じセッションを --resume して
#   会話文脈を保持する（サイクルをまたいで前回の指示・応答を覚える）。初回のみ --session-id で作成。
#   ワーカーごとに別IDなので、3ワーカー（exec/task/paper）の文脈は互いに独立。
# アイドル肥大化対策: 手順(プロンプト本文)は --append-system-prompt に載せ、各サイクルの
#   ユーザ発話は短いトリガだけにする（idleの繰り返しで会話本体が膨らむのを防ぐ）。
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

INSTRUCTIONS="$(cat "$PROMPT_FILE")"
MAX_SECONDS="${WORKER_MAX_SECONDS:-300}"
# 既定は auto モード（分類器が許可/ブロックを自動判定。headlessでは連続ブロック時に中断）。
PERMISSION_MODE="${WORKER_PERMISSION_MODE:-auto}"
# 追加の claude 引数（例: タスク/論文ワーカーで --disallowedTools Bash ...）。空白区切り。
EXTRA_ARGS="${WORKER_EXTRA_ARGS:-}"
SESSION_ID="${WORKER_SESSION_ID:-}"

# 常駐ワーカーの説明 + 手順を system prompt に載せる（会話本体は文脈保持に使う）
SYS_PROMPT="あなたはバックグラウンドの常駐リモートワーカーとして headless 実行されています。
前サイクルまでの会話文脈は保持されます（このワーカーへの過去のやり取りを覚えています）。
以下の手順に従って動作してください。

===== ワーカー手順 =====
${INSTRUCTIONS}"

# 各サイクルで送る短いトリガ（手順は system prompt 側にある）
CYCLE_PROMPT="次の1サイクルを実行してください（手順はシステムプロンプト参照。前サイクルまでの文脈は保持されています）。"

echo "[worker] start: cwd=$WORK_DIR prompt=$PROMPT_FILE session=${SESSION_ID:-none} perm=$PERMISSION_MODE extra=[$EXTRA_ARGS]"

# セッション作成済みマーカー（pm2再起動後も --resume を使うため永続化）
MARKER=""
if [ -n "$SESSION_ID" ]; then
  STATE_DIR="$HOME/.ccrt-worker-sessions"; mkdir -p "$STATE_DIR"
  MARKER="$STATE_DIR/${SESSION_ID}.created"
fi

run_cycle() {
  # $@ : 追加のセッション系フラグ（--resume / --session-id 等）
  # shellcheck disable=SC2086
  timeout --signal=TERM "$MAX_SECONDS" \
    claude -p "$CYCLE_PROMPT" \
      --permission-mode "$PERMISSION_MODE" \
      $EXTRA_ARGS \
      --append-system-prompt "$SYS_PROMPT" \
      "$@" \
      < /dev/null
}

while true; do
  if [ -n "$SESSION_ID" ]; then
    if [ -f "$MARKER" ]; then
      run_cycle --resume "$SESSION_ID" || echo "[worker] resume失敗($?)。再試行します。"
    else
      # 初回: 固定IDで作成。既に存在していた場合は resume にフォールバック。
      if run_cycle --session-id "$SESSION_ID"; then
        touch "$MARKER"
      elif run_cycle --resume "$SESSION_ID"; then
        touch "$MARKER"
      else
        echo "[worker] セッション初期化失敗($?)。再試行します。"
      fi
    fi
  else
    run_cycle || echo "[worker] claude 終了/タイムアウト($?)。再接続します。"
  fi
  sleep 1
done
