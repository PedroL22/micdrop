// Player: toca as 4 faixas juntas (Web Audio, em sincronia perfeita), mostra a letra
// sincronizada e manda nota/escala por MIDI ao abrir a música.

const STEMS = ["instrumental", "backing", "lead", "original"];
const params = new URLSearchParams(location.search);

let song = null;
let lines = [];          // [{t, text}]
let synced = false;
let duration = 0;

// ---------------------------------------------------------------- áudio

const ctx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = ctx.createGain();
masterGain.connect(ctx.destination);
const gains = {};
const buffers = {};
for (const s of STEMS) { gains[s] = ctx.createGain(); gains[s].gain.value = 0; gains[s].connect(masterGain); }

let playing = false;
let startedAt = 0;   // ctx.currentTime em que a posição "startPos" começou a tocar
let startPos = 0;
let sources = [];

function position() {
  return playing ? Math.min(duration, startPos + (ctx.currentTime - startedAt)) : startPos;
}

function play() {
  if (playing || !duration) return;
  ctx.resume();
  if (startPos >= duration - 0.05) startPos = 0;
  const when = ctx.currentTime + 0.05;
  sources = STEMS.filter(s => buffers[s]).map(s => {
    const src = ctx.createBufferSource();
    src.buffer = buffers[s];
    src.connect(gains[s]);
    src.start(when, startPos);
    return src;
  });
  startedAt = when;
  playing = true;
  $("#playBtn").textContent = "❚❚";
}

function pause() {
  if (!playing) return;
  startPos = position();
  for (const src of sources) { try { src.stop(); } catch (e) {} }
  sources = [];
  playing = false;
  $("#playBtn").textContent = "▶";
}

function seek(t) {
  const was = playing;
  pause();
  startPos = Math.max(0, Math.min(duration, t));
  if (was) play();
  lastIdx = -2;
}

function applyMix() {
  const st = song.settings;
  const orig = st.mode === "original";
  const target = {
    original: orig ? 1 : 0,
    instrumental: orig ? 0 : 1,
    backing: orig ? 0 : st.backing,
    lead: orig ? 0 : st.lead,
  };
  for (const s of STEMS) gains[s].gain.setTargetAtTime(target[s], ctx.currentTime, 0.03);
  $("#modeOriginal").classList.toggle("on", orig);
  $("#modeInstrumental").classList.toggle("on", !orig);
  for (const id of ["#volBacking", "#volLead"]) $(id).disabled = orig;
}

async function loadStems() {
  let done = 0;
  const msg = $("#msg");
  await Promise.all(STEMS.map(async s => {
    const res = await fetch(`/media/${SONG_ID}/${s}.flac`);
    if (!res.ok) throw new Error(`faixa ${s} não encontrada`);
    buffers[s] = await ctx.decodeAudioData(await res.arrayBuffer());
    msg.textContent = `Carregando faixas... ${++done}/${STEMS.length}`;
  }));
  duration = Math.max(...STEMS.map(s => buffers[s].duration));
}

// ---------------------------------------------------------------- letra

const lyricsEl = $("#lyrics");
const inner = $("#lyricsInner");
let lastIdx = -2;

function renderLyrics() {
  inner.innerHTML = "";
  inner.style.transform = "";
  lyricsEl.classList.toggle("static", !synced);
  lines.forEach((l, i) => {
    const d = document.createElement("div");
    d.className = "line";
    d.textContent = l.text;
    d.onclick = () => onLineClick(i);
    inner.appendChild(d);
  });
  lastIdx = -2;
  updateMsg();
}

function updateMsg() {
  const msg = $("#msg");
  if (!duration) return;
  if (!lines.length) {
    msg.hidden = false;
    msg.innerHTML = `Sem letra<small>Escolha uma letra acima ou toque assim mesmo.</small>`;
  } else msg.hidden = true;
}

function currentIndex(t) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function placeLyrics(idx) {
  const els = inner.children;
  for (let i = 0; i < els.length; i++) {
    els[i].classList.toggle("active", i === idx);
    els[i].classList.toggle("past", i < idx);
  }
  const ref = els[Math.max(0, idx)];
  if (!ref) return;
  const center = ref.offsetTop + ref.offsetHeight / 2;
  inner.style.transform = `translateY(${lyricsEl.clientHeight * 0.42 - center}px)`;
}

window.addEventListener("resize", () => (lastIdx = -2));

// ---------------------------------------------------------------- sincronia

let armed = false;

