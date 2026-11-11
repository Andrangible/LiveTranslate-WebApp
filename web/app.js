/**
 * LiveTranslate (version statique, clé API de l'utilisateur).
 * Dépend des globales de i18n.js, languages.js, geminilive.js, audio.js.
 */

const DEFAULT_MODEL = "gemini-3.1-flash-live-preview";
const VOICES = ["Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"];
const VAD = {
  disabled: false,
  silenceDurationMs: 800,
  prefixPaddingMs: 500,
  endOfSpeechSensitivity: "END_SENSITIVITY_UNSPECIFIED",
  startOfSpeechSensitivity: "START_SENSITIVITY_UNSPECIFIED",
};
const TEMPERATURE = 0.8;
// Deux formats de clé Google : classique « AIza… » (39 car.) et récent « AQ.… »
const KEY_RE = /AIza[0-9A-Za-z_-]{35}|AQ\.[0-9A-Za-z_-]{30,}/;
const MAX_REPLAYABLE_TURNS = 20;
const MAX_RECONNECT_ATTEMPTS = 3;
const STORAGE_KEY = "livetranslate.settings.v1";
const MAX_RECENT_LANGS = 5;
const HISTORY_KEY = "livetranslate.history.v1";
const HISTORY_LIMITS = [0, 50, 100, 200, 500, 1000]; // 0 = pas de sauvegarde (session seulement)

/* ---------- Réglages persistants ---------- */

function defaultSettings() {
  // Langue du téléphone : code exact (es-ES), sinon première variante de la langue (zh → zh-CN)
  const full = navigator.language || "en";
  const base = full.slice(0, 2).toLowerCase();
  const match =
    LANGUAGES.find((l) => l.code.toLowerCase() === full.toLowerCase()) ||
    LANGUAGES.find((l) => l.code === base || l.code.startsWith(base + "-"));
  const langA = match ? match.code : "en";
  return {
    keys: [], // [{id, name, key}]
    activeKeyId: null,
    langA,
    langB: langA === "en" ? "fr" : "en",
    uiLang: null, // null = langue du navigateur
    voice: "Puck",
    model: DEFAULT_MODEL,
    liveModels: [],
    rawMic: false,
    recentLangs: [], // 5 dernières langues utilisées, la plus récente en premier
    historyLimit: 200, // nombre de traductions conservées sur l'appareil
  };
}

let settings = defaultSettings();

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) settings = { ...settings, ...saved };
    if (!settings.recentLangs?.length) settings.recentLangs = [settings.langA, settings.langB];
  } catch (err) {
    console.warn("Réglages illisibles, valeurs par défaut utilisées:", err);
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("Impossible d'enregistrer les réglages:", err);
  }
}

function activeKey() {
  return settings.keys.find((k) => k.id === settings.activeKeyId) || settings.keys[0] || null;
}

/* ---------- Éléments ---------- */

const el = {};
function initDOM() {
  [
    "langA", "langB", "swapBtn", "mainBtn", "mainIcon", "mainLabel", "pauseBtn", "replayBtn", "statusText", "lineIn", "lineOut",
    "subtitlesLog", "shareBtn", "settingsBtn", "wizard", "wizardClose", "keyInput", "pasteBtn",
    "keyMsg", "saveKeyBtn", "aiStudioLink", "settings", "keyList", "addKeyBtn", "sendKeyBtn", "uiLangSelect",
    "voiceSelect", "modelSelect", "rawMicToggle", "historyLimitSelect", "exportHistoryBtn", "clearHistoryBtn", "qrDialog", "qrTitle", "qrBody", "qrCode",
    "copyLinkBtn", "toast",
  ].forEach((id) => (el[id] = document.getElementById(id)));
}

let toastTimer = null;
function showToast(text, ms = 3000) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), ms);
}

/* ---------- État de session ---------- */

const session = {
  client: null,
  mic: null,
  active: false,
  reconnecting: false,
  reconnectAttempts: 0,
  resumptionHandle: null,
  manualPause: false, // bouton pause
  echoMuted: false, // le modèle parle
  replayMuted: false, // relecture en cours
  echoTimer: null,
  error: null,
};

const player = new PcmPlayer();
let wakeLock = null;

