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

import yt_dlp

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
    os.replace(tmp, path)


def _read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
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


def clean_title(title, artist):
    """Tira o nome do artista quando ele vem grudado no título ("Música – Artista")."""
    parts = DASH.split((title or "").strip(), maxsplit=1)
    if len(parts) == 2 and artist:
        if _same(parts[1], artist):
            return parts[0].strip()
        if _same(parts[0], artist):
            return parts[1].strip()
    return (title or "").strip()


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


def thumb_url(video_id):
    return f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"


# ---------------------------------------------------------------- YouTube

def search_youtube(query, limit=5):
    query = query.strip()
    opts = {"quiet": True, "no_warnings": True, "skip_download": True,
            "extract_flat": "in_playlist"}
    is_url = query.startswith("http") or "youtu" in query
    target = query if is_url else f"ytsearch{int(limit)}:{query}"
    with yt_dlp.YoutubeDL(opts) as ydl:
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


def preview_clip(video_id, seconds=5):
    """Corta um trecho do meio da música (cacheado em data/_previews)."""
    song_dir(video_id)  # valida o id
    out = os.path.join(PREVIEWS, f"{video_id}.mp3")
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return out
    opts = {"quiet": True, "no_warnings": True, "format": "bestaudio/best"}
    with yt_dlp.YoutubeDL(opts) as ydl:
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
        last = [0.0]

        def hook(d):
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                p = d.get("downloaded_bytes", 0) / total if total else 0
                if p - last[0] >= 0.05:
                    last[0] = p
                    _video_state(song_id, progress=round(min(p, 0.99), 2))

        opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "noprogress": True,
                "format": VIDEO_FORMAT, "outtmpl": os.path.join(folder, "video.%(ext)s"),
                "progress_hooks": [hook]}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={source_id}", download=True)
                path = ydl.prepare_filename(info)
            if not os.path.exists(path):  # yt-dlp pode trocar a extensão
                path = next(os.path.join(folder, n) for n in os.listdir(folder) if n.startswith("video."))
            _video_state(song_id, status="ready", progress=1.0, file=os.path.basename(path),
                         title=info.get("title"), duration=info.get("duration"))
        except Exception as exc:
            print(f"[clipe] erro em {song_id}: {exc}")
            _video_state(song_id, status="error", error=str(exc)[:300])

    threading.Thread(target=run, daemon=True, name=f"video-{song_id}").start()
    return meta


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


def add_job(entry, owner=None, owner_name=None):
    vid = entry["id"]
    song_dir(vid)
    with _lock:
        if get_song(vid):
            return None, "Essa música já está na biblioteca"
        if any(j["video_id"] == vid for j in _jobs):
            return None, "Essa música já está na fila"
        job = {
            "id": uuid.uuid4().hex[:10],
            "video_id": vid,
            "title": entry.get("title") or vid,
            "channel": entry.get("channel") or "",
            "duration": entry.get("duration") or 0,
            "thumbnail": entry.get("thumbnail") or thumb_url(vid),
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
        if job["status"] != "done":
            shutil.rmtree(os.path.join(DATA, job["video_id"]), ignore_errors=True)
        return True


def retry_job(job_id):
    with _lock:
        job = find_job(job_id)
        if job and job["status"] == "error":
            job.update(status="queued", stage="Na fila", progress=0.0, error=None)
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


def _download(job, folder):
    vid = job["video_id"]

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
    with yt_dlp.YoutubeDL(opts) as ydl:
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


def _process(job):
    vid = job["video_id"]
    folder = os.path.join(DATA, vid)
    os.makedirs(folder, exist_ok=True)
    _set(job, status="running", stage="Baixando do YouTube...", progress=0.0)
    info = _download(job, folder)
    artist, title = guess_artist_title(info)
    _set(job, stage="Preparando separação...", progress=0.0)
    res = _separate(job, folder)
    meta = {
        "id": vid,
        "title": title or job["title"],
        "artist": artist or job["channel"],
        "video_title": info.get("title") or job["title"],
        "channel": info.get("channel") or job["channel"],
        "duration": info.get("duration") or job["duration"],
        "thumbnail": thumb_url(vid),
        "cover": None,
        "key": res.get("key", "C"),
        "scale": res.get("scale", "Major"),
        "lyrics": None,
        "offset": 0.0,
        "settings": {"mode": "instrumental", "backing": 1.0, "lead": 0.0,
                     "blur": 0.5, "brightness": 0.85},
        "owner": job.get("owner"),
        "owner_name": job.get("owner_name"),
        "created": time.time(),
    }
    _write_json(os.path.join(folder, "song.json"), meta)


def _worker():
    while True:
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
        except Exception as exc:
            print(f"[pipeline] erro em {job['video_id']}: {exc}")
            with _lock:
                if job in _jobs:
                    job.update(status="error", stage="Erro", error=str(exc)[:400])
                    _save_queue()


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
            if (meta.get("video") or {}).get("status") == "downloading":
                _video_state(meta["id"], status="error", error="Download interrompido; tente de novo")
    threading.Thread(target=_worker, daemon=True, name="pipeline").start()
