import { promises as fs } from "node:fs";
import path from "node:path";

// 1端末＝1パスキー資格情報
export type StoredCredential = {
  id: string; // base64url credential ID
  publicKey: string; // base64url COSE public key
  counter: number;
  transports?: string[];
  deviceLabel: string; // 登録時のUA等から付与する識別ラベル
  createdAt: number;
  lastUsedAt: number;
};

export type StoredUser = {
  email: string;
  name: string;
  createdAt: number;
  credentials: StoredCredential[];
};

type DB = { users: Record<string, StoredUser> };

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const DB_PATH = path.join(DATA_DIR, "store.json");
const LOG_PATH = path.join(DATA_DIR, "access.log");

let db: DB = { users: {} };
let writing: Promise<void> = Promise.resolve();

export async function loadStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    db = JSON.parse(raw);
    if (!db.users) db = { users: {} };
  } catch {
    db = { users: {} };
    await persist();
  }
}

// 原子的書き込み（tmp→rename）
async function persist(): Promise<void> {
  writing = writing.then(async () => {
    const tmp = `${DB_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await fs.rename(tmp, DB_PATH);
  });
  return writing;
}

export function getUser(email: string): StoredUser | undefined {
  return db.users[email.toLowerCase()];
}

export async function upsertUser(email: string, name: string): Promise<StoredUser> {
  const key = email.toLowerCase();
  if (!db.users[key]) {
    db.users[key] = { email: key, name, createdAt: Date.now(), credentials: [] };
  } else if (name) {
    db.users[key].name = name;
  }
  await persist();
  return db.users[key];
}

export async function addCredential(email: string, cred: StoredCredential): Promise<void> {
  const user = getUser(email);
  if (!user) throw new Error("user not found");
  user.credentials.push(cred);
  await persist();
}

export function findCredential(credentialId: string): { user: StoredUser; cred: StoredCredential } | undefined {
  for (const user of Object.values(db.users)) {
    const cred = user.credentials.find((c) => c.id === credentialId);
    if (cred) return { user, cred };
  }
  return undefined;
}

export async function touchCredential(credentialId: string, newCounter: number): Promise<void> {
  const found = findCredential(credentialId);
  if (!found) return;
  found.cred.counter = newCounter;
  found.cred.lastUsedAt = Date.now();
  await persist();
}

export function hasCredential(credentialId: string): boolean {
  return !!findCredential(credentialId);
}

export function listDevices(email: string): StoredCredential[] {
  return getUser(email)?.credentials ?? [];
}

export async function removeCredential(email: string, credentialId: string): Promise<void> {
  const user = getUser(email);
  if (!user) return;
  user.credentials = user.credentials.filter((c) => c.id !== credentialId);
  await persist();
}

// 監査ログ（JSONL追記）
export async function audit(entry: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  await fs.appendFile(LOG_PATH, line, "utf8").catch(() => {});
}