// Tour en cours (transcriptions + audio du modèle) et historique rejouable
let currentTurn = newTurn();
// Le plus récent en premier : {ts, langA, langB, in, out, audio, node, button}.
// Le texte est sauvegardé dans localStorage ; l'audio (≈ 3 Mo/min) reste en mémoire,
// donc seules les traductions de la session en cours peuvent être réécoutées.
const turnLog = [];
let replaying = null;
let replayTimer = null;

function newTurn() {
  return { in: "", out: "", audio: [] };
}

/* ---------- Statut ---------- */

function refreshStatus() {
  let text;
  if (session.error) text = session.error;
  else if (session.reconnecting) text = t("statusReconnecting");
  else if (!session.active) text = replaying ? t("statusReplaying") : t("statusReady");
  else if (!session.client?.ready) text = t("statusWait");
  else if (session.manualPause) text = t("statusPaused");
  else if (replaying) text = t("statusReplaying");
  else if (session.echoMuted) text = t("statusTranslating");
  else text = t("statusListening");
  el.statusText.textContent = text;
  el.statusText.classList.toggle("error", !!session.error);
  updateMainBtn();
}

/**
 * Bouton principal : « connecting » (orange, sablier, pas de pulsation) tant que la
 * session n'est pas prête, pour que personne ne parle avant ; « live » (rouge qui pulse)
 * seulement une fois la connexion établie. Un appui pendant la connexion annule.
 */
function updateMainBtn() {
  const state = !session.active ? "idle" : session.client?.ready && !session.reconnecting ? "live" : "connecting";
  if (el.mainBtn.dataset.state === state) return;
  const wasConnecting = el.mainBtn.dataset.state === "connecting";
  el.mainBtn.dataset.state = state;
  el.mainBtn.classList.toggle("active", state === "live");
  el.mainBtn.classList.toggle("connecting", state === "connecting");
  el.mainLabel.dataset.i18n = { idle: "start", connecting: "wait", live: "stop" }[state];
  el.mainLabel.textContent = t(el.mainLabel.dataset.i18n);
  el.mainIcon.innerHTML = { idle: MIC_ICON, connecting: WAIT_ICON, live: STOP_ICON }[state];
  // Petite vibration quand on peut commencer à parler
  if (wasConnecting && state === "live") navigator.vibrate?.(80);
}

function showError(reasonOrText, detail = "") {
  const map = { invalidKey: "errInvalidKey", quota: "errQuota", region: "errRegion", network: "errNetwork", mic: "errMic" };
  if (map[reasonOrText]) session.error = t(map[reasonOrText]);
  else if (reasonOrText === "message") session.error = detail;
  else session.error = t("errUnknown", { detail: detail || reasonOrText });
  refreshStatus();
}

function clearError() {
  session.error = null;
}

/* ---------- Micro / anti-écho ---------- */

// Les trois raisons de couper le micro sont indépendantes : aucune n'annule les autres.
function updateMic() {
  if (session.mic) session.mic.setMuted(session.manualPause || session.echoMuted || session.replayMuted);
}

/* ---------- Wake lock ---------- */

async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (err) {
    console.warn("Wake lock non disponible:", err.message);
  }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release();
  wakeLock = null;
}

/* ---------- Session ---------- */

async function startSession() {
  const key = activeKey();
  if (!key) {
    openWizard(1);
    return;
  }
  if (settings.langA === settings.langB) {
    showError("message", t("errSameLang"));
    return;
  }
  clearError();
  stopReplay();
  rememberRecentLangs(settings.langA, settings.langB);

  session.active = true;
  session.reconnectAttempts = 0;
  session.resumptionHandle = null;
  setSessionUI(true);
  refreshStatus();

  try {
    await player.init(); // pendant le geste utilisateur
    session.mic = new MicStreamer(
      (chunk) => {
        if (session.client?.ready && !session.manualPause) session.client.sendAudio(chunk);
      },
      { raw: settings.rawMic }
    );
    await session.mic.start();
  } catch (err) {
    console.error("Micro:", err);
    stopSession();
    showError(err.name === "NotAllowedError" ? "mic" : "text", err.message);
    return;
  }

  openClient();
  acquireWakeLock();
}

