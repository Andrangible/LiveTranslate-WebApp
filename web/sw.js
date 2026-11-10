// Service worker : met en cache l'interface pour qu'elle s'ouvre même avec un
// réseau faible. La traduction elle-même nécessite toujours une connexion.
// Stratégie « réseau d'abord » : une nouvelle version est prise dès qu'elle est en ligne.
// Incrémenter CACHE si la liste des fichiers change.
const CACHE = "livetranslate-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "i18n.js",
  "languages.js",
  "geminilive.js",
  "audio.js",
  "app.js",
  "vendor/qrcode.min.js",
  "audio-processors/capture.worklet.js",
  "audio-processors/playback.worklet.js",
  "manifest.json",
  "icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Uniquement nos propres fichiers (jamais les appels à l'API Google)
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
