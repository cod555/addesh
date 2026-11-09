// Offline support. Every request goes to the network first (so a new deploy or a retrained
// model shows up immediately) and falls back to the saved copy when there is no connection.

const CACHE = 'addesh-v4';

const APP_SHELL = [
  './',
  'index.html',
  'lab.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/scanner.css',
  'css/lab.css',
  'js/config.js',
  'js/dom.js',
  'js/evaluate.js',
  'js/folders.js',
  'js/i18n.js',
  'js/lab.js',
  'js/labels.js',
  'js/model.js',
  'js/pwa.js',
  'js/rosette.js',
  'js/scanner.js',
  'js/speech.js',
  'js/stabilizer.js',
  'js/store.js',
  'vendor/tf-4.22.0.min.js',
  'fonts/readex-pro-latin.woff2',
  'fonts/readex-pro-arabic.woff2',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Add files one by one so a single missing file doesn't break the install.
    await Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('addesh-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Teachable Machine model files hosted elsewhere (shareable links) are cached too.
const isModelFile = (url) => /\/(model\.json|metadata\.json|[^/]+\.bin)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !isModelFile(url)) return;
  event.respondWith(networkFirst(request, url));
});

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && (response.type === 'basic' || response.type === 'cors')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;
    if (request.mode === 'navigate') {
      // "/lab" (clean URL) → lab.html, anything else → the scanner.
      const page = url.pathname.endsWith('/lab') ? 'lab.html' : 'index.html';
      const fallback = await cache.match(page);
      if (fallback) return fallback;
    }
    throw err;
  }
}