function openClient() {
  const client = new GeminiLiveClient({
    apiKey: activeKey().key,
    model: settings.model || DEFAULT_MODEL,
    systemInstruction: buildSystemInstruction(settings.langA, settings.langB),
    voiceName: settings.voice,
    temperature: TEMPERATURE,
    vad: VAD,
    resumptionHandle: session.resumptionHandle,
    languageCodes: [settings.langA, settings.langB],
  });
  client.ready = false;
  client.onEvent = (event) => handleEvent(client, event);
  client.onClose = (code, reason) => handleClose(client, code, reason);
  session.client = client;
  client.connect();
}

/** Remplace la connexion courante par une nouvelle (GoAway ou coupure). */
function reconnect() {
  if (!session.active) return;
  archiveTurn();
  if (session.client) session.client.close();
  session.client = null;
  session.reconnecting = true;
  session.echoMuted = false;
  clearTimeout(session.echoTimer);
  updateMic();
  refreshStatus();
  const delay = 300 * session.reconnectAttempts;
  setTimeout(() => session.active && openClient(), delay);
}

/** Bouton Arrêter = bouton panique : tout est coupé immédiatement, y compris l'audio en cours. */
function stopSession() {
  session.active = false;
  session.reconnecting = false;
  if (session.client) session.client.close();
  session.client = null;
  if (session.mic) session.mic.destroy();
  session.mic = null;
  session.manualPause = session.echoMuted = session.replayMuted = false;
  clearTimeout(session.echoTimer);
  player.interrupt();
  archiveTurn();
  releaseWakeLock();
  setSessionUI(false);
  refreshStatus();
}

function handleClose(client, code, reason) {
  if (client !== session.client || !session.active) return; // connexion déjà remplacée
  console.warn("WebSocket fermé:", code, reason);
  const kind = classifyApiError(0, reason);
  const fatal = kind === "invalidKey" || kind === "quota" || kind === "region";
  if (!fatal && session.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    session.reconnectAttempts++;
    reconnect();
    return;
  }
  stopSession();
  showError(fatal ? kind : navigator.onLine ? "text" : "network", reason || `code ${code}`);
}

function handleEvent(client, event) {
  if (client !== session.client) return;
  switch (event.type) {
    case LiveEvent.SETUP_COMPLETE:
      client.ready = true;
      session.reconnecting = false;
      session.reconnectAttempts = 0;
      break;

    case LiveEvent.AUDIO:
      // Anti-écho : micro coupé dès le premier morceau audio du modèle
      if (replaying) stopReplay();
      clearTimeout(session.echoTimer);
      session.echoMuted = true;
      updateMic();
      currentTurn.audio.push(event.data);
      player.play(event.data);
      break;

    case LiveEvent.INPUT_TRANSCRIPTION:
      currentTurn.in += event.data;
      showLiveText(el.lineIn, currentTurn.in);
      break;

    case LiveEvent.OUTPUT_TRANSCRIPTION:
      currentTurn.out += event.data;
      showLiveText(el.lineOut, currentTurn.out);
      break;

    case LiveEvent.TURN_COMPLETE:
      // Archivage sur TURN_COMPLETE (le flag `finished` des transcriptions n'est pas fiable)
      archiveTurn();
      session.echoTimer = setTimeout(() => {
        session.echoMuted = false;
        updateMic();
        refreshStatus();
      }, 300);
      break;

    case LiveEvent.RESUMPTION_HANDLE:
      session.resumptionHandle = event.data;
      break;

    case LiveEvent.GO_AWAY:
      // Le serveur va fermer la connexion : on en ouvre une nouvelle en reprenant la session
      reconnect();
      break;
  }
  refreshStatus();
}

function togglePause() {
  if (!session.active) return;
  session.manualPause = !session.manualPause;
  updateMic();
  // En pause, on clôt le flux audio pour que la phrase en cours soit traduite
  // immédiatement ; la reprise de l'envoi audio rouvre le flux.
  if (session.manualPause && session.client?.ready) session.client.sendAudioStreamEnd();
  el.pauseBtn.innerHTML = session.manualPause ? PLAY_ICON : PAUSE_ICON;
  el.pauseBtn.classList.toggle("paused", session.manualPause);
  refreshStatus();
}

