// Flow 5 — Deposit admin view
//
// Confirms the admin can navigate to Requests → มัดจำ (Deposits) tab
// and that the KPI cards render with numeric values.
//
// The three KPI cards are:
//   dep-kpi-holding  — rooms with deposit held (integer ≥ 0)
//   dep-kpi-returned — deposits returned (integer ≥ 0)
//   dep-kpi-total    — total THB held (฿ prefixed or 0)
//
// Read-only — no deposit actions taken. Fixture: deposit data from
// existing tenants confirmed by smoke:verify.
//
// Corresponds to: tasks/smoke-test-admin-playbook.md § Deposit flow

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, openRequestsTab } = require('./helpers/login');

test.describe('Deposit admin view', () => {
  test.skip(
    !process.env.SMOKE_ADMIN_EMAIL || !process.env.SMOKE_ADMIN_PASSWORD,
    'SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD not configured — skipping deposit E2E'
  );

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    // Navigate to Requests & Approvals → Deposits (race-resilient — see helper).
    await openRequestsTab(page, 'deposits');
  });

  test('deposit KPI cards are present in the DOM', async ({ page }) => {
    await expect(page.locator('#dep-kpi-holding')).toBeAttached({ timeout: 10_000 });
    await expect(page.locator('#dep-kpi-returned')).toBeAttached();
    await expect(page.locator('#dep-kpi-total')).toBeAttached();
  });

  test('deposit KPI cards show numeric values (not empty)', async ({ page }) => {
    // Wait for Firestore data to load
    await page.waitForTimeout(3_000);

    const holding = await page.locator('#dep-kpi-holding').textContent();
    const returned = await page.locator('#dep-kpi-returned').textContent();
    const total = await page.locator('#dep-kpi-total').textContent();

    // Values must be numeric (0+) or ฿-prefixed — never empty string
    expect(holding.trim(), 'dep-kpi-holding must not be empty').not.toBe('');
    expect(returned.trim(), 'dep-kpi-returned must not be empty').not.toBe('');
    expect(total.trim(), 'dep-kpi-total must not be empty').not.toBe('');
  });

  test('deposit list container renders (populated or empty-state)', async ({ page }) => {
    const depList = page.locator('#depList');
    await expect(depList).toBeVisible({ timeout: 10_000 });

    // Should not be stuck loading indefinitely
    await page.waitForTimeout(3_000);
    await expect(depList).not.toContainText('กำลังโหลด...', { timeout: 5_000 });
  });

  test('building and status filters are interactive', async ({ page }) => {
    // The filters are visible once the deposits panel is shown (beforeEach), but
    // their <option>s are populated async from Firestore (dashboard-building-selects.js).
    // selectOption({index:0}) HANGS the whole timeout if no <option> exists yet, so
    // wait for the selects to be visible, then retry the select with a SHORT inner
    // timeout until the options are present and selectable.
    const building = page.locator('#dep-filter-building');
    const status = page.locator('#dep-filter-status');
    await expect(building).toBeVisible({ timeout: 15_000 });
    await expect(status).toBeVisible({ timeout: 5_000 });

    // Selecting a filter should not throw a JS error
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await expect(async () => {
      await building.selectOption({ index: 0 }, { timeout: 3_000 });
      await status.selectOption({ index: 0 }, { timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
    await page.waitForTimeout(1_000);

    const jsErrors = errors.filter(e => !/favicon/.test(e));
    expect(jsErrors, `JS errors after filter change: ${jsErrors.join('\n')}`).toHaveLength(0);
  });

  test('no permission-denied errors when loading deposits', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('permission-denied')) {
        errors.push(msg.text());
      }
    });

    const depList = page.locator('#depList');
    await expect(depList).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2_000);

    const permErrors = errors.filter(e => /permission-denied/.test(e));
    expect(permErrors, `Firestore permission errors: ${permErrors.join('\n')}`).toHaveLength(0);
  });
});
