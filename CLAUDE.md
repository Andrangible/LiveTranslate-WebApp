# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LiveTranslate: a real-time, two-way voice interpreter (French ↔ Kyrgyz/Turkish/Uzbek/Russian/Mexican Spanish) built on the Gemini Live API. It is a mobile PWA used in speaker mode (no headphones). It started from Google's `gemini-live-ephemeral-tokens-websocket` example; the upstream reference copy is in `../gemini-live-api-examples/` (a separate repo, not part of this app).

UI text, code comments and the system prompt are in French.

## Commands

Develop under WSL2. `.env` must be UTF-8 with no BOM.

```bash
uv venv && source .venv/bin/activate && uv pip install -r requirements.txt
uv run server.py            # http://localhost:8000 (PORT env var overrides)
ngrok http 8000             # HTTPS tunnel; mobile mic access requires HTTPS
./deploy.sh                 # gcloud run deploy to Cloud Run (service "livetranslate", us-central1)
```

There are no tests, linter or build step. The frontend is plain JS loaded with `<script>` tags (no bundler or modules). Runtime dependencies are listed in both `requirements.txt` (used by the Dockerfile) and `pyproject.toml`. Keep the two in sync.

Env vars: `GEMINI_API_KEY`, `APP_PASSWORD` (Basic auth is **disabled when unset**, which is the normal local setup), `APP_USERNAME`. In production the first two come from Secret Manager.

## Two versions side by side
- `frontend/` + `server.py`: the original version (Cloud Run, server-side key, Basic auth). Kept as is.
- `web/`: the shareable static version (no backend). Each user brings their own Gemini key, stored in localStorage, and connects to `v1beta…BidiGenerateContent?key=`. It handles any language pair, has an EN/FR UI, a key-setup wizard, a replay button and automatic reconnection (GoAway + session resumption). See `web/README.md`. Run it with `python3 -m http.server -d web 8001`. Deploy it with `./deploy-web.sh` to Firebase Hosting (free Spark plan; config in `firebase.json`, which includes a strict CSP, so any new external resource must be added there). The Live session behaviour: **Pause** sends `audioStreamEnd` so the current phrase is translated immediately, and **Stop** is a panic button that cuts everything without translating.

Google API keys come in two formats: `AIza…` (39 characters) and the newer `AQ.…`. Accept both.

## Architecture (original version)

**Backend (`server.py`, aiohttp)** does only two things:
1. `POST /api/token` creates a single-use Gemini ephemeral token (`v1alpha`, valid 30 min, the session must start within 1 min).
2. It serves `frontend/` as static files.

A Basic-auth middleware protects everything except `PUBLIC_PATHS` (`/manifest.json`, `/sw.js`) and `/icons/`. Those must stay public, or Chrome cannot check whether the PWA is installable. Cloud Run runs with `--allow-unauthenticated` because the app handles auth itself.

**The audio never passes through the backend.** The browser opens a WebSocket straight to Gemini with the ephemeral token.

**Frontend (`frontend/`), load order matters:** `geminilive.js` → `mediaUtils.js` → `script.js` (globals shared between files).
- `geminilive.js` contains `GeminiLiveAPI` (the WebSocket client). It parses server messages into `MultimodalLiveResponseType` events (`AUDIO`, `INPUT_TRANSCRIPTION`, `OUTPUT_TRANSCRIPTION`, `TURN_COMPLETE`, …).
- `mediaUtils.js` contains `AudioStreamer` (mic capture at 16 kHz PCM) and `AudioPlayer` (playback at 24 kHz), backed by the AudioWorklets in `audio-processors/`. The video and screen-capture classes are unused leftovers from the upstream example.
- `script.js` holds all the app logic:
  - `FIXED_CONFIG`: model `gemini-3.1-flash-live-preview`, voice `Puck`, VAD settings.
  - `LANGUAGES` and `buildSystemInstruction()`: translation behaviour comes entirely from this generated system prompt, not from a config parameter.
  - Anti-echo handling, subtitles and the wake lock.

### Non-obvious behaviours (keep them when editing)
- **Anti-echo:** the mic track is disabled (`track.enabled = false`) on the first `AUDIO` chunk and re-enabled about 300 ms after `TURN_COMPLETE`. A timer based on chunk silence was less reliable. The two flags `manualPause` (pause button) and `echoMuted` are independent and combined, so one never cancels the other.
- **Subtitles** are archived as a new paragraph on `TURN_COMPLETE`, not on the transcription's `finished` flag, which is unreliable with this model.
- **Wake lock** is taken on connect, released on disconnect, and taken again on `visibilitychange` while a session is active.
- **Model choice:** the dedicated `gemini-3.5-live-translate-preview` model is deliberately not used. It doesn't support Kyrgyz and doesn't accept a system prompt.

### Adding a language
1. Add an `<option>` to `<select id="targetLang">` in `index.html`.
2. Add the matching entry to `LANGUAGES` in `script.js`.
3. Optionally, add a regional-variant note in `buildSystemInstruction()` (see `es` → Mexican Spanish).

First check that the conversational Live model supports the language.

## Backlog (`frontend/Backlog.todo`)
- Switch between the free and the paid Gemini API key.
- Make the voice configurable and save it to localStorage.