function setSessionUI(active) {
  updateMainBtn();
  el.langA.disabled = el.langB.disabled = el.swapBtn.disabled = active;
  el.pauseBtn.disabled = !active;
  if (!active) {
    el.pauseBtn.innerHTML = PAUSE_ICON;
    el.pauseBtn.classList.remove("paused");
  }
}

/* ---------- Sous-titres et historique ---------- */

const MIC_ICON = '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>';
const WAIT_ICON = '<path d="M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9"/>';
const STOP_ICON = '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>';
const COPY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
const REPLAY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>';

/** Affiche un texte et le signale s'il n'est écrit dans aucune des deux langues. */
function showLiveText(node, text, langA = settings.langA, langB = settings.langB) {
  node.textContent = text; // textContent : jamais de HTML issu des transcriptions
  const suspect = !scriptMatchesPair(text, langA, langB);
  node.classList.toggle("suspect", suspect);
  node.title = suspect ? t("suspectScript") : "";
}

function archiveTurn() {
  const turn = currentTurn;
  currentTurn = newTurn();
  showLiveText(el.lineIn, "");
  showLiveText(el.lineOut, "");
  if (!turn.in.trim() && !turn.out.trim() && !turn.audio.length) return;

  const entry = {
    ts: Date.now(),
    langA: settings.langA,
    langB: settings.langB,
    in: turn.in.trim(),
    out: turn.out.trim(),
    audio: turn.audio,
  };
  turnLog.unshift(entry);
  el.subtitlesLog.prepend(renderLogEntry(entry));

  // On ne garde l'audio que des derniers tours (~48 Ko/s chacun)
  turnLog.slice(MAX_REPLAYABLE_TURNS).forEach((old) => {
    old.audio = [];
    if (old.button) old.button.remove();
    old.button = null;
  });
  saveHistory();
  updateReplayButton();
}

function formatEntryTime(ts) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const opts = sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(uiLang, opts).format(d);
}

function renderLogEntry(entry) {
  const node = document.createElement("div");
  node.className = "log-entry";
  const texts = document.createElement("div");
  texts.className = "texts";
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = formatEntryTime(entry.ts);
  const inEl = document.createElement("div");
  inEl.className = "in";
  showLiveText(inEl, entry.in, entry.langA, entry.langB);
  const outEl = document.createElement("div");
  outEl.className = "out";
  showLiveText(outEl, entry.out, entry.langA, entry.langB);
  texts.append(meta, inEl, outEl);
  node.append(texts);

  const actions = document.createElement("div");
  actions.className = "entry-actions";
  const copyBtn = document.createElement("button");
  copyBtn.className = "replay-small";
  copyBtn.title = t("copy");
  copyBtn.setAttribute("aria-label", copyBtn.title);
  copyBtn.innerHTML = COPY_ICON;
  copyBtn.addEventListener("click", () => copyEntry(entry));
  actions.append(copyBtn);
  node.append(actions);

  entry.node = node;
  entry.button = null;
  if (entry.audio?.length) {
    const btn = document.createElement("button");
    btn.className = "replay-small";
    btn.title = t("replay");
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = REPLAY_ICON;
    btn.addEventListener("click", () => toggleReplay(entry));
    actions.prepend(btn);
    entry.button = btn;
  }
  return node;
}

/** Copie l'original et la traduction d'une entrée dans le presse-papiers. */
async function copyEntry(entry) {
  const text = [entry.in, entry.out].filter(Boolean).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    showToast(t("copied"), 1500);
  } catch (_) {
    prompt("", text);
  }
}

/* ---------- Historique sauvegardé ---------- */

function loadHistory() {
  if (!settings.historyLimit) return;
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch (err) {
    console.warn("Historique illisible:", err);
  }
  for (const h of saved.slice(0, settings.historyLimit)) {
    const entry = { ts: h.ts, langA: h.langA, langB: h.langB, in: h.in || "", out: h.out || "", audio: [] };
    turnLog.push(entry);
    el.subtitlesLog.append(renderLogEntry(entry));
  }
}

