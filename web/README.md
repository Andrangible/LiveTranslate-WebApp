# LiveTranslate (static version, bring your own key)

The shareable version of the app. It has no backend. Each user pastes their own free Gemini API key, which is stored only in that browser's localStorage, and the browser talks to the Gemini Live API directly.

The original version (`../frontend` + `../server.py`, deployed to Cloud Run with a server-side key) is still in place and unchanged.

## Run locally

```bash
python3 -m http.server -d web 8001     # http://localhost:8001 (the microphone works on localhost)
ngrok http 8001                         # HTTPS, needed for testing on a phone
```

## Deploy (Firebase Hosting)

The app is hosted on Firebase Hosting's free Spark plan, which has no billing account, so it can never cost anything. If the daily quota (~360 MB) were ever exceeded, the site would just pause until the next day. `firebase.json` (at the repo root) serves `web/` with `no-cache` (each update shows up straight away) and a strict Content-Security-Policy: the page can only connect to Google's Gemini API.

One-time setup:
1. At https://console.firebase.google.com, create a **new** project (do not reuse the Cloud Run project, which has billing turned on). Turn off Google Analytics, and do not upgrade the plan.
2. Install the CLI: `curl -sL https://firebase.tools | bash` (a standalone binary, Node isn't needed).
3. Run `firebase login` (under WSL, if the browser redirect fails: `firebase login --no-localhost`).
4. Run `firebase use --add`, pick the project, and use the alias `default`. This creates `.firebaserc`; commit it.

Each deploy: `./deploy-web.sh`. The site goes to `https://<project-id>.web.app`.

Local test with the real Firebase server (headers included): `firebase emulators:start --only hosting --project demo-livetranslate`, then open http://127.0.0.1:5000.

## Files (load order matters, globals are shared)

`vendor/qrcode.min.js` → `i18n.js` (UI strings) → `languages.js` (language list + system prompt) → `geminilive.js` (WebSocket client, key validation) → `audio.js` (mic/player) → `app.js` (everything else).

- **Adding a UI language:** add a block to `STRINGS` and its code to `UI_LANGUAGES` in `i18n.js`.
- **Adding a spoken language:** add an entry to `LANGUAGES` in `languages.js`. The display name comes from `Intl.DisplayNames`.
- **Changing cached files:** if you change which files the app uses, update `SHELL` and bump `CACHE` in `sw.js`.
