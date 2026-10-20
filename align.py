"""Descobre quando cada palavra da letra é cantada, usando a voz isolada (lead.flac).

Usa o modelo de alinhamento MMS (torchaudio) linha por linha: para cada linha da letra
pega o trecho da voz em volta do horário dela e acha onde cada palavra cai.
Roda em processo à parte (chamado pelo pipeline.py), como o separate.py.

Uso: python align.py <pasta da música> <entrada.json> <saida.json>
  entrada: {"lines": [{"t": seg, "text": "..."}], "offset": seg}
  saída:   {"words": [[[início, fim], ...] por linha]}   (no tempo da letra, sem o offset)
Imprime "PROG:<0-1>" para a barra de progresso.
"""

import json
import os
import re
import sys
import unicodedata

import numpy as np

SR = 16000
BEFORE = 1.0   # segundos de folga antes do horário da linha
AFTER = 0.8    # folga depois do início da próxima linha
MAX_LINE = 12  # última linha: no máximo isso de áudio


def say(msg):
    print(msg, flush=True)


def normalize(word):
    """'Coração,' -> 'coracao' (o modelo só conhece a-z e apóstrofo)."""
    s = unicodedata.normalize("NFKD", word.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("’", "'")
    return re.sub(r"[^a-z']", "", s).strip("'")


def fill_gaps(spans, words, line_start, line_end):
    """Palavras sem letras alinháveis (números, símbolos) pegam o tempo entre as vizinhas."""
    for i, s in enumerate(spans):
        if s is not None:
            continue
        prev_end = next((spans[j][1] for j in range(i - 1, -1, -1) if spans[j]), line_start)
        nxt = next((spans[j][0] for j in range(i + 1, len(spans)) if spans[j]), None)
        nxt = nxt if nxt is not None else max(prev_end + 0.3, min(line_end, prev_end + 0.6))
        spans[i] = [prev_end, max(prev_end + 0.05, nxt)]
    return spans


def main():
    folder, inp, outp = sys.argv[1:4]
    data = json.load(open(inp, encoding="utf-8"))
    lines, offset = data["lines"], float(data.get("offset") or 0)

    import soundfile as sf
    import torch
    import torchaudio
    from torchaudio.pipelines import MMS_FA as bundle

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    audio, sr = sf.read(os.path.join(folder, "lead.flac"), dtype="float32", always_2d=True)
    wave = torch.from_numpy(audio.mean(axis=1))
    wave = torchaudio.functional.resample(wave, sr, SR)
    duration = wave.shape[0] / SR

    if not os.path.exists(os.path.join(torch.hub.get_dir(), "checkpoints", "model.pt")):
        say("MODEL")
    model = bundle.get_model(with_star=True).to(dev).eval()
    tokenizer = bundle.get_tokenizer()
    aligner = bundle.get_aligner()

    result = []
    for i, line in enumerate(lines):
        say(f"PROG:{i / max(1, len(lines)):.3f}")
        words = line["text"].split()
        t0 = line["t"] + offset
        t1 = lines[i + 1]["t"] + offset if i + 1 < len(lines) else min(duration, t0 + MAX_LINE)
        fallback_end = max(t0 + 0.5, t1 - 0.3)
        norm = [normalize(w) for w in words]
        keep = [k for k, n in enumerate(norm) if n]
        spans = [None] * len(words)
        start = max(0.0, t0 - BEFORE)
        end = min(duration, t1 + AFTER)
        try:
            if not keep or end - start < 0.4:
                raise ValueError("nada para alinhar")
            seg = wave[int(start * SR):int(end * SR)]
            with torch.inference_mode():
                emission, _ = model(seg.unsqueeze(0).to(dev))
            # "*" engole a voz que sobra das linhas vizinhas
            transcript = ["*"] + [norm[k] for k in keep] + ["*"]
            token_spans = aligner(emission[0], tokenizer(transcript))
            frame = seg.shape[0] / emission.shape[1] / SR
            for k, tspans in zip(keep, token_spans[1:-1]):
                spans[k] = [round(start + tspans[0].start * frame, 3),
                            round(start + tspans[-1].end * frame, 3)]
            spans = fill_gaps(spans, words, t0, fallback_end)
            if spans[0][0] > t0 + 3 or spans[-1][0] < t0:
                raise ValueError("alinhamento fora da linha")
        except Exception as exc:  # linha curta demais, só símbolos, alinhamento sem sentido...
            say(f"WARN:linha {i}: {exc}")
            result.append(None)  # a tela usa a duração padrão (web/src/player/wordTiming.ts)
            continue
        # volta para o tempo da letra (sem offset), igual aos horários das linhas.
        # A tela só confia no INÍCIO de cada palavra e encaixa tudo dentro da linha.
        result.append([[round(s - offset, 3), round(e - offset, 3)] for s, e in spans])

    with open(outp, "w", encoding="utf-8") as f:
        json.dump({"words": result}, f)
    say("PROG:1")


if __name__ == "__main__":
    main()
