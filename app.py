"""Karaokê caseiro: servidor web.

Abra http://localhost:5000 no PC que toca o som. Os convidados entram pelo QR code
(precisam estar no mesmo Wi-Fi) e colocam músicas na fila pelo celular.
"""

import io
import json
import os
import re
import shutil
import socket
import subprocess
import time
import webbrowser

import requests
import segno
from flask import Flask, abort, jsonify, request, send_file, send_from_directory

import lyrics
import midi_control
import pipeline

ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(ROOT, "config.json")
WEB = os.path.join(ROOT, "web")          # interface (React + shadcn/ui)
DIST = os.path.join(WEB, "dist")         # interface compilada
UA = lyrics.UA

with open(CONFIG_FILE, encoding="utf-8") as f:
    CONFIG = json.load(f)

PORT = int(os.environ.get("KARAOKE_PORT") or CONFIG.get("port", 5000))

app = Flask(__name__, static_folder=None)
app.json.ensure_ascii = False


def save_config():
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(CONFIG, f, ensure_ascii=False, indent=2)


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # não envia nada, só descobre a interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def session_url():
    return f"http://{lan_ip()}:{PORT}/session"


def is_admin():
    """Quem abre pelo próprio PC (o anfitrião) pode tudo; celulares só mexem no que é deles."""
    return request.remote_addr in ("127.0.0.1", "::1", lan_ip())


def token():
    return request.args.get("token") or (request.get_json(silent=True) or {}).get("token")


def can_touch(owner):
    return is_admin() or (owner is not None and owner == token())


def public_song(s):
    s = dict(s)
    s["mine"] = can_touch(s.pop("owner", None))
    if s.get("lyrics"):
        s["has_lyrics"] = True
    return s


# ---------------------------------------------------------------- páginas

def spa():
    """As três telas são o mesmo app React; ele escolhe a tela pelo endereço."""
    path = os.path.join(DIST, "index.html")
    if not os.path.exists(path):
        return ("A interface ainda não foi compilada. Instale o Node.js e rode o "
                "'Iniciar Karaoke.bat' de novo.", 503)
    return send_file(path, max_age=0)


@app.get("/")
def index():
    return spa()


@app.get("/session")
def session_page():
    return spa()


@app.get("/player/<song_id>")
def player(song_id):
    if not pipeline.get_song(song_id):
        abort(404)
    return spa()


@app.get("/assets/<path:name>")
def assets(name):
    return send_from_directory(os.path.join(DIST, "assets"), name, max_age=31536000)


@app.get("/qr.svg")
def qr():
    buf = io.BytesIO()
    segno.make(session_url(), error="m").save(buf, kind="svg", scale=8, border=2, dark="#000", light="#fff")
    return app.response_class(buf.getvalue(), mimetype="image/svg+xml")


# ---------------------------------------------------------------- API

@app.get("/api/info")
def info():
    return jsonify(session_url=session_url(), admin=is_admin(),
                   midi_device=CONFIG["midi"].get("device", ""),
                   midi_devices=midi_control.list_devices(),
                   notes=midi_control.NOTES,
                   scales=CONFIG["midi"].get("scales", ["Major", "Minor"]))


@app.get("/api/search")
def search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify([])
    try:
        return jsonify(pipeline.search_youtube(q, CONFIG.get("search_results", 5)))
    except Exception as exc:
        return jsonify(error=f"Falha na busca: {exc}"), 502


@app.get("/api/preview/<video_id>")
def preview(video_id):
    try:
        path = pipeline.preview_clip(video_id, CONFIG.get("preview_seconds", 5))
    except ValueError:
        abort(400)
    except Exception as exc:
        return jsonify(error=f"Falha no preview: {exc}"), 502
    return send_file(path, mimetype="audio/mpeg", max_age=3600)


@app.get("/api/queue")
def queue():
    return jsonify(pipeline.public_jobs(token(), is_admin()))


@app.post("/api/queue")
def queue_add():
    body = request.get_json(force=True)
    entry = body.get("entry") or {}
    try:
        job, err = pipeline.add_job(entry, owner=body.get("token"), owner_name=body.get("name"))
    except ValueError:
        abort(400)
    if err:
        return jsonify(error=err), 409
    return jsonify(id=job["id"])


@app.delete("/api/queue/<job_id>")
def queue_delete(job_id):
    job = pipeline.find_job(job_id)
    if not job:
        abort(404)
    if not can_touch(job.get("owner")):
        return jsonify(error="Só quem adicionou pode remover essa música"), 403
    pipeline.remove_job(job_id)
    return jsonify(ok=True)


