"""Fila de processamento: baixa do YouTube, separa as vozes na GPU e detecta o tom.

Cada música vira uma pasta em data/<id do vídeo>/ com:
  original.flac      música original
  instrumental.flac  sem nenhuma voz
  lead.flac          voz principal
  backing.flac       vocais de apoio (backing vocals)
  song.json          título, artista, tom, letra, capa e ajustes do player
"""

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid

import requests
import yt_dlp

import lyrics
import romanize
import spotify

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
MODELS = os.path.join(ROOT, "models")
PREVIEWS = os.path.join(DATA, "_previews")
QUEUE_FILE = os.path.join(DATA, "_queue.json")
STEMS = ("original", "instrumental", "lead", "backing")

os.makedirs(DATA, exist_ok=True)
os.makedirs(PREVIEWS, exist_ok=True)

_lock = threading.RLock()
_jobs = []          # fila (o primeiro "queued" é o próximo)
_wake = threading.Event()
_config = {}
GPU_LOCK = threading.Lock()  # separação e alinhamento não rodam juntos (memória da placa)

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


# ---------------------------------------------------------------- utilidades

def song_dir(song_id):
    if not VIDEO_ID_RE.match(song_id or ""):
        raise ValueError("id inválido")
    return os.path.join(DATA, song_id)


def _write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    # No Windows, trocar o arquivo falha ("Acesso negado") se alguém estiver lendo
    # ele naquele instante (a página consulta a cada segundo): tenta de novo.
    for attempt in range(40):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 39:
                raise
            time.sleep(0.05)


def _read_json(path, default=None):
    for attempt in range(20):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except PermissionError:
            time.sleep(0.05)  # sendo trocado neste instante
        except (OSError, ValueError):
            return default
    return default


JUNK = re.compile(
    r"\s*[\(\[][^\)\]]*(official|oficial|video|vídeo|clipe|clip|lyric|letra|audio|áudio|"
    r"hd|hq|4k|remaster|ao vivo|live|visualizer|prod\.?)[^\)\]]*[\)\]]",
    re.IGNORECASE,
)


DASH = re.compile(r"\s+[-–—|]\s+")  # "Artista - Música", "Música – Artista", "A | B"


def _same(a, b):
    norm = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("vevo", ""))
    return bool(norm(a)) and norm(a) == norm(b)


FEAT_PART = re.compile(r"(?i)\s*[\(\[]?\b(?:ft|feat|featuring)\b\.?\s+[^\(\)\[\]]+?[\)\]]?(?=\s*(?:[\(\[]?\b(?:ft|feat|featuring)\b|$))")


def tidy_title(title):
    """Espaços duplos e participações repetidas ("... ft. X ft. X" -> "... ft. X")."""
    title = re.sub(r"\s+", " ", title or "").strip()
    feats = FEAT_PART.findall(title)
    if len(feats) > 1:
        first = FEAT_PART.search(title)
        title = title[: first.end()] + FEAT_PART.sub("", title[first.end():])
    return title.strip()


def clean_title(title, artist):
    """Tira o nome do artista quando ele vem grudado no título ("Música – Artista")."""
    title = tidy_title(title)
    parts = DASH.split(title, maxsplit=1)
    if len(parts) == 2 and artist:
        if _same(parts[1], artist):
            return parts[0].strip()
        if _same(parts[0], artist):
            return parts[1].strip()
    return title


def guess_artist_title(info):
    """Tenta descobrir artista e nome da música a partir dos dados do YouTube."""
    artist = (info.get("artist") or info.get("creator") or "").split(",")[0].strip()
    channel = (info.get("channel") or info.get("uploader") or "").strip()
    if info.get("track") and artist:
        return artist, clean_title(info["track"], artist)
    clean = re.sub(r"\s+", " ", JUNK.sub("", info.get("title") or "")).strip()
    if channel.endswith(" - Topic"):
        channel = channel[: -len(" - Topic")]
    channel = re.sub(r"(?i)\s*(vevo|official)$", "", channel).strip()
    parts = DASH.split(clean, maxsplit=1)
    if len(parts) == 2:
        a, b = (p.strip() for p in parts)
        if _same(b, channel):      # "Música – Artista"
            return b, a
        return a, b                # "Artista - Música"
    return channel, clean


# ---------------------------------------------------------------- acesso ao YouTube

BLOCKED = re.compile(r"(?i)sign in to confirm|not a bot|http error 429|too many requests|http error 403")


def cookies_file():
    """cookies.txt do YouTube enviado nas configurações (opcional, evita bloqueios)."""
    return os.path.join(DATA, "_youtube_cookies.txt")


def js_runtime():
    """O YouTube exige um interpretador de JavaScript para liberar os vídeos (yt-dlp + yt-dlp-ejs)."""
    for name in ("deno", "node", "bun"):
        path = shutil.which(name)
        if path:
            return name, path
    return None, None


def _ydl(opts):
    """yt-dlp com as opções de sempre: JavaScript, cookies, novas tentativas e pedidos espaçados."""
    o = {"retries": 5, "extractor_retries": 3, "fragment_retries": 5,
         "sleep_interval_requests": 0.4, **opts}
    name, path = js_runtime()
    if name and name != "deno":  # o deno já é usado por padrão
        o["js_runtimes"] = {name: {"path": path}}
    if os.path.exists(cookies_file()):
        o["cookiefile"] = cookies_file()
    return yt_dlp.YoutubeDL(o)


_cooldown_until = 0.0  # o YouTube pediu uma pausa: a fila espera até esse horário


def youtube_status():
    name, _ = js_runtime()
    return {"cookies": os.path.exists(cookies_file()), "js_runtime": name,
            "cooldown_until": _cooldown_until if _cooldown_until > time.time() else None}


def thumb_url(video_id):
    return f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"


# ---------------------------------------------------------------- YouTube

