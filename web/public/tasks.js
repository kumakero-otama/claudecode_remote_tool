const listEl = document.getElementById("taskList");
const tagFilterEl = document.getElementById("tagFilter");
let allTasks = [];
// タグの状態: "show"(青=表示) / "hide"(赤=非表示) / 未設定(白)
const tagStates = new Map();

function render() {
  // タグフィルタ
  const tags = [...new Set(allTasks.flatMap((t) => t.tags))].sort();
  tagFilterEl.textContent = "";

  // クリックで 白 → 青(表示) → 赤(非表示) → 白 と切り替え
  const cycle = (tag) => {
    const cur = tagStates.get(tag);
    if (cur === "show") tagStates.set(tag, "hide");
    else if (cur === "hide") tagStates.delete(tag);
    else tagStates.set(tag, "show");
    render();
  };

  // 「すべて」: 絞り込みを全解除
  const resetChip = document.createElement("button");
  resetChip.className = "tagchip" + (tagStates.size === 0 ? " active" : "");
  resetChip.textContent = "すべて";
  resetChip.addEventListener("click", () => { tagStates.clear(); render(); });
  tagFilterEl.appendChild(resetChip);

  tags.forEach((tag) => {
    const b = document.createElement("button");
    const state = tagStates.get(tag); // "show" | "hide" | undefined
    b.className = "tagchip" + (state ? " " + state : "");
    b.textContent = "#" + tag;
    b.addEventListener("click", () => cycle(tag));
    tagFilterEl.appendChild(b);
  });

  // 一覧の絞り込み
  const showTags = [...tagStates].filter(([, s]) => s === "show").map(([t]) => t);
  const hideTags = [...tagStates].filter(([, s]) => s === "hide").map(([t]) => t);
  const shown = allTasks.filter((t) => {
    // 赤(非表示)のタグを1つでも持つタスクは非表示
    if (hideTags.some((tag) => t.tags.includes(tag))) return false;
    // 青(表示)が1つでもある場合は、青のタグを持つタスクのみ表示
    if (showTags.length && !showTags.some((tag) => t.tags.includes(tag))) return false;
    return true;
  });
  listEl.textContent = "";
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "empty muted";
    li.textContent = "タスクがありません。上の入力欄から追加してください。";
    listEl.appendChild(li);
    return;
  }
  for (const t of shown) {
    const li = document.createElement("li");
    li.className = "taskitem";
    li.addEventListener("click", () => { location.href = `/pages/task?id=${encodeURIComponent(t.id)}`; });

    const main = document.createElement("div");
    main.className = "ti-main";
    const title = document.createElement("div");
    title.className = "ti-title";
    title.textContent = t.title;
    const tags = document.createElement("div");
    tags.className = "ti-tags";
    t.tags.forEach((tag) => {
      const s = document.createElement("span");
      s.className = "tagchip mini";
      s.textContent = "#" + tag;
      tags.appendChild(s);
    });
    main.append(title, tags);

    const status = document.createElement("span");
    status.className = `ti-status st-${t.status}`;
    status.textContent = t.status;

    li.append(main, status);
    listEl.appendChild(li);
  }
}

async function load() {
  try {
    const res = await fetch("/api/tasks");
    if (res.status === 401) { top.location.href = "/login"; return; }
    const data = await res.json();
    allTasks = data.tasks || [];
    render();
  } catch {
    listEl.textContent = "読み込みに失敗しました";
  }
}

document.getElementById("newTaskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("newTitle").value.trim();
  const tags = document.getElementById("newTags").value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!title) return;
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, tags }),
  });
  if (res.ok) {
    document.getElementById("newTitle").value = "";
    document.getElementById("newTags").value = "";
    load();
  }
});

load();
