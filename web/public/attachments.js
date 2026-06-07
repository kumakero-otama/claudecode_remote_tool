// 添付ウィジェット（チャット・タスク詳細で共用）。
// 使い方: const att = createAttachments({ listEl, fileInput, attachBtn, textarea });
//   att.get()   -> [{name, hostPath, mime}]  送信時に付与
//   att.clear() -> 送信後にクリア
function createAttachments({ listEl, fileInput, attachBtn, textarea }) {
  const items = []; // {name, hostPath, mime, chip}

  function render() {
    listEl.classList.toggle("has-items", items.length > 0);
  }

  function makeChip(file) {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    if (file && file.type && file.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      chip.appendChild(img);
    } else {
      const ic = document.createElement("span");
      ic.className = "fileicon";
      ic.textContent = "📄";
      chip.appendChild(ic);
    }
    const label = document.createElement("span");
    label.className = "cname";
    label.textContent = file ? file.name : "アップロード中…";
    chip.appendChild(label);
    listEl.appendChild(chip);
    render();
    return { chip, label };
  }

  async function uploadFile(file) {
    const { chip, label } = makeChip(file);
    chip.classList.add("uploading");
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (res.status === 401) { top.location.href = "/login"; return; }
      if (!res.ok) throw new Error("upload failed");
      const meta = await res.json();
      chip.classList.remove("uploading");
      label.textContent = meta.name;
      const entry = { name: meta.name, hostPath: meta.hostPath, mime: meta.mime, chip };
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "rm";
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        const i = items.indexOf(entry);
        if (i >= 0) items.splice(i, 1);
        chip.remove();
        render();
      });
      chip.appendChild(rm);
      items.push(entry);
    } catch {
      label.textContent = "失敗";
      chip.classList.add("failed");
      setTimeout(() => { chip.remove(); render(); }, 2000);
    }
  }

  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    for (const f of fileInput.files) uploadFile(f);
    fileInput.value = "";
  });
  // クリップボードからの画像/ファイル貼り付け
  textarea.addEventListener("paste", (e) => {
    const files = [];
    for (const item of e.clipboardData?.items ?? []) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      files.forEach(uploadFile);
    }
  });

  return {
    get: () => items.map((i) => ({ name: i.name, hostPath: i.hostPath, mime: i.mime })),
    clear: () => {
      items.length = 0;
      listEl.textContent = "";
      render();
    },
    count: () => items.length,
  };
}
