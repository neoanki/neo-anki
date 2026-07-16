const CACHE = 'neo-anki-v4'
self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE)
  const response = await fetch('/')
  const html = await response.clone().text()
  await cache.put('/', response)
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)].map((match) => match[1])
  await cache.addAll([...new Set(['/manifest.webmanifest', '/icon.svg', ...assets])])
  await self.skipWaiting()
})()))
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys()
  await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
  await self.clients.claim()
})()))
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const path = new URL(event.request.url).pathname
    const cached = await cache.match(path)
    if (cached) return cached
    try {
      const response = await fetch(event.request)
      if (response.ok) await cache.put(path, response.clone())
      return response
    } catch {
      return event.request.mode === 'navigate' ? (await cache.match('/')) || Response.error() : Response.error()
    }
  })())
})
