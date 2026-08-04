/*
 * BHEALIX service worker.
 *
 * This is a CRM behind a session cookie, so the caching is deliberately narrow:
 *
 *   - /api/* is never cached. It is per-user, it changes constantly, and a
 *     stale visit or sample count is worse than no answer at all.
 *   - Page HTML is never cached either. It is rendered per role and per user,
 *     and phones get shared between reps. Offline navigations fall back to a
 *     generic page instead.
 *   - Only build output and icons are cached, and those are safe because Next
 *     fingerprints every file under /_next/static.
 *
 * Bump VERSION to evict every cache on the next deploy.
 */
/* v2: real logo artwork. The icon filenames did not change, so without this
 * bump an installed worker would keep serving the placeholder from its cache. */
const VERSION = "v2";
const SHELL_CACHE = `bhealix-shell-${VERSION}`;
const ASSET_CACHE = `bhealix-assets-${VERSION}`;
const CURRENT = [SHELL_CACHE, ASSET_CACHE];

const OFFLINE_URL = "/offline.html";
const SHELL = [OFFLINE_URL, "/icons/icon-192.png", "/icons/favicon-32.png"];

const IMMUTABLE = ["/_next/static/", "/icons/"];
const STATIC_FILE = /\.(?:css|js|png|jpe?g|gif|svg|webp|avif|ico|woff2?)$/;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)));
  // No skipWaiting: a live page keeps the worker that matches the chunks it
  // already loaded until the user accepts the update.
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("bhealix-") && !CURRENT.includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigateOrOfflinePage(request));
    return;
  }

  if (isCacheable(url)) event.respondWith(cacheFirst(request));
});

const isCacheable = url =>
  IMMUTABLE.some(prefix => url.pathname.startsWith(prefix)) || STATIC_FILE.test(url.pathname);

/** Always ask the network so signed-in pages are never served stale. */
async function navigateOrOfflinePage(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(OFFLINE_URL)) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // `basic` skips opaque cross-origin replies; 206s are unusable from a cache.
  if (response.ok && response.type === "basic") cache.put(request, response.clone());
  return response;
}
