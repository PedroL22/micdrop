# 🎤 MicDrop

Self-hosted AI karaoke powered by original studio audio: downloads tracks from YouTube, separates lead and backing vocals on your GPU, and plays synced word-by-word lyrics in fullscreen with album art or music videos in the background.

> **Note:** The web interface is currently in Brazilian Portuguese (PT-BR).

## Core Features

- **YouTube search & previews**: Search by song name or paste a URL, inspect the top 5 results, and play a 5-second preview from the middle of each track.
- **Two-stage GPU vocal separation**: Uses **BS-Roformer** and **Mel-Band Roformer** to separate instrumental, backing vocals, and lead vocals.
- **Word-by-word synced lyrics**: Fetches synced lyrics from [LRCLIB](https://lrclib.net) and computes word-level timestamps on the isolated vocal track using Meta's MMS model on GPU.
- **Mobile party queue (LAN)**: Share a QR code so guests on the same Wi-Fi can search, queue tracks, and track processing progress in real time.
- **Auto-Tune over MIDI**: Sends the detected musical key and scale via MIDI Control Change messages to DAWs like Reaper.

## Quick Start

Double-click **`Start MicDrop.bat`** on Windows (runs `setup.ps1` automatically on first launch) and open `http://localhost:5000`.

## License

MIT — see [LICENSE](./LICENSE).
