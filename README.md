# 🎤 MicDrop

Self-hosted AI karaoke powered by **original studio audio**: downloads tracks from YouTube (or Spotify playlists), separates lead and backing vocals on your GPU, and renders fullscreen word-by-word synced lyrics over album art or auto-synced music videos.

Inspired by the karaoke app showcased in [this video](https://youtu.be/6i3vDPOjexA).

> **Note:** The web interface is currently in Brazilian Portuguese (PT-BR).

## Features

- **YouTube search & previews** — Search by song name or paste a direct URL; inspect the top 5 results and listen to a 5-second fade-in/fade-out preview from the middle of each track.
- **YouTube & Spotify playlists** — Paste a YouTube playlist URL or a Spotify track, album, or playlist URL to batch-queue songs. Spotify tracks are matched on YouTube by duration (public Spotify playlists expose up to 100 tracks without login). Duplicate artist + title pairs are automatically skipped.
- **Two-stage GPU vocal separation** — Uses **BS-Roformer** and **Mel-Band Roformer** to split each track into three independent stems:
  1. All vocals vs. instrumental
  2. Lead vocals vs. backing vocals
- **Automatic preparation** — Queued songs arrive ready to sing with duration-matched synced lyrics, official album art (Spotify/iTunes), a background music video (even when adding audio-only "Topic" uploads), and word-level timing.
- **Radio-version audio & auto-synced music videos** — When a music video includes long intros or skits, MicDrop determines the official track duration from LRCLIB, downloads the radio-version audio, and cross-correlates the audio tracks to sync the muted background video automatically (with per-song offset and toggle controls).
- **Word-by-word synced lyrics** — Smoothly fills each word in time with the isolated lead vocal track using Meta's MMS forced-alignment model on GPU (or uses native word timestamps from [LRCLIB](https://lrclib.net) when available). Click any lyric line to seek directly to it.
- **Japanese & Korean romanization** — Automatically romanizes Japanese (romaji) and Korean titles and lyrics, with full word-by-word sync support.
- **Inline lyric translations** — Shows subtle translations beneath each line in your browser's language (cached per song and toggleable from the player's Display panel).
- **Dynamic cover-art theming** — Player controls, sliders, background accents, and word highlights adapt smoothly to the dominant color of the song's cover art or music video.
- **Mobile party queue (LAN)** — Open **Entrar na sessão** to display a QR code. Guests on the same Wi-Fi can search, add songs, watch live queue progress, and delete their own tracks (the host PC has full control).
- **Persistent player preferences** — Original/instrumental mode, lead & backing vocal levels, background blur, text brightness, and cover/video background preference persist globally; lyric sync offset, clip delay, and musical key are stored per song.
- **Auto-Tune via MIDI** — Automatically sends the detected musical key and scale over MIDI when a song opens (or when adjusted in the player), allowing live Auto-Tune tracking in DAWs like Reaper.

## Quick Start

### Windows (one-click)

1. Double-click **`Start MicDrop.bat`**.
   - On the first run, `setup.ps1` automatically installs `ffmpeg`, Node.js, `uv`, Python 3.12, PyTorch (with CUDA if an NVIDIA GPU is detected), Python dependencies, and builds the React frontend (~5 GB total).
2. Your browser will open at `http://localhost:5000`.
3. Processing your first song downloads the AI models once (~1.5 GB for stem separation + ~1.2 GB for MMS word alignment).

> If Windows Firewall prompts you, allow access on **private networks** so phones on your Wi-Fi can connect to the session page.

### Linux / macOS (manual)

Requires **Python 3.12**, **Node.js**, and **ffmpeg**.

```bash
# 1. Create a Python 3.12 virtual environment
uv venv --python 3.12 venv
source venv/bin/activate

# 2. Install PyTorch (CUDA for NVIDIA GPUs, or CPU fallback)
uv pip install torch torchaudio

# 3. Install Python dependencies
uv pip install -r requirements.txt

# 4. Build the React frontend
cd web && npm install && npm run build && cd ..

# 5. Start the server
python app.py
```

