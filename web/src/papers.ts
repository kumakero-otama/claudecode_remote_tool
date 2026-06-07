import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// 論文管理: 参考文献を読み込んで理解するための補助。
// 各論文は frontmatter 付き <id>.md（本文＝ワーカーが書く解説HTML）として保存し、
// 論文そのもののファイル（PDF等）は PAPERS_DIR/files/<id>.<ext> に保存する。
const PAPERS_DIR = process.env.PAPERS_DIR ?? "/papers";
const HOST_PAPERS_DIR = process.env.HOST_PAPERS_DIR ?? PAPERS_DIR;
const FILES_DIR = path.join(PAPERS_DIR, "files");

export type PaperKind = "pdf" | "html" | "tex" | "text" | "url" | "other";
export type PaperMeta = {
  id: string;
  title: string;
  tags: string[];
  status: string;
  updated: string | null;
  kind: PaperKind;
  source: string | null; // 元URL（あれば）
  file: string | null; // files/ 内のファイル名（DL/アップロード時）
  filemime: string | null;
};
export type Paper = PaperMeta & { body: string; hostPath: string; fileHostPath: string | null };

// id は英数・ハイフン・アンダースコアのみ（パストラバーサル防止）
function safeId(id: string): string | null {
  return /^[\w-]+$/.test(id) ? id : null;
}

function filePath(id: string): string {
  return path.join(PAPERS_DIR, `${id}.md`);
}
export function paperHostPath(id: string): string {
  return `${HOST_PAPERS_DIR}/${id}.md`;
}
export function paperFileHostPath(file: string): string {
  return `${HOST_PAPERS_DIR}/files/${file}`;
}
export function paperFilesDir(): string {
  return FILES_DIR;
}
export async function ensurePaperFilesDir(): Promise<string> {
  await fs.mkdir(FILES_DIR, { recursive: true });
  return FILES_DIR;
}

// frontmatter(---で囲まれたYAML)と本文を分離
function splitFrontmatter(raw: string): { fm: any; body: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  let fm: any = {};
  try { fm = parseYaml(m[1]) ?? {}; } catch { fm = {}; }
  return { fm, body: m[2] ?? "" };
}

const KINDS: PaperKind[] = ["pdf", "html", "tex", "text", "url", "other"];
function toMeta(id: string, fm: any): PaperMeta {
  const tags = Array.isArray(fm?.tags)
    ? fm.tags.map((t: any) => String(t))
    : typeof fm?.tags === "string"
      ? fm.tags.split(",").map((s: string) => s.trim()).filter(Boolean)
      : [];
  const kind: PaperKind = KINDS.includes(fm?.kind) ? fm.kind : "other";
  return {
    id,
    title: typeof fm?.title === "string" && fm.title ? fm.title : id,
    tags,
    status: typeof fm?.status === "string" ? fm.status : "todo",
    updated: typeof fm?.updated === "string" ? fm.updated : null,
    kind,
    source: typeof fm?.source === "string" ? fm.source : null,
    file: typeof fm?.file === "string" ? fm.file : null,
    filemime: typeof fm?.filemime === "string" ? fm.filemime : null,
  };
}

export async function listPapers(): Promise<PaperMeta[]> {
  await fs.mkdir(PAPERS_DIR, { recursive: true });
  const files = (await fs.readdir(PAPERS_DIR)).filter((f) => f.endsWith(".md"));
  const out: PaperMeta[] = [];
  for (const f of files) {
    const id = f.slice(0, -3);
    if (!safeId(id)) continue;
    try {
      const raw = await fs.readFile(path.join(PAPERS_DIR, f), "utf8");
      out.push(toMeta(id, splitFrontmatter(raw).fm));
    } catch {}
  }
  out.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
  return out;
}

export async function getPaper(id: string): Promise<Paper | null> {
  if (!safeId(id)) return null;
  try {
    const raw = await fs.readFile(filePath(id), "utf8");
    const { fm, body } = splitFrontmatter(raw);
    const meta = toMeta(id, fm);
    return {
      ...meta,
      body,
      hostPath: paperHostPath(id),
      fileHostPath: meta.file ? paperFileHostPath(meta.file) : null,
    };
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// 一意の id を生成（タイトル由来 or タイムスタンプ）
export async function newPaperId(title: string): Promise<string> {
  await fs.mkdir(PAPERS_DIR, { recursive: true });
  const base = title.toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  let id = base || `paper-${Date.now()}`;
  try { await fs.access(filePath(id)); id = `${id}-${Date.now().toString(36).slice(-4)}`; } catch {}
  return id;
}

export type CreatePaperInput = {
  id: string;
  title: string;
  tags: string[];
  kind: PaperKind;
  source?: string | null;
  file?: string | null;
  filemime?: string | null;
};

// 論文アイテム（<id>.md）を作成。本文は解説HTMLの初期テンプレ。
export async function createPaper(input: CreatePaperInput): Promise<PaperMeta> {
  await fs.mkdir(PAPERS_DIR, { recursive: true });
  const now = new Date().toISOString();
  const fm: any = {
    title: input.title,
    tags: input.tags,
    status: "todo",
    updated: now,
    kind: input.kind,
    source: input.source ?? null,
    file: input.file ?? null,
    filemime: input.filemime ?? null,
  };
  const content =
    `---\n${stringifyYaml(fm)}---\n\n` +
    `<h1>${esc(input.title)}</h1>\n` +
    `<p>（この論文の要点・理解メモはチャットで指示すると Claude が HTML で記載します）</p>\n`;
  await fs.writeFile(filePath(input.id), content, "utf8");
  // ワーカー(別uid=ホストのotama)が編集できるよう書込権限を付与
  await fs.chmod(filePath(input.id), 0o666).catch(() => {});
  return toMeta(input.id, fm);
}

export async function deletePaper(id: string): Promise<boolean> {
  if (!safeId(id)) return false;
  const p = await getPaper(id);
  try { await fs.unlink(filePath(id)); } catch { return false; }
  if (p?.file) {
    try { await fs.unlink(path.join(FILES_DIR, p.file)); } catch {}
  }
  return true;
}

// 全論文のタグ一覧（フィルタUI用）
export async function allTags(): Promise<string[]> {
  const papers = await listPapers();
  const set = new Set<string>();
  papers.forEach((p) => p.tags.forEach((tag) => set.add(tag)));
  return [...set].sort();
}
