// Service worker: permite instalar la app y abrirla sin conexión.
// Solo guarda los archivos de la app; NUNCA guarda respuestas de Supabase (tienen datos personales).
const CACHE = 'pfj-v28';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './config.js', './manifest.webmanifest', './icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-180.png', './icons/favicon-32.png',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isAsset = url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net';
  if (!isAsset) return; // Supabase y cualquier otro servicio: directo a la red, sin guardar
  // 'no-cache' = siempre pregunta a GitHub si hay versión nueva (así nunca queda la vieja guardada).
  e.respondWith(
    fetch(e.request, url.origin === self.location.origin ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
