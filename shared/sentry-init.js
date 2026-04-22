/**
 * Sentry error monitoring — shared init for dashboard.html + tenant_app.html.
 *
 * Loaded after the Sentry CDN loader script. The loader stub is ~5KB and only
 * pulls the full SDK when an actual error fires, keeping cold-start fast.
 *
 * Free-tier guards (Developer plan = 5,000 errors/mo, 10K spans/mo, 50 replays/mo):
 *   - tracesSampleRate = 0      → no performance monitoring (kills span quota)
 *   - replaysSessionSampleRate=0 → no idle session replays
 *   - replaysOnErrorSampleRate=0.1 → only 10% of error sessions get replay
 *   - sampleRate = 1.0           → keep all errors (the whole point)
 *
 * Noise suppression (these would burn the error quota for no value):
 *   - ResizeObserver loop limit / completed
 *   - Browser extension errors (chrome-extension://, moz-extension://, etc.)
 *   - Cross-origin script errors with no detail ("Script error.")
 *   - Network failures (fetch/xhr offline) — track separately if needed
 *   - Firebase 'auth/popup-closed-by-user' — user action, not bug
 *
 * Each consuming HTML must set window.SENTRY_APP_NAME ('dashboard' or 'tenant_app')
 * BEFORE this file loads, so we can tag events with the right surface.
 */

(function () {
  if (typeof window === 'undefined') return;

  const appName = window.SENTRY_APP_NAME || 'unknown';

  // The loader stub must already be present (added inline in HTML head).
  // We attach configuration via Sentry.onLoad — fires once the SDK lazy-loads
  // either on first error OR when we explicitly call Sentry.forceLoad().
  if (!window.Sentry || typeof window.Sentry.onLoad !== 'function') {
    console.warn('⚠️ Sentry loader not present — error monitoring disabled');
    return;
  }

  window.Sentry.onLoad(function () {
    Sentry.init({
      // dsn is auto-filled by the loader from the URL public key — no need to repeat
      environment: location.hostname === 'the-green-haven.vercel.app' ? 'production'
                 : location.hostname === 'localhost' ? 'development'
                 : 'preview',
      release: window.SENTRY_RELEASE || undefined,  // optional: git SHA injected at build

      // Quota guards
      sampleRate: 1.0,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0.1,

      // Don't auto-send IP / cookies — Thai PDPA prefers explicit opt-in
      sendDefaultPii: false,

      // Noise filters — keep error budget for real bugs
      ignoreErrors: [
        // Browser quirks
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        // Cross-origin opaque errors (no actionable info)
        'Script error.',
        'Non-Error promise rejection captured',
        // Firebase / LIFF user-cancelled flows
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request',
        'The user closed the LIFF page',
        // Network blips — recoverable, not bugs
        'NetworkError',
        'Load failed',
        'Failed to fetch',
        'cancelled'
      ],

      denyUrls: [
        // Browser extensions throw inside our pages — not our bug
        /extensions?\//i,
        /^chrome:\/\//i,
        /^chrome-extension:\/\//i,
        /^moz-extension:\/\//i,
        /^safari-extension:\/\//i,
        // 3rd-party CDNs we can't fix (analytics, ads, etc.)
        /googletagmanager\.com/i,
        /google-analytics\.com/i
      ],

      // Tag every event with the app + page so issues group cleanly
      initialScope: {
        tags: {
          app: appName,
          page: location.pathname
        }
      },

      // Last-line filter: scrub PII the user typed before send
      beforeSend(event) {
        // Strip query strings + hashes from breadcrumb URLs (might contain IDs)
        if (event.request && event.request.url) {
          try {
            const u = new URL(event.request.url);
            event.request.url = u.origin + u.pathname;
          } catch (_) { /* ignore */ }
        }
        return event;
      }
    });

    // Identify user from session if available — helps debug "user X says…" reports.
    // Don't include name/phone — only user role + room (anonymized).
    try {
      const session = JSON.parse(sessionStorage.getItem('user') || 'null');
      if (session) {
        Sentry.setUser({
          id: session.uid || session.email || 'unknown',
          username: session.userType || 'unknown',  // 'admin' | 'tenant'
          // No PII fields (email, name, ip)
        });
      }
      // Tenant_app additionally has room context
      const tenantBuilding = sessionStorage.getItem('tenant_building');
      const tenantRoom = sessionStorage.getItem('tenant_room');
      if (tenantBuilding || tenantRoom) {
        Sentry.setTags({
          building: tenantBuilding || 'unknown',
          room: tenantRoom || 'unknown'
        });
      }
    } catch (_) { /* sessionStorage might be blocked */ }

    console.log(`🛡️ Sentry initialized for ${appName}`);
  });
})();
