"""Separa as vozes de data/<id>/original.flac e detecta o tom.

Roda em processo separado (chamado pelo pipeline.py) para liberar a memória da GPU
ao terminar. Fala com o pipeline imprimindo linhas:
  DEVICE:cuda|cpu   STAGE:<etapa>   KEY:<nota>:<escala>
e o progresso vem das barras do tqdm ("37%|...").

Uso: python separate.py <pasta> <modelo de vocais> <modelo karaokê> <pasta dos modelos> [fast]
"""

import logging
import os
import re
import sys

import numpy as np


def say(msg):
    print(msg, flush=True)


def separate(folder, model, models_dir, source, stage, fast=False):
    from audio_separator.separator import Separator

    if not os.path.exists(os.path.join(models_dir, model)):
        say("STAGE:model")
    import torch

    extra = {}
    if fast:
        # metade das janelas sobrepostas + fp16 na GPU: bem mais rápido, quase a mesma qualidade
        extra["mdxc_params"] = {"segment_size": 256, "override_model_segment_size": False,
                                "batch_size": None, "overlap": 2, "pitch_shift": 0}
        extra["use_autocast"] = torch.cuda.is_available()
    sep = Separator(log_level=logging.WARNING, model_file_dir=models_dir,
                    output_dir=folder, output_format="FLAC", **extra)
    sep.load_model(model_filename=model)
    say(f"STAGE:{stage}")
    outputs = {}
    for f in sep.separate(source):
        path = f if os.path.isabs(f) else os.path.join(folder, os.path.basename(f))
        m = re.search(r"_\(([^)]+)\)_", os.path.basename(path))
        outputs[(m.group(1) if m else path).lower()] = path
    return outputs


def pick(outputs, *names):
    for name in names:
        for stem, path in outputs.items():
            if name in stem:
                return path
    raise RuntimeError(f"stem não encontrado entre {list(outputs)}")


def move(src, dst):
    if os.path.exists(dst):
        os.remove(dst)
    os.replace(src, dst)


# Perfis de Krumhansl-Schmuckler (peso de cada grau da escala)
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def detect_key(path):
    import librosa

    y, sr = librosa.load(path, sr=22050, mono=True)
    y = librosa.effects.harmonic(y)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    best = (-2.0, "C", "Major")
    for i in range(12):
        for profile, scale in ((MAJOR, "Major"), (MINOR, "Minor")):
            r = np.corrcoef(chroma, np.roll(profile, i))[0, 1]
            if r > best[0]:
                best = (r, NOTES[i], scale)
    return best[1], best[2]


def main():
    folder, vocal_model, karaoke_model, models_dir = sys.argv[1:5]
    fast = len(sys.argv) > 5 and sys.argv[5] == "fast"
    os.makedirs(models_dir, exist_ok=True)
    import torch

    say("DEVICE:" + ("cuda" if torch.cuda.is_available() else "cpu"))
    original = os.path.join(folder, "original.flac")

    # 1) música -> todas as vozes + instrumental
    out = separate(folder, vocal_model, models_dir, original, "vocals", fast)
    vocals = os.path.join(folder, "vocals_all.flac")
    move(pick(out, "vocal"), vocals)
    move(pick(out, "instrument", "other"), os.path.join(folder, "instrumental.flac"))

    # 2) vozes -> voz principal + vocais de apoio
    #    o modelo karaokê chama a voz principal de "Vocals"/"karaoke" e o resto de "Instrumental"
    out = separate(folder, karaoke_model, models_dir, vocals, "backing", fast)
    move(pick(out, "vocal", "karaoke"), os.path.join(folder, "lead.flac"))
    move(pick(out, "instrument", "other"), os.path.join(folder, "backing.flac"))
    os.remove(vocals)

    # 3) nota e escala
    say("STAGE:key")
    note, scale = detect_key(os.path.join(folder, "instrumental.flac"))
    say(f"KEY:{note}:{scale}")


if __name__ == "__main__":
    main()
