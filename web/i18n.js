/**
 * Textes de l'interface. Ajouter une langue = ajouter un bloc ici
 * (et son code dans UI_LANGUAGES). Clés manquantes → anglais.
 */
const STRINGS = {
  en: {
    start: "Start",
    stop: "Stop",
    replay: "Replay last translation",
    pause: "Pause",
    statusReady: "Ready",
    statusConnecting: "Connecting…",
    statusListening: "Listening",
    statusTranslating: "Translating",
    statusPaused: "Paused",
    statusReplaying: "Replaying",
    statusReconnecting: "Reconnecting…",
    suspectScript: "This text may have been transcribed in the wrong language. The audio is usually correct.",
    volume: "Volume",
    swap: "Swap languages",
    settings: "Settings",
    share: "Share the app",
    close: "Close",
    nothingToReplay: "Nothing to replay yet",

    errInvalidKey: "Your API key was rejected. Check it in Settings.",
    errQuota: "Free quota reached for now. Wait a few minutes, or switch to another key in Settings.",
    errRegion: "Google's Gemini API is not available in your current country.",
    errNetwork: "No connection to Google. Check your internet connection.",
    errMic: "Microphone access denied. Allow it in your browser settings.",
    errUnknown: "Error: {detail}",
    errSameLang: "Choose two different languages.",

    wizTitle: "Set up your free key",
    wiz1Title: "Why a key?",
    wiz1Body:
      "This app is free and has no server. It talks directly to Google's Gemini AI using your own free API key. Nobody else pays for it, and your conversations don't go through anyone but Google.",
    wiz1Need: "You only need a Google account. It takes about 2 minutes.",
    wiz1Privacy:
      "Note: with a free key, Google may use the audio to improve its products. Your key stays on this device only.",
    next: "Next",
    back: "Back",
    wiz2Title: "Create your key",
    wiz2Step1: "Tap the button below. Google AI Studio opens.",
    wiz2Step2: "Sign in with your Google account and accept the terms if asked.",
    wiz2Step3: "Tap “Create API key” (if a key already exists, just copy it).",
    wiz2Step4: "Tap the copy icon next to the key, then come back to this app.",
    wiz2Open: "Open Google AI Studio",
    wiz2Done: "I copied my key",
    wiz3Title: "Paste your key",
    wiz3Body: "If you copied the key, it may be filled in automatically. Otherwise tap Paste.",
    wiz3Paste: "Paste",
    wiz3Placeholder: "AIza… / AQ.…",
    wiz3Save: "Check and save",
    wiz3Checking: "Checking the key…",
    wiz3Ok: "Key works! You're ready.",
    wiz3NoLive: "This key works, but has no access to the voice (Live) models.",
    wiz3Format: "This doesn't look like a Gemini key (it should start with “AIza” or “AQ.”).",
    wiz3OtherDevice: "Created the key on another device? Open Settings there and use “Send key to a phone”.",

    setKeys: "API keys",
    setKeyActive: "In use",
    setKeyUse: "Use",
    setKeyDelete: "Delete",
    setKeyDeleteConfirm: "Delete this key from this device?",
    setKeyAdd: "Add a key",
    setKeySend: "Send key to a phone",
    setKeyName: "Name for this key (e.g. Free, Paid):",
    keyDefaultName: "Key {n}",
    setVoice: "Voice",
    setModel: "Model",
    setUiLang: "App language",
    setRawMic: "Raw microphone (noisy places, car)",
    setRawMicHint: "Turns off the browser's noise and echo processing. Try it if your voice gets cut off.",
    setClearHistory: "Clear subtitle history",
    setAbout:
      "LiveTranslate has no server: everything runs on your phone and talks directly to Google with your own key. Nothing is collected.",

    shareTitle: "Share LiveTranslate",
    shareBody: "Scan with the phone camera. Each person uses their own free Google key.",
    shareCopy: "Copy link",
    shareCopied: "Link copied",
    sendKeyTitle: "Send your key",
    sendKeyBody: "Scan this with YOUR other phone's camera. Never show it to anyone else: this key gives access to your Google quota.",
    importKeyConfirm: "Save the API key from this link on this device?",
    importKeyDone: "Key saved.",
  },

  fr: {
    start: "Démarrer",
    stop: "Arrêter",
    replay: "Réécouter la dernière traduction",
    pause: "Pause",
    statusReady: "Prêt",
    statusConnecting: "Connexion…",
    statusListening: "En écoute",
    statusTranslating: "Traduction en cours",
    statusPaused: "En pause",
    statusReplaying: "Relecture",
    statusReconnecting: "Reconnexion…",
    suspectScript: "Ce texte a peut-être été transcrit dans la mauvaise langue. L'audio est en général correct.",
    volume: "Volume",
    swap: "Inverser les langues",
    settings: "Réglages",
    share: "Partager l'app",
    close: "Fermer",
    nothingToReplay: "Rien à réécouter pour l'instant",

    errInvalidKey: "Votre clé API a été refusée. Vérifiez-la dans les Réglages.",
    errQuota: "Quota gratuit atteint pour le moment. Attendez quelques minutes ou changez de clé dans les Réglages.",
    errRegion: "L'API Gemini de Google n'est pas disponible dans votre pays actuel.",
    errNetwork: "Pas de connexion à Google. Vérifiez votre connexion internet.",
    errMic: "Accès au micro refusé. Autorisez-le dans les réglages du navigateur.",
    errUnknown: "Erreur : {detail}",
    errSameLang: "Choisissez deux langues différentes.",

    wizTitle: "Configurez votre clé gratuite",
    wiz1Title: "Pourquoi une clé ?",
    wiz1Body:
      "Cette app est gratuite et n'a pas de serveur. Elle parle directement à l'IA Gemini de Google avec votre propre clé API gratuite. Personne d'autre ne paie, et vos conversations ne passent que par Google.",
    wiz1Need: "Il suffit d'un compte Google. Comptez environ 2 minutes.",
    wiz1Privacy:
      "À noter : avec une clé gratuite, Google peut utiliser l'audio pour améliorer ses produits. Votre clé reste uniquement sur cet appareil.",
    next: "Suivant",
    back: "Retour",
    wiz2Title: "Créez votre clé",
    wiz2Step1: "Touchez le bouton ci-dessous : Google AI Studio s'ouvre.",
    wiz2Step2: "Connectez-vous avec votre compte Google et acceptez les conditions si demandé.",
    wiz2Step3: "Touchez « Create API key » (si une clé existe déjà, copiez-la simplement).",
    wiz2Step4: "Touchez l'icône de copie à côté de la clé, puis revenez dans cette app.",
    wiz2Open: "Ouvrir Google AI Studio",
    wiz2Done: "J'ai copié ma clé",
    wiz3Title: "Collez votre clé",
    wiz3Body: "Si vous avez copié la clé, elle peut se remplir automatiquement. Sinon, touchez Coller.",
    wiz3Paste: "Coller",
    wiz3Placeholder: "AIza… / AQ.…",
    wiz3Save: "Vérifier et enregistrer",
    wiz3Checking: "Vérification de la clé…",
    wiz3Ok: "La clé fonctionne ! C'est prêt.",
    wiz3NoLive: "Cette clé fonctionne, mais n'a pas accès aux modèles vocaux (Live).",
    wiz3Format: "Ceci ne ressemble pas à une clé Gemini (elle doit commencer par « AIza » ou « AQ. »).",
    wiz3OtherDevice: "Clé créée sur un autre appareil ? Ouvrez les Réglages sur celui-ci et utilisez « Envoyer la clé à un téléphone ».",

    setKeys: "Clés API",
    setKeyActive: "Utilisée",
    setKeyUse: "Utiliser",
    setKeyDelete: "Supprimer",
    setKeyDeleteConfirm: "Supprimer cette clé de cet appareil ?",
    setKeyAdd: "Ajouter une clé",
    setKeySend: "Envoyer la clé à un téléphone",
    setKeyName: "Nom de cette clé (ex. Gratuite, Payante) :",
    keyDefaultName: "Clé {n}",
    setVoice: "Voix",
    setModel: "Modèle",
    setUiLang: "Langue de l'app",
    setRawMic: "Micro brut (lieux bruyants, voiture)",
    setRawMicHint: "Désactive le traitement du bruit et de l'écho du navigateur. À essayer si votre voix est coupée.",
    setClearHistory: "Effacer l'historique des sous-titres",
    setAbout:
      "LiveTranslate n'a pas de serveur : tout tourne sur votre téléphone et parle directement à Google avec votre propre clé. Rien n'est collecté.",

    shareTitle: "Partager LiveTranslate",
    shareBody: "Scannez avec l'appareil photo. Chaque personne utilise sa propre clé Google gratuite.",
    shareCopy: "Copier le lien",
    shareCopied: "Lien copié",
    sendKeyTitle: "Envoyer votre clé",
    sendKeyBody: "Scannez ceci avec l'appareil photo de VOTRE autre téléphone. Ne le montrez à personne d'autre : cette clé donne accès à votre quota Google.",
    importKeyConfirm: "Enregistrer la clé API de ce lien sur cet appareil ?",
    importKeyDone: "Clé enregistrée.",
  },
};

const UI_LANGUAGES = ["en", "fr"];

let uiLang = "en";

function detectUiLang() {
  for (const l of navigator.languages || [navigator.language || "en"]) {
    const base = l.slice(0, 2).toLowerCase();
    if (UI_LANGUAGES.includes(base)) return base;
  }
  return "en";
}

function t(key, vars = {}) {
  let s = STRINGS[uiLang]?.[key] ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

/** Applique les traductions aux éléments marqués data-i18n / data-i18n-title / data-i18n-placeholder. */
function applyI18n(root = document) {
  document.documentElement.lang = uiLang;
  root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute("aria-label", el.title);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
}
