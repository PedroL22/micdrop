// Tela principal (PC do anfitrião).

setupSearch({ form: $("#searchForm"), input: $("#q"), status: $("#searchStatus"), results: $("#results") });

let songs = [];
let lastQueue = "";
let lastSongs = "";

function libraryRow(s) {
  const row = document.createElement("div");
  row.className = "lib";
  row.innerHTML = `
    <div class="item" title="Abrir player">
      <img class="thumb" src="${esc(songThumb(s))}" alt="">
      <div class="meta">
        <div class="title">${esc(songTitle(s))}</div>
        <div class="sub">${esc(s.artist || s.channel)}
          <span class="badge">${esc(s.key)} ${esc(s.scale)}</span>
          ${s.lyrics ? "" : `<span class="badge warn">sem letra</span>`}
        </div>
      </div>
    </div>
    <button class="tool play" title="Prévia">▶</button>
    <button class="tool" data-pick="lyrics" title="Trocar letra">🎤</button>
    <button class="tool" data-pick="cover" title="Trocar arte de fundo">🖼️</button>
    <button class="tool del" title="Apagar música">🗑️</button>`;
  $(".item", row).onclick = () => (location.href = `/player/${s.id}`);
  const play = $(".play", row);
  play.onclick = () => togglePreview(play, `/media/${s.id}/original.flac`, (s.duration || 60) / 2);
  row.querySelectorAll("[data-pick]").forEach(b =>
    (b.onclick = () => (location.href = `/player/${s.id}?pick=${b.dataset.pick}`)));
  $(".del", row).onclick = async () => {
    if (!confirm(`Apagar "${songTitle(s)}" da biblioteca?`)) return;
    try { await api(`/api/songs/${s.id}`, { method: "DELETE" }); refresh(); }
    catch (e) { toast(e.message); }
  };
  return row;
}

function renderLibrary() {
  const f = $("#filter").value.trim().toLowerCase();
  const box = $("#library");
  box.innerHTML = "";
  const shown = songs.filter(s => !f || `${s.title} ${s.artist} ${s.channel}`.toLowerCase().includes(f));
  if (!shown.length) {
    box.innerHTML = `<div class="empty">${songs.length ? "Nenhuma música encontrada." : "Nenhuma musica processada ainda."}</div>`;
    return;
  }
  for (const s of shown) box.appendChild(libraryRow(s));
}
$("#filter").addEventListener("input", renderLibrary);

startPolling(async () => {
  const [queue, lib] = await Promise.all([api("/api/queue"), api("/api/songs")]);
  const qs = JSON.stringify(queue);
  if (qs !== lastQueue) {
    lastQueue = qs;
    $("#queueBox").hidden = !queue.length;
    const box = $("#queue");
    box.innerHTML = "";
    for (const j of queue) box.appendChild(queueRow(j));
  }
  const ls = JSON.stringify(lib);
  if (ls !== lastSongs) {
    lastSongs = ls;
    songs = lib;
    stopPreview();
    renderLibrary();
  }
});

// ---------------------------------------------------------------- MIDI e sessão

(async () => {
  const info = await api("/api/info");
  $("#sessionUrl").textContent = info.session_url;
  const sel = $("#midi");
  for (const d of info.midi_devices) sel.add(new Option(d, d));
  if (info.midi_device && !info.midi_devices.includes(info.midi_device)) {
    sel.add(new Option(info.midi_device + " (desconectado)", info.midi_device));
  }
  sel.value = info.midi_device || "";
  sel.onchange = () => api("/api/midi/device", { method: "POST", body: { device: sel.value } })
    .then(() => toast(sel.value ? `MIDI: ${sel.value}` : "MIDI desligado"))
    .catch(e => toast(e.message));
  const test = which => api("/api/midi/test", { method: "POST", body: { which } })
    .then(r => toast(r.sent ? "CC enviado" : "Escolha um MIDI Device primeiro")).catch(e => toast(e.message));
  $("#ccKey").onclick = () => test("key");
  $("#ccScale").onclick = () => test("scale");
})();
