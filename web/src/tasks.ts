import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const TASKS_DIR = process.env.TASKS_DIR ?? "/tasks";
const HOST_TASKS_DIR = process.env.HOST_TASKS_DIR ?? TASKS_DIR;

export type TaskMeta = {
  id: string;
  title: string;
  tags: string[];
  status: string;
  updated: string | null;
};
export type Task = TaskMeta & { body: string; hostPath: string };

// id は英数・ハイフン・アンダースコアのみ（パストラバーサル防止）
function safeId(id: string): string | null {
  return /^[\w-]+$/.test(id) ? id : null;
}

function filePath(id: string): string {
  return path.join(TASKS_DIR, `${id}.md`);
}
export function taskHostPath(id: string): string {
  return `${HOST_TASKS_DIR}/${id}.md`;
}

// frontmatter(---で囲まれたYAML)と本文を分離
function splitFrontmatter(raw: string): { fm: any; body: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  let fm: any = {};
  try { fm = parseYaml(m[1]) ?? {}; } catch { fm = {}; }
  return { fm, body: m[2] ?? "" };
}

function toMeta(id: string, fm: any): TaskMeta {
  const tags = Array.isArray(fm?.tags)
    ? fm.tags.map((t: any) => String(t))
    : typeof fm?.tags === "string"
      ? fm.tags.split(",").map((s: string) => s.trim()).filter(Boolean)
      : [];
  return {
    id,
    title: typeof fm?.title === "string" && fm.title ? fm.title : id,
    tags,
    status: typeof fm?.status === "string" ? fm.status : "todo",
    updated: typeof fm?.updated === "string" ? fm.updated : null,
  };
}

export async function listTasks(): Promise<TaskMeta[]> {
  await fs.mkdir(TASKS_DIR, { recursive: true });
  const files = (await fs.readdir(TASKS_DIR)).filter((f) => f.endsWith(".md"));
  const out: TaskMeta[] = [];
  for (const f of files) {
    const id = f.slice(0, -3);
    if (!safeId(id)) continue;
    try {
      const raw = await fs.readFile(path.join(TASKS_DIR, f), "utf8");
      out.push(toMeta(id, splitFrontmatter(raw).fm));
    } catch {}
  }
  // 更新日時の新しい順
  out.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
  return out;
}

export async function getTask(id: string): Promise<Task | null> {
  if (!safeId(id)) return null;
  try {
    const raw = await fs.readFile(filePath(id), "utf8");
    const { fm, body } = splitFrontmatter(raw);
    return { ...toMeta(id, fm), body, hostPath: taskHostPath(id) };
  } catch {
    return null;
  }
}

export async function createTask(title: string, tags: string[]): Promise<TaskMeta> {
  await fs.mkdir(TASKS_DIR, { recursive: true });
  const now = new Date().toISOString();
  // タイトルからidを生成（日本語等はタイムスタンプベースに）
  const base = title.toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  let id = base || `task-${Date.now()}`;
  // 衝突回避
  try { await fs.access(filePath(id)); id = `${id}-${Date.now().toString(36).slice(-4)}`; } catch {}
  const fm = { title, tags, status: "todo", updated: now };
  // 本文はHTML（画像・リンク埋め込み可）。タイトルはエスケープして埋め込む。
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const content = `---\n${stringifyYaml(fm)}---\n\n<h1>${esc(title)}</h1>\n<p>（ここにタスクの内容。チャットからの指示でClaudeがHTMLで編集します）</p>\n`;
  await fs.writeFile(filePath(id), content, "utf8");
  // ワーカー(別uid=ホストのotama)が編集できるよう書込権限を付与
  await fs.chmod(filePath(id), 0o666).catch(() => {});
  return toMeta(id, fm);
}

// タスク本文(HTML)内の N番目のチェックボックスの checked 状態を保存する。
// index は本文ソース順（=ブラウザのDOM順）での 0 始まりの番号。
// どのタスクの・どんなチェックボックスでも「<input type=checkbox> が在れば」共通で扱える汎用処理。
export async function setCheckbox(id: string, index: number, checked: boolean): Promise<Task | null> {
  if (!safeId(id)) return null;
  let raw: string;
  try { raw = await fs.readFile(filePath(id), "utf8"); } catch { return null; }
  const { fm, body } = splitFrontmatter(raw);
  // 本文中の <input ... type="checkbox" ...> を出現順に収集
  const re = /<input\b[^>]*?type\s*=\s*["']?checkbox["']?[^>]*>/gi;
  const tags: { tag: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) tags.push({ tag: m[0], start: m.index, end: m.index + m[0].length });
  if (!Number.isInteger(index) || index < 0 || index >= tags.length) return null; // 範囲外
  const t = tags[index];
  let newTag = t.tag;
  const hasChecked = /\bchecked\b/i.test(newTag);
  if (checked && !hasChecked) {
    newTag = newTag.replace(/\s*\/?>\s*$/, " checked>");
  } else if (!checked && hasChecked) {
    newTag = newTag.replace(/\s+checked(\s*=\s*["'][^"']*["'])?/i, "");
  }
  if (newTag === t.tag) {
    // 変化なし。ファイルは触らず現状を返す
    return { ...toMeta(id, fm), body, hostPath: taskHostPath(id) };
  }
  const newBody = body.slice(0, t.start) + newTag + body.slice(t.end);
  const now = new Date().toISOString();
  const newFm = { ...(fm ?? {}), updated: now };
  const content = `---\n${stringifyYaml(newFm)}---\n${newBody}`;
  await fs.writeFile(filePath(id), content, "utf8");
  // ワーカー(別uid)も編集できるよう書込権限を維持
  await fs.chmod(filePath(id), 0o666).catch(() => {});
  return { ...toMeta(id, newFm), body: newBody, hostPath: taskHostPath(id) };
}

// 全タスクのタグ一覧（フィルタUI用）
export async function allTags(): Promise<string[]> {
  const tasks = await listTasks();
  const set = new Set<string>();
  tasks.forEach((t) => t.tags.forEach((tag) => set.add(tag)));
  return [...set].sort();
}
