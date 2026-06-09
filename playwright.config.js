// Playwright E2E config for The Green Haven admin dashboard.
//
// Tests run against the LIVE Vercel production URL — Firebase Auth rejects
// localhost, so tests cannot run against a dev server. This means:
//   - You need SMOKE_ADMIN_EMAIL + SMOKE_ADMIN_PASSWORD env vars set
//   - Tests hit real production data (read-only by design)
//   - Use `npm run test:e2e` to run all flows; see e2e/ directory for each spec
//
// Required env vars (same as npm run smoke):
//   SMOKE_ADMIN_EMAIL    — admin account email
//   SMOKE_ADMIN_PASSWORD — admin account password
//
// GitHub Actions: set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD as repo secrets.

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  // Per-test ceiling MUST exceed loginAsAdmin's stacked internal waits, which run
  // inside the beforeEach hook: waitForURL (≤45s cold-start redirect) + sidebar
  // (10s) + tour-dismiss (~11s) ≈ up to 66s before the test body even starts.
  // The old 30s ceiling was SMALLER than that budget, so a slow cold-start login
  // blew the beforeEach ("Test timeout exceeded while running beforeEach hook")
  // on the 2-3 tests that hit the cold Vercel+Firebase Auth at suite start — the
  // sole cause of the suite being red on every commit #319→#325 (27/32 passed,
  // 2 failed + 1 flaky, all login-timing). 120s leaves comfortable headroom.
  timeout: 120_000,
  // 2 retries (was 1): cold-start slowness is front-loaded — a retry runs once the
  // deployment is warm, so a genuinely slow first attempt self-heals.
  retries: process.env.CI ? 2 : 0,
  // Default expect timeout is 5s — too tight for assertions against the live prod
  // app on a cold edge. 15s tolerates a slow first paint without masking real breaks.
  expect: { timeout: 15_000 },

  // Pay the cold Vercel serverless/edge spin-up (notably /api/config, which gates
  // window.firebaseReady in login.html) ONCE before the suite, instead of having
  // the first few logins each race it. See e2e/helpers/global-setup.js.
  globalSetup: require.resolve('./e2e/helpers/global-setup.js'),

  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'list',

  use: {
    baseURL: 'https://the-green-haven.vercel.app',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    // page.goto against a cold-deployed Vercel build can exceed the 30s default
    // (bounded anyway by the per-test timeout above).
    navigationTimeout: 45_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
