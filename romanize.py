"""Letras e nomes em japonês ou coreano viram letras latinas (romaji / romanização oficial).

Assim dá para cantar sem ler a escrita original, e o alinhamento das palavras (que só
entende a-z) passa a funcionar nessas músicas.
"""

import re

HANGUL = re.compile(r"[가-힣ᄀ-ᇿ㄰-㆏]")
KANA = re.compile(r"[぀-ヿㇰ-ㇿｦ-ﾟ]")
KANJI = re.compile(r"[㐀-䶿一-鿿]")

_cutlet = None


def language(texts):
    """'ja', 'ko' ou None olhando o texto todo (kanji sozinho pode ser chinês: precisa de kana)."""
    joined = "\n".join(t or "" for t in texts)
    if HANGUL.search(joined):
        return "ko"
    if KANA.search(joined):
        return "ja"
    return None


def _ja(text):
    global _cutlet
    if _cutlet is None:
        import cutlet

        _cutlet = cutlet.Cutlet()
        _cutlet.use_foreign_spelling = False  # katakana vira romaji, não a palavra em inglês
    return _cutlet.romaji(text)


def _ko(text):
    from korean_romanizer.romanizer import Romanizer

    out = Romanizer(text).romanize()
    return out[:1].upper() + out[1:]


def romanize(text, lang):
    """Romaniza uma linha se ela tiver escrita japonesa/coreana; senão devolve igual."""
    if not text or not lang:
        return text
    if lang == "ko" and HANGUL.search(text):
        return re.sub(r"\s+", " ", _ko(text)).strip()
    if lang == "ja" and (KANA.search(text) or KANJI.search(text)):
        return re.sub(r"\s+", " ", _ja(text)).strip()
    return text


def name(text):
    """Nome de música/artista: romaniza se tiver japonês ou coreano."""
    lang = language([text])
    return romanize(text, lang) if lang else text


def lyrics(lyr):
    """Romaniza as linhas de uma letra (guarda o original em "orig"). Devolve True se mudou algo."""
    if not lyr or lyr.get("romanized"):
        return False
    lang = language(l.get("text") for l in lyr.get("lines") or [])
    if not lang:
        return False
    for line in lyr["lines"]:
        new = romanize(line["text"], lang)
        if new != line["text"]:
            line["orig"] = line["text"]
            line["text"] = new
            line.pop("w", None)  # as palavras mudaram: o tempo de cada uma é refeito
    lyr["romanized"] = lang
    if lyr.get("words_source") == "lrc":
        lyr.pop("words_source", None)
    return True