function setOffset(v) {
  song.offset = Math.round(v * 100) / 100;
  $("#offset").textContent = (song.offset > 0 ? "+" : "") + song.offset.toFixed(1) + "s";
  lastIdx = -2;
  save({ offset: song.offset });
}

document.querySelectorAll("[data-shift]").forEach(b =>
  (b.onclick = () => setOffset(song.offset + parseFloat(b.dataset.shift))));

$("#syncMouse").onclick = () => {
  armed = !armed;
  $("#syncMouse").classList.toggle("on", armed);
  lyricsEl.classList.toggle("armed", armed);
  if (armed) toast("Agora clique na linha da letra no instante em que ela começa a ser cantada");
};

function onLineClick(i) {
  if (!armed || !synced) return;
  setOffset(position() - lines[i].t);
  armed = false;
  $("#syncMouse").classList.remove("on");
  lyricsEl.classList.remove("armed");
}

// ---------------------------------------------------------------- laço de animação

function tick() {
  const pos = position();
  if (playing && pos >= duration) { pause(); startPos = duration; }
  if (!seeking) $("#seek").value = duration ? (pos / duration) * 1000 : 0;
  $("#time").textContent = `${fmtTime(pos)} / ${fmtTime(duration)}`;
  if (synced && lines.length) {
    const idx = currentIndex(pos - song.offset);
    if (idx !== lastIdx) { lastIdx = idx; placeLyrics(idx); }
  }
  syncVideo(pos);
  requestAnimationFrame(tick);
}

let seeking = false;
const seekEl = $("#seek");
seekEl.addEventListener("input", () => {
  seeking = true;
  $("#time").textContent = `${fmtTime((seekEl.value / 1000) * duration)} / ${fmtTime(duration)}`;
});
seekEl.addEventListener("change", () => { seek((seekEl.value / 1000) * duration); seeking = false; });
$("#playBtn").onclick = () => (playing ? pause() : play());
$("#volMaster").oninput = e => (masterGain.gain.value = e.target.value);

// ---------------------------------------------------------------- visual (arte, desfoque, brilho)

function artUrl() {
  return song.cover ? `/media/${SONG_ID}/cover.jpg?v=${song.cover_v || 0}`
                    : `https://i.ytimg.com/vi/${SONG_ID}/hqdefault.jpg`;
}

function applyLook() {
  const st = song.settings;
  $("#art").style.filter = `blur(${(st.blur * 40).toFixed(1)}px)`;
  $("#bgVideo").style.filter = `blur(${(st.blur * 40).toFixed(1)}px)`;
  $("#shade").style.opacity = (0.15 + st.blur * 0.5).toFixed(2);
  lyricsEl.style.setProperty("--txt", st.brightness);
}

function setArt() {
  const url = artUrl();
  $("#art").style.backgroundImage = `url("${url}")`;
  // brilho colorido em volta do quadro, com a cor média da capa
  const img = new Image();
  if (!song.cover) img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 8;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data;
      let r = 0, gr = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      $("#stage").style.setProperty("--glow", `rgba(${r / n | 0},${gr / n | 0},${b / n | 0},.55)`);
    } catch (e) { /* imagem de outro site sem permissão: fica sem brilho */ }
  };
  img.src = url;
}

// ---------------------------------------------------------------- salvar ajustes

let saveTimer = null;
let pending = {};
function save(changes) {
  Object.assign(pending, changes);
  if (changes.settings) pending.settings = { ...song.settings };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const body = pending;
    pending = {};
    api(`/api/songs/${SONG_ID}`, { method: "PATCH", body }).catch(e => toast(e.message));
  }, 400);
}

function bindSetting(id, key, after) {
  const el = $(id);
  el.value = song.settings[key];
  el.addEventListener("input", () => {
    song.settings[key] = parseFloat(el.value);
    after();
    save({ settings: true });
  });
}

$("#modeOriginal").onclick = () => { song.settings.mode = "original"; applyMix(); save({ settings: true }); };
$("#modeInstrumental").onclick = () => { song.settings.mode = "instrumental"; applyMix(); save({ settings: true }); };

// ---------------------------------------------------------------- escolher letra e capa

function openPicker(id, open = true) {
  $("#" + id).hidden = !open;
  if (open && id === "lyricsPicker") searchLyrics();
  if (open && id === "coverPicker") searchCovers();
  if (open && id === "clipPicker") { clipStatus(); if (!$("#clipList").children.length) searchClips(); }
}
document.querySelectorAll("[data-close]").forEach(b => (b.onclick = () => openPicker(b.dataset.close, false)));
$("#pickLyrics").onclick = () => openPicker("lyricsPicker");
$("#pickCover").onclick = () => openPicker("coverPicker");
$("#pickClip").onclick = () => openPicker("clipPicker");

