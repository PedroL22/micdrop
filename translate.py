"""Tradução das letras para o idioma do navegador (Google Tradutor, sem chave).

Linhas que já estão no idioma pedido voltam iguais e ficam sem tradução (None).
"""

import re
import unicodedata

import requests

URL = "https://translate.googleapis.com/translate_a/single"
CHUNK = 3500  # caracteres por pedido


def _norm(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return re.sub(r"[\W_]+", "", "".join(c for c in s if not unicodedata.combining(c)))


def _translate_block(lines, target):
    r = requests.post(URL, params={"client": "gtx", "sl": "auto", "tl": target, "dt": "t"},
                      data={"q": "\n".join(lines)}, timeout=20)
    r.raise_for_status()
    data = r.json()
    text = "".join(seg[0] for seg in data[0] or [] if seg and seg[0])
    parts = text.split("\n")
    if len(parts) != len(lines):  # o tradutor juntou/separou linhas: traduz uma a uma
        parts = [_translate_block([l], target)[0] if l.strip() else "" for l in lines]
    return parts


def translate_lines(lines, target):
    """Lista com a tradução de cada linha (None quando a linha já está no idioma pedido)."""
    out, block, size = [], [], 0
    for line in lines:
        if block and size + len(line) > CHUNK:
            out += _translate_block(block, target)
            block, size = [], 0
        block.append(line)
        size += len(line) + 1
    if block:
        out += _translate_block(block, target)
    return [t.strip() if t and _norm(t) != _norm(src) else None for src, t in zip(lines, out)]
