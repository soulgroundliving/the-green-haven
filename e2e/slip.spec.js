// Flow 3 — Slip view (admin)
//
// Confirms the admin slip-verification UI is present in the bill detail.
//
// WHY there is no "signed-URL slip image" assertion here (fixme removed 2026-06-10):
// the admin bill UI renders verified-slip data as METADATA TEXT only
// (ผู้โอน · ฿amount · ref · date — see shared/dashboard-bill.js showPayDetail
// and dashboard-bill-slip-verify.js #slipResult). It NEVER renders a stored
// slip IMAGE. Stored slip images are only shown in the tenant LIFF payment
// history. So the §7-Y "stored slip images load from a Storage signed URL,
// never data:" invariant is not observable on the admin side — it is owned by
// the tenant LIFF playbook (tasks/smoke-test-liff-playbook.md Flow 3, manual)
// and the data layer (npm run smoke). A prior `test.fixme` here asserted a
// non-existent admin behavior (clicking a paid card to find a slip <img>) and
// was removed. The cross-cutting §7-Y "any Storage-hosted <img> must be signed"
// invariant is guarded deterministically by e2e/signed-url.spec.js.
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
});
