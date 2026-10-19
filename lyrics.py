"""Letras sincronizadas do LRCLIB (https://lrclib.net): busca, leitura do LRC e escolha automática."""

import re
import time
import unicodedata

import requests

UA = {"User-Agent": "KaraokeCaseiro/1.0 (https://github.com/)"}
LRC_LINE = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
LRC_WORD = re.compile(r"<(\d+):(\d+(?:\.\d+)?)>")

_cache = {}  # id do LRCLIB -> resultado completo da busca (já vem com a letra)


def _request(path, params=None, attempts=4):
    """O LRCLIB às vezes responde 503 (instável) ou 429 (muitas buscas): tenta de novo com pausas."""
    for attempt in range(attempts):
        try:
            r = requests.get(f"https://lrclib.net/api/{path}", params=params, headers=UA, timeout=15)
        except requests.RequestException:
            if attempt == attempts - 1:
                raise
        else:
            if r.status_code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                r.raise_for_status()
                return r.json()
        time.sleep(1 + attempt * 1.5)


def search(q):
    """Resultados crus do LRCLIB (só os que têm alguma letra)."""
    items = [i for i in _request("search", {"q": q}) if i.get("syncedLyrics") or i.get("plainLyrics")]
    for item in items:
        _cache[item["id"]] = item
    return items


def get(lrclib_id):
    if lrclib_id in _cache:
        return _cache[lrclib_id]
    return _request(f"get/{lrclib_id}")


def summary(item):
    return {"id": item["id"], "track": item.get("trackName"), "artist": item.get("artistName"),
            "album": item.get("albumName"), "duration": item.get("duration") or 0,
            "synced": bool(item.get("syncedLyrics"))}


# ---------------------------------------------------------------- LRC

def _word_times(body):
    """LRC "enhanced": '<00:12.10> Que <00:12.40> bom' -> texto e [início, fim] de cada palavra."""
    parts = LRC_WORD.split(body)
    if parts[0].split():  # texto antes da primeira marca: sem tempo próprio
        return None, None
    stamps, words, times = [], [], []
    for i in range(1, len(parts), 3):
        t = int(parts[i]) * 60 + float(parts[i + 1])
        stamps.append(t)
        for w in parts[i + 2].split():
            words.append(w)
            times.append([t, None])
    for k, wt in enumerate(times):
        later = [s for s in stamps if s > wt[0]]
        wt[1] = later[0] if later else wt[0] + 0.6
        if k + 1 < len(times) and times[k + 1][0] > wt[0]:
            wt[1] = min(wt[1], times[k + 1][0])
    return " ".join(words), times


def parse_lrc(text):
    lines = []
    for raw in (text or "").splitlines():
        stamps = LRC_LINE.findall(raw)
        body = LRC_LINE.sub("", raw).strip()
        words = None
        if LRC_WORD.search(body):
            plain, words = _word_times(body)
            body = plain if plain else LRC_WORD.sub("", body).strip()
        body = re.sub(r"\s+", " ", body)
        for mm, ss in stamps:
            if body:
                line = {"t": int(mm) * 60 + float(ss), "text": body}
                if words and len(stamps) == 1:
                    line["w"] = words
                lines.append(line)
    lines.sort(key=lambda l: l["t"])
    return lines


def build(item):
    """Resultado do LRCLIB -> o "lyrics" guardado no song.json."""
    if item.get("syncedLyrics"):
        lyr = {"synced": True, "lines": parse_lrc(item["syncedLyrics"])}
    else:
        lines = [l.strip() for l in (item.get("plainLyrics") or "").splitlines() if l.strip()]
        lyr = {"synced": False, "lines": [{"t": None, "text": l} for l in lines]}
    lyr["source"] = f"lrclib:{item['id']}:{int(time.time())}"
    if lyr["synced"] and lyr["lines"] and all(l.get("w") for l in lyr["lines"]):
        lyr["words_source"] = "lrc"  # a própria letra já traz o tempo de cada palavra
    return lyr


# ---------------------------------------------------------------- escolha automática

def _norm(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if not unicodedata.combining(c)))


def pick_best(items, artist, title, duration):
    """Melhor letra para a música: sincronizada, mesmo artista e duração parecida.

    Retorna None se nada for confiável (aí o usuário escolhe na mão no player)."""
    want_artist, want_title = _norm(artist), _norm(title)
    best, best_score = None, None
    for item in items:
        diff = abs((item.get("duration") or 0) - (duration or 0)) if duration else 0
        if duration and diff > 8:  # outra versão (ao vivo, remix...)
            continue
        got_artist, got_title = _norm(item.get("artistName")), _norm(item.get("trackName"))
        artist_ok = bool(want_artist) and (want_artist in got_artist or got_artist in want_artist)
        title_ok = bool(want_title) and (want_title in got_title or got_title in want_title)
        if not (artist_ok or title_ok):
            continue
        score = (0 if item.get("syncedLyrics") else 100) + diff + (0 if artist_ok else 10) + (0 if title_ok else 10)
        if best_score is None or score < best_score:
            best, best_score = item, score
    return best


def find_for(artist, title, duration):
    """Busca e escolhe sozinho. Tenta "artista + música" e depois só o nome da música."""
    for q in (f"{artist} {title}".strip(), title):
        if not q:
            continue
        found = pick_best(search(q), artist, title, duration)
        if found:
            return found
    return None
