import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { hasCredential } from "./store.js";

const SESSION_SECRET = required("SESSION_SECRET");
const SESSION_EPOCH = process.env.SESSION_EPOCH ?? "1"; // 値を変えると全セッションを一括失効
// false にするとパスキー必須を解除し、Googleログインだけでフルセッションを許可（一時運用向け）
const REQUIRE_PASSKEY = process.env.REQUIRE_PASSKEY !== "false";
export function isPasskeyRequired(): boolean {
  return REQUIRE_PASSKEY;
}
const ALLOWED = new Set(
  (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

export const COOKIE_IDENTITY = "ccrt_idy"; // Google認証済み(端末未登録/未認証)
export const COOKIE_SESSION = "ccrt_session"; // パスキー認証済みのフルセッション
export const COOKIE_CHALLENGE = "ccrt_chal"; // WebAuthnチャレンジの一時保管

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[web] FATAL: missing required env ${name}`);
    process.exit(1);
  }
  return v;
}

export function isAllowedEmail(email: string): boolean {
  return ALLOWED.has(email.toLowerCase());
}

const isProd = process.env.NODE_ENV !== "development";
const baseCookie = {
  httpOnly: true,
  secure: isProd, // Funnel配下はHTTPS。開発時(localhost http)はsecureを外す
  // Lax: OAuthコールバック直後のリダイレクトでもクッキーが送られる。
  //      クロスサイトPOSTは送らないためCSRF対策としても十分。
  sameSite: "lax" as const,
  path: "/",
};

/* -------- identity トークン（Google認証直後・パスキー登録の足場） -------- */
export function setIdentityCookie(res: Response, email: string, name: string): void {
  const token = jwt.sign({ email, name, stage: "identity" }, SESSION_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
  res.cookie(COOKIE_IDENTITY, token, { ...baseCookie, maxAge: 60 * 60 * 1000 });
}

export type Identity = { email: string; name: string };
export function readIdentity(req: Request): Identity | null {
  const token = req.cookies?.[COOKIE_IDENTITY];
  if (!token) return null;
  try {
    const p = jwt.verify(token, SESSION_SECRET, { algorithms: ["HS256"] }) as any;
    if (p.stage !== "identity" || !isAllowedEmail(p.email)) return null;
    return { email: p.email, name: p.name };
  } catch {
    return null;
  }
}

/* -------- full セッション（パスキー認証済み / もしくはGoogleのみ） -------- */
export function setSessionCookie(
  res: Response,
  email: string,
  name: string,
  credId: string,
  via: "passkey" | "google" = "passkey"
): void {
  const token = jwt.sign({ email, name, cred: credId, via, ver: SESSION_EPOCH, stage: "full" }, SESSION_SECRET, {
    algorithm: "HS256",
    expiresIn: "12h",
  });
  res.cookie(COOKIE_SESSION, token, { ...baseCookie, maxAge: 12 * 60 * 60 * 1000 });
}

export type Session = { email: string; name: string; cred: string };
export function readSession(req: Request): Session | null {
  const token = req.cookies?.[COOKIE_SESSION];
  if (!token) return null;
  try {
    const p = jwt.verify(token, SESSION_SECRET, { algorithms: ["HS256"] }) as any;
    if (p.stage !== "full") return null;
    if (String(p.ver) !== SESSION_EPOCH) return null; // 一括失効
    if (!isAllowedEmail(p.email)) return null; // 許可リストから外れたら無効
    if (p.via === "passkey") {
      if (!hasCredential(p.cred)) return null; // 端末(資格情報)が削除されていたら無効
    } else {
      // Googleのみセッション。パスキー必須に戻したら無効化される。
      if (REQUIRE_PASSKEY) return null;
    }
    return { email: p.email, name: p.name, cred: p.cred };
  } catch {
    return null;
  }
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(COOKIE_IDENTITY, { ...baseCookie });
  res.clearCookie(COOKIE_SESSION, { ...baseCookie });
}

/* -------- チャレンジ用の短命Cookie -------- */
export function setChallengeCookie(res: Response, purpose: "reg" | "auth", challenge: string, email?: string): void {
  const token = jwt.sign({ purpose, challenge, email }, SESSION_SECRET, { algorithm: "HS256", expiresIn: "5m" });
  res.cookie(COOKIE_CHALLENGE, token, { ...baseCookie, maxAge: 5 * 60 * 1000 });
}
export function readChallenge(req: Request, purpose: "reg" | "auth"): { challenge: string; email?: string } | null {
  const token = req.cookies?.[COOKIE_CHALLENGE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, SESSION_SECRET, { algorithms: ["HS256"] }) as any;
    if (p.purpose !== purpose) return null;
    return { challenge: p.challenge, email: p.email };
  } catch {
    return null;
  }
}
export function clearChallengeCookie(res: Response): void {
  res.clearCookie(COOKIE_CHALLENGE, { ...baseCookie });
}

/* -------- ミドルウェア -------- */
// フルセッション必須（命令送信・SPA本体）。未認証はAPIなら401、画面なら/loginへ。
export function requireFull(req: Request, res: Response, next: NextFunction): void {
  const s = readSession(req);
  if (!s) {
    // マウント時は req.path が短縮されるため originalUrl で判定
    if (req.originalUrl.startsWith("/api")) res.status(401).json({ error: "unauthorized" });
    else res.redirect("/login");
    return;
  }
  (req as any).session = s;
  next();
}
