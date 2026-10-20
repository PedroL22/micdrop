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


def pick_best(items, artist, title, duration, max_diff=8):
    """Melhor letra para a música: sincronizada, mesmo artista e duração parecida.

    Retorna None se nada for confiável (aí o usuário escolhe na mão no player)."""
    want_artist, want_title = _norm(artist), _norm(core_title(title))
    best, best_score = None, None
    for item in items:
        diff = abs((item.get("duration") or 0) - (duration or 0)) if duration else 0
        if duration and max_diff is not None and diff > max_diff:  # outra versão (ao vivo, remix...)
            continue
        got_artist, got_title = _norm(item.get("artistName")), _norm(core_title(item.get("trackName")))
        artist_ok = bool(want_artist) and (want_artist in got_artist or got_artist in want_artist)
        title_ok = bool(want_title) and (want_title in got_title or got_title in want_title)
        if not (artist_ok or title_ok):
            continue
        score = (0 if item.get("syncedLyrics") else 100) + diff + (0 if artist_ok else 10) + (0 if title_ok else 10)
        if best_score is None or score < best_score:
            best, best_score = item, score
    return best


def names_for(item, title, artist):
    """Título e artista a usar depois de escolher uma letra.

    Usa os nomes do LRCLIB (costumam vir mais limpos) só se o artista bater;
    se vierem trocados (música no lugar do artista), desinverte; senão mantém os atuais."""
    t, a = item.get("trackName") or "", item.get("artistName") or ""

    def near(x, y):
        # "Charlie Brown Jr" = "Charlie Brown Jr."; mas "Rick Astley - Never Gonna..." != "Rick Astley"
        nx, ny = _norm(x), _norm(y)
        if not nx or not ny or not (nx in ny or ny in nx):
            return False
        return min(len(nx), len(ny)) / max(len(nx), len(ny)) >= 0.7
    if near(a, artist):
        return t or title, a
    if near(t, artist) and near(a, title):  # campos trocados no LRCLIB
        return a, t
    return title, artist


FEAT = re.compile(r"(?i)\s*[\(\[]?\b(ft|feat|featuring)\b\.?.*$")


def core_title(title):
    """'Beauty And A Beat ft. Nicki Minaj' -> 'Beauty And A Beat' (participações atrapalham a busca)."""
    return FEAT.sub("", title or "").strip() or (title or "")


def candidates(artist, title):
    """Todas as letras do LRCLIB que parecem ser desta música (mesmo artista ou mesmo nome)."""
    out, seen = [], set()
    want_artist, want_title = _norm(artist), _norm(core_title(title))
    for q in (f"{artist} {core_title(title)}".strip(), core_title(title)):
        if not q:
            continue
        for item in search(q):
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            got_artist, got_title = _norm(item.get("artistName")), _norm(core_title(item.get("trackName")))
            artist_ok = bool(want_artist) and (want_artist in got_artist or got_artist in want_artist)
            title_ok = bool(want_title) and (want_title in got_title or got_title in want_title)
            if artist_ok and title_ok:
                out.append(item)
        if out:
            break
    return out


def typical_duration(items):
    """Duração "oficial" pelas letras do LRCLIB: a mais votada.

    Muita gente sincroniza a letra com o clipe do YouTube, então as letras com nome de álbum de
    verdade valem mais e, no empate, ganha a mais curta (versões de rádio costumam ser mais curtas)."""
    entries = []
    for i in items:
        d = i.get("duration") or 0
        if not d:
            continue
        album = _norm(i.get("albumName"))
        real_album = bool(album) and album != _norm(i.get("trackName")) and album != _norm(core_title(i.get("trackName")))
        entries.append((d, 2 if real_album else 1))
    if not entries:
        return None
    votes = lambda d: sum(w for x, w in entries if abs(x - d) <= 2)
    return max((d for d, _ in entries), key=lambda d: (votes(d), -d))


NOT_ALBUM_VERSION = re.compile(r"(?i)\b(live|ao vivo|remix|acoustic|ac[uú]stico|instrumental|karaoke|version|edit)\b")


_itunes_cache = {}


def itunes_match(artist, title):
    """A faixa no iTunes (versão do álbum): {"duration", "artwork"}. None se não achar com segurança."""
    key = (_norm(artist), _norm(core_title(title)))
    if key in _itunes_cache:
        return _itunes_cache[key]
    try:
        r = requests.get("https://itunes.apple.com/search", headers=UA, timeout=15, params={
            "term": f"{artist} {core_title(title)}", "media": "music", "entity": "song", "limit": 15})
        r.raise_for_status()
        results = r.json().get("results", [])
    except Exception:
        return None  # sem cache: tenta de novo na próxima
    want_artist, want_title = key
    found = []
    for t in results:
        name = t.get("trackName") or ""
        if NOT_ALBUM_VERSION.search(name) or not t.get("trackTimeMillis"):
            continue
        got_artist, got_title = _norm(t.get("artistName")), _norm(core_title(name))
        if not (want_artist and (want_artist in got_artist or got_artist in want_artist)):
            continue
        if got_title != want_title:
            continue
        found.append(t)
    match = None
    if found:
        durs = [round(t["trackTimeMillis"] / 1000) for t in found]
        dur = max(durs, key=lambda d: (sum(1 for x in durs if abs(x - d) <= 2), -d))
        best = next(t for t in found if abs(round(t["trackTimeMillis"] / 1000) - dur) <= 2)
        match = {"duration": dur, "artwork": best.get("artworkUrl100")}
    _itunes_cache[key] = match
    return match


def itunes_duration(artist, title):
    m = itunes_match(artist, title)
    return m["duration"] if m else None


def itunes_artwork(artist, title, size=1000):
    """Capa do álbum no iTunes no tamanho pedido (mesmo endereço que a aba Capa usa)."""
    m = itunes_match(artist, title)
    if not m or not m.get("artwork"):
        return None
    return re.sub(r"/\d+x\d+bb\.", f"/{size}x{size}bb.", m["artwork"])


def official_duration(artist, title, items):
    """Duração da versão de rádio/álbum: iTunes primeiro, letras do LRCLIB como plano B."""
    return itunes_duration(artist, title) or typical_duration(items)


def find_for(artist, title, duration, max_diff=8):
    """Busca e escolhe sozinho. Tenta "artista + música" e depois só o nome da música.

    max_diff=None aceita qualquer duração (útil quando o vídeo tem introdução e a letra é
    da versão de rádio)."""
    for q in (f"{artist} {title}".strip(), title):
        if not q:
            continue
        found = pick_best(search(q), artist, title, duration, max_diff)
        if found:
            return found
    return None
