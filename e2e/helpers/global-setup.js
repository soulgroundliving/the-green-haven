// Playwright globalSetup — warm the freshly-deployed Vercel build ONCE before
// the suite runs.
//
// Why this exists: the E2E suite is triggered by `deployment_status` (see
// .github/workflows/e2e.yml) — i.e. the instant a new production build goes
// live, which is the COLDEST possible moment. The slowest cold path is
// /api/config, a Vercel serverless function whose response gates
// window.firebaseReady in login.html (login.html:750). Until firebaseReady is
// true, handleLogin() refuses to sign in. Without a warm-up, the first few
// per-test logins each pay that cold spin-up and race firebaseReady — the cause
// of the cold-deploy login flakiness this setup eliminates.
//
// Paying it once here means the per-test logins hit a warm /api/config + warm
// edge cache. Best-effort by design: a warm-up failure must NEVER fail the
// suite (the tests have their own waits + retries), so every request is
// individually swallowed.

const { request } = require('@playwright/test');

// Routes whose cold spin-up most affects the login → dashboard path.
const WARM_PATHS = [
  '/api/config',                          // serverless fn — gates window.firebaseReady
  '/login.html',
  '/dashboard',
  '/shared/firebase-config-loader.js',    // fetches /api/config in the browser
];

const FALLBACK_BASE = 'https://the-green-haven.vercel.app';

module.exports = async (config) => {
  // Skip when no credentials are configured — the suite itself is skipped in CI
  // in that case (e2e.yml "Check secrets" gate), so warming would be wasted.
  if (!process.env.SMOKE_ADMIN_EMAIL || !process.env.SMOKE_ADMIN_PASSWORD) {
    return;
  }

  const baseURL =
    (config && config.projects && config.projects[0] && config.projects[0].use && config.projects[0].use.baseURL) ||
    FALLBACK_BASE;

  let ctx;
  try {
    ctx = await request.newContext({ baseURL });

    // Two passes: the first request triggers the cold spin-up; the second
    // confirms the function is warm and primes the edge cache.
    for (let pass = 0; pass < 2; pass++) {
      await Promise.allSettled(
        WARM_PATHS.map((p) => ctx.get(p, { timeout: 30_000 }).catch(() => {}))
      );
    }
    console.log(`[e2e global-setup] warmed ${baseURL} → ${WARM_PATHS.join(', ')}`);
  } catch (err) {
    console.warn('[e2e global-setup] warm-up skipped (non-fatal):', err && err.message);
  } finally {
    if (ctx) await ctx.dispose().catch(() => {});
  }
};
