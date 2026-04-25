/**
 * Service worker for Nature Haven tenant_app PWA.
 *
 * Strategy per request type — chosen to give offline tenants the most
 * useful state without ever serving stale data they'd act on:
 *
 *  - **Cache-first** for static assets (CSS, JS, fonts, the SVG icon):
 *    these almost never change between deploys, and a cache hit lets the
 *    app boot offline. New deploys bust the cache via CACHE_VERSION below.
 *
 *  - **Network-first with cache fallback** for the tenant_app HTML and
 *    its config endpoints: when online, the latest is shown; when offline,
 *    the last cached HTML lets the tenant at least open the app and see
 *    cached data underneath.
 *
 *  - **Network-only** for write/auth-sensitive endpoints — Firestore
 *    writes, RTDB ops, SlipOK verify, LIFF auth, Sentry. We never want
 *    to silently replay these from cache.
 *
 *  - **Bypass entirely** for cross-origin URLs not in our allowlist (let
 *    the browser handle them normally, no SW interference).
 *
 * CACHE_VERSION — bump on any deploy that materially changes shared/*.js
 * structure. The activate handler purges every cache that doesn't match,
 * so old cached assets won't outlive a release.
 *
 * Updates: registration in tenant_app.html does navigator.serviceWorker
 * .register('/service-worker.js'); browsers re-fetch the SW file (this
 * one) on every navigation and swap it in on the next page load if the
 * bytes changed.
 */

const CACHE_VERSION = 'v3-2026-04-25n';
const STATIC_CACHE = `nh-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `nh-dynamic-${CACHE_VERSION}`;

// Pre-cache the shell so the very first install populates offline assets
// without needing the tenant to navigate every page.
const PRECACHE_URLS = [
  '/tenant_app.html',
  '/manifest.json',
  '/shared/pwa-icon.svg',
  '/shared/brand.css'
];

// Origins we're willing to cache. Cross-origin (Firebase API, LINE, Google
// Fonts CDN) bypasses the SW entirely — those have their own caching +
// CORS rules we don't want to fight with.
const CACHEABLE_ORIGINS = new Set([
  self.location.origin
]);

// Endpoints we MUST always hit network — never serve from cache.
const NETWORK_ONLY_PATHS = [
  '/api/',                         // serverless config
  '/login',                        // auth flow
  '/login.html'
];

// Cross-origin URLs that we should always pass through (writes, auth, etc).
const NETWORK_ONLY_HOST_PATTERNS = [
  /firebaseio\.com/,
  /firestore\.googleapis\.com/,
  /firebaseapp\.com/,
  /firebasestorage\.app/,
  /api\.line\.me/,
  /liff\.line\.me/,
  /cloudfunctions\.net/,
  /sentry\.io/,
  /ingest\..*sentry/i
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())  // activate immediately on first install
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(n => n !== STATIC_CACHE && n !== DYNAMIC_CACHE)
          .map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())  // take control of all open tabs immediately
  );
});

function isNetworkOnly(url) {
  if (NETWORK_ONLY_PATHS.some(p => url.pathname.startsWith(p))) return true;
  if (NETWORK_ONLY_HOST_PATTERNS.some(p => p.test(url.hostname))) return true;
  return false;
}

function isStaticAsset(url) {
  if (!CACHEABLE_ORIGINS.has(url.origin)) return false;
  return /\.(css|js|svg|png|jpg|jpeg|webp|woff2?|ttf|ico)(\?|$)/i.test(url.pathname);
}

function isAppShell(url) {
  if (!CACHEABLE_ORIGINS.has(url.origin)) return false;
  return url.pathname === '/tenant_app.html'
      || url.pathname === '/'
      || url.pathname === '/manifest.json';
}

self.addEventListener('fetch', (event) => {
  // Only handle GET. Writes (POST/PUT/PATCH/DELETE) always pass through.
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Cross-origin Firebase / LINE / Sentry / etc. → bypass SW entirely.
  if (isNetworkOnly(url)) return;

  // Cross-origin static (Google Fonts, CDNs) → also bypass; they cache
  // fine on their own with long max-age headers.
  if (!CACHEABLE_ORIGINS.has(url.origin)) return;

  if (isStaticAsset(url)) {
    // Cache-first
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(STATIC_CACHE).then(c => c.put(event.request, clone));
          }
          return resp;
        });
      })
    );
    return;
  }

  if (isAppShell(url)) {
    // Network-first with cache fallback so offline tenants still see
    // the app shell + last-cached app data underneath.
    event.respondWith(
      fetch(event.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(DYNAMIC_CACHE).then(c => c.put(event.request, clone));
        }
        return resp;
      }).catch(() => caches.match(event.request).then(c => c || caches.match('/tenant_app.html')))
    );
    return;
  }
  // Everything else: let the browser do its default thing.
});

// Allow page to instruct SW to skip waiting (e.g. on a "new version"
// banner click in tenant_app). Optional but standard.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
