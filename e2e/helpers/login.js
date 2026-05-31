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

  // Race the dashboard redirect (Vercel serves /dashboard, also accepts
  // /dashboard.html) against a surfaced login error. login.html reports auth
  // failures AND "not an admin account" type-mismatches in #errorMessage
  // (role="alert"). Catching it turns a cryptic 25s navigation timeout into an
  // actionable message: a failed SMOKE_ADMIN login is an account/secret problem
  // (wrong password / missing admin custom claim), NOT a code regression.
  const redirected = page
    .waitForURL(/\/dashboard(\.html)?([?#]|$)/, { timeout: 25_000 })
    .then(() => 'dashboard', () => null);
  const errored = page
    .waitForFunction(() => {
      const el = document.getElementById('errorMessage');
      return !!(el && el.offsetParent !== null && el.textContent.trim());
    }, { timeout: 25_000 })
    .then(() => 'error', () => null);

  const outcome = await Promise.race([redirected, errored]);
  if (outcome === 'error') {
    const msg = ((await page.locator('#errorMessage').textContent().catch(() => '')) || '').trim();
    throw new Error(
      `Admin login failed — login page reported: "${msg}". ` +
      'The SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD account is invalid, has the wrong ' +
      'password, or lacks the admin custom claim. This is an account/secret issue, ' +
      'NOT a code regression — verify the GitHub secret, and run tools/grant-admin-claim.js ' +
      'if the admin claim is missing.'
    );
  }
  if (outcome !== 'dashboard') {
    // Neither a redirect nor a surfaced error within 25s — re-await briefly so the
    // original navigation timeout (a genuine page/redirect failure) is surfaced.
    await page.waitForURL(/\/dashboard(\.html)?([?#]|$)/, { timeout: 5_000 });
  }

  // Sidebar presence confirms the dashboard rendered successfully
  await expect(
    page.locator('button[data-action="showPage"][data-page="bill"]')
  ).toBeVisible({ timeout: 10_000 });
}

module.exports = { loginAsAdmin };
