// Flow 4 — Checklist admin view
//
// Confirms the admin can navigate to the Requests → Checklist tab and
// that the checklist list container renders (possibly empty, but not stuck).
//
// Read-only — does NOT create or submit a checklist. Creating one requires
// a specific tenant context and file upload.
//
// Corresponds to: tasks/smoke-test-admin-playbook.md § Checklist flow

const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/login');

test.describe('Checklist admin view', () => {
  test.skip(
    !process.env.SMOKE_ADMIN_EMAIL || !process.env.SMOKE_ADMIN_PASSWORD,
    'SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD not configured — skipping checklist E2E'
  );

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('navigates to checklist tab without error', async ({ page }) => {
    // Open Requests & Approvals page
    await page.click('button[data-action="showPage"][data-page="requests-approvals"]');

    // Click the Checklists tab
    await page.click('button[data-action="switchRequestsTab"][data-tab="checklist"]');

    // Tab content must become visible
    const checklistTab = page.locator('#requests-tab-checklist');
    await expect(checklistTab).toBeVisible({ timeout: 10_000 });
  });

  test('checklist filter dropdowns are present', async ({ page }) => {
    await page.click('button[data-action="showPage"][data-page="requests-approvals"]');
    await page.click('button[data-action="switchRequestsTab"][data-tab="checklist"]');

    // Building and status filters must exist (they gate the list query)
    await expect(page.locator('#checklist-admin-building')).toBeAttached({ timeout: 10_000 });
    await expect(page.locator('#checklist-admin-status')).toBeAttached();
  });

  test('checklist list container renders (populated or empty)', async ({ page }) => {
    await page.click('button[data-action="showPage"][data-page="requests-approvals"]');
    await page.click('button[data-action="switchRequestsTab"][data-tab="checklist"]');

    const list = page.locator('#checklist-admin-list');
    await expect(list).toBeVisible({ timeout: 10_000 });

    // Must not be stuck on a loading spinner indefinitely
    await page.waitForTimeout(3_000);
    await expect(list).not.toContainText('กำลังโหลด...', { timeout: 5_000 });
  });

  test('no permission-denied errors when loading checklists', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('permission-denied')) {
        errors.push(msg.text());
      }
    });

    await page.click('button[data-action="showPage"][data-page="requests-approvals"]');
    await page.click('button[data-action="switchRequestsTab"][data-tab="checklist"]');

    const list = page.locator('#checklist-admin-list');
    await expect(list).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2_000);

    const permErrors = errors.filter(e => /permission-denied/.test(e));
    expect(permErrors, `Firestore permission errors: ${permErrors.join('\n')}`).toHaveLength(0);
  });
});
