/**
 * Capture micro (PCM 16 kHz) et lecture (PCM 24 kHz) via AudioWorklets.
 */

/** Capture le micro et appelle onChunk(base64PCM16) toutes les ~32 ms. */
class MicStreamer {
  /**
   * @param {(base64: string) => void} onChunk
   * @param {{raw?: boolean}} options  raw = pas de traitement navigateur (utile en voiture)
   */
  constructor(onChunk, options = {}) {
    this.onChunk = onChunk;
    this.raw = !!options.raw;
    this.sampleRate = 16000; // Gemini attend du 16 kHz
    this.audioContext = null;
    this.worklet = null;
    this.source = null;
    this.stream = null;
  }

  async start() {
    // L'anti-écho de l'app (coupure du micro pendant la lecture) suffit en général ;
    // le mode « brut » désactive en plus le traitement du navigateur, qui coupe
    // parfois la voix dans les environnements bruyants (voiture).
    const processing = !this.raw;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: this.sampleRate,
        echoCancellation: processing,
        noiseSuppression: processing,
        autoGainControl: processing,
      },
    });

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sampleRate });
    await this.audioContext.audioWorklet.addModule("audio-processors/capture.worklet.js");
    this.worklet = new AudioWorkletNode(this.audioContext, "audio-capture-processor");
    this.worklet.port.onmessage = (event) => {
      if (event.data.type === "audio") this.onChunk(float32ToBase64PCM16(event.data.data));
    };
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.source.connect(this.worklet);
  }

  /** Coupe le micro sans arrêter le flux (anti-écho / pause). */
  setMuted(muted) {
    if (this.stream) this.stream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  destroy() {
    if (this.source) this.source.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.audioContext) this.audioContext.close();
    this.source = this.stream = this.audioContext = this.worklet = null;
  }
}

/** Lit des morceaux PCM16 24 kHz encodés en base64. */
class PcmPlayer {
  constructor() {
    this.sampleRate = 24000; // Gemini produit du 24 kHz
    this.audioContext = null;
    this.worklet = null;
    this.gain = null;
    this.volume = 1; // volume réglé avec les boutons du téléphone
    this.initPromise = null;
  }

  /** Doit être appelé pendant un geste utilisateur (contrainte des navigateurs mobiles). */
  init() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sampleRate });
        if (this.audioContext.state === "suspended") await this.audioContext.resume();
        await this.audioContext.audioWorklet.addModule("audio-processors/playback.worklet.js");
        this.worklet = new AudioWorkletNode(this.audioContext, "pcm-processor");
        this.gain = this.audioContext.createGain();
        this.gain.gain.value = this.volume;
        this.worklet.connect(this.gain);
        this.gain.connect(this.audioContext.destination);
      })().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  async play(base64Audio) {
    await this.init();
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
    this.worklet.port.postMessage(base64PCM16ToFloat32(base64Audio));
  }

  /** Vide la file de lecture immédiatement. */
  interrupt() {
    if (this.worklet) this.worklet.port.postMessage("interrupt");
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  destroy() {
    if (this.audioContext) this.audioContext.close();
    this.audioContext = this.worklet = this.gain = this.initPromise = null;
  }
}

/** Durée en secondes d'une liste de morceaux PCM16 24 kHz en base64. */
function pcmChunksDuration(chunks) {
  let bytes = 0;
  for (const c of chunks) bytes += (c.length * 3) / 4; // taille décodée approximative
  return bytes / (24000 * 2);
}

function float32ToBase64PCM16(float32) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    pcm[i] = Math.max(-1, Math.min(1, float32[i])) * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64PCM16ToFloat32(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}
