// Flow 2 — Bill view (admin)
//
// Confirms the admin can navigate to the bill page, see the room grid
// populated from RTDB, and open the detail panel for fixture room 15.
//
// Fixture: rooms/15 has 2 bills (confirmed 2026-05-19, smoke:verify --bill).
// The test is read-only — it only navigates and asserts, never writes data.
//
// Corresponds to: tasks/smoke-test-admin-playbook.md § Flow 2

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, openBillRoomDetail } = require('./helpers/login');

// Fixture room known to have bills (smoke:verify confirmed 2026-05-19)
const FIXTURE_ROOM = '15';

test.describe('Bill view flow', () => {
  test.skip(
    !process.env.SMOKE_ADMIN_EMAIL || !process.env.SMOKE_ADMIN_PASSWORD,
    'SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD not configured — skipping bill E2E'
  );

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('bill page navigation shows room grid', async ({ page }) => {
    // Click sidebar bill nav
    await page.click('button[data-action="showPage"][data-page="bill"]');

    // Room grid should appear and populate (RTDB subscription)
    const grid = page.locator('#billRoomGrid');
    await expect(grid).toBeVisible({ timeout: 10_000 });

    // Grid must not be stuck on the loading placeholder
    await expect(grid).not.toContainText('กำลังโหลด...', { timeout: 15_000 });
  });

  test('fixture room 15 card is visible in the grid', async ({ page }) => {
    await page.click('button[data-action="showPage"][data-page="bill"]');

    // Wait for room 15 card (data-room attribute is set by dashboard-bill-room-grid.js)
    const room15 = page.locator(`.bill-room-card[data-room="${FIXTURE_ROOM}"]`);
    await expect(room15).toBeVisible({ timeout: 20_000 });

    // Card shows the room number text inside .bc-num
    await expect(room15.locator('.bc-num')).toContainText(FIXTURE_ROOM);
  });

  test('clicking room 15 opens bill detail with room number', async ({ page }) => {
    await page.click('button[data-action="showPage"][data-page="bill"]');

    const room15 = page.locator(`.bill-room-card[data-room="${FIXTURE_ROOM}"]`);
    // Robust click — the RTDB grid re-renders the card under the click on cold loads.
    await openBillRoomDetail(page, room15);

    // Room number header must match the fixture
    const roomNum = page.locator('#fpRoomNum');
    await expect(roomNum).toContainText(FIXTURE_ROOM, { timeout: 10_000 });
  });

  test('bill detail shows payment status badge', async ({ page }) => {
    await page.click('button[data-action="showPage"][data-page="bill"]');

    const room15 = page.locator(`.bill-room-card[data-room="${FIXTURE_ROOM}"]`);
    await openBillRoomDetail(page, room15);

    // Payment status badge — one of the three possible states
    const badge = page.locator('#fpPaidBadge');
    await expect(badge).toBeVisible({ timeout: 10_000 });
    const badgeText = await badge.textContent();
    const validStatuses = ['ชำระแล้ว', 'ยังไม่ชำระ', 'รอตรวจสลิป'];
    const hasValidStatus = validStatuses.some(s => badgeText.includes(s));
    expect(hasValidStatus, `Badge "${badgeText}" is not a known payment status`).toBe(true);
  });

  test('no permission-denied errors when loading bills', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('permission-denied')) {
        errors.push(msg.text());
      }
    });

    await page.click('button[data-action="showPage"][data-page="bill"]');
    const room15 = page.locator(`.bill-room-card[data-room="${FIXTURE_ROOM}"]`);
    await expect(room15).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_000); // let subscriptions settle

    const permErrors = errors.filter(e => /permission-denied/.test(e));
    expect(permErrors, `RTDB permission errors: ${permErrors.join('\n')}`).toHaveLength(0);
  });
});
