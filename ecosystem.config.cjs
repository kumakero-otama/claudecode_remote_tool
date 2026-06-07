// pm2 設定: リモートワーカー（headless Claude Code）を常駐させる。
// 起動:   pm2 start ecosystem.config.cjs
// 保存:   pm2 save            （再起動後も復帰させるなら pm2 startup も一度実行）
// ログ:   pm2 logs ccrt-worker
// 停止:   pm2 stop ccrt-worker
module.exports = {
  apps: [
    {
      // exec チャネル: Claude通信（実行可・全権限）
      name: "ccrt-worker",
      script: "scripts/worker-loop.sh",
      interpreter: "bash",
      cwd: __dirname,
      env: {
        WORKER_CWD: "/home/otama",
        WORKER_PROMPT: __dirname + "/scripts/worker-prompt.md",
        WORKER_PERMISSION_MODE: "bypassPermissions",
      },
      autorestart: true,
      max_restarts: 100,
      restart_delay: 2000,
      out_file: "/home/otama/.pm2/logs/ccrt-worker-out.log",
      error_file: "/home/otama/.pm2/logs/ccrt-worker-error.log",
      merge_logs: true,
      time: true,
    },
    {
      // task チャネル: タスク編集専任（Bash/Web禁止・tasksフォルダ限定＝実行不可のロック）
      name: "ccrt-worker-task",
      script: "scripts/worker-loop.sh",
      interpreter: "bash",
      cwd: __dirname,
      env: {
        WORKER_CWD: "/home/otama/claudecode_remote_tool/tasks", // タスク以外を見せない
        WORKER_PROMPT: __dirname + "/scripts/worker-prompt-task.md",
        WORKER_PERMISSION_MODE: "bypassPermissions",
        // コマンド実行・外部通信を物理的に禁止（実行ロックの要）
        WORKER_EXTRA_ARGS: "--disallowedTools Bash WebFetch WebSearch",
      },
      autorestart: true,
      max_restarts: 100,
      restart_delay: 2000,
      out_file: "/home/otama/.pm2/logs/ccrt-worker-task-out.log",
      error_file: "/home/otama/.pm2/logs/ccrt-worker-task-error.log",
      merge_logs: true,
      time: true,
    },
    {
      // paper チャネル: 論文解説の編集専任（Bash/Web禁止・papersフォルダ限定。論文ファイルはReadのみ可）
      name: "ccrt-worker-paper",
      script: "scripts/worker-loop.sh",
      interpreter: "bash",
      cwd: __dirname,
      env: {
        WORKER_CWD: "/home/otama/claudecode_remote_tool/papers", // 論文以外を見せない
        WORKER_PROMPT: __dirname + "/scripts/worker-prompt-paper.md",
        WORKER_PERMISSION_MODE: "bypassPermissions",
        // コマンド実行・外部通信を禁止（Read は許可＝論文ファイルを読める）
        WORKER_EXTRA_ARGS: "--disallowedTools Bash WebFetch WebSearch",
      },
      autorestart: true,
      max_restarts: 100,
      restart_delay: 2000,
      out_file: "/home/otama/.pm2/logs/ccrt-worker-paper-out.log",
      error_file: "/home/otama/.pm2/logs/ccrt-worker-paper-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
