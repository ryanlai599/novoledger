const CACHE = 'novoledger-idb-v6';
const CORE = ['/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const html = await fetch('/index.html', { cache: 'no-store' });
    if (!html.ok) throw new Error('Application shell unavailable');
    const source = await html.clone().text();
    const assets = [...source.matchAll(/(?:src|href)="(\/assets\/[\w.-]+)"/g)].map(match => match[1]);
    if (!assets.some(file => file.endsWith('.js'))) throw new Error('Application bundle unavailable');
    await cache.addAll([...new Set([...CORE, ...assets])]);
    await cache.put('/index.html', html);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE && /^(finance-workbench-v\d+|novoledger-idb-v\d+)$/.test(key))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin
      || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        if (response.ok || response.status < 500) return response;
      } catch {
        // Use the verified shell, not arbitrary cached navigations.
      }
      return (await caches.open(CACHE)).match('/index.html');
    })());
  } else if (url.pathname.startsWith('/assets/') || CORE.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(event.request) ?? fetch(event.request);
    })());
  }
});
