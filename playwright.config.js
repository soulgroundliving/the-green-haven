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
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,

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
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