def search_youtube(query, limit=5):
    query = query.strip()
    opts = {"quiet": True, "no_warnings": True, "skip_download": True,
            "extract_flat": "in_playlist"}
    is_url = query.startswith("http") or "youtu" in query
    target = query if is_url else f"ytsearch{int(limit)}:{query}"
    with _ydl(opts) as ydl:
        info = ydl.extract_info(target, download=False)
    entries = info.get("entries") if "entries" in info else [info]
    results = []
    for e in entries or []:
        vid = e.get("id")
        if not vid or not VIDEO_ID_RE.match(vid):
            continue
        results.append({
            "id": vid,
            "title": e.get("title") or "",
            "channel": e.get("channel") or e.get("uploader") or "",
            "duration": e.get("duration") or 0,
            "thumbnail": thumb_url(vid),
        })
    return results[:limit] if not is_url else results[:1]


PLAYLIST_ID = re.compile(r"[?&]list=([A-Za-z0-9_-]+)")


def youtube_playlist_id(text):
    """Id da playlist num link do YouTube (ignora os "mix" automáticos, que não têm fim)."""
    m = PLAYLIST_ID.search(text or "")
    if not m or m.group(1).startswith("RD"):
        return None
    return m.group(1)


def youtube_playlist(list_id, limit=300):
    opts = {"quiet": True, "no_warnings": True, "skip_download": True,
            "extract_flat": "in_playlist", "playlistend": limit}
    with _ydl(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/playlist?list={list_id}", download=False)
    items = []
    for e in info.get("entries") or []:
        vid = e.get("id")
        if not vid or not VIDEO_ID_RE.match(vid) or e.get("title") in ("[Private video]", "[Deleted video]"):
            continue
        items.append({"id": vid, "title": e.get("title") or "", "duration": e.get("duration") or 0,
                      "channel": e.get("channel") or e.get("uploader") or "", "thumbnail": thumb_url(vid)})
    return {"title": info.get("title") or "Playlist", "items": items}


def resolve_query(q, limit=5):
    """O que mostrar para o texto digitado: busca, um vídeo, playlist do YouTube ou link do Spotify."""
    q = (q or "").strip()
    sp = spotify.parse_link(q)
    if sp:
        kind, sid = sp
        data = spotify.fetch(kind, sid)
        items = [{
            "id": None,
            "title": t["title"],
            "channel": ", ".join(t["artists"]),
            "duration": t["duration"],
            "thumbnail": t["cover"],
            "preview": t["preview"],
            "spotify": {"id": t["spotify_id"], "title": t["title"], "artist": t["artist"],
                        "duration": t["duration"], "cover": t["cover"]},
        } for t in data["tracks"]]
        return {"kind": "video" if kind == "track" else "playlist", "source": "spotify",
                "title": data["title"], "cover": data["cover"], "items": items,
                "truncated": data["maybe_truncated"]}
    list_id = youtube_playlist_id(q) if ("youtu" in q or q.startswith("http")) else None
    if list_id:
        data = youtube_playlist(list_id)
        return {"kind": "playlist", "source": "youtube", "title": data["title"],
                "cover": data["items"][0]["thumbnail"] if data["items"] else None,
                "items": data["items"], "truncated": False}
    items = search_youtube(q, limit)
    is_url = q.startswith("http") or "youtu" in q
    return {"kind": "video" if is_url else "search", "source": "youtube", "title": None,
            "items": items, "truncated": False}


def mark_duplicates(items):
    """Marca nos resultados o que já está na biblioteca ou na fila (o "Adicionar todas" pula)."""
    songs = [(s["id"], s.get("spotify_id"), song_key(s.get("artist"), s.get("title"))) for s in list_songs()]
    with _lock:
        jobs = [(j.get("video_id"), (j.get("spotify") or {}).get("id"), tuple(j["key"]) if j.get("key") else None)
                for j in _jobs]
    for it in items:
        key = entry_key(it)
        sp_id = (it.get("spotify") or {}).get("id")
        it["duplicate"] = None
        for sid, spid, skey in songs:
            if (it.get("id") and it["id"] == sid) or (sp_id and sp_id == spid) or _same_song(key, skey):
                it["duplicate"] = "biblioteca"
                break
        else:
            for vid, spid, jkey in jobs:
                if (it.get("id") and it["id"] == vid) or (sp_id and sp_id == spid) or (jkey and _same_song(key, jkey)):
                    it["duplicate"] = "fila"
                    break
    return items


def find_on_youtube(title, artist, duration, how_many=4):
    """Acha no YouTube a faixa de uma música do Spotify: mesmo nome e a mesma duração.

    Devolve os melhores candidatos, do mais provável ao menos (se um estiver bloqueado, tenta o próximo)."""
    want = lyrics._norm(lyrics.core_title(title))
    scored, seen = [], set()
    best, best_score = None, None
    for q in (f"{artist} {lyrics.core_title(title)}", f"{artist} {lyrics.core_title(title)} audio"):
        try:
            results = search_youtube(q, 8)
        except Exception:
            continue
        for r in results:
            if NOT_RADIO.search(r["title"]) and not NOT_RADIO.search(title):
                # ao vivo, cover, remix... (a não ser que a própria faixa seja assim)
                if not re.search(r"(?i)clipe|music video|official video", r["title"]):
                    continue
            if want and want not in lyrics._norm(r["title"]):
                continue
            diff = abs((r["duration"] or 0) - duration) if duration else 0
            if duration and diff > 60:
                continue  # nada parecido
            score = diff + (0 if lyrics._norm(artist) in lyrics._norm(r["channel"] + r["title"]) else 5)
            if r["id"] not in seen:
                seen.add(r["id"])
                scored.append((score, r))
            if best_score is None or score < best_score:
                best, best_score = r, score
        if best and best_score <= 2 and len(scored) >= how_many:
            break
    return [r for _, r in sorted(scored, key=lambda x: x[0])[:how_many]]


SPOTIFY_PREVIEW = re.compile(r"^https://p\.scdn\.co/mp3-preview/[A-Za-z0-9]+")


def preview_spotify(url, seconds=5):
    """5 s do meio do trecho de 30 s que o Spotify oferece (cacheado)."""
    if not SPOTIFY_PREVIEW.match(url or ""):
        raise ValueError("endereço inválido")
    out = os.path.join(PREVIEWS, "sp_" + url.rsplit("/", 1)[-1][:40] + ".mp3")
    if not (os.path.exists(out) and os.path.getsize(out) > 0):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "12", "-i", url, "-t", str(seconds),
                        "-vn", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "160k", out], check=True, timeout=60)
    return out


