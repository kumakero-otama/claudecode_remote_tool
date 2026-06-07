// 論文のみを全画面表示する別ウィンドウ用ビューア（ヘッダ/サイドバー/タブ/チャットなし）。
const paperId = new URLSearchParams(location.search).get("id");
const root = document.getElementById("viewerRoot");

function empty(text) {
  const d = document.createElement("div");
  d.className = "paper-empty muted";
  d.textContent = text;
  return d;
}

function render(p) {
  root.textContent = "";
  const fileUrl = `/api/papers/${encodeURIComponent(paperId)}/file`;
  const makeIframe = (src, sandbox) => {
    const f = document.createElement("iframe");
    f.className = "paper-frame";
    if (sandbox) f.setAttribute("sandbox", "allow-same-origin allow-popups allow-forms");
    f.src = src;
    return f;
  };

  if (p.kind === "pdf") {
    root.appendChild(makeIframe(fileUrl, false));
  } else if (p.kind === "url") {
    if (p.source) root.appendChild(makeIframe(p.source, false));
    else root.appendChild(empty("表示できる対象がありません。"));
  } else if (p.kind === "html") {
    root.appendChild(makeIframe(fileUrl, true));
  } else if (p.kind === "tex" || p.kind === "text") {
    const pre = document.createElement("pre");
    pre.className = "paper-src";
    pre.textContent = "読み込み中…";
    root.appendChild(pre);
    fetch(fileUrl).then((r) => (r.ok ? r.text() : Promise.reject())).then((t) => { pre.textContent = t; }).catch(() => { pre.textContent = "ファイルを読み込めませんでした。"; });
  } else {
    const box = empty("このファイル形式はプレビュー非対応です。");
    if (p.file) {
      const a = document.createElement("a");
      a.href = fileUrl; a.className = "btn ghost small"; a.textContent = "⬇ ダウンロード"; a.setAttribute("download", "");
      box.appendChild(document.createElement("br"));
      box.appendChild(a);
    }
    root.appendChild(box);
  }
}

async function load() {
  if (!paperId) { root.appendChild(empty("論文IDがありません")); return; }
  try {
    const res = await fetch(`/api/papers/${encodeURIComponent(paperId)}`);
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { root.appendChild(empty("論文が見つかりません")); return; }
    const p = await res.json();
    document.title = p.title || "論文";
    render(p);
  } catch {
    root.appendChild(empty("読み込みエラー"));
  }
}

load();
