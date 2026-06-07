// 論文ポップアップ別ウィンドウ。左=論文ビューア / 右=解説HTML、境界は左右ドラッグで可変。
const paperId = new URLSearchParams(location.search).get("id");
const leftEl = document.getElementById("pvLeft");
const rightEl = document.getElementById("pvRight");

function empty(text) {
  const d = document.createElement("div");
  d.className = "paper-empty muted";
  d.textContent = text;
  return d;
}

// 左ペイン: 論文そのもの
function renderViewer(p) {
  leftEl.textContent = "";
  const fileUrl = `/api/papers/${encodeURIComponent(paperId)}/file`;
  const makeIframe = (src, sandbox) => {
    const f = document.createElement("iframe");
    f.className = "paper-frame";
    if (sandbox) f.setAttribute("sandbox", "allow-same-origin allow-popups allow-forms");
    f.src = src;
    return f;
  };

  if (p.kind === "pdf") {
    leftEl.appendChild(makeIframe(fileUrl, false));
  } else if (p.kind === "url") {
    if (p.source) leftEl.appendChild(makeIframe(p.source, false));
    else leftEl.appendChild(empty("表示できる対象がありません。"));
  } else if (p.kind === "html") {
    leftEl.appendChild(makeIframe(fileUrl, true));
  } else if (p.kind === "tex" || p.kind === "text") {
    const pre = document.createElement("pre");
    pre.className = "paper-src";
    pre.textContent = "読み込み中…";
    leftEl.appendChild(pre);
    fetch(fileUrl).then((r) => (r.ok ? r.text() : Promise.reject())).then((t) => { pre.textContent = t; }).catch(() => { pre.textContent = "ファイルを読み込めませんでした。"; });
  } else {
    const box = empty("このファイル形式はプレビュー非対応です。");
    if (p.file) {
      const a = document.createElement("a");
      a.href = fileUrl; a.className = "btn ghost small"; a.textContent = "⬇ ダウンロード"; a.setAttribute("download", "");
      box.appendChild(document.createElement("br"));
      box.appendChild(a);
    }
    leftEl.appendChild(box);
  }
}

async function load() {
  if (!paperId) { leftEl.appendChild(empty("論文IDがありません")); return; }
  try {
    const res = await fetch(`/api/papers/${encodeURIComponent(paperId)}`);
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { leftEl.appendChild(empty("論文が見つかりません")); return; }
    const p = await res.json();
    document.title = p.title || "論文";
    renderViewer(p);
    rightEl.innerHTML = p.body == null ? "" : String(p.body); // 右ペイン: 解説HTML
  } catch {
    leftEl.appendChild(empty("読み込みエラー"));
  }
}

// 左右の幅をドラッグで調整（縦の境界）。
function setupSplitter() {
  const splitter = document.getElementById("pvSplit");
  const left = leftEl;
  if (!splitter || !left) return;
  const saved = Number(localStorage.getItem("ccrt.pvLeftPct"));
  if (saved && saved >= 15 && saved <= 85) left.style.flexBasis = saved + "%";
  let dragging = false;
  const clientX = (e) => (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
  const onMove = (e) => {
    if (!dragging) return;
    const pct = Math.max(15, Math.min(85, (clientX(e) / window.innerWidth) * 100));
    left.style.flexBasis = pct + "%";
    e.preventDefault();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false; splitter.classList.remove("dragging"); document.body.classList.remove("dragging"); document.body.style.userSelect = "";
    const pct = (left.getBoundingClientRect().width / window.innerWidth) * 100;
    localStorage.setItem("ccrt.pvLeftPct", String(Math.round(pct)));
  };
  // ドラッグ中は iframe(PDF等)がマウスイベントを奪わないよう pointer-events を無効化（body.dragging）
  const onDown = (e) => { dragging = true; splitter.classList.add("dragging"); document.body.classList.add("dragging"); document.body.style.userSelect = "none"; e.preventDefault(); };
  splitter.addEventListener("mousedown", onDown);
  splitter.addEventListener("touchstart", onDown, { passive: false });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("mouseup", onUp);
  window.addEventListener("touchend", onUp);
}
setupSplitter();
load();
