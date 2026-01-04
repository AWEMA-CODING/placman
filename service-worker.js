// PLACMAN PWA Service Worker (cache simple + fiable)
const CACHE_NAME = "placman-cache-v1";

const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./main.js",
  "./manifest.json",

  // Images / assets (ajuste si besoin)
  "./assets/weapon/slingshot.png",
  "./assets/fx/rift.png",

  // Musiques
  "./music/Ancestral War Circle.mp3",
  "./music/Forest Masks at Dusk.mp3",
  "./music/Neon Mask Ritual.mp3",

  // Icons
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Stratégie: cache-first, puis réseau
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Laisse passer les requêtes non-GET
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          // Met en cache au passage (si ok)
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => {
          // fallback minimal si offline
          if (req.destination === "document") {
            return caches.match("./index.html");
          }
        });
    })
  );
});
