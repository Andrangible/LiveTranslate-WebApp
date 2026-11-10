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

/* ---------- Réglages persistants ---------- */

function defaultSettings() {
  const base = (navigator.language || "en").slice(0, 2).toLowerCase();
  const langA = LANGUAGE_BY_CODE[base] ? base : "en";
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
    volume: 80,
  };
}

let settings = defaultSettings();

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) settings = { ...settings, ...saved };
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
    "langA", "langB", "swapBtn", "mainBtn", "pauseBtn", "replayBtn", "statusText", "lineIn", "lineOut",
    "subtitlesLog", "volume", "shareBtn", "settingsBtn", "wizard", "wizardClose", "keyInput", "pasteBtn",
    "keyMsg", "saveKeyBtn", "aiStudioLink", "settings", "keyList", "addKeyBtn", "sendKeyBtn", "uiLangSelect",
    "voiceSelect", "modelSelect", "rawMicToggle", "clearHistoryBtn", "qrDialog", "qrTitle", "qrBody", "qrCode",
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
const turnLog = []; // le plus récent en premier : {in, out, audio, node}
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
  else if (!session.client?.ready) text = t("statusConnecting");
  else if (session.manualPause) text = t("statusPaused");
  else if (replaying) text = t("statusReplaying");
  else if (session.echoMuted) text = t("statusTranslating");
  else text = t("statusListening");
  el.statusText.textContent = text;
  el.statusText.classList.toggle("error", !!session.error);
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

  session.active = true;
  session.reconnectAttempts = 0;
  session.resumptionHandle = null;
  setSessionUI(true);
  refreshStatus();

  try {
    await player.init(); // pendant le geste utilisateur
    player.setVolume(settings.volume / 100);
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
  el.mainBtn.dataset.i18n = active ? "stop" : "start";
  el.mainBtn.textContent = t(el.mainBtn.dataset.i18n);
  el.mainBtn.classList.toggle("active", active);
  el.langA.disabled = el.langB.disabled = el.swapBtn.disabled = active;
  el.pauseBtn.disabled = !active;
  if (!active) {
    el.pauseBtn.innerHTML = PAUSE_ICON;
    el.pauseBtn.classList.remove("paused");
  }
}

/* ---------- Sous-titres et historique ---------- */

const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>';
const REPLAY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>';

/** Affiche un texte et le signale s'il n'est écrit dans aucune des deux langues. */
function showLiveText(node, text) {
  node.textContent = text; // textContent : jamais de HTML issu des transcriptions
  const suspect = !scriptMatchesPair(text, settings.langA, settings.langB);
  node.classList.toggle("suspect", suspect);
  node.title = suspect ? t("suspectScript") : "";
}

function archiveTurn() {
  const turn = currentTurn;
  currentTurn = newTurn();
  showLiveText(el.lineIn, "");
  showLiveText(el.lineOut, "");
  if (!turn.in.trim() && !turn.out.trim() && !turn.audio.length) return;

  const node = document.createElement("div");
  node.className = "log-entry";
  const texts = document.createElement("div");
  texts.className = "texts";
  const inEl = document.createElement("div");
  inEl.className = "in";
  showLiveText(inEl, turn.in.trim());
  const outEl = document.createElement("div");
  outEl.className = "out";
  showLiveText(outEl, turn.out.trim());
  texts.append(inEl, outEl);
  node.append(texts);

  const entry = { in: turn.in, out: turn.out, audio: turn.audio, node, button: null };
  if (turn.audio.length) {
    const btn = document.createElement("button");
    btn.className = "replay-small";
    btn.title = t("replay");
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = REPLAY_ICON;
    btn.addEventListener("click", () => toggleReplay(entry));
    node.append(btn);
    entry.button = btn;
  }
  turnLog.unshift(entry);
  el.subtitlesLog.prepend(node);

  // On ne garde l'audio que des derniers tours (~48 Ko/s chacun)
  turnLog.slice(MAX_REPLAYABLE_TURNS).forEach((old) => {
    old.audio = [];
    if (old.button) old.button.remove();
    old.button = null;
  });
  updateReplayButton();
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
  player.setVolume(settings.volume / 100);
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

function renderLanguageSelects() {
  const sorted = [...LANGUAGES].sort((a, b) =>
    languageLabel(a.code, uiLang).localeCompare(languageLabel(b.code, uiLang), uiLang)
  );
  for (const select of [el.langA, el.langB]) {
    select.textContent = "";
    for (const lang of sorted) {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = languageLabel(lang.code, uiLang);
      select.append(opt);
    }
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
}

function setUiLang(code) {
  uiLang = code;
  applyI18n();
  renderLanguageSelects();
  renderSettings();
  turnLog.forEach((h) => h.button && (h.button.title = t("replay")));
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
  el.volume.addEventListener("input", () => {
    settings.volume = Number(el.volume.value);
    player.setVolume(settings.volume / 100);
    saveSettings();
  });
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
  el.clearHistoryBtn.addEventListener("click", () => {
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
  el.volume.value = settings.volume;
  initEventListeners();
  refreshStatus();

  await importKeyFromHash();
  if (!activeKey()) openWizard(1);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker:", err));
  }
});
