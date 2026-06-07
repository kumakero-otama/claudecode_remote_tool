const chat = document.getElementById("chat");
const input = document.getElementById("input");
const composer = document.getElementById("composer");
const workerDot = document.getElementById("worker");
const workerText = document.getElementById("workerText");

const att = createAttachments({
  listEl: document.getElementById("attachments"),
  fileInput: document.getElementById("fileInput"),
  attachBtn: document.getElementById("attachBtn"),
  textarea: input,
});

// 処理中の指示: instruction_id -> { el(吹き出し), bodyEl, metaEl }
const pending = new Map();

function scroll() { chat.scrollTop = chat.scrollHeight; }

function addMessage(kind, text, meta) {
  const el = document.createElement("div");
  el.className = `msg ${kind}`;
  if (meta) {
    const m = document.createElement("div");
    m.className = "meta small muted";
    m.textContent = meta;
    el.appendChild(m);
  }
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text; // textContent固定：XSS対策
  el.appendChild(body);
  chat.appendChild(el);
  scroll();
  return el;
}

// 思考中の吹き出し（受領待ち→考え中）。アニメするドット付き。
function addThinking(id) {
  const el = document.createElement("div");
  el.className = "msg claude thinking";
  const meta = document.createElement("div");
  meta.className = "meta small muted";
  meta.textContent = "Claude";
  const body = document.createElement("div");
  body.className = "body";
  const label = document.createElement("span");
  label.className = "tlabel";
  label.textContent = "送信しました — 受領待ち";
  const dots = document.createElement("span");
  dots.className = "dots";
  dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  body.append(label, dots);
  el.append(meta, body);
  chat.appendChild(el);
  scroll();
  pending.set(id, { el, label });
}

function markReceived(id) {
  const p = pending.get(id);
  if (p) { p.label.textContent = "受領しました ✓ 考え中"; scroll(); }
}

function setProgress(id, text) {
  const p = pending.get(id);
  if (p) { p.label.textContent = text; scroll(); }
  else addMessage("progress", text, "経過");
}

function finalize(id, text) {
  const p = pending.get(id);
  if (p) {
    p.el.classList.remove("thinking");
    p.el.querySelector(".body").textContent = text; // ドット等を消して結果に置換
    pending.delete(id);
    scroll();
  } else {
    addMessage("claude", text, "Claude");
  }
}

function setWorker(online) {
  workerDot.style.color = online ? "#2ecc71" : "#bbb";
  workerText.textContent = online ? "ワーカー接続中" : "ワーカー未接続";
}

function connect() {
  const es = new EventSource("/api/events?space=exec");
  es.addEventListener("status", (e) => {
    try { setWorker(JSON.parse(e.data).workerOnline); } catch {}
  });
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.type === "received") markReceived(ev.instructionId);
    else if (ev.type === "progress") setProgress(ev.instructionId, ev.text);
    else if (ev.type === "response") {
      if (ev.done) finalize(ev.instructionId, ev.text);
      else setProgress(ev.instructionId, ev.text);
    } else if (ev.type === "worker_status") setWorker(ev.online);
  };
  es.onerror = () => setWorker(false);
}

async function send() {
  const text = input.value.trim();
  const attachments = att.get();
  if (!text && attachments.length === 0) return;
  const label = attachments.length ? `${text}${text ? "\n" : ""}📎 ${attachments.map((a) => a.name).join(", ")}` : text;
  addMessage("me", label, "あなた");
  input.value = "";
  att.clear();
  try {
    const res = await fetch("/api/instruction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, attachments }),
    });
    if (res.status === 401) { top.location.href = "/login"; return; }
    if (!res.ok) { addMessage("progress", "送信に失敗しました。", "エラー"); return; }
    const { id } = await res.json();
    addThinking(id); // 受領待ちの思考中バブルを表示
  } catch {
    addMessage("progress", "ネットワークエラー。", "エラー");
  }
}

// IME変換中フラグ。Macで日本語確定のEnterが送信に化けるのを防ぐ要。
let composing = false;
input.addEventListener("compositionstart", () => { composing = true; });
input.addEventListener("compositionend", () => { composing = false; });

// 送信は「送信ボタンのクリック」と「Ctrl/Cmd+Enter」のみ。
// ボタンは type="button" にしてあるので、Enterによるフォーム暗黙送信は一切起きない
// （＝日本語確定のEnterで誤送信されない）。フォームのsubmitは安全網として無効化。
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
    const res = await fetch("/api/history?space=exec");
    if (!res.ok) return;
    const { messages } = await res.json();
    for (const m of messages || []) addMessage(m.role, m.text, m.role === "me" ? "あなた" : "Claude");
  } catch {}
}

setWorker(false);
loadHistory().then(connect);
