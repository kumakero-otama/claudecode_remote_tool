import { promises as fs } from "node:fs";
import path from "node:path";

// チャット履歴をスペース別(JSONL)に保存する。
// スペースキー: "exec" もしくは "task-<taskId>"
const HISTORY_DIR = path.join(process.env.DATA_DIR ?? "/data", "chat");
const MAX_RETURN = 300;

export type ChatMsg = { role: "me" | "claude"; text: string; ts: number };

// 履歴キー: "<userkey>__exec" または "<userkey>__task-<id>"
export function validSpace(space: string): boolean {
  return /^[\w-]+__(exec|task-[\w-]+)$/.test(space) && space.length < 200;
}

function fileFor(space: string): string {
  return path.join(HISTORY_DIR, `${space}.jsonl`);
}

export async function appendMsg(space: string, msg: ChatMsg): Promise<void> {
  if (!validSpace(space)) return;
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.appendFile(fileFor(space), JSON.stringify(msg) + "\n", "utf8").catch(() => {});
}

export async function readHistory(space: string): Promise<ChatMsg[]> {
  if (!validSpace(space)) return [];
  try {
    const raw = await fs.readFile(fileFor(space), "utf8");
    const msgs = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l) as ChatMsg; } catch { return null; }
      })
      .filter((m): m is ChatMsg => !!m);
    return msgs.slice(-MAX_RETURN);
  } catch {
    return [];
  }
}
