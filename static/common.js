// Partes usadas tanto na tela do PC quanto na do celular.

const $ = (sel, el = document) => el.querySelector(sel);

// Identifica este navegador, para cada um só poder apagar as próprias músicas.
const TOKEN = localStorage.karaokeToken ||
  (localStorage.karaokeToken = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()));

async function api(path, opts = {}) {
  const url = path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(TOKEN);
  const init = { method: opts.method || "GET", headers: {} };
  if (opts.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify({ token: TOKEN, ...opts.body });
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function toast(msg, ms = 2600) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------------------------------------------------------- prévia de 5 segundos

const previewAudio = new Audio();
let previewBtn = null;
let previewTimer = null;

function stopPreview() {
  previewAudio.pause();
  clearTimeout(previewTimer);
  if (previewBtn) { previewBtn.textContent = "▶"; previewBtn.disabled = false; }
  previewBtn = null;
}

// src: URL do áudio. start: segundo inicial (null = já é um trecho pronto).
async function togglePreview(btn, src, start = null, seconds = 5) {
  if (previewBtn === btn) return stopPreview();
  stopPreview();
  previewBtn = btn;
  btn.textContent = "…";
  btn.disabled = true;
  previewAudio.src = src;
  try {
    if (start !== null) {
      await new Promise((ok, fail) => {
        previewAudio.onloadedmetadata = ok;
        previewAudio.onerror = fail;
      });
      previewAudio.currentTime = start;
    }
    await previewAudio.play();
    if (previewBtn !== btn) return;
    btn.textContent = "■";
    btn.disabled = false;
    previewTimer = setTimeout(stopPreview, seconds * 1000 + 300);
  } catch (e) {
    if (previewBtn === btn) { toast("Não deu para tocar a prévia"); stopPreview(); }
  }
}
previewAudio.onended = stopPreview;

// ---------------------------------------------------------------- busca no YouTube

function setupSearch({ form, input, status, results, getName }) {
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    stopPreview();
    results.innerHTML = "";
    status.innerHTML = `Buscando no YouTube...<div class="bar"></div>`;
    status.hidden = false;
    try {
      const items = await api("/api/search?q=" + encodeURIComponent(q));
      status.hidden = true;
      if (!items.length) { results.innerHTML = `<div class="empty">Nada encontrado.</div>`; return; }
      for (const it of items) results.appendChild(resultRow(it, getName));
    } catch (e) {
      status.textContent = e.message;
    }
  });
}

function resultRow(it, getName) {
  const row = document.createElement("div");
  row.className = "item";
  row.innerHTML = `
    <img class="thumb" src="${esc(it.thumbnail)}" alt="">
    <div class="meta">
      <div class="title" title="${esc(it.title)}">${esc(it.title)}</div>
      <div class="sub">${esc(it.channel)} · ${fmtTime(it.duration)}</div>
    </div>
    <div class="actions">
      <button class="btn small icon play" title="Ouvir 5 segundos do meio da música">▶</button>
      <button class="btn small primary add">Adicionar</button>
    </div>`;
  const play = $(".play", row);
  play.onclick = () => togglePreview(play, `/api/preview/${it.id}`);
  const add = $(".add", row);
  add.onclick = async () => {
    add.disabled = true;
    try {
      await api("/api/queue", { method: "POST", body: { entry: it, name: getName ? getName() : "" } });
      add.textContent = "Na fila ✓";
      stopPreview();
      refresh();
    } catch (e) {
      toast(e.message);
      add.disabled = false;
    }
  };
  return row;
}

// ---------------------------------------------------------------- fila e biblioteca

function queueRow(job) {
  const wrap = document.createElement("div");
  wrap.className = "queue-item";
  const err = job.status === "error";
  wrap.innerHTML = `
    <div class="item">
      <img class="thumb" src="${esc(job.thumbnail)}" alt="">
      <div class="meta">
        <div class="title">${esc(job.title)}</div>
        <div class="sub">${esc(job.channel)}${job.owner_name ? ` · <span class="who">${esc(job.owner_name)}</span>` : ""}</div>
        <div class="job-stage ${err ? "err" : ""}" title="${esc(job.error || "")}">${esc(err ? "Erro: " + (job.error || "") : job.stage)}</div>
        ${err ? "" : `<div class="progress"><div style="width:${Math.round(job.progress * 100)}%"></div></div>`}
      </div>
      ${err && job.mine ? `<button class="btn small retry">Tentar de novo</button>` : ""}
    </div>
    ${job.mine ? `<button class="x" title="Remover da fila">✕</button>` : ""}`;
  const x = $(".x", wrap);
  if (x) x.onclick = async () => {
    try { await api(`/api/queue/${job.id}`, { method: "DELETE" }); refresh(); }
    catch (e) { toast(e.message); }
  };
  const retry = $(".retry", wrap);
  if (retry) retry.onclick = async () => { await api(`/api/queue/${job.id}/retry`, { method: "POST", body: {} }); refresh(); };
  return wrap;
}

function songTitle(s) {
  return s.artist && !s.title.toLowerCase().includes(s.artist.toLowerCase()) ? `${s.artist} - ${s.title}` : s.title;
}

function songThumb(s) {
  return s.cover ? `/media/${s.id}/cover.jpg?v=${s.cover_v || ""}` : s.thumbnail;
}

// Atualização "ao vivo": a página consulta o servidor a cada ~1 segundo
let refreshFn = null;
let refreshTimer = null;
function startPolling(fn, ms = 1200) {
  refreshFn = async () => {
    clearTimeout(refreshTimer);
    try { await fn(); } catch (e) { /* servidor reiniciando */ }
    refreshTimer = setTimeout(refreshFn, document.hidden ? 4000 : ms);
  };
  refreshFn();
}
function refresh() { if (refreshFn) refreshFn(); }
