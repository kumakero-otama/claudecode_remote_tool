# リモートワーカーの起動方法

Web アプリからの指示を受けて実行するのは、このホスト上で動く **Claude Code セッション**です。
セッションが MCP ゲートウェイのツールをループ呼び出しすることで「ワーカー」として振る舞います。

## 1. MCP を登録（初回のみ）

```bash
./scripts/claude-mcp-add.sh
claude mcp list   # remote-gateway が出ればOK
```

## 2. ワーカーセッションを起動

専用のターミナルで作業ディレクトリを開いて Claude Code を起動します。

```bash
cd ~            # /home/otama 配下のリポジトリ全般を扱う
claude
```

## 3. ワーカーモードに入れる（プロンプトを貼り付け）

セッションに以下を貼り付けてください。これで指示待ち→実行→応答 のループに入ります。

```
あなたはリモートワーカーです。以下を繰り返してください:
1. MCP ツール wait_for_instruction を呼ぶ（最大25秒のロングポーリング）。
2. NO_INSTRUCTION（タイムアウト）が返ったら、すぐに wait_for_instruction を再度呼ぶ。
3. 指示(JSON: instruction_id, text)が返ったら、その内容を /home/otama 配下で実行する。
   - 長い作業の途中経過は push_progress(instruction_id, text) で随時送る。
   - 完了したら send_response(instruction_id, text, done=true) で結果を返す。
4. 1 に戻る。
注意: 破壊的・不可逆な操作は要点を send_response で先に報告してから慎重に行うこと。
```

> ヒント: `/loop` スキルでループを自走させることもできます。タイムアウトで自然に再呼び出しされるため、
> 通常はこのプロンプト1回でループし続けます。

## 停止

セッションで Esc / Ctrl-C、またはターミナルを閉じればワーカーは停止します（Web 側は「ワーカー未接続」表示になります）。
