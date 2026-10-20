"""Músicas, playlists e álbuns do Spotify (sem login).

Lê a página pública de incorporação (open.spotify.com/embed/...), que traz nome, artistas,
duração, capa e um trecho de 30 s de cada faixa. Limite: o Spotify mostra no máximo 100
faixas por playlist nessa página.

O áudio vem do YouTube: cada faixa é procurada lá com a mesma duração da versão do Spotify
(veja pipeline.find_on_youtube).
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor

import requests

BROWSER = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/130 Safari/537.36",
           "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"}
LINK = re.compile(r"(?:open\.spotify\.com/(?:intl-[a-z-]+/)?|spotify:)(track|playlist|album)[/:]([A-Za-z0-9]{22})")
NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
LIMIT = 100


def parse_link(text):
    """('playlist', 'id') para links/URIs do Spotify, senão None."""
    m = LINK.search(text or "")
    return (m.group(1), m.group(2)) if m else None


def _entity(kind, sid):
    r = requests.get(f"https://open.spotify.com/embed/{kind}/{sid}", headers=BROWSER, timeout=20)
    r.raise_for_status()
    m = NEXT_DATA.search(r.text)
    if not m:
        raise RuntimeError("O Spotify não devolveu os dados (link privado ou removido?)")
    return json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]


def _image(entity):
    sources = (entity.get("visualIdentity") or {}).get("image") or (entity.get("coverArt") or {}).get("sources") or []
    sources = [s for s in sources if s.get("url")]
    if not sources:
        return None
    # a de ~300 px é suficiente para miniaturas
    return min(sources, key=lambda s: abs((s.get("maxWidth") or s.get("width") or 300) - 300))["url"]


_images = {}  # id da faixa -> capa (cache)


def track_images(ids):
    """Capa de cada faixa (a página da playlist só traz a capa da playlist).

    Usa o oEmbed público do Spotify, em paralelo: ~100 faixas em poucos segundos."""
    todo = [i for i in dict.fromkeys(ids) if i not in _images]

    def one(tid):
        try:
            r = requests.get("https://open.spotify.com/oembed", headers=BROWSER, timeout=15,
                             params={"url": f"https://open.spotify.com/track/{tid}"})
            return tid, (r.json().get("thumbnail_url") if r.ok else None)
        except Exception:
            return tid, None

    if todo:
        with ThreadPoolExecutor(12) as ex:
            for tid, url in ex.map(one, todo):
                if url:
                    _images[tid] = url
    return {i: _images.get(i) for i in ids}


def big_cover(url):
    """Mesma capa em 640 px (o Spotify troca o tamanho pelo código no endereço)."""
    return (url or "").replace("ab67616d00001e02", "ab67616d0000b273") or None


def _artists(text):
    return [a.strip() for a in (text or "").replace("\xa0", " ").split(",") if a.strip()]


def fetch(kind, sid):
    """Lista de faixas: [{spotify_id, title, artist, artists, duration, preview, cover}]."""
    e = _entity(kind, sid)
    cover = _image(e)
    if kind == "track":
        artists = [a.get("name") for a in e.get("artists") or [] if a.get("name")]
        tracks = [{
            "spotify_id": sid,
            "title": e.get("name") or e.get("title") or "",
            "artists": artists,
            "duration": round((e.get("duration") or 0) / 1000),
            "preview": (e.get("audioPreview") or {}).get("url"),
            "cover": cover,
        }]
        name = tracks[0]["title"]
    else:
        tracks = []
        for t in e.get("trackList") or []:
            uri = t.get("uri") or ""
            if t.get("entityType") not in (None, "track") or not uri.startswith("spotify:track:"):
                continue  # episódios de podcast etc.
            tracks.append({
                "spotify_id": uri.split(":")[-1],
                "title": t.get("title") or "",
                "artists": _artists(t.get("subtitle")),
                "duration": round((t.get("duration") or 0) / 1000),
                "preview": (t.get("audioPreview") or {}).get("url"),
                "cover": cover,
            })
        name = e.get("name") or e.get("title") or ""
        if kind == "playlist":  # álbum: todas as faixas têm a capa do álbum
            images = track_images([t["spotify_id"] for t in tracks])
            for t in tracks:
                t["cover"] = images.get(t["spotify_id"]) or cover
    for t in tracks:
        t["artist"] = t["artists"][0] if t["artists"] else ""
    return {"kind": kind, "title": name, "cover": cover, "tracks": tracks,
            "maybe_truncated": kind == "playlist" and len(tracks) >= LIMIT}
