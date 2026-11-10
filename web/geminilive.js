/**
 * Client WebSocket minimal pour la Gemini Live API.
 * Authentification par clé API de l'utilisateur (BYOK) : le navigateur parle
 * directement à Gemini, aucun serveur intermédiaire.
 */

const LiveEvent = {
  SETUP_COMPLETE: "SETUP_COMPLETE",
  AUDIO: "AUDIO",
  INPUT_TRANSCRIPTION: "INPUT_TRANSCRIPTION",
  OUTPUT_TRANSCRIPTION: "OUTPUT_TRANSCRIPTION",
  INTERRUPTED: "INTERRUPTED",
  TURN_COMPLETE: "TURN_COMPLETE",
  GO_AWAY: "GO_AWAY", // le serveur va bientôt fermer la connexion
  RESUMPTION_HANDLE: "RESUMPTION_HANDLE",
};

const LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

/** Un message serveur peut contenir plusieurs champs (audio + transcription) : on renvoie une liste. */
function parseLiveMessage(data) {
  const out = [];
  if (data.setupComplete) {
    out.push({ type: LiveEvent.SETUP_COMPLETE });
    return out;
  }
  if (data.goAway) out.push({ type: LiveEvent.GO_AWAY, data: data.goAway });
  if (data.sessionResumptionUpdate?.resumable && data.sessionResumptionUpdate.newHandle) {
    out.push({ type: LiveEvent.RESUMPTION_HANDLE, data: data.sessionResumptionUpdate.newHandle });
  }

  const sc = data.serverContent;
  if (!sc) return out;
  for (const part of sc.modelTurn?.parts || []) {
    if (part.inlineData?.data) out.push({ type: LiveEvent.AUDIO, data: part.inlineData.data });
  }
  if (sc.inputTranscription) out.push({ type: LiveEvent.INPUT_TRANSCRIPTION, data: sc.inputTranscription.text || "" });
  if (sc.outputTranscription) out.push({ type: LiveEvent.OUTPUT_TRANSCRIPTION, data: sc.outputTranscription.text || "" });
  if (sc.interrupted) out.push({ type: LiveEvent.INTERRUPTED });
  if (sc.turnComplete) out.push({ type: LiveEvent.TURN_COMPLETE });
  return out;
}

class GeminiLiveClient {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} opts.model
   * @param {string} opts.systemInstruction
   * @param {string} opts.voiceName
   * @param {number} opts.temperature
   * @param {object} opts.vad   paramètres automaticActivityDetection (camelCase)
   * @param {string|null} opts.resumptionHandle
   * @param {string[]} opts.languageCodes  indices de langue pour les transcriptions (BCP-47)
   */
  constructor(opts) {
    this.opts = opts;
    this.ws = null;
    this.connected = false;
    this.onEvent = () => {};
    this.onOpen = () => {};
    /** Appelé avec (code, reason) à la fermeture. */
    this.onClose = () => {};
  }

  connect() {
    this.ws = new WebSocket(`${LIVE_WS_URL}?key=${encodeURIComponent(this.opts.apiKey)}`);
    this.ws.onopen = () => {
      this.connected = true;
      this.sendSetup();
      this.onOpen();
    };
    this.ws.onmessage = (ev) => this.handleMessage(ev);
    // onerror est toujours suivi de onclose, qui porte le code et la raison
    this.ws.onerror = () => {};
    this.ws.onclose = (ev) => {
      this.connected = false;
      this.onClose(ev.code, ev.reason || "");
    };
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.connected = false;
  }

  async handleMessage(ev) {
    let text = ev.data;
    if (text instanceof Blob) text = await text.text();
    else if (text instanceof ArrayBuffer) text = new TextDecoder().decode(text);
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.error("Message non JSON:", err);
      return;
    }
    for (const event of parseLiveMessage(data)) this.onEvent(event);
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  sendSetup() {
    const o = this.opts;
    const setup = {
      model: `models/${o.model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        temperature: o.temperature,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voiceName } } },
      },
      systemInstruction: { parts: [{ text: o.systemInstruction }] },
      // Sans indice, la transcription des langues rares (kirghize…) part parfois
      // dans une autre langue ou une autre écriture (coréen, espagnol…).
      inputAudioTranscription: { languageCodes: o.languageCodes },
      outputAudioTranscription: { languageCodes: o.languageCodes },
      realtimeInputConfig: {
        automaticActivityDetection: o.vad,
        turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY",
      },
      // Sans compression, une session audio est limitée à ~15 min.
      contextWindowCompression: { slidingWindow: {} },
      // Permet de reprendre la session après un GoAway / une coupure réseau.
      sessionResumption: o.resumptionHandle ? { handle: o.resumptionHandle } : {},
    };
    this.send({ setup });
  }

  /** Fin du flux audio : le serveur termine le tour en cours sans attendre le silence. */
  sendAudioStreamEnd() {
    this.send({ realtimeInput: { audioStreamEnd: true } });
  }

  sendAudio(base64PCM) {
    this.send({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: base64PCM } } });
  }
}

/**
 * Vérifie une clé API en listant les modèles.
 * @returns {Promise<{ok: true, liveModels: string[]} | {ok: false, reason: string, detail?: string}>}
 */
async function validateApiKey(apiKey) {
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`
    );
  } catch (err) {
    return { ok: false, reason: "network" };
  }
  if (res.ok) {
    const body = await res.json();
    const liveModels = (body.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("bidiGenerateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
    return { ok: true, liveModels };
  }
  let message = "";
  try {
    message = (await res.json()).error?.message || "";
  } catch (_) {}
  return { ok: false, reason: classifyApiError(res.status, message), detail: message };
}

/** Traduit un message d'erreur Google en catégorie affichable. */
function classifyApiError(status, message) {
  const m = (message || "").toLowerCase();
  if (m.includes("location") || m.includes("region") || m.includes("country")) return "region";
  if (status === 429 || m.includes("quota") || m.includes("resource_exhausted") || m.includes("rate limit")) return "quota";
  if (status === 400 || status === 401 || status === 403 || m.includes("api key")) return "invalidKey";
  return "unknown";
}
