const grid = document.getElementById("grid");
const hostEl = document.getElementById("host");
const updEl = document.getElementById("upd");

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function card(title) {
  const c = el("div", "card");
  c.appendChild(el("h2", null, title));
  return c;
}

function bar(percent) {
  const b = el("div", "bar");
  const i = el("i");
  const p = Math.max(0, Math.min(100, percent || 0));
  i.style.width = p + "%";
  i.style.background = p > 90 ? "var(--bad)" : p > 75 ? "var(--warn)" : "var(--ok)";
  b.appendChild(i);
  return b;
}

function rowKV(k, v) {
  const r = el("div", "row");
  r.appendChild(el("span", "k", k));
  r.appendChild(el("span", "v", v));
  return r;
}

function render(s) {
  grid.textContent = "";
  hostEl.textContent = s.host ? `${s.host.hostname} · uptime ${s.host.uptime}` : "";

  // CPU
  if (s.cpu) {
    const c = card("CPU");
    c.appendChild(el("div", "big", `${s.cpu.percent?.toFixed(1)}%`));
    c.appendChild(el("div", "sub", `${s.cpu.cores} cores @ ${s.cpu.freq_mhz} MHz · load ${(s.cpu.load || []).join(" / ")}`));
    c.appendChild(bar(s.cpu.percent));
    (s.cpu.per_core || []).forEach((v, i) => c.appendChild(rowKV(`core ${i}`, `${v.toFixed(0)}%`)));
    grid.appendChild(c);
  }

  // Memory
  if (s.mem) {
    const c = card("Memory");
    c.appendChild(el("div", "big", `${s.mem.percent?.toFixed(1)}%`));
    c.appendChild(el("div", "sub", `${s.mem.used_h} / ${s.mem.total_h}`));
    c.appendChild(bar(s.mem.percent));
    c.appendChild(rowKV("swap", `${s.mem.swap_used_h} / ${s.mem.swap_total_h} (${s.mem.swap_percent?.toFixed(1)}%)`));
    grid.appendChild(c);
  }

  // Disks
  if (s.disks?.length) {
    const c = card("Disks");
    s.disks.forEach((d) => {
      c.appendChild(rowKV(`${d.mount} (${d.fstype})`, `${d.used_h} / ${d.total_h}`));
      c.appendChild(bar(d.percent));
    });
    grid.appendChild(c);
  }

  // Network
  if (s.net?.length) {
    const c = card("Network");
    s.net.forEach((n) => {
      c.appendChild(rowKV(n.nic, `▼ ${n.rx_h}  ▲ ${n.tx_h}`));
      c.appendChild(el("div", "sub", `total ▼ ${n.rx_total_h} · ▲ ${n.tx_total_h}`));
    });
    grid.appendChild(c);
  }

  // Containers
  if (s.containers?.items?.length) {
    const c = card("Containers");
    const t = el("table");
    const head = el("tr");
    ["name", "state", "status"].forEach((h) => head.appendChild(el("th", null, h)));
    t.appendChild(head);
    s.containers.items.forEach((it) => {
      const tr = el("tr");
      tr.appendChild(el("td", null, it.name));
      const st = el("td");
      st.appendChild(el("span", `tag ${it.state === "running" ? "ok" : "bad"}`, it.state));
      tr.appendChild(st);
      tr.appendChild(el("td", null, it.status));
      t.appendChild(tr);
    });
    c.appendChild(t);
    grid.appendChild(c);
  }

  // Endpoints
  if (s.endpoints?.items?.length) {
    const c = card("Endpoints");
    const t = el("table");
    const head = el("tr");
    ["name", "port", "kind", "up"].forEach((h) => head.appendChild(el("th", null, h)));
    t.appendChild(head);
    s.endpoints.items.forEach((it) => {
      const tr = el("tr");
      tr.appendChild(el("td", null, it.name));
      tr.appendChild(el("td", null, String(it.port)));
      tr.appendChild(el("td", null, it.kind));
      const up = el("td");
      up.appendChild(el("span", `tag ${it.up ? "ok" : "bad"}`, it.up ? "up" : "down"));
      tr.appendChild(up);
      t.appendChild(tr);
    });
    c.appendChild(t);
    grid.appendChild(c);
  }
}

async function tick() {
  try {
    const res = await fetch("/api/server-stats", { cache: "no-store" });
    if (res.status === 401) { top.location.href = "/login"; return; }
    if (!res.ok) throw new Error("bad");
    render(await res.json());
    updEl.textContent = "更新: " + new Date().toLocaleTimeString();
  } catch {
    updEl.textContent = "サーバ情報を取得できません";
  }
}

tick();
setInterval(tick, 3000);