@app.post("/api/queue/<job_id>/retry")
def queue_retry(job_id):
    job = pipeline.find_job(job_id)
    if not job:
        abort(404)
    if not can_touch(job.get("owner")):
        abort(403)
    return jsonify(ok=pipeline.retry_job(job_id))


@app.get("/api/songs")
def songs():
    return jsonify([public_song(s) for s in pipeline.list_songs()])


@app.get("/api/songs/<song_id>")
def song(song_id):
    s = pipeline.get_song(song_id)
    if not s:
        abort(404)
    return jsonify(public_song(s))


EDITABLE = {"key", "scale", "offset", "settings", "title", "artist"}


@app.patch("/api/songs/<song_id>")
def song_update(song_id):
    body = request.get_json(force=True)
    changes = {k: v for k, v in body.items() if k in EDITABLE}
    s = pipeline.update_song(song_id, changes)
    if not s:
        abort(404)
    if "key" in changes or "scale" in changes:
        midi_control.send_key(CONFIG["midi"], s["key"], s["scale"])
    return jsonify(public_song(s))


@app.delete("/api/songs/<song_id>")
def song_delete(song_id):
    s = pipeline.get_song(song_id)
    if not s:
        abort(404)
    if not can_touch(s.get("owner")):
        return jsonify(error="Só quem adicionou pode apagar essa música"), 403
    pipeline.delete_song(song_id)
    return jsonify(ok=True)


@app.post("/api/songs/<song_id>/midi")
def song_midi(song_id):
    s = pipeline.get_song(song_id)
    if not s:
        abort(404)
    return jsonify(sent=midi_control.send_key(CONFIG["midi"], s["key"], s["scale"]))


@app.get("/media/<song_id>/<name>")
def media(song_id, name):
    stems = {f"{stem}.flac" for stem in pipeline.STEMS} | {"cover.jpg", "video.mp4", "video.webm"}
    if name not in stems:
        abort(404)
    try:
        path = os.path.join(pipeline.song_dir(song_id), name)
    except ValueError:
        abort(400)
    if not os.path.exists(path):
        abort(404)
    return send_file(path, conditional=True, max_age=0)


# ---------------------------------------------------------------- letras (LRCLIB)

@app.get("/api/lyrics/search")
def lyrics_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify([])
    try:
        results = lyrics.search(q)
    except Exception as exc:
        code = getattr(getattr(exc, "response", None), "status_code", None)
        why = f"erro {code}" if code else "sem conexão"
        return jsonify(error=f"O site de letras (LRCLIB) está instável agora ({why}). "
                             "Tente de novo em alguns segundos."), 502
    out = [lyrics.summary(i) for i in results]
    out.sort(key=lambda x: not x["synced"])  # sincronizadas primeiro
    return jsonify(out)


@app.post("/api/songs/<song_id>/lyrics")
def lyrics_use(song_id):
    if not pipeline.get_song(song_id):
        abort(404)
    try:
        item = lyrics.get(int(request.get_json(force=True).get("id")))
    except Exception:
        return jsonify(error="O site de letras (LRCLIB) não respondeu. Tente de novo em alguns segundos."), 502
    lyr = lyrics.build(item)
    changes = {"lyrics": lyr, "offset": 0.0}
    if item.get("trackName"):
        changes["title"] = pipeline.clean_title(item["trackName"], item.get("artistName"))
    if item.get("artistName"):
        changes["artist"] = item["artistName"]
    s = pipeline.update_song(song_id, changes)
    if lyr["synced"] and not lyr.get("words_source"):
        s = pipeline.start_word_sync(song_id)
    return jsonify(public_song(s))


@app.post("/api/songs/<song_id>/words")
def words_sync(song_id):
    s = pipeline.get_song(song_id)
    if not s:
        abort(404)
    if not (s.get("lyrics") or {}).get("synced"):
        return jsonify(error="Escolha uma letra sincronizada primeiro"), 400
    return jsonify(public_song(pipeline.start_word_sync(song_id)))


@app.delete("/api/songs/<song_id>/lyrics")
def lyrics_clear(song_id):
    s = pipeline.update_song(song_id, {"lyrics": None})
    if not s:
        abort(404)
    return jsonify(public_song(s))


# ---------------------------------------------------------------- capas (iTunes)

def _art(url, size=1000):
    return re.sub(r"/\d+x\d+bb\.", f"/{size}x{size}bb.", url or "")


