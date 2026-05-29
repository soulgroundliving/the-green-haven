// Shared admin login helper for E2E specs.
// Reads SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD from env and performs
// the full UI login flow. Throws a descriptive error when credentials
// are missing so CI produces a clear "secrets not configured" message.

const { expect } = require('@playwright/test');

async function loginAsAdmin(page) {
  const email = process.env.SMOKE_ADMIN_EMAIL;
  const password = process.env.SMOKE_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Missing test credentials.\n' +
      'Set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD before running E2E tests.\n' +
      'Example: SMOKE_ADMIN_EMAIL=admin@x.com SMOKE_ADMIN_PASSWORD=secret npx playwright test'
    );
  }

  await page.goto('/login.html');
  await expect(page.locator('#loginBtn')).toBeVisible({ timeout: 10_000 });

  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', password);
  await page.click('#loginBtn');

  // Wait for the dashboard redirect — Firebase Auth rejects localhost
  // so the production URL is the only valid redirect target.
  await page.waitForURL('**/dashboard.html', { timeout: 25_000 });
  // Sidebar presence confirms the dashboard rendered successfully
  await expect(
    page.locator('button[data-action="showPage"][data-page="bill"]')
  ).toBeVisible({ timeout: 10_000 });
}

module.exports = { loginAsAdmin };