/** Sauvegarde le texte des N dernières traductions et retire de l'écran celles au-delà. */
function saveHistory() {
  const limit = settings.historyLimit;
  if (limit) {
    turnLog.splice(Math.max(limit, MAX_REPLAYABLE_TURNS)).forEach((old) => old.node.remove());
  }
  const data = turnLog
    .slice(0, limit)
    .map(({ ts, langA, langB, in: input, out }) => ({ ts, langA, langB, in: input, out }));
  try {
    if (data.length) localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
    else localStorage.removeItem(HISTORY_KEY);
  } catch (err) {
    console.warn("Impossible de sauvegarder l'historique:", err);
  }
}

/** Export en texte lisible : feuille de partage du téléphone si possible, sinon téléchargement. */
async function exportHistory() {
  if (!turnLog.length) {
    showToast(t("historyEmpty"));
    return;
  }
  const dateTime = new Intl.DateTimeFormat(uiLang, { dateStyle: "medium", timeStyle: "short" });
  const lines = [`LiveTranslate — ${t("historyExportTitle")} — ${dateTime.format(new Date())}`, ""];
  for (const h of [...turnLog].reverse()) {
    lines.push(`${dateTime.format(new Date(h.ts))} · ${languageLabel(h.langA, uiLang)} ↔ ${languageLabel(h.langB, uiLang)}`);
    if (h.in) lines.push(`  > ${h.in}`);
    if (h.out) lines.push(`  < ${h.out}`);
    lines.push("");
  }
  const name = `livetranslate-${new Date().toISOString().slice(0, 10)}.txt`;
  const file = new File([lines.join("\n")], name, { type: "text/plain" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // l'utilisateur a fermé la feuille de partage
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function lastReplayable() {
  return turnLog.find((h) => h.audio.length) || null;
}

function updateReplayButton() {
  el.replayBtn.disabled = !lastReplayable();
  el.replayBtn.classList.toggle("playing", !!replaying);
}

function clearHistory() {
  stopReplay();
  turnLog.length = 0;
  el.subtitlesLog.textContent = "";
  saveHistory();
  updateReplayButton();
}

/* ---------- Relecture ---------- */

function toggleReplay(entry) {
  if (replaying) {
    const same = replaying === entry;
    stopReplay();
    if (same) return;
  }
  playReplay(entry);
}

async function playReplay(entry) {
  if (!entry || !entry.audio.length) {
    showToast(t("nothingToReplay"));
    return;
  }
  // Ne pas couper le modèle s'il est en train de parler
  if (session.echoMuted) return;

  await player.init(); // geste utilisateur → AudioContext autorisé même hors session
  player.interrupt();

  replaying = entry;
  if (entry.button) entry.button.classList.add("playing");
  // Anti-écho : sans ça, Gemini entendrait la relecture et la retraduirait
  session.replayMuted = true;
  updateMic();
  updateReplayButton();
  refreshStatus();

  for (const chunk of entry.audio) await player.play(chunk);
  replayTimer = setTimeout(endReplay, pcmChunksDuration(entry.audio) * 1000 + 300);
}

function stopReplay() {
  if (!replaying) return;
  player.interrupt();
  endReplay();
}

function endReplay() {
  clearTimeout(replayTimer);
  if (replaying?.button) replaying.button.classList.remove("playing");
  replaying = null;
  session.replayMuted = false;
  updateMic();
  updateReplayButton();
  refreshStatus();
}

/* ---------- Langues ---------- */

/** Place la paire utilisée en tête des langues récentes (max 5). */
function rememberRecentLangs(codeA, codeB) {
  const recent = [codeA, codeB, ...settings.recentLangs].filter(
    (c, i, all) => LANGUAGE_BY_CODE[c] && all.indexOf(c) === i
  );
  settings.recentLangs = recent.slice(0, MAX_RECENT_LANGS);
  saveSettings();
  renderLanguageSelects();
}

/**
 * Deux groupes : « Récentes » (5 dernières utilisées) puis toutes les langues
 * par ordre alphabétique. Une langue récente apparaît dans les deux groupes ;
 * select.value choisit la première option correspondante, donc celle du haut.
 */
function renderLanguageSelects() {
  const label = (code) => languageLabel(code, uiLang);
  const sorted = [...LANGUAGES].sort((a, b) => label(a.code).localeCompare(label(b.code), uiLang));
  const recent = settings.recentLangs.filter((c) => LANGUAGE_BY_CODE[c]);

  for (const select of [el.langA, el.langB]) {
    select.textContent = "";
    const addGroup = (title, codes) => {
      const group = document.createElement("optgroup");
      group.label = title;
      for (const code of codes) group.append(new Option(label(code), code));
      select.append(group);
    };
    if (recent.length) addGroup(t("langRecent"), recent);
    addGroup(t("langAll"), sorted.map((l) => l.code));
  }
  el.langA.value = settings.langA;
  el.langB.value = settings.langB;
}

function onLanguageChange() {
  settings.langA = el.langA.value;
  settings.langB = el.langB.value;
  saveSettings();
  clearError();
  refreshStatus();
}

function swapLanguages() {
  [settings.langA, settings.langB] = [settings.langB, settings.langA];
  el.langA.value = settings.langA;
  el.langB.value = settings.langB;
  saveSettings();
}

/* ---------- Assistant de clé API ---------- */

let wizardStep = 1;
let wentToAiStudio = false;
let validating = false;

function openWizard(step = 1) {
  el.keyInput.value = "";
  setKeyMsg("");
  el.wizardClose.hidden = settings.keys.length === 0;
  showWizardStep(step);
  if (!el.wizard.open) el.wizard.showModal();
}

function showWizardStep(step) {
  wizardStep = step;
  el.wizard.querySelectorAll("section[data-step]").forEach((s) => (s.hidden = s.dataset.step !== String(step)));
  if (step === 3) tryClipboardKey();
}

function setKeyMsg(text, kind = "") {
  el.keyMsg.textContent = text;
  el.keyMsg.className = "msg " + kind;
}

/** Lecture automatique du presse-papiers au retour d'AI Studio (peut être refusée : silencieux). */
async function tryClipboardKey() {
  if (!navigator.clipboard?.readText || validating) return;
  try {
    const text = await navigator.clipboard.readText();
    const match = text.match(KEY_RE);
    if (match) {
      el.keyInput.value = match[0];
      await validateAndSaveKey(match[0]);
    }
  } catch (_) {
    // Permission refusée ou document sans focus : l'utilisateur utilisera « Coller »
  }
}

async function pasteKey() {
  try {
    const text = await navigator.clipboard.readText();
    const match = text.match(KEY_RE);
    el.keyInput.value = match ? match[0] : text.trim();
    if (match) await validateAndSaveKey(match[0]);
    else setKeyMsg(t("wiz3Format"), "error");
  } catch (_) {
    el.keyInput.focus(); // collage manuel
  }
}

async function validateAndSaveKey(raw) {
  const match = (raw || "").match(KEY_RE);
  if (!match) {
    setKeyMsg(t("wiz3Format"), "error");
    return false;
  }
  validating = true;
  setKeyMsg(t("wiz3Checking"));
  const result = await validateApiKey(match[0]);
  validating = false;

  if (!result.ok) {
    const map = { invalidKey: "errInvalidKey", quota: "errQuota", region: "errRegion", network: "errNetwork" };
    setKeyMsg(map[result.reason] ? t(map[result.reason]) : t("errUnknown", { detail: result.detail }), "error");
    return false;
  }
  if (!result.liveModels.length) {
    setKeyMsg(t("wiz3NoLive"), "error");
    return false;
  }

  let name;
  if (settings.keys.length && !settings.keys.some((k) => k.key === match[0])) {
    name = prompt(t("setKeyName"), t("keyDefaultName", { n: settings.keys.length + 1 })) || undefined;
  }
  addKey(match[0], result.liveModels, name);
  setKeyMsg(t("wiz3Ok"), "ok");
  setTimeout(() => el.wizard.open && el.wizard.close(), 1200);
  return true;
}

function addKey(key, liveModels, name) {
  let entry = settings.keys.find((k) => k.key === key);
  if (!entry) {
    const fallbackName = t("keyDefaultName", { n: settings.keys.length + 1 });
    entry = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name: name || fallbackName, key };
    settings.keys.push(entry);
  }
  settings.activeKeyId = entry.id;
  settings.liveModels = liveModels;
  if (!liveModels.includes(settings.model)) settings.model = liveModels.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : liveModels[0];
  saveSettings();
  renderSettings();
  clearError();
  refreshStatus();
}

/** Import d'une clé via un lien « …#key=AIza… » (QR code envoyé depuis un autre appareil). */
async function importKeyFromHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const raw = params.get("key");
  if (!raw) return;
  // On retire tout de suite la clé de l'URL (historique, favoris, partage d'écran)
  window.history.replaceState(null, "", location.pathname + location.search);
  const match = raw.match(KEY_RE);
  if (!match || !confirm(t("importKeyConfirm"))) return;
  const result = await validateApiKey(match[0]);
  if (result.ok && result.liveModels.length) {
    addKey(match[0], result.liveModels);
    if (el.wizard.open) el.wizard.close();
    showToast(t("importKeyDone"));
  } else {
    showError(result.ok ? "text" : result.reason, result.ok ? t("wiz3NoLive") : result.detail);
  }
}

/* ---------- Réglages ---------- */

function maskKey(key) {
  return "…" + key.slice(-4);
}

function renderSettings() {
  // Clés
  el.keyList.textContent = "";
  const active = activeKey();
  for (const k of settings.keys) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.className = "key-label";
    label.textContent = k.name;
    const small = document.createElement("small");
    small.textContent = maskKey(k.key);
    label.append(small);
    li.append(label);

    if (active && k.id === active.id) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "● " + t("setKeyActive");
      li.append(badge);
    } else {
      const use = document.createElement("button");
      use.textContent = t("setKeyUse");
      use.addEventListener("click", () => {
        settings.activeKeyId = k.id;
        saveSettings();
        renderSettings();
      });
      li.append(use);
    }
    const del = document.createElement("button");
    del.textContent = t("setKeyDelete");
    del.addEventListener("click", () => {
      if (!confirm(t("setKeyDeleteConfirm"))) return;
      settings.keys = settings.keys.filter((x) => x.id !== k.id);
      if (settings.activeKeyId === k.id) settings.activeKeyId = settings.keys[0]?.id || null;
      saveSettings();
      renderSettings();
    });
    li.append(del);
    el.keyList.append(li);
  }
  el.sendKeyBtn.disabled = !active;

  // Langue de l'interface
  el.uiLangSelect.textContent = "";
  for (const code of UI_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = languageLabel(code, code);
    el.uiLangSelect.append(opt);
  }
  el.uiLangSelect.value = uiLang;

  // Voix
  el.voiceSelect.textContent = "";
  for (const v of VOICES) el.voiceSelect.append(new Option(v, v));
  el.voiceSelect.value = settings.voice;

  // Modèles Live disponibles pour cette clé (hors modèles spécialisés)
  const models = (settings.liveModels.length ? settings.liveModels : [DEFAULT_MODEL]).filter(
    (m) => !/translate|transcribe|robotics|thinking/.test(m)
  );
  if (!models.includes(settings.model)) models.unshift(settings.model);
  el.modelSelect.textContent = "";
  for (const m of models) el.modelSelect.append(new Option(m === DEFAULT_MODEL ? `${m} ★` : m, m));
  el.modelSelect.value = settings.model;

  el.rawMicToggle.checked = settings.rawMic;

  // Taille de l'historique
  el.historyLimitSelect.textContent = "";
  for (const n of HISTORY_LIMITS) {
    el.historyLimitSelect.append(new Option(n ? t("historyKeep", { n }) : t("historyKeepNone"), String(n)));
  }
  el.historyLimitSelect.value = String(settings.historyLimit);
}

