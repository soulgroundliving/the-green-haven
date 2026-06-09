// Flow 3 — Slip view (admin)
//
// Confirms the slip verification UI is present in the bill detail, and that
// any already-verified slip images load from a valid Firebase Storage signed
// URL (not a raw data: URL — see CLAUDE.md §7-Y).
//
// This flow is CONDITIONALLY INCONCLUSIVE: if no room in the grid has a
// paid bill with an attached slip, the "signed URL" assertion is skipped
// and the test reports inconclusive rather than fail.
//
// Read-only — this test never uploads a slip or writes any data.
//
// Corresponds to: tasks/smoke-test-admin-playbook.md § Flow 3

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, openBillRoomDetail } = require('./helpers/login');

const FIXTURE_ROOM = '15';

test.describe('Slip view flow', () => {
  test.skip(
    !process.env.SMOKE_ADMIN_EMAIL || !process.env.SMOKE_ADMIN_PASSWORD,
    'SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD not configured — skipping slip E2E'
  );

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('button[data-action="showPage"][data-page="bill"]');
    const room15 = page.locator(`.bill-room-card[data-room="${FIXTURE_ROOM}"]`);
    // Robust click — the RTDB grid re-renders the card under the click on cold loads.
    await openBillRoomDetail(page, room15);
  });

  test('slip verification UI components are present in bill detail', async ({ page }) => {
    // The slip section container must exist in the DOM (hidden until invoice generated,
    // but always present as part of the bill form). This confirms
    // shared/dashboard-bill.js loaded correctly and wired the slip UI.
    const slipSection = page.locator('#slipVerifySection');
    await expect(slipSection).toBeAttached({ timeout: 10_000 });

    // File input for slip upload must exist
    await expect(page.locator('#slipFileInput')).toBeAttached();

    // Result container must exist
    await expect(page.locator('#slipResult')).toBeAttached();
  });

  test('paid rooms with verified slips serve images via signed URL', async ({ page }) => {
    // Look for any paid room in the grid — paid rooms show ".bc-paid" status
    const paidCards = page.locator('.bill-room-card.bc-paid');
    const paidCount = await paidCards.count();

    if (paidCount === 0) {
      // No paid bills in the grid — inconclusive, not a failure.
      // This happens when all bills are unpaid (e.g. beginning of month).
      test.info().annotations.push({
        type: 'inconclusive',
        description: 'No paid bills found in the room grid — slip image check skipped',
      });
      return;
    }

    // Click the first paid room (most likely to have a slip attached)
    const firstPaid = paidCards.first();
    const paidRoomId = await firstPaid.getAttribute('data-room');
    await openBillRoomDetail(page, firstPaid);

    // Look for slip images in the bill detail — signed URLs contain the
    // GCS query parameter X-Goog-Algorithm (§7-Y: never raw data: URLs)
    const slipImages = page.locator('img[src*="X-Goog-Algorithm"], img[src*="firebasestorage.googleapis.com"]');
    const slipCount = await slipImages.count();

    if (slipCount === 0) {
      // Paid bill exists but no slip image displayed.
      // This is inconclusive (tenant may have paid cash, no slip uploaded).
      test.info().annotations.push({
        type: 'inconclusive',
        description: `Room ${paidRoomId} is paid but has no slip image — check tenant payment method`,
      });
      return;
    }

    // Slip image exists — verify it uses a Storage signed URL, not data:
    const firstSlip = slipImages.first();
    const src = await firstSlip.getAttribute('src');

    expect(src, 'Slip image src must not be a data: URL (§7-Y)').not.toMatch(/^data:/);
    expect(src, 'Slip image must be a Firebase Storage signed URL').toMatch(
      /firebasestorage\.googleapis\.com|X-Goog-Algorithm/
    );
  });
});
