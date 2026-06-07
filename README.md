# claudecode_remote_tool

Web アプリから、このホスト上で動く **Claude Code セッション**へ指示を送り、応答を受け取るためのツール。
MCP サーバを「ゲートウェイ」として Web ⇄ Claude を仲介します。Web アプリはポータル + 子ページ構成で、
**Claude 通信 / サーバ情報 / タスク管理（準備中）** を提供します。

## アーキテクチャ

```
[ブラウザ] ──Tailscale Funnel(HTTPS/公開)──▶ [web コンテナ :8080]
   認証: Google OAuth(メール許可リスト) + WebAuthnパスキー(端末バインド)
        │ REST/SSE (docker network内, Bearer)
        ▼
   [gateway コンテナ] = MCPゲートウェイ + メッセージバス
        ▲ MCP (Streamable HTTP, 127.0.0.1:8765, Bearer)
        │
   [Claude Code セッション(ホスト)] ── wait_for_instruction / send_response をループ
```

- **gateway/** … Claude Code が繋ぐ MCP サーバ（`wait_for_instruction`/`send_response`/`push_progress`）と、Web 用 API（指示投入・SSE 配信）。
- **web/** … ポータル(SPA) + BFF。認証・許可制御を担い、`gateway` と既存ダッシュボード(:8088)へプロキシ。

## セキュリティ

- **公開はするが認証で守る**: Funnel で公開し、入口で **Google OAuth(許可メールのみ)** → **パスキー登録端末のみ命令実行可**。
- 多層防御: CSP/helmet・`SameSite=Strict`・JWT(HS256, alg固定)・`SESSION_EPOCH` で一括失効・端末単位失効・レート制限。
- MCP/内部APIは `127.0.0.1`/docker network 限定 + Bearer トークン。
- 詳細・残存リスク（認証突破時のRCE影響範囲など）は運用前に確認すること。

## セットアップ

### 1. シークレット生成と設定

```bash
cp .env.example .env
./scripts/gen-secrets.sh          # MCP_TOKEN / GATEWAY_API_TOKEN / SESSION_SECRET を生成
```

`.env` を編集:
- `PUBLIC_URL` … Funnel の MagicDNS 名（例: `https://barrierfree-map.tail5de5e1.ts.net`）
- `ALLOWED_EMAILS` … 許可する Google アカウント（カンマ区切り）
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` … 下記で取得

### 2. Google OAuth クライアント作成

> **使用アカウント: `yamashita.3154@gmail.com`**
> Google Cloud Console（プロジェクト作成・OAuthクライアント発行）は、必ずこのアカウントでログインして操作すること。
> ※これは「コンソールを操作する管理者アカウント」です。実際にWebアプリへログインを許可するアカウントは
> `.env` の `ALLOWED_EMAILS` で別途指定します（両者は別物）。

Google Cloud Console（`yamashita.3154@gmail.com` でログイン）→ 「APIとサービス」→「認証情報」→「OAuth クライアント ID（ウェブアプリ）」
- 承認済みリダイレクト URI: `https://barrierfree-map.tail5de5e1.ts.net:8443/auth/google/callback`
  - ※ 443は StepBy が使用中のため本ツールは **:8443** で公開。リダイレクトURIにも **:8443** を含めること。
- 発行された ID/Secret を `.env` に記入

### 3. コンテナ起動

```bash
docker compose up -d --build
docker compose logs -f         # 起動確認
```

### 4. インターネット公開（Funnel）

```bash
./scripts/funnel.sh            # :8443(公開) → :8080(web) を追加公開
```

> 同ホストの 443(ルート) は StepBy が使用中。本スクリプトは衝突を避けて **8443番**で追加公開し、443の設定は触らない。
> 公開URL: `https://barrierfree-map.tail5de5e1.ts.net:8443`
> 8443の公開停止のみ: `tailscale funnel --https=8443 off`

### 5. Claude Code をワーカーにする

[WORKER.md](./WORKER.md) を参照。要点:

```bash
./scripts/claude-mcp-add.sh    # MCP登録(初回)
cd ~ && claude                 # ワーカー用セッション起動 → WORKER.md のプロンプトを貼る
```

## 使い方

1. ブラウザで `PUBLIC_URL` を開く → 初回は「Googleでログイン」→ 端末のパスキーを登録。
2. 2回目以降は「パスキーでログイン」だけでOK。
3. ポータル左カラムから **Claude 通信** を開き、指示を送信 → ワーカーが実行し応答が返る。

## ローカルでの動作確認（Googleなし）

`.env` で `NODE_ENV=development` / `ALLOW_DEV_ENROLL=true` / `PUBLIC_URL=http://localhost:8080` にして起動すると、
`http://localhost:8080/auth/dev?email=<許可メール>` で端末登録の動作確認ができます（localhost は WebAuthn の安全コンテキスト扱い）。

## 運用メモ

- 全セッション失効: `.env` の `SESSION_EPOCH` を変更して `docker compose up -d`。
- 端末の確認/解除: ポータル右上「端末」。
- 監査ログ: `ccrt-data` ボリューム内 `/data/access.log`。
- 登録情報: `/data/store.json`。
