// Service worker minimal — l'app nécessite une connexion réseau active,
// donc pas de mise en cache hors-ligne pertinente ici.
self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
    // Passthrough — laisse toutes les requêtes aller directement au réseau
});