@app.get("/api/covers/search")
def covers_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify([])
    seen, out = set(), []
    for entity in ("song", "album"):
        try:
            r = requests.get("https://itunes.apple.com/search",
                             params={"term": q, "media": "music", "entity": entity, "limit": 25},
                             headers=UA, timeout=15)
            r.raise_for_status()
            results = r.json().get("results", [])
        except Exception:
            continue
        for item in results:
            url = item.get("artworkUrl100")
            if not url or url in seen:
                continue
            seen.add(url)
            out.append({"thumb": _art(url, 300), "full": _art(url, 1000),
                        "album": item.get("collectionName"), "artist": item.get("artistName")})
    return jsonify(out[:30])


@app.post("/api/songs/<song_id>/cover")
def cover_use(song_id):
    if not pipeline.get_song(song_id):
        abort(404)
    url = request.get_json(force=True).get("url") or ""
    if not re.match(r"^https://[a-z0-9-]+\.mzstatic\.com/", url):
        return jsonify(error="URL de capa inválida"), 400
    r = requests.get(url, headers=UA, timeout=20)
    r.raise_for_status()
    with open(os.path.join(pipeline.song_dir(song_id), "cover.jpg"), "wb") as f:
        f.write(r.content)
    # cover_url: de onde veio, para a tela marcar qual capa está em uso
    return jsonify(public_song(pipeline.update_song(
        song_id, {"cover": "cover.jpg", "cover_v": int(time.time()), "cover_url": url})))


@app.delete("/api/songs/<song_id>/cover")
def cover_remove(song_id):
    if not pipeline.get_song(song_id):
        abort(404)
    path = os.path.join(pipeline.song_dir(song_id), "cover.jpg")
    if os.path.exists(path):
        os.remove(path)
    return jsonify(public_song(pipeline.update_song(song_id, {"cover": None, "cover_url": None})))


# ---------------------------------------------------------------- clipe de fundo

@app.post("/api/songs/<song_id>/video")
def video_use(song_id):
    source = request.get_json(force=True).get("video_id") or song_id
    try:
        s = pipeline.start_video_download(song_id, source)
    except ValueError:
        abort(400)
    if not s:
        abort(404)
    return jsonify(public_song(s))


@app.delete("/api/songs/<song_id>/video")
def video_remove(song_id):
    s = pipeline.remove_video(song_id)
    if not s:
        abort(404)
    return jsonify(public_song(s))


# ---------------------------------------------------------------- MIDI

@app.get("/api/midi/devices")
def midi_devices():
    return jsonify(devices=midi_control.list_devices(), device=CONFIG["midi"].get("device", ""))


@app.post("/api/midi/device")
def midi_device():
    if not is_admin():
        abort(403)
    CONFIG["midi"]["device"] = request.get_json(force=True).get("device") or ""
    save_config()
    return jsonify(ok=True)


@app.post("/api/midi/test")
def midi_test():
    which = request.get_json(force=True).get("which")
    if which not in ("key", "scale"):
        abort(400)
    return jsonify(sent=midi_control.send_test(CONFIG["midi"], which))


# ---------------------------------------------------------------- início

def build_frontend():
    """Compila a interface (web/) quando ela mudou desde a última compilação."""
    built = os.path.join(DIST, "index.html")
    sources = [os.path.join(WEB, f) for f in ("index.html", "package.json", "vite.config.ts")]
    for base, _, files in os.walk(os.path.join(WEB, "src")):
        sources += [os.path.join(base, f) for f in files]
    newest = max((os.path.getmtime(p) for p in sources if os.path.exists(p)), default=0)
    if os.path.exists(built) and os.path.getmtime(built) >= newest:
        return
    if not shutil.which("npm"):
        print("  [interface] Node.js não encontrado: instale para compilar a interface (setup.ps1 faz isso).")
        return
    run = (lambda *a: subprocess.run(["cmd", "/c", "npm", *a], cwd=WEB, check=True)) if os.name == "nt"         else (lambda *a: subprocess.run(["npm", *a], cwd=WEB, check=True))
    print("  [interface] Compilando a interface...")
    try:
        if not os.path.isdir(os.path.join(WEB, "node_modules")):
            run("install", "--no-audit", "--no-fund")
        run("run", "build")
    except subprocess.CalledProcessError as exc:
        print(f"  [interface] Falhou ao compilar ({exc}). Usando a versão anterior, se houver.")


if __name__ == "__main__":
    build_frontend()
    import logging

    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    pipeline.start(CONFIG)
    port = PORT
    print(f"\n  Karaokê rodando!\n  Neste PC:   http://localhost:{port}\n  Celulares:  {session_url()}\n")
    if os.environ.get("KARAOKE_NO_BROWSER") != "1":
        webbrowser.open(f"http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, threaded=True, debug=False)