// "Somewhere I Belong – Linkin Park" + "Linkin Park" -> "Somewhere I Belong"
function cleanTitle(title, artist) {
  const norm = s => (s || "").toLowerCase().replace(/vevo/g, "").replace(/[^a-z0-9]/g, "");
  const parts = (title || "").split(/\s+[-–—|]\s+/);
  if (parts.length >= 2 && artist) {
    if (norm(parts[parts.length - 1]) === norm(artist)) return parts.slice(0, -1).join(" - ").trim();
    if (norm(parts[0]) === norm(artist)) return parts.slice(1).join(" - ").trim();
  }
  return (title || "").trim();
}

function searchQuery(extra = "") {
  return `${song.artist || ""} ${cleanTitle(song.title, song.artist)} ${extra}`.replace(/\s+/g, " ").trim();
}

async function searchLyrics() {
  const list = $("#lyricsList");
  const q = $("#lyricsQ").value.trim();
  if (!q) return;
  list.innerHTML = `<div class="loading">Buscando no LRCLIB...<div class="bar"></div></div>`;
  try {
    const items = await api("/api/lyrics/search?q=" + encodeURIComponent(q));
    const dur = song.duration || duration;
    items.sort((a, b) => (b.synced - a.synced) || (Math.abs(a.duration - dur) - Math.abs(b.duration - dur)));
    list.innerHTML = items.length ? "" : `<div class="empty">Nenhuma letra encontrada. Tente mudar a busca.</div>`;
    for (const it of items) {
      const close = dur && Math.abs(it.duration - dur) <= 3;
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div class="meta">
          <div class="title">${esc(it.artist)} - ${esc(it.track)}</div>
          <div class="sub">${fmtTime(it.duration)} · ${it.synced ? "sincronizada" : "só texto"}
            ${it.album ? " · " + esc(it.album) : ""} ${close ? `<span class="badge">duração bate</span>` : ""}</div>
        </div>
        <button class="btn small primary">Usar</button>`;
      $("button", row).onclick = async () => {
        try {
          song = await api(`/api/songs/${SONG_ID}/lyrics`, { method: "POST", body: { id: it.id } });
          useSongLyrics();
          setOffset(0);
          $("#title").textContent = song.title;
          $("#coverQ").value = `${song.artist} ${song.title}`;
          $("#clipQ").value = `${song.artist} ${song.title} clipe oficial`;
          openPicker("lyricsPicker", false);
          toast("Letra aplicada");
        } catch (e) { toast(e.message); }
      };
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = `<div class="empty">${esc(e.message)}
      <button class="btn small" id="lyricsRetry" type="button">Tentar de novo</button></div>`;
    $("#lyricsRetry").onclick = searchLyrics;
  }
}
$("#lyricsForm").onsubmit = ev => { ev.preventDefault(); searchLyrics(); };

async function searchCovers() {
  const list = $("#coverList");
  const q = $("#coverQ").value.trim();
  if (!q) return;
  list.innerHTML = `<div class="loading">Buscando no iTunes...<div class="bar"></div></div>`;
  try {
    const items = await api("/api/covers/search?q=" + encodeURIComponent(q));
    list.innerHTML = items.length ? "" : `<div class="empty">Nenhuma capa encontrada.</div>`;
    for (const it of items) {
      const img = document.createElement("img");
      img.src = it.thumb;
      img.title = `${it.artist || ""} — ${it.album || ""}`;
      img.onclick = async () => {
        try {
          song = await api(`/api/songs/${SONG_ID}/cover`, { method: "POST", body: { url: it.full } });
          setArt();
          openPicker("coverPicker", false);
        } catch (e) { toast(e.message); }
      };
      list.appendChild(img);
    }
  } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$("#coverForm").onsubmit = ev => { ev.preventDefault(); searchCovers(); };

function useSongLyrics() {
  lines = song.lyrics ? song.lyrics.lines : [];
  synced = !!(song.lyrics && song.lyrics.synced);
  renderLyrics();
}

// ---------------------------------------------------------------- clipe de fundo

const bgVideo = $("#bgVideo");
let videoSrc = "";
let lastVideoSync = 0;

function videoReady() {
  return !!(song.video && song.video.status === "ready" && song.video.file);
}

function fmtOffset(v) {
  return (v > 0 ? "+" : "") + (v || 0).toFixed(1) + "s";
}

function applyBg() {
  const useVideo = song.settings.bg === "video" && videoReady();
  if (useVideo) {
    const src = `/media/${SONG_ID}/${song.video.file}?v=${song.video.source}`;
    if (src !== videoSrc) { videoSrc = src; bgVideo.src = src; }
  } else bgVideo.pause();
  bgVideo.hidden = !useVideo;
  $("#art").hidden = useVideo;
  $("#bgCover").classList.toggle("on", !useVideo);
  $("#bgClip").classList.toggle("on", useVideo);
  $("#clipAdjust").hidden = !useVideo;
  $("#videoOffset").textContent = fmtOffset(song.settings.video_offset);
  lastVideoSync = 0;
}

// Mantém o vídeo (mudo) no mesmo ponto da música
function syncVideo(pos) {
  if (bgVideo.hidden || !bgVideo.duration) return;
  const now = performance.now();
  if (now - lastVideoSync < 250) return;
  lastVideoSync = now;
  const target = pos + (song.settings.video_offset || 0);
  if (target < 0 || target >= bgVideo.duration - 0.05) {
    if (!bgVideo.paused) bgVideo.pause();
    return;
  }
  if (Math.abs(bgVideo.currentTime - target) > 0.3) bgVideo.currentTime = target;
  if (playing && bgVideo.paused) bgVideo.play().catch(() => {});
  if (!playing && !bgVideo.paused) bgVideo.pause();
}

$("#bgCover").onclick = () => { song.settings.bg = "cover"; applyBg(); save({ settings: true }); };
$("#bgClip").onclick = () => {
  if (!videoReady()) return openPicker("clipPicker");
  song.settings.bg = "video"; applyBg(); save({ settings: true });
};
document.querySelectorAll("[data-vshift]").forEach(b => (b.onclick = () => {
  song.settings.video_offset = Math.round(((song.settings.video_offset || 0) + parseFloat(b.dataset.vshift)) * 100) / 100;
  applyBg();
  save({ settings: true });
}));

function clipStatus() {
  const v = song.video;
  const el = $("#clipStatus");
  $("#clipRemove").hidden = !v;
  if (!v) { el.textContent = "Nenhum clipe ainda."; return; }
  if (v.status === "downloading") el.innerHTML = `Baixando clipe... ${Math.round((v.progress || 0) * 100)}%<div class="bar"></div>`;
  else if (v.status === "ready") el.textContent = `Clipe pronto: ${v.title || v.source}`;
  else el.textContent = "Erro ao baixar o clipe: " + (v.error || "");
}

let clipPoll = null;
async function watchClip() {
  clearTimeout(clipPoll);
  try {
    const s = await api(`/api/songs/${SONG_ID}`);
    song.video = s.video;
  } catch (e) { /* tenta de novo */ }
  clipStatus();
  if (song.video && song.video.status === "downloading") clipPoll = setTimeout(watchClip, 1000);
  else if (videoReady()) {
    song.settings.bg = "video";
    applyBg();
    save({ settings: true });
    toast("Clipe pronto!");
  }
}

async function useClip(videoId) {
  try {
    const s = await api(`/api/songs/${SONG_ID}/video`, { method: "POST", body: { video_id: videoId } });
    song.video = s.video;
    clipStatus();
    watchClip();
  } catch (e) { toast(e.message); }
}
$("#clipSame").onclick = () => useClip(SONG_ID);
$("#clipRemove").onclick = async () => {
  try {
    const s = await api(`/api/songs/${SONG_ID}/video`, { method: "DELETE" });
    song.video = s.video;
    song.settings.bg = "cover";
    videoSrc = "";
    bgVideo.removeAttribute("src");
    applyBg();
    clipStatus();
  } catch (e) { toast(e.message); }
};

async function searchClips() {
  const list = $("#clipList");
  const q = $("#clipQ").value.trim();
  if (!q) return;
  list.innerHTML = `<div class="loading">Buscando no YouTube...<div class="bar"></div></div>`;
  try {
    const items = await api("/api/search?q=" + encodeURIComponent(q));
    list.innerHTML = items.length ? "" : `<div class="empty">Nada encontrado.</div>`;
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <img class="thumb" src="${esc(it.thumbnail)}" alt="">
        <div class="meta">
          <div class="title" title="${esc(it.title)}">${esc(it.title)}</div>
          <div class="sub">${esc(it.channel)} · ${fmtTime(it.duration)}</div>
        </div>
        <button class="btn small primary">Usar</button>`;
      $("button", row).onclick = () => useClip(it.id);
      list.appendChild(row);
    }
  } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$("#clipForm").onsubmit = ev => { ev.preventDefault(); searchClips(); };

// ---------------------------------------------------------------- tela cheia

const controls = $("#controls");
let hideTimer = null;

function setFs(on) {
  document.body.classList.toggle("fs", on);
  lastIdx = -2;
  if (on) {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    showControls(2500);
  } else {
    controls.classList.remove("show");
    if (document.fullscreenElement) document.exitFullscreen?.();
  }
}
$("#fsBtn").onclick = () => setFs(!document.body.classList.contains("fs"));
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) setFs(false); });

