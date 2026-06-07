import express, { type Request } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { createProxyMiddleware } from "http-proxy-middleware";
import multer from "multer";
import fs from "node:fs";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { listTasks, getTask, createTask, allTags } from "./tasks.js";
import { appendMsg, readHistory, validSpace } from "./history.js";
import {
  loadStore,
  getUser,
  upsertUser,
  addCredential,
  findCredential,
  touchCredential,
  listDevices,
  removeCredential,
  audit,
} from "./store.js";
import {
  isAllowedEmail,
  isPasskeyRequired,
  setIdentityCookie,
  readIdentity,
  setSessionCookie,
  readSession,
  clearAuthCookies,
  setChallengeCookie,
  readChallenge,
  clearChallengeCookie,
  requireFull,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_PORT = Number(process.env.WEB_PORT ?? 8080);
const PUBLIC_URL = req("PUBLIC_URL");
const GATEWAY_API_URL = req("GATEWAY_API_URL");
const API_TOKEN = req("GATEWAY_API_TOKEN");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
// 既存のサーバ情報ダッシュボード(:8088)。コンテナからホストへ host.docker.internal で到達。
const DASHBOARD_URL = process.env.SERVER_DASHBOARD_URL ?? "http://host.docker.internal:8088";
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/uploads"; // コンテナ内の保存先
const HOST_UPLOADS_DIR = process.env.HOST_UPLOADS_DIR ?? UPLOADS_DIR; // ワーカー(ホスト)が読む実パス
const isProd = process.env.NODE_ENV !== "development";
const allowDevEnroll = process.env.ALLOW_DEV_ENROLL === "true" && !isProd;

const rpID = new URL(PUBLIC_URL).hostname;
const origin = new URL(PUBLIC_URL).origin;
const rpName = "Claude Code Remote";

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[web] FATAL: missing required env ${name}`);
    process.exit(1);
  }
  return v;
}

const oauth =
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
    ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, `${origin}/auth/google/callback`)
    : null;

const stateCookie = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const, // OAuthのクロスサイトリダイレクトで戻るため lax
  path: "/",
  maxAge: 10 * 60 * 1000,
};
// clearCookie 用（maxAge を含めない: Express の非推奨警告回避）
const stateClear = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };

function clientIp(r: Request): string {
  return (r.headers["x-forwarded-for"]?.toString().split(",")[0].trim()) || r.ip || "";
}

function deviceLabel(r: Request): string {
  const ua = r.headers["user-agent"] ?? "";
  const os =
    /Windows NT 10|Windows NT 11/.test(ua) ? "Windows" :
    /CrOS/.test(ua) ? "ChromeOS" :
    /Android/.test(ua) ? "Android" :
    /Mac OS X/.test(ua) ? "macOS" :
    /iPhone|iPad/.test(ua) ? "iOS" :
    /Linux/.test(ua) ? "Linux" : "Unknown OS";
  const br =
    /Edg\//.test(ua) ? "Edge" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} / ${br}`;
}

// 添付ファイルのアップロード（ホスト側 uploads/ に保存→ワーカーが実パスで読む）
const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const safe = (file.originalname || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
    const rnd = Math.random().toString(36).slice(2, 8);
    cb(null, `${Date.now()}-${rnd}-${safe}`);
  },
});
const upload = multer({ storage: uploadStorage, limits: { fileSize: 25 * 1024 * 1024 } });

// 添付の実パスを指示文に追記（ワーカーが Read ツールで参照できるように）
function composeInstruction(
  text: string,
  attachments: Array<{ name?: string; hostPath?: string; mime?: string }>
): string {
  if (!attachments?.length) return text;
  const lines = attachments
    .filter((a) => a.hostPath)
    .map((a) => {
      const kind = (a.mime || "").startsWith("image/") ? "画像" : "ファイル";
      return `- ${kind}: ${a.hostPath}  (元の名前: ${a.name ?? ""})`;
    });
  return `${text}\n\n[添付ファイル]（必要に応じて Read ツールで参照してください）\n${lines.join("\n")}`;
}

// 履歴/画面に出すユーザ発言の表示ラベル（添付名を付す）
function userLabel(text: string, attachments: Array<{ name?: string }>): string {
  if (attachments?.length) {
    const names = attachments.map((a) => a.name).filter(Boolean).join(", ");
    return `${text}${text ? "\n" : ""}📎 ${names}`;
  }
  return text;
}

