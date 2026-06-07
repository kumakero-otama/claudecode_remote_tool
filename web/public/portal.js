const frame = document.getElementById("frame");
const links = Array.from(document.querySelectorAll(".navlink"));
const sidebar = document.getElementById("sidebar");

function activate(link) {
  links.forEach((l) => l.classList.toggle("active", l === link));
  frame.src = link.dataset.src;
  sidebar.classList.remove("open");
}

links.forEach((link) => {
  link.addEventListener("click", () => activate(link));
});

// 初期表示は最初の子ページ
if (links.length) activate(links[0]);

// モバイル用メニュー開閉
document.getElementById("menuBtn").addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

// ユーザ情報・端末・ログアウト
async function loadMe() {
  try {
    const me = await (await fetch("/api/me")).json();
    document.getElementById("userEmail").textContent = me.email || "";
    return me;
  } catch {
    return null;
  }
}
loadMe();

document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/logout", { method: "POST" });
  location.href = "/login";
});

const dialog = document.getElementById("devicesDialog");
const deviceList = document.getElementById("deviceList");
document.getElementById("devicesBtn").addEventListener("click", async () => {
  const me = await loadMe();
  deviceList.textContent = "";
  for (const d of me?.devices ?? []) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    const when = new Date(d.lastUsedAt).toLocaleString();
    label.textContent = `${d.label}${d.current ? "（この端末）" : ""} — 最終: ${when}`;
    li.appendChild(label);
    if (!d.current) {
      const btn = document.createElement("button");
      btn.className = "btn ghost small";
      btn.textContent = "解除";
      btn.addEventListener("click", async () => {
        await fetch(`/api/devices/${encodeURIComponent(d.id)}`, { method: "DELETE" });
        li.remove();
      });
      li.appendChild(btn);
    }
    deviceList.appendChild(li);
  }
  dialog.showModal();
});
