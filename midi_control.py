"""Envia a nota e a escala da música por MIDI (ex.: para o Auto-Tune dentro do Reaper).

Cada música manda dois Control Change:
  - key_cc   -> nota (C, C#, ... B), espalhada de 0 a 127
  - scale_cc -> escala (posição na lista "scales" do config.json), espalhada de 0 a 127

No Reaper, ligue cada CC a um parâmetro do plugin com o "Learn"
(botão "Param" do plugin > "Learn" > botão "CC nota"/"CC escala" na tela do karaokê).
Se o plugin precisar de valores específicos, defina "key_values" / "scale_values"
no config.json com o valor exato (0-127) para cada posição.
"""

import threading

import mido

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_lock = threading.Lock()
_port = None
_port_name = None


def list_devices():
    try:
        return mido.get_output_names()
    except Exception:
        return []


def _open(name):
    global _port, _port_name
    if _port_name == name and _port is not None:
        return _port
    if _port is not None:
        try:
            _port.close()
        except Exception:
            pass
        _port, _port_name = None, None
    if not name:
        return None
    _port = mido.open_output(name)
    _port_name = name
    return _port


def _spread(index, count, explicit=None):
    if explicit and index < len(explicit):
        return int(explicit[index])
    if count <= 1:
        return 0
    return round(index * 127 / (count - 1))


def send_key(midi_cfg, note, scale):
    """Manda nota/escala para o dispositivo configurado. Retorna True se enviou."""
    device = midi_cfg.get("device") or ""
    if not device or note not in NOTES:
        return False
    scales = midi_cfg.get("scales") or ["Major", "Minor"]
    scale_idx = scales.index(scale) if scale in scales else 0
    channel = max(0, min(15, int(midi_cfg.get("channel", 1)) - 1))
    key_val = _spread(NOTES.index(note), 12, midi_cfg.get("key_values"))
    scale_val = _spread(scale_idx, len(scales), midi_cfg.get("scale_values"))
    with _lock:
        try:
            port = _open(device)
            if port is None:
                return False
            port.send(mido.Message("control_change", channel=channel,
                                   control=int(midi_cfg.get("key_cc", 20)), value=key_val))
            port.send(mido.Message("control_change", channel=channel,
                                   control=int(midi_cfg.get("scale_cc", 21)), value=scale_val))
            return True
        except Exception as exc:  # porta sumiu, driver fechado etc.
            print(f"[midi] falha ao enviar para '{device}': {exc}")
            _open(None)
            return False


def send_test(midi_cfg, which, value=64):
    """Manda só um CC (nota ou escala), para usar o "Learn" do Reaper."""
    device = midi_cfg.get("device") or ""
    if not device:
        return False
    cc = int(midi_cfg.get("key_cc" if which == "key" else "scale_cc", 20))
    channel = max(0, min(15, int(midi_cfg.get("channel", 1)) - 1))
    with _lock:
        try:
            port = _open(device)
            port.send(mido.Message("control_change", channel=channel, control=cc, value=int(value) & 127))
            return True
        except Exception as exc:
            print(f"[midi] falha ao enviar para '{device}': {exc}")
            _open(None)
            return False