function setUiLang(code) {
  uiLang = code;
  applyI18n();
  renderLanguageSelects();
  renderSettings();
  turnLog.forEach((h) => {
    if (h.button) h.button.title = t("replay");
    h.node.querySelector(".meta").textContent = formatEntryTime(h.ts);
  });
  refreshStatus();
}

/* ---------- QR codes ---------- */

function appUrl() {
  return location.origin + location.pathname;
}

function showQr(title, body, text, allowCopy) {
  el.qrTitle.textContent = title;
  el.qrBody.textContent = body;
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  el.qrCode.innerHTML = qr.createImgTag(6, 8);
  el.copyLinkBtn.hidden = !allowCopy;
  el.qrDialog.showModal();
}

async function copyAppLink() {
  try {
    await navigator.clipboard.writeText(appUrl());
    showToast(t("shareCopied"));
  } catch (_) {
    prompt("", appUrl());
  }
}

/* ---------- Initialisation ---------- */

function initEventListeners() {
  el.mainBtn.addEventListener("click", () => (session.active ? stopSession() : startSession()));
  el.pauseBtn.addEventListener("click", togglePause);
  el.replayBtn.addEventListener("click", () => toggleReplay(replaying || lastReplayable()));
  el.langA.addEventListener("change", onLanguageChange);
  el.langB.addEventListener("change", onLanguageChange);
  el.swapBtn.addEventListener("click", swapLanguages);

  // Assistant
  el.wizard.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => showWizardStep(Number(b.dataset.goto)))
  );
  el.aiStudioLink.addEventListener("click", () => (wentToAiStudio = true));
  el.pasteBtn.addEventListener("click", pasteKey);
  el.saveKeyBtn.addEventListener("click", () => validateAndSaveKey(el.keyInput.value.trim()));
  el.keyInput.addEventListener("input", () => {
    const m = el.keyInput.value.match(KEY_RE);
    if (m && !validating) validateAndSaveKey(m[0]);
    else if (!m) setKeyMsg("");
  });
  el.wizardClose.addEventListener("click", () => el.wizard.close());
  el.wizard.addEventListener("cancel", (e) => {
    if (settings.keys.length === 0) e.preventDefault(); // pas de clé : l'assistant reste ouvert
  });

  // Réglages
  el.settingsBtn.addEventListener("click", () => {
    renderSettings();
    el.settings.showModal();
  });
  el.addKeyBtn.addEventListener("click", () => {
    el.settings.close();
    openWizard(2);
  });
  el.sendKeyBtn.addEventListener("click", () => {
    const k = activeKey();
    if (!k) return;
    el.settings.close();
    showQr(t("sendKeyTitle"), t("sendKeyBody"), `${appUrl()}#key=${k.key}`, false);
  });
  el.uiLangSelect.addEventListener("change", () => {
    settings.uiLang = el.uiLangSelect.value;
    saveSettings();
    setUiLang(settings.uiLang);
  });
  el.voiceSelect.addEventListener("change", () => {
    settings.voice = el.voiceSelect.value;
    saveSettings();
  });
  el.modelSelect.addEventListener("change", () => {
    settings.model = el.modelSelect.value;
    saveSettings();
  });
  el.rawMicToggle.addEventListener("change", () => {
    settings.rawMic = el.rawMicToggle.checked;
    saveSettings();
  });
  el.historyLimitSelect.addEventListener("change", () => {
    settings.historyLimit = Number(el.historyLimitSelect.value);
    saveSettings();
    saveHistory();
  });
  el.exportHistoryBtn.addEventListener("click", exportHistory);
  el.clearHistoryBtn.addEventListener("click", () => {
    if (!confirm(t("historyClearConfirm"))) return;
    clearHistory();
    el.settings.close();
  });

  // Partage
  el.shareBtn.addEventListener("click", () => showQr(t("shareTitle"), t("shareBody"), appUrl(), true));
  el.copyLinkBtn.addEventListener("click", copyAppLink);

  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  // Retour dans l'app : wake lock à reprendre, et clé peut-être copiée depuis AI Studio
  const onReturn = async () => {
    if (document.visibilityState !== "visible") return;
    if (session.active && !wakeLock) await acquireWakeLock();
    if (el.wizard.open && (wizardStep === 3 || (wizardStep === 2 && wentToAiStudio))) {
      if (wizardStep !== 3) showWizardStep(3);
      else tryClipboardKey();
    }
  };
  document.addEventListener("visibilitychange", onReturn);
  window.addEventListener("focus", onReturn);
  window.addEventListener("hashchange", importKeyFromHash);
}

window.addEventListener("DOMContentLoaded", async () => {
  loadSettings();
  uiLang = settings.uiLang || detectUiLang();
  initDOM();
  applyI18n();
  renderLanguageSelects();
  renderSettings();
  loadHistory();
  updateReplayButton();
  initEventListeners();
  refreshStatus();

  await importKeyFromHash();
  if (!activeKey()) openWizard(1);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker:", err));
  }
});