// instruction_id → {space, owner(email), ts}
const instrSpace = new Map<string, { space: string; owner: string; ts: number }>();
function rememberSpace(id: string, space: string, owner: string) {
  instrSpace.set(id, { space, owner, ts: Date.now() });
  if (instrSpace.size > 1000) {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [k, v] of instrSpace) if (v.ts < cutoff) instrSpace.delete(k);
  }
}

// 履歴キー: ユーザ別・スペース別
function userKey(email: string): string {
  return email.replace(/[^\w-]/g, "_");
}
function histKey(email: string, space: string): string {
  return `${userKey(email)}__${space}`;
}

// ブラウザの SSE 接続（ユーザ＋スペースで絞って配信＝混線防止）
type SseClient = { email: string; space: string; res: import("express").Response };
const clients = new Set<SseClient>();
function fanout(match: (c: SseClient) => boolean, ev: unknown): void {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) if (match(c)) { try { c.res.write(line); } catch {} }
}

// gateway の SSE を購読し、(1)履歴記録 (2)該当ユーザ/スペースへの配信 を行う
async function startRecorder() {
  for (;;) {
    try {
      const res = await fetch(`${GATEWAY_API_URL}/events`, { headers: { Authorization: `Bearer ${API_TOKEN}` } });
      if (!res.ok || !res.body) throw new Error("events not ok");
      const reader = (res.body as any).getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let ev: any;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }

          if (ev.type === "worker_status") { fanout(() => true, ev); continue; } // 接続表示は全員へ
          if (ev.type === "instruction") continue; // 自分の発言はブラウザ側で表示済み

          // received / progress / response は instructionId で持ち主と空間を特定して配信
          const m = ev.instructionId ? instrSpace.get(ev.instructionId) : undefined;
          if (!m) continue;
          fanout((c) => c.email === m.owner && c.space === m.space, ev);
          if (ev.type === "response" && ev.done) {
            await appendMsg(histKey(m.owner, m.space), { role: "claude", text: ev.text ?? "", ts: ev.ts ?? Date.now() });
            instrSpace.delete(ev.instructionId);
          }
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  await loadStore();
  startRecorder(); // バックグラウンドで応答を記録

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true); // Funnel配下の X-Forwarded-* を信頼

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameSrc: ["'self'"], // ポータルが子ページをiframe表示
          frameAncestors: ["'self'"], // 自サイトのみ frame 可（外部クリックジャッキングは拒否）
          objectSrc: ["'none'"],
        },
      },
      hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
      crossOriginOpenerPolicy: { policy: "same-origin" },
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "256kb" }));

  const authLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
  const instrLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

  app.get("/healthz", (_r, res) => res.json({ ok: true }));

  /* ----------------------- Google OAuth（パスキー登録のゲート） ----------------------- */
  app.get("/auth/google", authLimiter, (r, res) => {
    if (!oauth) return res.status(503).send("Google OAuth is not configured");
    const state = randomBytes(32).toString("base64url");
    res.cookie("ccrt_oauth_state", state, stateCookie);
    const url = oauth.generateAuthUrl({
      access_type: "online",
      scope: ["openid", "email", "profile"],
      prompt: "select_account",
      state,
    });
    res.redirect(url);
  });

  app.get("/auth/google/callback", authLimiter, async (r, res) => {
    if (!oauth) return res.status(503).send("Google OAuth is not configured");
    const code = r.query.code as string | undefined;
    const state = r.query.state as string | undefined;
    const saved = r.cookies?.ccrt_oauth_state as string | undefined;
    res.clearCookie("ccrt_oauth_state", stateClear);
    // state不一致（戻る/再読込/使用済みURL再利用など）は、エラー画面ではなく /login へ戻してやり直し可能に
    if (!code || !state || !saved || state !== saved) return res.redirect("/login?e=state");
    try {
      const { tokens } = await oauth.getToken(code);
      if (!tokens.id_token) return res.status(400).send("No id_token");
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload();
      const email = payload?.email;
      if (!payload?.email_verified || !email || !isAllowedEmail(email)) {
        await audit({ event: "login_denied", email, ip: clientIp(r), ua: r.headers["user-agent"] });
        return res.status(403).send("このGoogleアカウントは許可されていません。");
      }
      await audit({ event: "google_ok", email, ip: clientIp(r), ua: r.headers["user-agent"] });
      if (!isPasskeyRequired()) {
        // パスキー不要モード: Googleのみでフルセッションを発行
        setSessionCookie(res, email, payload.name ?? email, "google", "google");
        return res.redirect("/");
      }
      setIdentityCookie(res, email, payload.name ?? email);
      res.redirect("/enroll");
    } catch {
      res.status(400).send("OAuth exchange failed");
    }
  });

  // 開発時のみ：Googleなしで identity を発行（ローカル動作確認用）
  if (allowDevEnroll) {
    app.get("/auth/dev", authLimiter, (r, res) => {
      const email = (r.query.email as string) || "";
      if (!isAllowedEmail(email)) return res.status(403).send("not allowed");
      setIdentityCookie(res, email, email);
      res.redirect("/enroll");
    });
  }

  /* ----------------------- WebAuthn 登録（端末バインド） ----------------------- */
  app.get("/webauthn/register/options", authLimiter, async (r, res) => {
    const idy = readIdentity(r);
    if (!idy) return res.status(401).json({ error: "google login required" });
    const user = getUser(idy.email);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: idy.email,
      userDisplayName: idy.name || idy.email,
      userID: new TextEncoder().encode(idy.email),
      attestationType: "none",
      excludeCredentials: (user?.credentials ?? []).map((c) => ({ id: c.id, transports: c.transports as any })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
    setChallengeCookie(res, "reg", options.challenge, idy.email);
    res.json(options);
  });

  app.post("/webauthn/register/verify", authLimiter, async (r, res) => {
    const idy = readIdentity(r);
    if (!idy) return res.status(401).json({ error: "google login required" });
    const chal = readChallenge(r, "reg");
    if (!chal || chal.email !== idy.email) return res.status(400).json({ error: "no challenge" });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: r.body,
        expectedChallenge: chal.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch {
      return res.status(400).json({ error: "verification failed" });
    }
    clearChallengeCookie(res);
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "not verified" });
    }
    const { credential } = verification.registrationInfo;
    await upsertUser(idy.email, idy.name);
    await addCredential(idy.email, {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports,
      deviceLabel: deviceLabel(r),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    setSessionCookie(res, idy.email, idy.name, credential.id);
    await audit({ event: "register", email: idy.email, cred: credential.id, ip: clientIp(r), ua: r.headers["user-agent"] });
    res.json({ ok: true });
  });

  /* ----------------------- WebAuthn ログイン（登録端末のみ） ----------------------- */
  app.get("/webauthn/login/options", authLimiter, async (_r, res) => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
    setChallengeCookie(res, "auth", options.challenge);
    res.json(options);
  });

  app.post("/webauthn/login/verify", authLimiter, async (r, res) => {
    const chal = readChallenge(r, "auth");
    if (!chal) return res.status(400).json({ error: "no challenge" });
    const credId = r.body?.id as string | undefined;
    if (!credId) return res.status(400).json({ error: "no credential id" });
    const found = findCredential(credId);
    if (!found) {
      await audit({ event: "login_unknown_device", cred: credId, ip: clientIp(r), ua: r.headers["user-agent"] });
      return res.status(401).json({ error: "unknown device" });
    }
    if (!isAllowedEmail(found.user.email)) return res.status(403).json({ error: "not allowed" });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: r.body,
        expectedChallenge: chal.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
        credential: {
          id: found.cred.id,
          publicKey: new Uint8Array(Buffer.from(found.cred.publicKey, "base64url")),
          counter: found.cred.counter,
          transports: found.cred.transports as any,
        },
      });
    } catch {
      return res.status(400).json({ error: "verification failed" });
    }
    clearChallengeCookie(res);
    if (!verification.verified) return res.status(401).json({ error: "not verified" });
    await touchCredential(found.cred.id, verification.authenticationInfo.newCounter);
    setSessionCookie(res, found.user.email, found.user.name, found.cred.id);
    await audit({ event: "login", email: found.user.email, cred: found.cred.id, ip: clientIp(r), ua: r.headers["user-agent"] });
    res.json({ ok: true });
  });

  app.post("/logout", (_r, res) => {
    clearAuthCookies(res);
    res.json({ ok: true });
  });

  /* ----------------------- アプリ用ローカルAPI（フルセッション必須） ----------------------- */
  app.get("/api/me", requireFull, (r, res) => {
    const s = (r as any).session;
    res.json({
      email: s.email,
      name: s.name,
      devices: listDevices(s.email).map((d) => ({
        id: d.id,
        label: d.deviceLabel,
        createdAt: d.createdAt,
        lastUsedAt: d.lastUsedAt,
        current: d.id === s.cred,
      })),
    });
  });

  // サーバ情報：既存ダッシュボード(:8088)の /api/stats を認証下でプロキシ
  app.get("/api/server-stats", requireFull, async (_r, res) => {
    try {
      const u = await fetch(`${DASHBOARD_URL}/api/stats`, { signal: AbortSignal.timeout(8000) });
      if (!u.ok) return res.status(502).json({ error: "dashboard error" });
      res.json(await u.json());
    } catch {
      res.status(502).json({ error: "dashboard unreachable" });
    }
  });

  app.delete("/api/devices/:id", requireFull, async (r, res) => {
    const s = (r as any).session;
    await removeCredential(s.email, r.params.id);
    await audit({ event: "device_revoke", email: s.email, cred: r.params.id, ip: clientIp(r) });
    res.json({ ok: true });
  });

  /* ----------------------- 添付アップロード ----------------------- */
  app.post("/api/upload", instrLimiter, requireFull, upload.single("file"), (r, res) => {
    const f = (r as any).file as Express.Multer.File | undefined;
    if (!f) return res.status(400).json({ error: "no file" });
    // 日本語ファイル名の文字化け対策（multerはlatin1で受ける）
    const name = Buffer.from(f.originalname, "latin1").toString("utf8");
    res.json({ name, hostPath: `${HOST_UPLOADS_DIR}/${f.filename}`, size: f.size, mime: f.mimetype });
  });

  /* ----------------------- 指示の投入（添付を合成して gateway へ） ----------------------- */
  app.post("/api/instruction", instrLimiter, requireFull, async (r, res) => {
    const s = (r as any).session;
    const text = typeof r.body?.text === "string" ? r.body.text.trim() : "";
    const attachments = Array.isArray(r.body?.attachments) ? r.body.attachments : [];
    if (!text && attachments.length === 0) return res.status(400).json({ error: "empty" });
    const composed = composeInstruction(text, attachments);
    try {
      const gw = await fetch(`${GATEWAY_API_URL}/instruction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_TOKEN}` },
        body: JSON.stringify({ text: composed, from: s.email }),
      });
      if (!gw.ok) return res.status(502).json({ error: "gateway error" });
      const out = await gw.json();
      if (out?.id) {
        rememberSpace(out.id, "exec", s.email);
        await appendMsg(histKey(s.email, "exec"), { role: "me", text: userLabel(text, attachments), ts: Date.now() });
      }
      res.json(out);
    } catch {
      res.status(502).json({ error: "gateway unreachable" });
    }
  });

  // 履歴取得（space=exec / task-<id>。ユーザは認証セッションから自動付与）
  app.get("/api/history", requireFull, async (r, res) => {
    const s = (r as any).session;
    const space = String(r.query.space ?? "");
    if (!/^(exec|task-[\w-]+)$/.test(space)) return res.status(400).json({ error: "bad space" });
    res.json({ messages: await readHistory(histKey(s.email, space)) });
  });

  // ブラウザへの SSE（自分の・指定スペースのイベントだけを受け取る）
  app.get("/api/events", requireFull, async (r, res) => {
    const s = (r as any).session;
    const space = String(r.query.space ?? "exec");
    if (!/^(exec|task-[\w-]+)$/.test(space)) return res.status(400).end();
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    try {
      const st = await fetch(`${GATEWAY_API_URL}/status`, { headers: { Authorization: `Bearer ${API_TOKEN}` } });
      if (st.ok) res.write(`event: status\ndata: ${await st.text()}\n\n`);
    } catch {}
    const client = { email: s.email, space, res };
    clients.add(client);
    const ka = setInterval(() => { try { res.write(": keepalive\n\n"); } catch {} }, 20_000);
    r.on("close", () => { clearInterval(ka); clients.delete(client); });
  });

  /* ----------------------- タスク管理 ----------------------- */
  app.get("/api/tasks", requireFull, async (_r, res) => {
    res.json({ tasks: await listTasks(), tags: await allTags() });
  });

  app.post("/api/tasks", requireFull, async (r, res) => {
    const title = typeof r.body?.title === "string" ? r.body.title.trim() : "";
    const tags = Array.isArray(r.body?.tags) ? r.body.tags.map((t: any) => String(t).trim()).filter(Boolean) : [];
    if (!title) return res.status(400).json({ error: "title required" });
    res.json(await createTask(title, tags));
  });

  app.get("/api/tasks/:id", requireFull, async (r, res) => {
    const task = await getTask(r.params.id);
    if (!task) return res.status(404).json({ error: "not found" });
    res.json(task);
  });

  // タスク詳細チャット: 指示でワーカーがそのタスクMarkdownを書き換える
  app.post("/api/tasks/:id/instruct", instrLimiter, requireFull, async (r, res) => {
    const s = (r as any).session;
    const task = await getTask(r.params.id);
    if (!task) return res.status(404).json({ error: "not found" });
    const text = typeof r.body?.text === "string" ? r.body.text.trim() : "";
    const attachments = Array.isArray(r.body?.attachments) ? r.body.attachments : [];
    if (!text && attachments.length === 0) return res.status(400).json({ error: "empty" });
    const base =
      `タスク「${task.title}」の編集作業です。\n` +
      `対象ファイル(実パス): ${task.hostPath}\n\n` +
      `【ユーザの指示】\n${text}\n\n` +
      `この指示に従い、上記の Markdown ファイルを Edit/Write で書き換えてください。` +
      `frontmatter の updated を現在時刻(ISO8601)に更新し、必要に応じて status・tags も調整してください。` +
      `本文の見出し(# ...)は維持しつつ内容を反映すること。完了したら send_response で変更点の要約を返してください。`;
    const composed = composeInstruction(base, attachments);
    try {
      const gw = await fetch(`${GATEWAY_API_URL}/instruction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_TOKEN}` },
        body: JSON.stringify({ text: composed, from: s.email, channel: "task" }),
      });
      if (!gw.ok) return res.status(502).json({ error: "gateway error" });
      const out = await gw.json();
      const space = `task-${r.params.id}`;
      if (out?.id) {
        rememberSpace(out.id, space, s.email);
        await appendMsg(histKey(s.email, space), { role: "me", text: userLabel(text, attachments), ts: Date.now() });
      }
      res.json(out);
    } catch {
      res.status(502).json({ error: "gateway unreachable" });
    }
  });

  /* ----------------------- gateway への GET プロキシ（status のみ） ----------------------- */
  const gwProxy = createProxyMiddleware({
    target: GATEWAY_API_URL,
    changeOrigin: true,
    pathFilter: ["/api/status"],
    pathRewrite: { "^/api": "" },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader("authorization", `Bearer ${API_TOKEN}`);
      },
    },
  });
  app.use("/api/status", requireFull);
  app.use(gwProxy as any);

  /* ----------------------- 画面（HTML） ----------------------- */
  app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));

  const view = (name: string) => path.join(__dirname, "..", "views", name);
  app.get("/login", (_r, res) => res.sendFile(view("login.html")));
  app.get("/enroll", (r, res) => {
    if (!readIdentity(r)) return res.redirect("/login");
    res.sendFile(view("enroll.html"));
  });

  // ポータル本体と子ページ（いずれもフルセッション必須）
  app.get("/", requireFull, (_r, res) => res.sendFile(view("portal.html")));
  app.get("/pages/chat", requireFull, (_r, res) => res.sendFile(view("pages/chat.html")));
  app.get("/pages/server", requireFull, (_r, res) => res.sendFile(view("pages/server.html")));
  app.get("/pages/tasks", requireFull, (_r, res) => res.sendFile(view("pages/tasks.html")));
  app.get("/pages/task", requireFull, (_r, res) => res.sendFile(view("pages/task.html")));
  app.get("/pages/help", requireFull, (_r, res) => res.sendFile(view("pages/help.html")));

  app.listen(WEB_PORT, () => {
    console.log(`[web] listening on :${WEB_PORT}  (public: ${PUBLIC_URL}, rpID: ${rpID})`);
    if (!oauth) console.warn("[web] WARNING: Google OAuth not configured (GOOGLE_CLIENT_ID/SECRET missing)");
    if (allowDevEnroll) console.warn("[web] DEV enroll endpoint /auth/dev is ENABLED (development only)");
  });
}

main().catch((e) => {
  console.error("[web] fatal", e);
  process.exit(1);
});
