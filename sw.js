// The Green Haven - Payment Portal Service Worker
const CACHE_NAME = 'green-haven-payment-v2';
const urlsToCache = [
  '/',
  '/tenant-payment.html',
  'https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching assets');
      return cache.addAll(urlsToCache);
    }).then(() => {
      self.skipWaiting();
    }).catch((error) => {
      console.error('[SW] Cache failed:', error);
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle HTML files with network-first strategy (always get fresh HTML)
  if (request.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clonedResponse = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clonedResponse);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || new Response('Offline - HTML not available', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/html; charset=utf-8'
              })
            });
          });
        })
    );
    return;
  }

  // Handle API requests with network-first strategy (exclude manifest.json)
  if ((url.pathname.includes('/api/') || url.pathname.includes('.json')) && !url.pathname.includes('manifest.json')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response
          const clonedResponse = response.clone();

          // Cache successful responses
          if (response.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clonedResponse);
            });
          }

          return response;
        })
        .catch(() => {
          // Fall back to cache
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || new Response('Offline - data not available', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
        })
    );
    return;
  }

  // Handle static assets with cache-first strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        console.log('[SW] Serving from cache:', request.url);
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        // Clone the response
        const clonedResponse = response.clone();

        // Cache the response for future use
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, clonedResponse);
        });

        return response;
      }).catch(() => {
        console.log('[SW] Fetch failed, offline:', request.url);

        // Return cached version if available
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          // Return offline page
          if (request.destination === 'document') {
            return new Response(
              '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>Offline</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5;}div{text-align:center;background:white;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}h1{color:#d32f2f;margin:0 0 1rem 0;}p{color:#666;margin:0;}</style></head><body><div><h1>📡 Offline</h1><p>You are currently offline. Please check your connection and try again.</p></div></body></html>',
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: new Headers({
                  'Content-Type': 'text/html; charset=utf-8'
                })
              }
            );
          }

          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      });
    })
  );
});

// Handle background sync for payment verification
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-payment-status') {
    event.waitUntil(syncPaymentStatus());
  }
});

// Function to sync payment status in background
async function syncPaymentStatus() {
  try {
    // Get pending payments from localStorage
    const payments = localStorage.getItem('tenantPayments');
    if (!payments) return;

    const paymentList = JSON.parse(payments);
    const pendingPayments = paymentList.filter(p => p.status === 'pending');

    if (pendingPayments.length === 0) return;

    // Attempt to sync with server
    const response = await fetch('/api/verify-payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pendingPayments)
    });

    if (response.ok) {
      const result = await response.json();
      console.log('[SW] Payment sync successful:', result);

      // Notify client of successful sync
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'PAYMENT_SYNC_SUCCESS',
            data: result
          });
        });
      });
    }
  } catch (error) {
    console.error('[SW] Payment sync failed:', error);
    throw error; // Re-throw to retry
  }
}

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'REQUEST_CACHE_INFO') {
    event.ports[0].postMessage({
      cacheName: CACHE_NAME,
      timestamp: new Date().toISOString()
    });
  }
});

console.log('[SW] Service Worker loaded');
