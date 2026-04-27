/**
 * fixLegacyBillBuilding — one-shot migration that rewrites legacy RTDB bills
 * whose `building` field is the company display name ("เดอะ กรีน เฮฟเว่น" /
 * "Nest · เดอะ กรีน เฮฟเว่น") back to the canonical id ('rooms' / 'nest').
 *
 * Why: tenant_app's _hydrateTenantFromLocalStorage filter normalizes on read
 * (`session_2026_04_26_roomconfig_ssot_bill_fix.md`), but the RTDB subscription
 * callback doesn't, and downstream readers (charts, exports) compare on the
 * raw field. Stale display-name values are dead-end data — easier to migrate
 * once than to thread normalization everywhere.
 *
 * Bills written after commit `ad7dfc6` (2026-04-26 20:32 +0700) already use the
 * canonical id; this migration handles the pre-fix tail.
 *
 * Auth: admin only via `requireAdmin`.
 * Default: dry-run. Pass `?apply=1` to actually write.
 *
 * Reports: { dryRun, scanned, wouldFix, fixed, samples }.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAdmin } = require('./_auth');

if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();

function normalize(rawBuilding) {
  if (!rawBuilding) return null;
  const s = String(rawBuilding).toLowerCase();
  if (s === 'rooms' || s === 'nest') return null; // already canonical
  if (s.includes('nest')) return 'nest';
  return 'rooms';
}

exports.fixLegacyBillBuilding = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 300 })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    const apply = req.query.apply === '1' || req.query.apply === 'true';

    try {
      const stats = { scanned: 0, wouldFix: 0, fixed: 0, samples: [] };

      for (const buildingPath of ['rooms', 'nest']) {
        const snap = await rtdb.ref(`bills/${buildingPath}`).once('value');
        const buildings = snap.val() || {};
        for (const roomId of Object.keys(buildings)) {
          const bills = buildings[roomId] || {};
          for (const billId of Object.keys(bills)) {
            stats.scanned++;
            const bill = bills[billId];
            const canonical = normalize(bill.building);
            if (canonical === null) continue; // already correct OR field missing
            if (canonical !== buildingPath) {
              // Path says one thing but content normalizes to another — log + skip
              console.warn(`Skip path-mismatch: bills/${buildingPath}/${roomId}/${billId} field=${bill.building} → ${canonical}`);
              continue;
            }
            stats.wouldFix++;
            if (stats.samples.length < 5) {
              stats.samples.push({ path: `${buildingPath}/${roomId}/${billId}`, was: bill.building, become: canonical });
            }
            if (apply) {
              await rtdb.ref(`bills/${buildingPath}/${roomId}/${billId}/building`).set(canonical);
              stats.fixed++;
            }
          }
        }
      }

      console.log(`✅ fixLegacyBillBuilding (${apply ? 'APPLY' : 'DRY-RUN'}) by ${decoded.email}:`, stats);
      return res.status(200).json({ success: true, dryRun: !apply, ...stats });
    } catch (e) {
      console.error('fixLegacyBillBuilding failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });
