const paperId = new URLSearchParams(location.search).get("id");
const chat = document.getElementById("chat");
const input = document.getElementById("input");
const composer = document.getElementById("composer");
const titleEl = document.getElementById("pdTitle");
const statusEl = document.getElementById("pdStatus");
const tagsEl = document.getElementById("pdTags");
const openEl = document.getElementById("pdOpen");
const refreshingEl = document.getElementById("pdRefreshing");
const viewEl = document.getElementById("tabView");
const noteEl = document.getElementById("tabNote");

const pending = new Map();

const att = createAttachments({
  listEl: document.getElementById("attachments"),
  fileInput: document.getElementById("fileInput"),
  attachBtn: document.getElementById("attachBtn"),
  textarea: input,
});

function scroll() { chat.scrollTop = chat.scrollHeight; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function userTextToHtml(s) { return escapeHtml(s == null ? "" : s).replace(/\r\n?|\n/g, "<br />"); }

/* ---------------- チャット表示（task と同じ。HTML描画） ---------------- */
function addMessage(kind, text, meta) {
  const el = document.createElement("div");
  el.className = `msg ${kind}`;
  if (meta) { const m = document.createElement("div"); m.className = "meta small muted"; m.textContent = meta; el.appendChild(m); }
  const b = document.createElement("div"); b.className = "body markdown";
  b.innerHTML = kind === "me" ? userTextToHtml(text) : (text == null ? "" : String(text));
  el.appendChild(b);
  chat.appendChild(el); scroll(); return el;
}
function addThinking(id) {
  const el = document.createElement("div");
  el.className = "msg claude thinking";
  const m = document.createElement("div"); m.className = "meta small muted"; m.textContent = "Claude";
  const b = document.createElement("div"); b.className = "body";
  const label = document.createElement("span"); label.className = "tlabel"; label.textContent = "送信しました — 受領待ち";
  const dots = document.createElement("span"); dots.className = "dots";
  dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  b.append(label, dots); el.append(m, b); chat.appendChild(el); scroll();
  pending.set(id, { el, label });
}
function markReceived(id) { const p = pending.get(id); if (p) { p.label.textContent = "受領しました ✓ 編集中"; scroll(); } }
function setProgress(id, text) { const p = pending.get(id); if (p) { p.label.textContent = text; scroll(); } else addMessage("progress", text, "経過"); }
async function finalize(id, text) {
  const p = pending.get(id);
  if (p) { p.el.classList.remove("thinking"); const b = p.el.querySelector(".body"); b.classList.add("markdown"); b.innerHTML = text == null ? "" : String(text); pending.delete(id); scroll(); }
  else addMessage("claude", text, "Claude");
  await loadPaper(false); // 解説のみリフレッシュ（ビューアは保持）
}

/* ---------------- 論文ビューア（タブ1） ---------------- */
let viewerSig = null; // 再描画判定用シグネチャ
function renderViewer(p) {
  const sig = `${p.kind}|${p.file || ""}|${p.source || ""}`;
  if (sig === viewerSig) return; // 変化なしなら再描画しない（iframe再読込を避ける）
  viewerSig = sig;
  viewEl.textContent = "";
  const fileUrl = `/api/papers/${encodeURIComponent(paperId)}/file`;

  const makeIframe = (src, sandbox) => {
    const f = document.createElement("iframe");
    f.className = "paper-frame";
    if (sandbox) f.setAttribute("sandbox", "allow-same-origin allow-popups allow-forms");
    f.src = src;
    return f;
  };

  if (p.kind === "pdf") {
    viewEl.appendChild(makeIframe(fileUrl, false));
  } else if (p.kind === "url") {
    if (p.source) viewEl.appendChild(makeIframe(p.source, false));
    else viewEl.appendChild(noteBox("表示できる対象がありません。"));
  } else if (p.kind === "html") {
    viewEl.appendChild(makeIframe(fileUrl, true)); // 取得HTMLはスクリプト無効で表示
  } else if (p.kind === "tex" || p.kind === "text") {
    const pre = document.createElement("pre");
    pre.className = "paper-src";
    pre.textContent = "読み込み中…";
    viewEl.appendChild(pre);
    fetch(fileUrl).then((r) => (r.ok ? r.text() : Promise.reject())).then((t) => { pre.textContent = t; }).catch(() => { pre.textContent = "ファイルを読み込めませんでした。"; });
  } else {
    // other: ダウンロードリンク
    const box = noteBox("このファイル形式はプレビュー非対応です。");
    if (p.file) {
      const a = document.createElement("a");
      a.href = fileUrl; a.className = "btn ghost small"; a.textContent = "⬇ ダウンロード"; a.setAttribute("download", "");
      box.appendChild(document.createElement("br"));
      box.appendChild(a);
    }
    viewEl.appendChild(box);
  }
}
function noteBox(text) {
  const d = document.createElement("div");
  d.className = "paper-empty muted";
  d.textContent = text;
  return d;
}

/* ---------------- タブ切替 ---------------- */
document.querySelectorAll(".tabbar .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tabbar .tab").forEach((t) => t.classList.toggle("active", t === tab));
    const which = tab.dataset.tab;
    viewEl.classList.toggle("active", which === "view");
    noteEl.classList.toggle("active", which === "note");
  });
});