Set `KARAOKE_PORT` to override the port from `config.json`, or `KARAOKE_NO_BROWSER=1` to skip auto-opening the browser.

## Performance & Configuration

Settings live in [`config.json`](./config.json):

- **`fast_separation`** (`true` by default): Uses `fp16` and lower overlap for much faster GPU separation. Set to `false` for maximum separation quality.
- Works without an NVIDIA GPU (CPU fallback), though stem separation is significantly slower on CPU.

### Avoiding YouTube bot checks ("Confirm you're not a robot")

Downloading many tracks back-to-back (such as a large playlist) can trigger temporary YouTube rate limits. The processing queue automatically detects this, backs off, and retries.

To avoid blocks reliably, upload your YouTube cookies in **Settings › YouTube** (top-right gear icon):

1. Install the *Get cookies.txt LOCALLY* browser extension in Chrome.
2. Open `youtube.com` while signed in and click **Export**.
3. Upload the exported `cookies.txt` file in MicDrop.

`yt-dlp` also uses Node.js (or Deno/Bun) as a JS runtime to resolve YouTube formats (`setup.ps1` installs Node.js automatically on Windows).

## Mobile Sessions (LAN)

Click **Entrar na sessão** on the host PC and scan the QR code from any phone on the **same Wi-Fi network**. Guests connect directly to your computer's local IP (for example, `http://192.168.0.10:5000/session`).

## Auto-Tune over MIDI (Optional)

MicDrop sends two MIDI Control Change (CC) messages on channel `1` (configurable in `config.json`):

| CC | Parameter | Values |
|----|-----------|--------|
| `20` | Key | `C = 0` … `B = 127`, evenly spaced across 12 steps |
| `21` | Scale | Index in `midi.scales` (`Major`, `Minor`, `Chromatic`), evenly spaced from `0` to `127` |

### Reaper setup example

1. Install a virtual MIDI port such as [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) and create a port.
2. In MicDrop, select that port in **MIDI Device** (top-right).
3. In Reaper, go to *Preferences › MIDI Devices*, enable the port as input, and check **Enable input for control messages**.
4. In your Auto-Tune plugin, touch the *Key* control, click **Param › Learn**, and click **CC nota** in MicDrop. Repeat for *Scale* with **CC escala**.
5. Open any song in the player and confirm the plugin switches key automatically.

If your plugin requires exact CC values, add `"key_values"` (12 integers) and `"scale_values"` (one per scale) inside `midi` in `config.json`.

## Player Shortcuts

- **Space** — Play / Pause
- **F** — Toggle fullscreen (cursor auto-hides when idle)
- **← / →** — Seek backward / forward 5 seconds
- **Click any lyric line** — Jump directly to that line

## Project Structure

| Path | Description |
|------|-------------|
| `app.py` | Flask web server and REST API |
| `pipeline.py` | Background queue: YouTube/Spotify ingestion, vocal separation, key detection, and clip sync |
| `separate.py` | Subprocess runner for GPU stem separation (BS-Roformer / Mel-Band Roformer) |
| `align.py` | Word-level forced alignment on isolated lead vocals (Meta MMS) |
| `lyrics.py` | LRCLIB search, LRC parsing, automatic lyric selection, and iTunes cover/duration lookup |
| `translate.py` | Inline lyric translation in the browser's language |
| `romanize.py` | Japanese (romaji) and Korean romanization |
| `spotify.py` | Public Spotify track, album, and playlist scraping (no login required) |
| `midi_control.py` | MIDI CC output for live Auto-Tune key/scale switching |
| `web/` | Frontend (React + Tailwind CSS + [shadcn/ui](https://ui.shadcn.com)). Automatically rebuilt by `app.py` when changed; run `npm run dev` inside `web/` for live reload on port `5173` |
| `config.json` | Port, AI models, search/preview limits, and MIDI settings |
| `data/` | Processed songs (git-ignored, one folder per track) |
| `models/` | Downloaded AI model weights (git-ignored) |

## License

Released under the [MIT License](./LICENSE).
