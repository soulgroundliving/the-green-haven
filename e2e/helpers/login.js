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
  await expect(page.locator('#loginBtn')).toBeVisible({ timeout: 15_000 });

  // Gate the submit on Firebase being initialized. login.html's handleLogin()
  // returns EARLY (shows the transient "กำลังโหลด… โปรดรอสักครู่" message and does
  // NOT sign in) while window.firebaseReady is false. firebaseReady flips true
  // only after /api/config — a Vercel SERVERLESS function, and therefore COLD
  // right after the deploy that triggers this suite (deployment_status) —
  // resolves and the Firebase SDK finishes init (login.html:750). Clicking
  // before then is a silent no-op: no sign-in, no redirect, so the waitForURL
  // below just times out. This race was the root cause of the cold-deploy E2E
  // flakiness (most logins passed, a couple failed on the coldest builds).
  // Gating here makes the submit deterministic regardless of cold-start latency.
  try {
    await page.waitForFunction(() => window.firebaseReady === true, undefined, { timeout: 30_000 });
  } catch (_) {
    throw new Error(
      'login.html never set window.firebaseReady=true within 30s — Firebase failed ' +
      'to initialize, usually because /api/config (Vercel serverless) was down or ' +
      'returned a bad/empty config on a fresh deploy. This is an infra/deploy ' +
      'problem, NOT a test or code regression.'
    );
  }

  // Fill + submit + await the dashboard redirect as ONE unit so a retry re-does
  // the whole thing with fresh field values. Vercel serves /dashboard (no .html
  // extension) but also accepts /dashboard.html, so match both. We deliberately
  // do NOT race waitForURL against #errorMessage, because login.html reuses
  // #errorMessage for the transient "กำลังโหลด…" state during sign-in — racing it
  // produced false "login failed" results on slow loads.
  const submitAndAwaitRedirect = async () => {
    await page.fill('#loginEmail', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginBtn');
    await page.waitForURL(/\/dashboard(\.html)?([?#]|$)/, { timeout: 45_000 });
  };

  try {
    await submitAndAwaitRedirect();
  } catch (navErr) {
    // No redirect. If login.html surfaced a genuine auth error, report it as an
    // account/secret problem (not a code regression). Exclude the transient
    // loading wording defensively so only a real auth error is actionable.
    const msg = ((await page.locator('#errorMessage').textContent().catch(() => '')) || '').trim();
    if (msg && !/กำลังโหลด|โปรดรอ|loading/i.test(msg)) {
      throw new Error(
        `Admin login failed — login page reported: "${msg}". The SMOKE_ADMIN_EMAIL/` +
        'SMOKE_ADMIN_PASSWORD account is invalid, has the wrong password, or lacks the ' +
        'admin custom claim. This is an account/secret issue, NOT a code regression — ' +
        'verify the GitHub secret, and run tools/grant-admin-claim.js if the claim is missing.'
      );
    }
    // No genuine error shown → the submit was almost certainly a transient no-op
    // (a redirect that never started). Re-submit ONCE with a fresh budget; by now
    // firebaseReady is true and /api/config is warm, so this resolves quickly.
    await submitAndAwaitRedirect();
  }

  // Sidebar presence confirms the dashboard rendered successfully
  await expect(
    page.locator('button[data-action="showPage"][data-page="bill"]')
  ).toBeVisible({ timeout: 15_000 });

  // Dismiss the first-run onboarding tour (shared/onboarding-tour.js). It drops
  // a full-page .gh-tour-overlay that intercepts pointer events, so every
  // subsequent sidebar/nav click times out. The tour is gated by a localStorage
  // "seen" flag, so a fresh CI browser shows it on EVERY run. Escape triggers the
  // tour's own finish() → removes the overlay. Best-effort: if no tour appears
  // (already seen), the wait just times out and we proceed.
  const tourOverlay = page.locator('.gh-tour-overlay');
  try {
    await tourOverlay.waitFor({ state: 'visible', timeout: 6_000 });
    await page.keyboard.press('Escape');
    await tourOverlay.waitFor({ state: 'detached', timeout: 5_000 });
  } catch (_) {
    // No tour shown, or it didn't dismiss — fall back to clicking the skip button.
    const skip = page.locator('.gh-tour-tooltip button', { hasText: /ข้าม|ปิด/ });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click().catch(() => {});
      await tourOverlay.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
    }
  }
}

// Open a Requests & Approvals sub-tab, resilient to the page's default-tab race.
// showPage('requests-approvals') schedules a switch BACK to the Maintenance tab
// ~80ms after navigation (dashboard-main.js:43). Maintenance is also the
// default-visible panel (no u-init-hide), so "wait until Maintenance is visible"
// resolves instantly — BEFORE that deferred timer — and an immediate sub-tab
// click then gets clobbered when the timer fires. Instead, retry the sub-tab
// click until the target panel actually STAYS visible: once the +80ms default
// has fired, a click sticks. No fixed waitForTimeout — deterministic via toPass.
//
// IMPORTANT: showPage is clicked ONCE, OUTSIDE the toPass. Re-clicking it on each
// retry re-arms the +80ms Maintenance re-flip timer every attempt, so the target
// panel keeps getting re-hidden (#requests-tab-* are u-init-hide+u-hidden, §7-SS)
// and the toPass never converges — a regression observed 2026-06-09 when this
// helper briefly re-clicked showPage inside the loop. Click it once; retry only
// the sub-tab switch.
async function openRequestsTab(page, tab) {
  await page.click('button[data-action="showPage"][data-page="requests-approvals"]');
  const panel = page.locator(`#requests-tab-${tab}`);
  await expect(async () => {
    await page.click(`button[data-action="switchRequestsTab"][data-tab="${tab}"]`);
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

// Click a bill room-grid card and wait for its detail panel to open. The bill
// room grid re-renders on every RTDB snapshot (dashboard-bill-room-grid.js), so
// a card can detach between the visibility check and the click, or a re-render
// can swallow the click before #billActiveRoom opens. Retrying the click+assert
// as a unit (same proven toPass pattern as openRequestsTab) makes it deterministic
// even under the cold-deploy render churn. Pass any .bill-room-card locator.
async function openBillRoomDetail(page, cardLocator) {
  await expect(cardLocator).toBeVisible({ timeout: 20_000 });
  const detail = page.locator('#billActiveRoom');
  await expect(async () => {
    await cardLocator.click({ timeout: 5_000 });
    await expect(detail).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

module.exports = { loginAsAdmin, openRequestsTab, openBillRoomDetail };
