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

  // Wait for the dashboard redirect — Vercel serves /dashboard (no .html
  // extension) but also accepts /dashboard.html, so match both. On the success
  // path this resolves well before the timeout; we deliberately do NOT race it
  // against #errorMessage, because login.html reuses #errorMessage for a
  // transient "กำลังโหลด… โปรดรอสักครู่" loading state during the sign-in — racing
  // it produced false "login failed" results on slow loads.
  try {
    await page.waitForURL(/\/dashboard(\.html)?([?#]|$)/, { timeout: 25_000 });
  } catch (navErr) {
    // No redirect within 25s — surface a real login error if one is shown. By
    // now the transient loading text is gone (login.html replaces it with the
    // error via showMessage + setLoading(false)); still exclude the loading
    // wording defensively so only a genuine auth error is treated as actionable.
    const msg = ((await page.locator('#errorMessage').textContent().catch(() => '')) || '').trim();
    if (msg && !/กำลังโหลด|โปรดรอ|loading/i.test(msg)) {
      throw new Error(
        `Admin login failed — login page reported: "${msg}". The SMOKE_ADMIN_EMAIL/` +
        'SMOKE_ADMIN_PASSWORD account is invalid, has the wrong password, or lacks the ' +
        'admin custom claim. This is an account/secret issue, NOT a code regression — ' +
        'verify the GitHub secret, and run tools/grant-admin-claim.js if the claim is missing.'
      );
    }
    throw navErr;
  }

  // Sidebar presence confirms the dashboard rendered successfully
  await expect(
    page.locator('button[data-action="showPage"][data-page="bill"]')
  ).toBeVisible({ timeout: 10_000 });
}

module.exports = { loginAsAdmin };