def preview_clip(video_id, seconds=5):
    """Corta um trecho do meio da música (cacheado em data/_previews)."""
    song_dir(video_id)  # valida o id
    out = os.path.join(PREVIEWS, f"{video_id}.mp3")
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return out
    opts = {"quiet": True, "no_warnings": True, "format": "bestaudio/best"}
    with _ydl(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    start = max(0, (info.get("duration") or 60) / 2)
    headers = "".join(f"{k}: {v}\r\n" for k, v in (info.get("http_headers") or {}).items())
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{start:.1f}"]
    if headers:
        cmd += ["-headers", headers]
    cmd += ["-i", info["url"], "-t", str(seconds), "-vn", "-ac", "2",
            "-af", f"afade=t=in:d=0.3,afade=t=out:st={seconds - 0.5}:d=0.5",
            "-c:a", "libmp3lame", "-b:a", "160k", out]
    subprocess.run(cmd, check=True, timeout=90)
    return out


# ---------------------------------------------------------------- biblioteca

def list_songs():
    songs = []
    for name in os.listdir(DATA):
        meta = _read_json(os.path.join(DATA, name, "song.json"))
        if meta:
            songs.append(meta)
    songs.sort(key=lambda s: s.get("created", 0), reverse=True)
    return songs


def get_song(song_id):
    return _read_json(os.path.join(song_dir(song_id), "song.json"))


def update_song(song_id, changes):
    with _lock:
        meta = get_song(song_id)
        if meta is None:
            return None
        for k, v in changes.items():
            if k == "settings" and isinstance(v, dict):
                meta.setdefault("settings", {}).update(v)
            else:
                meta[k] = v
        _write_json(os.path.join(song_dir(song_id), "song.json"), meta)
        return meta


VIDEO_FORMAT = ("bv*[height<=720][vcodec^=avc1]/bv*[height<=720][ext=mp4]/"
                "bv*[height<=720]/bv*/b[height<=720]")


def start_video_download(song_id, source_id):
    """Baixa só a imagem (sem áudio) de um vídeo do YouTube para usar de fundo."""
    folder = song_dir(song_id)
    song_dir(source_id)  # valida
    with _lock:
        meta = get_song(song_id)
        if meta is None:
            return None
        if (meta.get("video") or {}).get("status") == "downloading":
            return meta
        for name in os.listdir(folder):
            if name.startswith("video."):
                os.remove(os.path.join(folder, name))
        meta = update_song(song_id, {"video": {"source": source_id, "status": "downloading",
                                               "progress": 0.0, "file": None, "error": None}})

    def run():
        try:
            done = _fetch_video(folder, source_id,
                                lambda p: _video_state(song_id, progress=round(min(p, 0.99), 2)))
            _video_state(song_id, **done)
            audio_id = (get_song(song_id) or {}).get("audio_source") or song_id
            if source_id == audio_id:
                update_song(song_id, {"settings": {"video_offset": 0.0}})
            else:
                sync_clip(song_id)
        except Exception as exc:
            print(f"[clipe] erro em {song_id}: {exc}")
            _video_state(song_id, status="error", error=str(exc)[:300])

    threading.Thread(target=run, daemon=True, name=f"video-{song_id}").start()
    return meta


def _fetch_video(folder, source_id, on_progress=None):
    """Baixa a imagem do vídeo (sem áudio, até 720p) em <pasta>/video.<ext>."""
    last = [0.0]

    def hook(d):
        if on_progress and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            p = d.get("downloaded_bytes", 0) / total if total else 0
            if p - last[0] >= 0.05:
                last[0] = p
                on_progress(p)

    opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "noprogress": True,
            "format": VIDEO_FORMAT, "outtmpl": os.path.join(folder, "video.%(ext)s"),
            "progress_hooks": [hook]}
    with _ydl(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={source_id}", download=True)
        path = ydl.prepare_filename(info)
    if not os.path.exists(path):  # yt-dlp pode trocar a extensão
        path = next(os.path.join(folder, n) for n in os.listdir(folder) if n.startswith("video."))
    return {"source": source_id, "status": "ready", "progress": 1.0, "error": None,
            "file": os.path.basename(path), "title": info.get("title"), "duration": info.get("duration")}


def _extract(vid):
    """Dados do vídeo sem baixar."""
    with _ydl({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
        return ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)


NOT_RADIO = re.compile(r"(?i)\b(ao vivo|live|cover|karaok\w*|instrumental|remix|8d|slowed|reverb|sped up|"
                       r"acoustic|acústico|acustico|extended|clipe|music video|official video)\b")


def _find_radio_edit(artist, title, target, exclude):
    """Procura no YouTube a versão de rádio: mesma música, duração igual à da letra (±3 s)."""
    seen, best, best_score = {exclude}, None, None
    for q in (f"{artist} {title} audio", f"{artist} {title}", f"{artist} {title} topic"):
        try:
            results = search_youtube(q, 8)
        except Exception:
            continue
        for r in results:
            if r["id"] in seen or not r["duration"]:
                continue
            seen.add(r["id"])
            if NOT_RADIO.search(r["title"]) or lyrics._norm(lyrics.core_title(title)) not in lyrics._norm(r["title"]):
                continue
            diff = abs(r["duration"] - target)
            if diff > 3:
                continue
            score = diff + (0 if lyrics._norm(artist) in lyrics._norm(r["channel"] + r["title"]) else 2)
            if best_score is None or score < best_score:
                best, best_score = r, score
        if best and best_score <= 1:
            break
    return best


def _to_wav(src, dst, rate=11025):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", str(rate), dst],
                   check=True)


def _envelope(path, sr=11025, hop=256):
    import librosa
    import numpy as np

    y, _ = librosa.load(path, sr=sr, mono=True)
    e = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    return (e - e.mean()) / (e.std() + 1e-9)


def _offset_between(song_path, clip_path, sr=11025, hop=256):
    """Em que segundo do clipe a música começa (positivo = o clipe tem introdução).

    Compara o "ritmo" (força dos ataques) dos dois áudios por correlação cruzada.
    Retorna None se a semelhança for fraca (clipe com outra versão da música)."""
    import numpy as np

    a, b = _envelope(song_path, sr, hop), _envelope(clip_path, sr, hop)
    n = 1 << int(np.ceil(np.log2(len(a) + len(b))))
    corr = np.fft.irfft(np.fft.rfft(b, n) * np.conj(np.fft.rfft(a, n)), n)
    fps = sr / hop
    lags = np.arange(n)
    lags[lags > n // 2] -= n  # índices do fim = atrasos negativos
    ok = (lags >= -30 * fps) & (lags <= min(len(b), 300 * fps))
    corr, lags = corr[ok], lags[ok]
    i = int(np.argmax(corr))
    z = (corr[i] - corr.mean()) / (corr.std() + 1e-9)
    if z < 6:
        return None
    return round(float(lags[i] / fps), 2)


def clip_offset(folder, clip_id, audio_id):
    """Baixa só o áudio do clipe e mede quanto ele está adiantado/atrasado em relação à música."""
    if clip_id == audio_id:
        return 0.0
    tmp = os.path.join(folder, "_clip_audio")
    os.makedirs(tmp, exist_ok=True)
    try:
        opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "noprogress": True,
                "format": "bestaudio/best", "outtmpl": os.path.join(tmp, "a.%(ext)s")}
        with _ydl(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={clip_id}", download=True)
            src = ydl.prepare_filename(info)
        _to_wav(src, os.path.join(tmp, "clip.wav"))
        _to_wav(os.path.join(folder, "original.flac"), os.path.join(tmp, "song.wav"))
        return _offset_between(os.path.join(tmp, "song.wav"), os.path.join(tmp, "clip.wav"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def sync_clip(song_id):
    """Recalcula em segundo plano o atraso do clipe (pula a introdução do vídeo)."""
    meta = get_song(song_id)
    video = (meta or {}).get("video") or {}
    if video.get("status") != "ready" or video.get("sync") == "running":
        return meta
    _video_state(song_id, sync="running", sync_error=None)

    def run():
        try:
            off = clip_offset(song_dir(song_id), video["source"], meta.get("audio_source") or song_id)
            if off is None:
                _video_state(song_id, sync="error", sync_error="O som do clipe não bate com a música")
                return
            _video_state(song_id, sync="done", offset=off)
            update_song(song_id, {"settings": {"video_offset": off}})
        except Exception as exc:
            print(f"[clipe] erro ao sincronizar {song_id}: {exc}")
            _video_state(song_id, sync="error", sync_error=str(exc)[:200])

    threading.Thread(target=run, daemon=True, name=f"clipsync-{song_id}").start()
    return get_song(song_id)


NOT_A_CLIP = re.compile(r"(?i)\b(lyrics?|letra|legendad[oa]|tradu[cç][aã]o|audio|áudio|ao vivo|live|cover|"
                        r"karaok\w*|instrumental|remix|8d|slowed|reverb|sped up|visuali[sz]er)\b")


OFFICIAL = re.compile(r"(?i)(official|oficial|videoclipe|clipe|music video|m/v|\bmv\b)")


def _pick_clip(info, artist, title, duration):
    """Qual vídeo usar de fundo: o próprio, ou o clipe oficial se o adicionado for só áudio."""
    vid = info["id"]
    channel = info.get("channel") or info.get("uploader") or ""
    art_track = channel.endswith(" - Topic") or (info.get("description") or "").startswith("Provided to YouTube by")
    # lyric video, visualizer, "official audio"...: a imagem não é clipe (e às vezes tem a letra escrita)
    not_clip = art_track or bool(NOT_A_CLIP.search(info.get("title") or ""))
    if not not_clip:
        return vid
    results, seen = [], set()
    for q in (f"{artist} {title} official music video", f"{artist} {title} clipe oficial"):
        try:
            for r in search_youtube(q, 8):
                if r["id"] not in seen:
                    seen.add(r["id"])
                    results.append(r)
        except Exception:
            pass
    want = lyrics._norm(title)
    best, best_score = vid, None
    for r in results:
        if r["id"] == vid or r["channel"].endswith(" - Topic") or NOT_A_CLIP.search(r["title"]):
            continue
        if want and want not in lyrics._norm(r["title"]):
            continue
        if not OFFICIAL.search(r["title"]):  # sem "clipe/oficial/official video": provável cópia do áudio
            continue
        # clipes costumam ter edição própria (mais curtos/longos que o álbum)
        if duration and r["duration"] and not (0.5 * duration <= r["duration"] <= 1.5 * duration):
            continue
        diff = abs((r["duration"] or duration or 0) - (duration or 0))
        score = diff
        if lyrics._norm(artist) and lyrics._norm(artist) in lyrics._norm(r["channel"]):
            score -= 40  # publicado pelo canal do próprio artista
        if best_score is None or score < best_score:
            best, best_score = r["id"], score
    if best == vid and not_clip:
        return None  # sem clipe oficial: melhor a capa do que um lyric video de fundo
    return best


def _video_state(song_id, **kw):
    with _lock:
        meta = get_song(song_id)
        if meta and meta.get("video"):
            update_song(song_id, {"video": {**meta["video"], **kw}})


def remove_video(song_id):
    folder = song_dir(song_id)
    with _lock:
        for name in os.listdir(folder):
            if name.startswith("video."):
                os.remove(os.path.join(folder, name))
        meta = get_song(song_id)
        if meta is None:
            return None
        settings = {**meta.get("settings", {}), "bg": "cover"}
        return update_song(song_id, {"video": None, "settings": settings})


# ---------------------------------------------------------------- palavras (alinhamento)

def _set_align(song_id, source, **kw):
    """Atualiza o estado do alinhamento, se a letra ainda for a mesma."""
    with _lock:
        meta = get_song(song_id)
        lyr = meta and meta.get("lyrics")
        if not lyr or lyr.get("source") != source:
            return False
        lyr["align"] = {**(lyr.get("align") or {}), **kw}
        update_song(song_id, {"lyrics": lyr})
        return True


def start_word_sync(song_id):
    """Descobre o tempo de cada palavra em segundo plano (align.py na GPU)."""
    meta = get_song(song_id)
    lyr = (meta or {}).get("lyrics")
    if not lyr or not lyr.get("synced") or not lyr.get("lines"):
        return meta
    if (lyr.get("align") or {}).get("status") in ("queued", "running"):
        return meta
    source = lyr.get("source")
    _set_align(song_id, source, status="queued", progress=0.0, stage="Na fila da placa de vídeo",
               error=None)
    threading.Thread(target=_run_align, args=(song_id, source), daemon=True,
                     name=f"align-{song_id}").start()
    return get_song(song_id)


def _align_words(folder, lines, offset, on_stage=None, on_progress=None, job=None):
    """Roda o align.py e devolve o tempo de cada palavra de cada linha."""
    inp = os.path.join(folder, "_align_in.json")
    out = os.path.join(folder, "_align_out.json")
    tail = []
    try:
        _write_json(inp, {"lines": [{"t": l["t"], "text": l["text"]} for l in lines], "offset": offset})
        proc = subprocess.Popen(
            [sys.executable, "-u", os.path.join(ROOT, "align.py"), folder, inp, out],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding="utf-8", errors="replace", env=dict(os.environ, PYTHONIOENCODING="utf-8"),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if job is not None:
            job["_proc"] = proc
        last = -1.0
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            tail = (tail + [line])[-6:]
            if line == "MODEL" and on_stage:
                on_stage("Baixando modelo de palavras (só na primeira vez)...")
            elif line.startswith("PROG:") and on_progress:
                p = float(line[5:])
                if p - last >= 0.05 or p >= 1:
                    last = p
                    on_progress(p)
        code = proc.wait()
        if job is not None:
            job.pop("_proc", None)
            if job.get("_cancel"):
                raise Cancelled()
        if code != 0 or not os.path.exists(out):
            raise RuntimeError(" | ".join(tail[-3:]) or f"código {code}")
        return _read_json(out, {}).get("words") or []
    finally:
        for path in (inp, out):
            if os.path.exists(path):
                os.remove(path)


def _run_align(song_id, source):
    folder = song_dir(song_id)
    try:
        with GPU_LOCK:
            meta = get_song(song_id)
            lyr = (meta or {}).get("lyrics")
            if not lyr or lyr.get("source") != source:
                return
            _set_align(song_id, source, status="running", stage="Sincronizando palavras...")
            words = _align_words(
                folder, lyr["lines"], meta.get("offset") or 0,
                on_stage=lambda s: _set_align(song_id, source, stage=s),
                on_progress=lambda p: _set_align(song_id, source, progress=round(p, 2)))
        with _lock:
            meta = get_song(song_id)
            lyr = (meta or {}).get("lyrics")
            if not lyr or lyr.get("source") != source:
                return
            for line, w in zip(lyr["lines"], words):
                line["w"] = w
            lyr["words_source"] = "align"
            lyr["align"] = {"status": "done", "progress": 1.0}
            update_song(song_id, {"lyrics": lyr})
    except Exception as exc:
        print(f"[palavras] erro em {song_id}: {exc}")
        _set_align(song_id, source, status="error", error=str(exc)[:300])


def delete_song(song_id):
    path = song_dir(song_id)
    if os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=True)


# ---------------------------------------------------------------- fila

def _save_queue():
    keep = [{k: v for k, v in j.items() if not k.startswith("_")} for j in _jobs]
    _write_json(QUEUE_FILE, keep)


def public_jobs(token=None, admin=False):
    """Fila sem dados internos; "mine" diz se quem pediu pode apagar o item."""
    with _lock:
        out = []
        for j in _jobs:
            item = {k: v for k, v in j.items() if not k.startswith("_") and k != "owner"}
            item["mine"] = admin or (token is not None and j.get("owner") == token)
            out.append(item)
        return out


# ---------------------------------------------------------------- duplicatas

def song_key(artist, title):
    """(artista, nome) normalizados: sem "(Official Video)", "ft. X", acentos, pontuação e maiúsculas."""
    t = lyrics._norm(lyrics.core_title(clean_title(JUNK.sub("", romanize.name(title or "")), artist)))
    a = lyrics._norm(re.sub(r"(?i)\s*(vevo|official|- topic)$", "", romanize.name(artist or "")))
    return a, t


def entry_key(entry):
    """Chave de um resultado de busca: do Spotify (nome oficial) ou adivinhada pelo título do vídeo."""
    sp = entry.get("spotify") or {}
    if sp.get("title"):
        return song_key(sp.get("artist"), sp["title"])
    artist, title = guess_artist_title({"title": entry.get("title") or "", "channel": entry.get("channel") or ""})
    return song_key(artist, title)


def _same_song(k1, k2):
    (a1, t1), (a2, t2) = k1, k2
    if not t1 or t1 != t2:
        return False
    return not a1 or not a2 or a1 in a2 or a2 in a1  # "Charlie Brown Jr" = "Charlie Brown Jr."


def find_duplicate(key, exclude_song=None, exclude_job=None):
    """"biblioteca", "fila" ou None."""
    for s in list_songs():
        if s["id"] != exclude_song and _same_song(key, song_key(s.get("artist"), s.get("title"))):
            return "biblioteca"
    with _lock:
        for j in _jobs:
            if j is not exclude_job and j.get("key") and _same_song(key, tuple(j["key"])):
                return "fila"
    return None


def add_job(entry, owner=None, owner_name=None):
    """Põe uma música na fila. `entry` tem o id do YouTube ou, vindo do Spotify, `spotify`
    (nome, artista e duração): o vídeo é procurado no YouTube na hora de processar."""
    vid = entry.get("id")
    sp = entry.get("spotify") or None
    if vid:
        song_dir(vid)
    elif not (sp and sp.get("title")):
        raise ValueError("música sem id")
    with _lock:
        if vid and get_song(vid):
            return None, "Essa música já está na biblioteca"
        if vid and any(j["video_id"] == vid for j in _jobs):
            return None, "Essa música já está na fila"
        if sp and any((j.get("spotify") or {}).get("id") == sp.get("id") for j in _jobs):
            return None, "Essa música já está na fila"
        if sp and any(s.get("spotify_id") == sp.get("id") for s in list_songs()):
            return None, "Essa música já está na biblioteca"
        key = entry_key(entry)
        dup = find_duplicate(key)
        if dup:
            return None, f"Essa música já está na {dup}"
        job = {
            "id": uuid.uuid4().hex[:10],
            "video_id": vid,
            "spotify": {k: sp.get(k) for k in ("id", "title", "artist", "duration", "cover")} if sp else None,
            "key": list(key),
            "title": entry.get("title") or vid,
            "channel": entry.get("channel") or "",
            "duration": entry.get("duration") or 0,
            "thumbnail": entry.get("thumbnail") or (thumb_url(vid) if vid else None),
            "owner": owner,
            "owner_name": (owner_name or "")[:30],
            "status": "queued",
            "stage": "Na fila",
            "progress": 0.0,
            "error": None,
            "created": time.time(),
        }
        _jobs.append(job)
        _save_queue()
    _wake.set()
    return job, None


def find_job(job_id):
    with _lock:
        return next((j for j in _jobs if j["id"] == job_id), None)


def remove_job(job_id):
    with _lock:
        job = find_job(job_id)
        if not job:
            return False
        job["_cancel"] = True
        proc = job.get("_proc")
        if proc and proc.poll() is None:
            proc.kill()
        _jobs.remove(job)
        _save_queue()
        if job["status"] != "done" and job.get("video_id") and not get_song(job["video_id"]):
            shutil.rmtree(os.path.join(DATA, job["video_id"]), ignore_errors=True)
        return True


def retry_job(job_id):
    with _lock:
        job = find_job(job_id)
        if job and job["status"] == "error":
            job.update(status="queued", stage="Na fila", progress=0.0, error=None, blocked=0)
            if job.get("spotify"):
                # faixa do Spotify: procura de novo (o vídeo escolhido antes pode estar bloqueado)
                vid = job.get("video_id")
                if vid and not get_song(vid):
                    shutil.rmtree(os.path.join(DATA, vid), ignore_errors=True)
                job["video_id"] = None
            _save_queue()
            _wake.set()
            return True
    return False


class Cancelled(Exception):
    pass


def _set(job, **kw):
    if job.get("_cancel"):
        raise Cancelled()
    with _lock:
        job.update(kw)


def _download(job, folder, vid=None):
    vid = vid or job["video_id"]

    def hook(d):
        if job.get("_cancel"):
            raise Cancelled()
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                _set(job, progress=min(0.99, d.get("downloaded_bytes", 0) / total))

    opts = {
        "quiet": True, "no_warnings": True, "noplaylist": True, "noprogress": True,
        "format": "bestaudio/best",
        "outtmpl": os.path.join(folder, "source.%(ext)s"),
        "progress_hooks": [hook],
    }
    with _ydl(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=True)
        src = ydl.prepare_filename(info)
    original = os.path.join(folder, "original.flac")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-vn",
                    "-ar", "44100", "-ac", "2", original], check=True)
    os.remove(src)
    return info


def _separate(job, folder):
    """Roda separate.py num processo à parte e lê o progresso dele."""
    cmd = [sys.executable, "-u", os.path.join(ROOT, "separate.py"), folder,
           _config.get("vocal_model", ""), _config.get("karaoke_model", ""), MODELS]
    if _config.get("fast_separation", True):
        cmd.append("fast")
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            env=env, bufsize=0,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    job["_proc"] = proc
    device = "GPU"
    labels = {
        "model": "Baixando modelo de separação (só na primeira vez)...",
        "vocals": "Separando vocais na {dev} (local)...",
        "backing": "Separando vocal de apoio na {dev} (local)...",
        "key": "Detectando nota e escala...",
    }
    # cada etapa ocupa um pedaço da barra de progresso
    spans = {"model": (0, 0), "vocals": (0.0, 0.6), "backing": (0.6, 0.97), "key": (0.97, 1.0)}
    stage = "vocals"
    result = {}
    tail = []
    buf = b""
    while True:
        chunk = proc.stdout.read(512)
        if not chunk:
            break
        buf += chunk
        parts = re.split(rb"[\r\n]", buf)
        buf = parts.pop()
        for raw in parts:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            tail = (tail + [line])[-15:]
            if line.startswith("DEVICE:"):
                device = "GPU" if line[7:].strip() == "cuda" else "CPU"
            elif line.startswith("STAGE:"):
                stage = line[6:].strip()
                lo = spans.get(stage, (0, 0))[0]
                _set(job, stage=labels.get(stage, stage).format(dev=device),
                     progress=lo if stage != "model" else 0.0)
            elif line.startswith("KEY:"):
                _, note, scale = line.split(":")
                result["key"], result["scale"] = note, scale
            else:
                m = re.search(r"(\d{1,3})%\|", line)
                if m:
                    pct = int(m.group(1)) / 100
                    if stage == "model":
                        _set(job, progress=pct)
                    else:
                        lo, hi = spans.get(stage, (0, 1))
                        _set(job, progress=lo + (hi - lo) * pct)
    code = proc.wait()
    job.pop("_proc", None)
    if job.get("_cancel"):
        raise Cancelled()
    if code != 0:
        raise RuntimeError("Falha na separação: " + " | ".join(tail[-4:]))
    return result


class AlreadyHave(Exception):
    """A faixa do Spotify caiu num vídeo que já está na biblioteca ou na fila."""


def _resolve_spotify(job):
    sp = job["spotify"]
    _set(job, status="running", stage="Procurando no YouTube...", progress=0.0)
    candidates = find_on_youtube(sp["title"], sp["artist"], sp.get("duration") or 0)
    if not candidates:
        raise RuntimeError("Não achei essa música no YouTube")
    last_error = None
    for found in candidates:
        vid = found["id"]
        with _lock:
            if get_song(vid) or any(j is not job and j["video_id"] == vid for j in _jobs):
                raise AlreadyHave(vid)
        try:
            job["_info"] = _extract(vid)  # alguns vídeos pedem login: aí tenta o próximo
        except Exception as exc:
            print(f"[spotify] {vid} indisponível ({str(exc)[:80]}), tentando o próximo")
            last_error = exc
            continue
        with _lock:
            job["video_id"] = vid
            _save_queue()
        print(f"[spotify] {sp['artist']} - {sp['title']} -> {vid} ({found['title']})")
        return
    raise last_error or RuntimeError("Não achei essa música no YouTube")


def _process(job):
    if not job.get("video_id"):
        _resolve_spotify(job)
    vid = job["video_id"]
    folder = os.path.join(DATA, vid)
    os.makedirs(folder, exist_ok=True)
    _set(job, status="running", stage="Lendo o vídeo...", progress=0.0)
    info = job.pop("_info", None) or _extract(vid)
    artist, title = guess_artist_title(info)
    sp = job.get("spotify") or {}
    if sp.get("title"):  # veio do Spotify: nome e artista oficiais (o vídeo pode ser um lyric video)
        title, artist = sp["title"], sp.get("artist") or artist
    duration = info.get("duration") or job["duration"]

    # letras do LRCLIB: a duração mais comum entre elas é a da versão de rádio (do álbum)
    _set(job, stage="Buscando a letra...", progress=0.0)
    lyr, item, cands, official = None, None, [], None
    try:
        cands = lyrics.candidates(artist, title)
        official = lyrics.official_duration(artist, title, cands)
        print(f"[radio] {vid}: duração oficial {official}s, vídeo {duration}s")
    except Exception as exc:
        print(f"[letra] busca falhou para {vid}: {exc}")

    # o vídeo adicionado é mais longo/curto que a versão de rádio (introdução, cenas...):
    # o áudio vem da versão de rádio e o vídeo vira só o clipe de fundo
    audio_id = vid
    if official and abs(official - duration) > 4:
        _set(job, stage="Procurando a versão de rádio...", progress=0.0)
        radio = _find_radio_edit(artist, lyrics.core_title(title), official, vid)
        if radio:
            print(f"[radio] {vid}: usando o áudio de {radio['id']} ({radio['title']}, {radio['duration']}s)")
            audio_id, duration = radio["id"], radio["duration"]
        else:
            print(f"[radio] {vid}: versão de rádio não encontrada, usando o áudio do vídeo")

    # a letra escolhida tem de combinar com o áudio que vai tocar
    item = lyrics.pick_best(cands, artist, title, duration, max_diff=4) or         lyrics.pick_best(cands, artist, title, duration, max_diff=8)
    if item:
        lyr = lyrics.build(item)
        if not sp.get("title"):
            title, artist = lyrics.names_for(item, title, artist)
        title = clean_title(JUNK.sub("", title).strip(), artist)

    job["key"] = list(song_key(artist, title))
    dup = find_duplicate(tuple(job["key"]), exclude_song=vid, exclude_job=job)
    if dup:
        raise AlreadyHave(f"{artist} - {title} já está na {dup}")

    _set(job, stage="Baixando a música...", progress=0.0)
    try:
        audio_info = _download(job, folder, audio_id)
    except Exception as exc:
        if audio_id == vid or not BLOCKED.search(str(exc)):
            raise
        # a versão de rádio está bloqueada: usa o áudio do próprio vídeo
        print(f"[radio] {audio_id} bloqueado, usando o áudio de {vid}")
        audio_id = vid
        audio_info = _download(job, folder, audio_id)
    duration = audio_info.get("duration") or duration

    # clipe de fundo: baixa (e acha onde a música começa nele) enquanto a placa de vídeo trabalha
    clip = {}

    def get_clip():
        try:
            if audio_id != vid:
                clip_id = vid  # o vídeo que a pessoa escolheu
            else:
                clip_id = _pick_clip(info, artist, title, duration)
            if not clip_id:
                print(f"[clipe] {vid}: sem clipe oficial, fica a capa")
                return
            clip.update(_fetch_video(folder, clip_id))
            off = clip_offset(folder, clip_id, audio_id)
            clip["offset"] = off or 0.0
            clip["sync"] = "done" if off is not None else "error"
        except Exception as exc:
            print(f"[clipe] erro em {vid}: {exc}")
            clip.update(source=vid, status="error", error=str(exc)[:300])

    clip_thread = threading.Thread(target=get_clip, daemon=True, name=f"clip-{vid}")
    clip_thread.start()

    _set(job, stage="Aguardando a placa de vídeo...", progress=0.0)
    with GPU_LOCK:
        _set(job, stage="Preparando separação...", progress=0.0)
        res = _separate(job, folder)
        if lyr and lyr["synced"] and not lyr.get("words_source"):
            _set(job, stage="Sincronizando as palavras...", progress=0.0)
            try:
                words = _align_words(folder, lyr["lines"], 0,
                                     on_stage=lambda s: _set(job, stage=s),
                                     on_progress=lambda p: _set(job, progress=p), job=job)
                for line, w in zip(lyr["lines"], words):
                    line["w"] = w
                lyr["words_source"] = "align"
                lyr["align"] = {"status": "done", "progress": 1.0}
            except Cancelled:
                raise
            except Exception as exc:
                print(f"[palavras] erro em {vid}: {exc}")
                lyr["align"] = {"status": "error", "error": str(exc)[:300]}

    if clip_thread.is_alive():
        _set(job, stage="Terminando de baixar o clipe...", progress=0.9)
        clip_thread.join(timeout=600)
    video = dict(clip) if clip.get("status") == "ready" else None

    # capa oficial do álbum: a do Spotify (se veio de lá) ou a do iTunes
    cover, cover_url = None, None
    try:
        cover_url = spotify.big_cover(sp.get("cover")) if sp.get("cover") else lyrics.itunes_artwork(artist, title)
        if cover_url:
            r = requests.get(cover_url, headers=lyrics.UA, timeout=20)
            r.raise_for_status()
            with open(os.path.join(folder, "cover.jpg"), "wb") as f:
                f.write(r.content)
            cover = "cover.jpg"
    except Exception as exc:
        print(f"[capa] {vid}: {exc}")
        cover, cover_url = None, None

    meta = {
        "id": vid,
        "title": romanize.name(title or job["title"]),
        "artist": romanize.name(artist or job["channel"]),
        "video_title": info.get("title") or job["title"],
        "channel": info.get("channel") or job["channel"],
        "duration": duration,
        "thumbnail": thumb_url(vid),
        "cover": cover,
        "cover_url": cover_url,
        "cover_v": int(time.time()) if cover else None,
        "key": res.get("key", "C"),
        "scale": res.get("scale", "Major"),
        "lyrics": lyr,
        "video": video,
        "audio_source": audio_id,
        "spotify_id": (job.get("spotify") or {}).get("id"),
        "offset": 0.0,
        "settings": {"video_offset": (video or {}).get("offset", 0.0)},
        "owner": job.get("owner"),
        "owner_name": job.get("owner_name"),
        "created": time.time(),
    }
    _write_json(os.path.join(folder, "song.json"), meta)


def _worker():
    global _cooldown_until
    while True:
        if time.time() < _cooldown_until:  # pausa pedida pelo YouTube
            time.sleep(5)
            continue
        with _lock:
            job = next((j for j in _jobs if j["status"] == "queued"), None)
        if job is None:
            _wake.wait(2)
            _wake.clear()
            continue
        try:
            _process(job)
            with _lock:
                if job in _jobs:
                    _jobs.remove(job)
                    _save_queue()
        except Cancelled:
            pass
        except AlreadyHave as exc:
            print(f"[pipeline] {job['title']}: já tenho ({exc}), tirando da fila")
            vid = job.get("video_id")
            if vid and not get_song(vid):
                shutil.rmtree(os.path.join(DATA, vid), ignore_errors=True)
            with _lock:
                if job in _jobs:
                    _jobs.remove(job)
                    _save_queue()
        except Exception as exc:
            print(f"[pipeline] erro em {job.get('video_id') or job['title']}: {exc}")
            with _lock:
                if job not in _jobs:
                    continue
                if BLOCKED.search(str(exc)) and job.get("blocked", 0) < 4:
                    # o YouTube bloqueou por excesso de pedidos: espera e tenta de novo sozinho
                    job["blocked"] = job.get("blocked", 0) + 1
                    wait = 5 * 60 * job["blocked"]
                    _cooldown_until = time.time() + wait
                    when = time.strftime("%H:%M", time.localtime(_cooldown_until))
                    job.update(status="queued", progress=0.0, error=None,
                               stage=f"O YouTube pediu uma pausa. Tentando de novo às {when}...")
                    _save_queue()
                    continue
                msg = re.sub(r"\x1b\[[0-9;]*m", "", str(exc)).replace("ERROR: ", "")  # sem cores do terminal
                if BLOCKED.search(msg):
                    msg = ("O YouTube está bloqueando os downloads deste computador. Espere um pouco ou "
                           "envie os cookies do YouTube em Configurações.")
                job.update(status="error", stage="Erro", error=msg[:400])
                _save_queue()


def official_cover(song_id, artist, title, spotify_id=None):
    """Baixa a capa oficial do álbum (Spotify ou iTunes) para a música. Retorna o endereço usado."""
    url = None
    if spotify_id:
        url = spotify.big_cover(spotify.track_images([spotify_id]).get(spotify_id))
    url = url or lyrics.itunes_artwork(artist, title)
    if not url:
        return None
    r = requests.get(url, headers=lyrics.UA, timeout=20)
    r.raise_for_status()
    with open(os.path.join(song_dir(song_id), "cover.jpg"), "wb") as f:
        f.write(r.content)
    update_song(song_id, {"cover": "cover.jpg", "cover_url": url, "cover_v": int(time.time())})
    return url


def _backfill_covers():
    """Músicas antigas sem capa: busca a oficial (em vez da miniatura do vídeo, às vezes um lyric video)."""
    for meta in list_songs():
        if meta.get("cover") or meta.get("cover_tried"):
            continue
        url = None
        try:
            url = official_cover(meta["id"], meta.get("artist") or "", meta.get("title") or "", meta.get("spotify_id"))
            print(f"[capa] {meta['id']}: {'capa oficial ' + url if url else 'sem capa oficial'}")
        except Exception as exc:
            print(f"[capa] {meta['id']}: {exc}")
        if not url:
            update_song(meta["id"], {"cover_tried": True})  # não tenta de novo a cada início
        time.sleep(0.5)


def _romanize_existing():
    """Músicas já na biblioteca com letra em japonês/coreano: romaniza e refaz as palavras."""
    for meta in list_songs():
        changes = {}
        lyr = meta.get("lyrics")
        if lyr and romanize.lyrics(lyr):
            lyr.pop("align", None)
            changes["lyrics"] = lyr
        for key in ("title", "artist"):
            new = romanize.name(meta.get(key) or "")
            if new and new != meta.get(key):
                changes[key] = new
        if not changes:
            continue
        update_song(meta["id"], changes)
        print(f"[romaji] {meta['id']}: {changes.get('title') or meta.get('title')}")
        if "lyrics" in changes and lyr.get("synced"):
            start_word_sync(meta["id"])


def start(config):
    _config.update(config)
    with _lock:
        for j in _read_json(QUEUE_FILE, []) or []:
            if j.get("status") in ("queued", "running"):
                j.update(status="queued", stage="Na fila", progress=0.0)
            _jobs.append(j)
        _save_queue()
        for meta in list_songs():
            if not meta.get("lyrics"):
                fixed = clean_title(meta.get("title"), meta.get("artist"))
                if fixed and fixed != meta.get("title"):
                    update_song(meta["id"], {"title": fixed})
            align = ((meta.get("lyrics") or {}).get("align") or {})
            if align.get("status") in ("queued", "running"):  # fechou no meio: refaz
                meta["lyrics"]["align"] = None
                update_song(meta["id"], {"lyrics": meta["lyrics"]})
                start_word_sync(meta["id"])
            if (meta.get("video") or {}).get("status") == "downloading":
                _video_state(meta["id"], status="error", error="Download interrompido; tente de novo")
    threading.Thread(target=_worker, daemon=True, name="pipeline").start()
    threading.Thread(target=_backfill_covers, daemon=True, name="covers").start()
    threading.Thread(target=_romanize_existing, daemon=True, name="romaji").start()