/* ---------------- 読み込み ---------------- */
async function loadPaper(renderView = true) {
  refreshingEl.hidden = false;
  try {
    const res = await fetch(`/api/papers/${encodeURIComponent(paperId)}`);
    if (res.status === 401) { top.location.href = "/login"; return; }
    if (!res.ok) { noteEl.textContent = "論文が見つかりません"; return; }
    const p = await res.json();
    titleEl.textContent = p.title;
    statusEl.textContent = p.status;
    statusEl.className = `ti-status st-${p.status}`;
    noteEl.innerHTML = p.body == null ? "" : String(p.body);
    tagsEl.textContent = "";
    (p.tags || []).forEach((tag) => { const s = document.createElement("span"); s.className = "tagchip mini"; s.textContent = "#" + tag; tagsEl.appendChild(s); });
    if (p.source) { openEl.hidden = false; openEl.href = p.source; } else { openEl.hidden = true; }
    if (renderView) renderViewer(p);
  } catch {
    noteEl.textContent = "読み込みエラー";
  } finally {
    refreshingEl.hidden = true;
  }
}

function connect() {
  const es = new EventSource(`/api/events?space=paper-${encodeURIComponent(paperId)}`);
  es.onmessage = (e) => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.type === "received") markReceived(ev.instructionId);
    else if (ev.type === "progress") setProgress(ev.instructionId, ev.text);
    else if (ev.type === "response" && ev.done) finalize(ev.instructionId, ev.text);
    else if (ev.type === "response") setProgress(ev.instructionId, ev.text);
  };
}

async function send() {
  const text = input.value.trim();
  const attachments = att.get();
  if (!text && attachments.length === 0) return;
  const label = attachments.length ? `${text}${text ? "\n" : ""}📎 ${attachments.map((a) => a.name).join(", ")}` : text;
  addMessage("me", label, "あなた");
  input.value = ""; att.clear();
  try {
    const res = await fetch(`/api/papers/${encodeURIComponent(paperId)}/instruct`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, attachments }),
    });
    if (res.status === 401) { top.location.href = "/login"; return; }
    if (!res.ok) { addMessage("progress", "送信に失敗しました。", "エラー"); return; }
    const { id } = await res.json();
    addThinking(id);
  } catch { addMessage("progress", "ネットワークエラー。", "エラー"); }
}

// IME変換中フラグ。Macで日本語確定のEnterが送信に化けるのを防ぐ。
let composing = false;
input.addEventListener("compositionstart", () => { composing = true; });
input.addEventListener("compositionend", () => { composing = false; });
const sendBtn = document.getElementById("send");
sendBtn.addEventListener("click", () => send());
composer.addEventListener("submit", (e) => e.preventDefault());
input.addEventListener("keydown", (e) => {
  if (composing || e.isComposing || e.keyCode === 229) return;
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); send(); }
});

async function loadHistory() {
  try {
    const res = await fetch(`/api/history?space=paper-${encodeURIComponent(paperId)}`);
    if (!res.ok) return;
    const { messages } = await res.json();
    for (const m of messages || []) addMessage(m.role, m.text, m.role === "me" ? "あなた" : "Claude");
  } catch {}
}

// 上部(.pd-top)と指示エリアの境界をドラッグで上下動。
function setupSplitter() {
  const splitter = document.getElementById("pdSplitter");
  const top = document.querySelector(".pd-top");
  if (!splitter || !top) return;
  const saved = Number(localStorage.getItem("ccrt.pdTopHeight"));
  if (saved && saved > 80) top.style.height = saved + "px";
  let dragging = false, startY = 0, startH = 0;
  const clientY = (e) => (e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY);
  const onMove = (e) => {
    if (!dragging) return;
    const dy = clientY(e) - startY;
    const maxH = window.innerHeight - 160;
    const h = Math.max(80, Math.min(startH + dy, Math.max(80, maxH)));
    top.style.height = h + "px";
    e.preventDefault();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false; splitter.classList.remove("dragging"); document.body.style.userSelect = "";
    localStorage.setItem("ccrt.pdTopHeight", String(Math.round(top.getBoundingClientRect().height)));
  };
  const onDown = (e) => {
    dragging = true; startY = clientY(e); startH = top.getBoundingClientRect().height;
    splitter.classList.add("dragging"); document.body.style.userSelect = "none"; e.preventDefault();
  };
  splitter.addEventListener("mousedown", onDown);
  splitter.addEventListener("touchstart", onDown, { passive: false });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("mouseup", onUp);
  window.addEventListener("touchend", onUp);
}
setupSplitter();

// 論文を「ポップアップ別ウィンドウ」（タブ/URLバー等のChrome UIなし）で開く。
// popup=yes + 明示サイズ指定でタブではなく独立ウィンドウになる。
const popoutBtn = document.getElementById("pdPopout");
if (popoutBtn) {
  popoutBtn.addEventListener("click", () => {
    if (!paperId) return;
    const w = (window.screen && screen.availWidth) || 1200;
    const h = (window.screen && screen.availHeight) || 800;
    const feat = `popup=yes,width=${w},height=${h},left=0,top=0,toolbar=no,location=no,menubar=no,status=no`;
    window.open(`/pages/paper-view?id=${encodeURIComponent(paperId)}`, `paperview_${paperId}`, feat);
  });
}

if (!paperId) { noteEl.textContent = "論文IDがありません"; }
else { loadPaper(true); loadHistory().then(connect); }
