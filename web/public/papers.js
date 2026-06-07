const listEl = document.getElementById("paperList");
const tagFilterEl = document.getElementById("tagFilter");
const addStatus = document.getElementById("addStatus");
let allPapers = [];
// タグの状態: "show"(青=表示) / "hide"(赤=非表示) / 未設定(白)
const tagStates = new Map();

const KIND_LABEL = { pdf: "PDF", html: "HTML", tex: "LaTeX", text: "TEXT", url: "URL", other: "FILE" };

function render() {
  const tags = [...new Set(allPapers.flatMap((p) => p.tags))].sort();
  tagFilterEl.textContent = "";

  const cycle = (tag) => {
    const cur = tagStates.get(tag);
    if (cur === "show") tagStates.set(tag, "hide");
    else if (cur === "hide") tagStates.delete(tag);
    else tagStates.set(tag, "show");
    render();
  };

  const resetChip = document.createElement("button");
  resetChip.className = "tagchip" + (tagStates.size === 0 ? " active" : "");
  resetChip.textContent = "すべて";
  resetChip.addEventListener("click", () => { tagStates.clear(); render(); });
  tagFilterEl.appendChild(resetChip);

  tags.forEach((tag) => {
    const b = document.createElement("button");
    const state = tagStates.get(tag);
    b.className = "tagchip" + (state ? " " + state : "");
    b.textContent = "#" + tag;
    b.addEventListener("click", () => cycle(tag));
    tagFilterEl.appendChild(b);
  });

  const showTags = [...tagStates].filter(([, s]) => s === "show").map(([t]) => t);
  const hideTags = [...tagStates].filter(([, s]) => s === "hide").map(([t]) => t);
  const shown = allPapers.filter((p) => {
    if (hideTags.some((tag) => p.tags.includes(tag))) return false;
    if (showTags.length && !showTags.some((tag) => p.tags.includes(tag))) return false;
    return true;
  });
  listEl.textContent = "";
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "empty muted";
    li.textContent = "論文がありません。上のフォームからURLまたはファイルで追加してください。";
    listEl.appendChild(li);
    return;
  }
  for (const p of shown) {
    const li = document.createElement("li");
    li.className = "taskitem";
    li.addEventListener("click", () => { location.href = `/pages/paper?id=${encodeURIComponent(p.id)}`; });

    const main = document.createElement("div");
    main.className = "ti-main";
    const title = document.createElement("div");
    title.className = "ti-title";
    title.textContent = p.title;
    const tags = document.createElement("div");
    tags.className = "ti-tags";
    const kindChip = document.createElement("span");
    kindChip.className = "tagchip mini kind";
    kindChip.textContent = KIND_LABEL[p.kind] || "FILE";
    tags.appendChild(kindChip);
    p.tags.forEach((tag) => {
      const s = document.createElement("span");
      s.className = "tagchip mini";
      s.textContent = "#" + tag;
      tags.appendChild(s);
    });
    main.append(title, tags);

    const status = document.createElement("span");
    status.className = `ti-status st-${p.status}`;
    status.textContent = p.status;

    li.append(main, status);
    listEl.appendChild(li);
  }
}

async function load() {
  try {
    const res = await fetch("/api/papers");
    if (res.status === 401) { top.location.href = "/login"; return; }
    const data = await res.json();
    allPapers = data.papers || [];
    render();
  } catch {
    listEl.textContent = "読み込みに失敗しました";
  }
}

function busy(on) { addStatus.hidden = !on; }

document.getElementById("addUrlForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = document.getElementById("newUrl").value.trim();
  const tags = document.getElementById("newUrlTags").value;
  if (!url) return;
  busy(true);
  try {
    const res = await fetch("/api/papers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, tags }),
    });
    if (res.status === 401) { top.location.href = "/login"; return; }
    if (res.ok) {
      document.getElementById("newUrl").value = "";
      document.getElementById("newUrlTags").value = "";
      await load();
    } else {
      alert("追加に失敗しました");
    }
  } finally { busy(false); }
});

document.getElementById("addFileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById("newFile");
  const file = fileInput.files && fileInput.files[0];
  const tags = document.getElementById("newFileTags").value;
  if (!file) return;
  busy(true);
  try {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("tags", tags);
    const res = await fetch("/api/papers", { method: "POST", body: fd });
    if (res.status === 401) { top.location.href = "/login"; return; }
    if (res.ok) {
      fileInput.value = "";
      document.getElementById("newFileTags").value = "";
      await load();
    } else {
      alert("追加に失敗しました");
    }
  } finally { busy(false); }
});

load();