function showControls(ms) {
  controls.classList.add("show");
  clearTimeout(hideTimer);
  if (ms) hideTimer = setTimeout(maybeHide, ms);
}
function maybeHide() {
  const busy = controls.matches(":hover") || (document.activeElement && controls.contains(document.activeElement)
    && document.activeElement.tagName === "SELECT");
  if (!busy) controls.classList.remove("show");
}
// Os controles aparecem quando o mouse chega na parte de baixo da tela.
// A área de ativação é a altura real dos controles + uma folga, para não sumirem
// enquanto o mouse ainda está em cima deles.
document.addEventListener("mousemove", e => {
  if (!document.body.classList.contains("fs")) return;
  const zone = controls.offsetHeight + 60;
  if (e.clientY >= window.innerHeight - zone) showControls();
  else { clearTimeout(hideTimer); hideTimer = setTimeout(maybeHide, 250); }
});

document.addEventListener("keydown", e => {
  if (e.target.matches("input[type=text], input[type=search]")) return;
  if (e.code === "Space") { e.preventDefault(); playing ? pause() : play(); }
  else if (e.key === "f" || e.key === "F") setFs(!document.body.classList.contains("fs"));
  else if (e.key === "ArrowRight") seek(position() + 5);
  else if (e.key === "ArrowLeft") seek(position() - 5);
});

