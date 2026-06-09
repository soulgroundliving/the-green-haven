// §7-Y guard — Firebase Storage assets must load from SIGNED URLs (admin)
//
// CLAUDE.md §7-Y: a stored asset rendered from Storage must use a tokenized
// download URL (getDownloadURL → `?alt=media&token=…`) or a GCS signed URL
// (`X-Goog-Algorithm`/`Signature`), never a raw unsigned Storage path. An
// unsigned `/o/{path}?alt=media` 403s (Storage rejects it) — the same failure
// class as the lease-doc "renders the Storage PATH directly → 404" bug
// (shared/dashboard-tenant-lease.js _resolveContractHref).
//
// WHY this is a session-wide tripwire, not a single-surface assertion:
// the admin dashboard has NO page that passively renders a Storage-hosted
// <img> on load — every stored-image surface is a per-entity modal (tenant
// contract viewer, lease docs, deposit/booking evidence) opened on demand, and
// most legacy image flows (maintenance photos, housekeeping slips) are `data:`
// base64, which is NOT a §7-Y concern and must NOT be flagged. So instead of
// hunting one fragile, data-dependent surface, this guard watches EVERY request
// + every rendered <img>/<a> for the whole admin session and asserts the
// invariant only on URLs that actually hit a Firebase Storage host. It can
// never false-positive on `data:` (not a Storage URL) or download links to
// non-Storage origins, and it catches a regression wherever a Storage asset is
// served unsigned. If no Storage asset loads during the session it reports
// inconclusive (clean pass) — the data layer (npm run smoke) + the tenant LIFF
// playbook (Flow 3) remain the primary §7-Y coverage.
//
// Read-only — never uploads or writes any data.

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, openBillRoomDetail } = require('./helpers/login');

const FIXTURE_ROOM = '15';

// A URL pointing at a Firebase Storage object-download host.
function isFirebaseStorageUrl(url) {
  return /firebasestorage\.googleapis\.com\/|\.firebasestorage\.app\//i.test(url || '');
}

// A Storage URL is "signed" if it carries a Firebase download token or a GCS
// signature. getDownloadURL() always returns one of these; a raw/unsigned path
// has none (and 403s).
function isSignedStorageUrl(url) {
  return /[?&]token=|X-Goog-Algorithm=|[?&]Signature=/i.test(url || '');
}

// A request that actually serves object BYTES (vs an SDK metadata ping). The
// byte-serving download is the one §7-Y cares about — `?alt=media`.
function isStorageDownload(url) {
  return isFirebaseStorageUrl(url) && /[?&]alt=media/i.test(url);
}

test.describe('§7-Y — Storage assets use signed URLs (admin)', () => {
  test.skip(
    !process.env.SMOKE_ADMIN_EMAIL || !process.env.SMOKE_ADMIN_PASSWORD,
    'SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD not configured — skipping §7-Y E2E'
  );

  test('every Firebase Storage asset loaded by the admin is signed', async ({ page }) => {
    // Capture Storage downloads for the WHOLE session — including images that
    // load inside a modal and are torn down before the final DOM scan runs.
    const storageDownloads = [];
    page.on('response', (resp) => {
      const url = resp.url();
      if (isStorageDownload(url)) {
        storageDownloads.push({ url, status: resp.status(), signed: isSignedStorageUrl(url) });
      }
    });

    await loginAsAdmin(page);

    // Walk the deterministically-reachable surfaces. Room 15 exists and has bills
    // (verified fixture, lifecycle_smoke_test.md), so this never blind-waits on
    // absent data. openBillRoomDetail retries the card click under RTDB re-render.
    await page.click('button[data-action="showPage"][data-page="bill"]');
    const room15 = page.locator(`.bill-room-card[data-room="${FIXTURE_ROOM}"]`);
    await openBillRoomDetail(page, room15);

    // Best-effort: visit People management — the surface most likely to expose a
    // Storage-backed tenant document/avatar. Never fail the guard if its sidebar
    // entry isn't present on this build; the assertion below stands on whatever
    // actually loaded.
    const peopleBtn = page.locator('button[data-action="showPage"][data-page="tenant"]');
    if (await peopleBtn.isVisible().catch(() => false)) {
      await peopleBtn.click().catch(() => {});
      // Bounded best-effort settle so async getDownloadURL() calls fire into the
      // response listener. NOT networkidle — this is a live Firebase app whose
      // Firestore/RTDB long-poll listeners may never reach idle (would hang the
      // full timeout). The network listener captures Storage downloads whenever
      // they resolve; this just gives in-flight ones a moment before the scan.
      await page.waitForTimeout(2500);
    }

    // DOM scan — every rendered <img>/<a href> pointing at a Storage host must be
    // signed (covers assets still present in the DOM at assertion time).
    const domUrls = await page
      .locator('img[src], a[href]')
      .evaluateAll((els) =>
        els
          .map((e) => e.getAttribute('src') || e.getAttribute('href') || '')
          .filter(Boolean)
      );

    const unsignedDom = domUrls.filter((u) => isStorageDownload(u) && !isSignedStorageUrl(u));
    const unsignedNet = storageDownloads.filter((h) => !h.signed);

    // The actual §7-Y assertions — these can only fire on a genuine Storage URL,
    // so a `data:` base64 image or a non-Storage link can never trip them.
    expect(
      unsignedNet,
      `Unsigned Firebase Storage download(s) served to admin (§7-Y): ${JSON.stringify(unsignedNet)}`
    ).toEqual([]);
    expect(
      unsignedDom,
      `Unsigned Firebase Storage URL(s) rendered in admin DOM (§7-Y): ${JSON.stringify(unsignedDom)}`
    ).toEqual([]);

    // Signal coverage: a green run with zero Storage assets is correct but
    // unexercised — record it so the report distinguishes "guard held" from
    // "guard never saw a Storage asset this run".
    const sawStorage = storageDownloads.length > 0 || domUrls.some(isStorageDownload);
    if (!sawStorage) {
      test.info().annotations.push({
        type: 'inconclusive',
        description:
          'No Firebase Storage asset loaded during the admin session — §7-Y invariant held vacuously',
      });
    }
  });
});
