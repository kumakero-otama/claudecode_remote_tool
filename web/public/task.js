const taskId = new URLSearchParams(location.search).get("id");
const chat = document.getElementById("chat");
const input = document.getElementById("input");
const composer = document.getElementById("composer");
const bodyEl = document.getElementById("tdBody");
const titleEl = document.getElementById("tdTitle");
const statusEl = document.getElementById("tdStatus");
const tagsEl = document.getElementById("tdTags");
const refreshingEl = document.getElementById("tdRefreshing");

const pending = new Map();

const att = createAttachments({
  listEl: document.getElementById("attachments"),
  fileInput: document.getElementById("fileInput"),
  attachBtn: document.getElementById("attachBtn"),
  textarea: input,
});

function scroll() { chat.scrollTop = chat.scrollHeight; }

// タスク本文・Claude返信は「HTMLとしてそのまま」描画する（Markdown変換はしない）。
// ユーザー自身の発言だけはプレーンテキスト扱いにするため、エスケープして改行を<br>化。
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// 自分の発言: 入力したプレーンテキストを安全に表示（改行のみ反映）
function userTextToHtml(s) { return escapeHtml(s == null ? "" : s).replace(/\r\n?|\n/g, "<br />"); }

function addMessage(kind, text, meta) {
  const el = document.createElement("div");
  el.className = `msg ${kind}`;
  if (meta) { const m = document.createElement("div"); m.className = "meta small muted"; m.textContent = meta; el.appendChild(m); }
  const b = document.createElement("div"); b.className = "body markdown";
  // 自分の発言はテキスト扱い、Claude/経過の応答は受け取ったHTMLをそのまま描画
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
  await loadTask(); // タスク本文をリフレッシュ
}

// 本文(tdBody)内のチェックボックスを操作可能にし、変更をサーバへ保存する。
// index は本文内の出現順（=サーバ側の数え方と一致）。
function wireCheckboxes() {
  const boxes = bodyEl.querySelectorAll('input[type="checkbox"]');
  boxes.forEach((box, idx) => {
    box.disabled = false;            // 変換時に付いた disabled を解除して操作可能に
    box.dataset.cbIndex = String(idx);
    box.addEventListener("change", onCheckboxChange);
  });
}
async function onCheckboxChange(e) {
  const box = e.currentTarget;
  const index = Number(box.dataset.cbIndex);
  const checked = box.checked;
  box.disabled = true; // 保存中は二重操作を防ぐ
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/checkbox`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index, checked }),
    });
    if (res.status === 401) { top.location.href = "/login"; return; }
    if (!res.ok) throw new Error("save failed");
  } catch {
    box.checked = !checked; // 失敗したら表示を元に戻す
  } finally {
    box.disabled = false;
  }
}

async function loadTask() {
  refreshingEl.hidden = false;
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (res.status === 401) { top.location.href = "/login"; return; }
    if (!res.ok) { bodyEl.textContent = "タスクが見つかりません"; return; }
    const t = await res.json();
    titleEl.textContent = t.title;
    statusEl.textContent = t.status;
    statusEl.className = `ti-status st-${t.status}`;
    bodyEl.innerHTML = t.body == null ? "" : String(t.body); // 本文はHTMLとしてそのまま表示
    wireCheckboxes(); // 本文内チェックボックスを操作可能にし、状態をサーバ保存
    tagsEl.textContent = "";
    t.tags.forEach((tag) => { const s = document.createElement("span"); s.className = "tagchip mini"; s.textContent = "#" + tag; tagsEl.appendChild(s); });
  } catch {
    bodyEl.textContent = "読み込みエラー";
  } finally {
    refreshingEl.hidden = true;
  }
}

function connect() {
  const es = new EventSource(`/api/events?space=task-${encodeURIComponent(taskId)}`);
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
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/instruct`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, attachments }),
    });
    if (res.status === 401) { top.location.href = "/login"; return; }
    if (!res.ok) { addMessage("progress", "送信に失敗しました。", "エラー"); return; }
    const { id } = await res.json();
    addThinking(id);
  } catch { addMessage("progress", "ネットワークエラー。", "エラー"); }
}

// IME変換中フラグ。Macで日本語確定のEnterが送信に化けるのを防ぐ要。
let composing = false;
input.addEventListener("compositionstart", () => { composing = true; });
input.addEventListener("compositionend", () => { composing = false; });

// 送信は「送信ボタンのクリック」と「Ctrl/Cmd+Enter」のみ。
// ボタンは type="button" なのでEnterによるフォーム暗黙送信は起きない（誤送信防止）。
const sendBtn = document.getElementById("send");
sendBtn.addEventListener("click", () => send());
composer.addEventListener("submit", (e) => e.preventDefault());
input.addEventListener("keydown", (e) => {
  // IME変換確定のEnter（変換中 / isComposing / keyCode 229）では送信しない
  if (composing || e.isComposing || e.keyCode === 229) return;
  // Ctrl+Enter（Macは Cmd+Enter）または Shift+Enter で送信。単独Enterはtextareaの改行に任せる
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); send(); }
});

async function loadHistory() {
  try {
    const res = await fetch(`/api/history?space=task-${encodeURIComponent(taskId)}`);
    if (!res.ok) return;
    const { messages } = await res.json();
    for (const m of messages || []) addMessage(m.role, m.text, m.role === "me" ? "あなた" : "Claude");
  } catch {}
}

// 表示エリア(.td-body-wrap)と指示エリア(.td-chat)の境界をドラッグで上下動して高さ調整。
function setupSplitter() {
  const splitter = document.getElementById("tdSplitter");
  const wrap = document.querySelector(".td-body-wrap");
  if (!splitter || !wrap) return;
  // 前回の高さを復元（全タスク共通）
  const saved = Number(localStorage.getItem("ccrt.tdBodyHeight"));
  if (saved && saved > 56) wrap.style.height = saved + "px";

  let dragging = false, startY = 0, startH = 0;
  const clientY = (e) => (e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY);
  const onMove = (e) => {
    if (!dragging) return;
    const dy = clientY(e) - startY;
    const maxH = window.innerHeight - 160; // 指示エリアに最低限を残す
    const h = Math.max(56, Math.min(startH + dy, Math.max(56, maxH)));
    wrap.style.height = h + "px";
    e.preventDefault();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    document.body.style.userSelect = "";
    localStorage.setItem("ccrt.tdBodyHeight", String(Math.round(wrap.getBoundingClientRect().height)));
  };
  const onDown = (e) => {
    dragging = true;
    startY = clientY(e);
    startH = wrap.getBoundingClientRect().height;
    splitter.classList.add("dragging");
    document.body.style.userSelect = "none";
    e.preventDefault();
  };
  splitter.addEventListener("mousedown", onDown);
  splitter.addEventListener("touchstart", onDown, { passive: false });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("mouseup", onUp);
  window.addEventListener("touchend", onUp);
}
setupSplitter();

if (!taskId) { bodyEl.textContent = "タスクIDがありません"; }
else { loadTask(); loadHistory().then(connect); }
