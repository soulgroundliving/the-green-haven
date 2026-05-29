// Flow 1 — Admin Login
//
// Tests the full Firebase Auth login path:
//   email + password form → signInWithEmailAndPassword → custom-claim check
//   → redirect to /dashboard.html
//
// Corresponds to: tasks/smoke-test-admin-playbook.md § Flow 1
// Assertions match the smoke playbook checklist items.

const { test, expect } = require('@playwright/test');

const PROD = 'https://the-green-haven.vercel.app';

test.describe('Login page', () => {
  test('login form renders with required fields', async ({ page }) => {
    await page.goto('/login.html');

    await expect(page.locator('#loginEmail')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#loginPassword')).toBeVisible();
    await expect(page.locator('#loginBtn')).toBeVisible();

    // Firebase Auth script must have loaded (no visible error banner)
    await expect(page.locator('body')).not.toContainText('Firebase: Error', { timeout: 5_000 });
  });

  test('wrong credentials stay on login page', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.locator('#loginBtn')).toBeVisible({ timeout: 10_000 });

    await page.fill('#loginEmail', 'nobody@example.com');
    await page.fill('#loginPassword', 'wrong-password-123');
    await page.click('#loginBtn');

    // Must NOT redirect to dashboard
    await page.waitForTimeout(5_000);
    await expect(page).not.toHaveURL(/dashboard\.html/);
    // Login button must still be present (didn't navigate away)
    await expect(page.locator('#loginBtn')).toBeVisible();
  });

  test('successful admin login redirects to dashboard', async ({ page }) => {
    const email = process.env.SMOKE_ADMIN_EMAIL;
    const password = process.env.SMOKE_ADMIN_PASSWORD;

    test.skip(!email || !password,
      'SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD not configured — skipping live login test');

    await page.goto('/login.html');
    await expect(page.locator('#loginBtn')).toBeVisible({ timeout: 10_000 });

    await page.fill('#loginEmail', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginBtn');

    // Redirect to dashboard — Firebase Auth + custom-claim check must pass
    await page.waitForURL('**/dashboard.html', { timeout: 25_000 });
    await expect(page).toHaveURL(/dashboard\.html/);

    // Sidebar is the canonical "dashboard rendered" indicator
    const billNav = page.locator('button[data-action="showPage"][data-page="bill"]');
    await expect(billNav).toBeVisible({ timeout: 10_000 });

    // No console errors (permission-denied flood = §7-P / §7-Z signal)
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.waitForTimeout(2_000);
    const criticalErrors = errors.filter(e =>
      /permission-denied|auth\//.test(e)
    );
    expect(criticalErrors, `Critical auth errors found: ${criticalErrors.join('\n')}`).toHaveLength(0);
  });
});