// ---------------------------------------------------------------- início

(async () => {
  const [info, s] = await Promise.all([api("/api/info"), api(`/api/songs/${SONG_ID}`)]);
  song = s;
  song.settings = { mode: "instrumental", backing: 1, lead: 0, blur: 0.5, brightness: 0.85,
                    bg: "cover", video_offset: 0, ...(song.settings || {}) };
  song.offset = song.offset || 0;
  $("#title").textContent = cleanTitle(song.title, song.artist);
  document.title = `${cleanTitle(song.title, song.artist)} · Karaoke`;

  // nota e escala (mandadas por MIDI para o Auto-Tune)
  const noteSel = $("#note"), scaleSel = $("#scale");
  for (const n of info.notes) noteSel.add(new Option(n, n));
  const scales = info.scales.includes(song.scale) ? info.scales : [...info.scales, song.scale];
  for (const sc of scales) scaleSel.add(new Option(sc, sc));
  noteSel.value = song.key;
  scaleSel.value = song.scale;
  const sendKey = () => {
    song.key = noteSel.value; song.scale = scaleSel.value;
    api(`/api/songs/${SONG_ID}`, { method: "PATCH", body: { key: song.key, scale: song.scale } })
      .then(() => toast(`Tom: ${song.key} ${song.scale}`)).catch(e => toast(e.message));
  };
  noteSel.onchange = sendKey;
  scaleSel.onchange = sendKey;
  api(`/api/songs/${SONG_ID}/midi`, { method: "POST", body: {} }).catch(() => {});

  bindSetting("#volBacking", "backing", applyMix);
  bindSetting("#volLead", "lead", applyMix);
  bindSetting("#blur", "blur", applyLook);
  bindSetting("#brightness", "brightness", applyLook);
  $("#offset").textContent = (song.offset > 0 ? "+" : "") + song.offset.toFixed(1) + "s";
  applyMix();
  applyLook();
  setArt();

  $("#lyricsQ").value = searchQuery();
  $("#coverQ").value = searchQuery();
  $("#clipQ").value = searchQuery("clipe oficial");
  applyBg();
  if (song.video && song.video.status === "downloading") watchClip();
  useSongLyrics();
  const pick = params.get("pick");
  if (pick === "lyrics" || (!song.lyrics && pick !== "cover")) openPicker("lyricsPicker");
  if (pick === "cover" || (!song.lyrics && !song.cover && pick !== "lyrics")) openPicker("coverPicker");

  try {
    await loadStems();
  } catch (e) {
    $("#msg").textContent = "Erro ao carregar o áudio: " + e.message;
    return;
  }
  updateMsg();
  requestAnimationFrame(tick);
})();
