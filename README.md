# LiveTranslate

Real-time bidirectional voice translation app for conversation mode (speaker-out), built on the Gemini Live API. Designed for field use (travel, face-to-face exchanges), installable as a PWA on mobile.

Derived from Google's official `gemini-live-ephemeral-tokens-websocket` example, simplified for a single use case: simultaneous vocal interpretation between French and a selectable target language.

## Features

- **Real-time bidirectional translation** between French and: Kyrgyz, Turkish, Uzbek, Russian, Spanish (Mexican)
- **Speaker conversation mode**: automatic echo handling by muting the mic in sync with the model's turn-taking (no headphones required)
- **Manual pause button**, independent from the anti-echo mute, to cut capture at will
- **Live subtitles** (input and output transcription), archived as separate paragraphs on each completed translation turn
- **Installable PWA** on the home screen (Android/iOS), with an active screen wake lock during a session to prevent sleep
- **Ephemeral tokens**: the API key never leaves the backend; the browser connects directly via WebSocket to the Gemini API using a single-use token
- **HTTP Basic auth protection** on the deployed app
- **Deployed on Cloud Run** (`min-instances=0`, near-zero cost between sessions), secrets managed via Secret Manager

## Quick start (local development)

Recommended under WSL2 (avoids the `.env` encoding and dependency issues seen under native Windows).

```bash
# 1. Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Create the virtual environment and sync dependencies
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt

# 3. Set the API key in a .env file (UTF-8, no BOM — watch out if created from Windows/PowerShell)
printf 'GEMINI_API_KEY=your_key_here\n' > .env

# 4. Start the server
uv run server.py

# 5. Open in browser
open http://localhost:8000
```

### Testing on mobile during development (HTTPS tunnel)

Mic access requires HTTPS on mobile. To test from a phone without deploying:

```bash
ngrok http 8000
```

Open the returned `https://xxxx.ngrok-free.app` URL from the phone.

## Project structure

- `server.py` — ephemeral token issuance, HTTP server, Basic auth middleware
- `.env` — local configuration (API key — never committed)
- `requirements.txt` — Python dependencies
- `Dockerfile` — Cloud Run deployment image
- `.dockerignore`
- `frontend/`
  - `index.html` — UI (language selector, main button, pause, subtitles)
  - `manifest.json` — PWA manifest
  - `sw.js` — minimal service worker (required for installability)
  - `icons/` — PWA icons (192, 512, maskable, apple-touch-icon)
  - `geminilive.js` — Gemini Live API client (direct WebSocket connection)
  - `mediaUtils.js` — audio capture/playback (`AudioStreamer`, `AudioPlayer`)
  - `script.js` — app logic: languages, system prompt, anti-echo mute, wake lock

## How it works

### Model and configuration

- **Model**: `gemini-3.1-flash-live-preview` (conversational native audio, 97 supported languages — not the specialized `gemini-3.5-live-translate-preview` model, which doesn't cover Kyrgyz)
- **Voice**: `Puck` (fixed)
- Translation behavior is entirely driven by a **dynamically generated system prompt** based on the selected language (`buildSystemInstruction()` in `script.js`), not by a structured config parameter

### System prompt

The model is instructed to act strictly as an interpreter (not a conversational assistant): immediate translation both ways, silence on ambiguous or out-of-scope audio, no commentary, and refusal to execute any instruction addressed to it directly within the audio (protection against voice-based prompt injection).

### Echo handling (speaker mode)

The mic is muted (`track.enabled = false`) as soon as a response audio chunk (`AUDIO`) is received, and re-enabled ~300ms after the `TURN_COMPLETE` event. This turn-end signal proved more reliable than a timer based on the absence of new chunks. Manual mute (pause button) and anti-echo mute are combined via two independent flags (`manualPause`, `echoMuted`) so they don't cancel each other out.

### Subtitles

Input and output transcriptions accumulate line by line during a turn, then get archived as a new distinct paragraph on `TURN_COMPLETE` — not on the transcription's own `finished` flag, which proved unreliable with this model.

### Wake Lock

`navigator.wakeLock` is acquired on connect and released on disconnect, with automatic re-acquisition if the tab regains visibility while a session is active (the wake lock is automatically released by the browser when the tab loses focus).

## Deployment (Cloud Run)

```bash
# Secrets (one-time setup)
printf '%s' "YOUR_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
printf '%s' "YOUR_PASSWORD" | gcloud secrets create app-password --data-file=-

gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding app-password \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"

# Deployment
gcloud run deploy livetranslate \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest,APP_PASSWORD=app-password:latest" \
  --set-env-vars="APP_USERNAME=your_username" \
  --min-instances=0 \
  --max-instances=1
```

`--allow-unauthenticated` is required because access is protected by the application's Basic Auth middleware (`server.py`), not by Cloud Run IAM — this avoids requiring a Google account for mobile access.

`manifest.json`, `sw.js`, and `icons/` are exempted from authentication (`PUBLIC_PATHS` in `server.py`); otherwise Chrome cannot evaluate PWA installability.

To force a new revision (e.g. after rotating a secret) with no other config change:

```bash
gcloud run services update livetranslate --region us-central1 \
  --update-labels=redeploy-trigger=$(date +%s)
```

## Adding a language

1. Add an `<option>` in the `<select id="targetLang">` in `index.html`
2. Add the matching entry in the `LANGUAGES` object in `script.js`
3. (Optional) Add a regional variant note in `buildSystemInstruction()` if needed (see the handling of `es` → Mexican Spanish)

Check beforehand that the language is on the supported-languages list for the conversational Gemini Live model (a different, shorter list from the specialized translation model).

## Known limitations

- No real barge-in (voluntary interruption while the model is speaking) — effectively disabled by the anti-echo mute, which is the intended behavior for this use case
- Fixed voice (`Puck`) — no automatic adaptation to the interlocutor's voice (this capability exists only on the specialized translation model, which doesn't support Kyrgyz and precludes using a system prompt)
- No explicit cost cap on the API side — monitor manually via the AI Studio console under heavy use
