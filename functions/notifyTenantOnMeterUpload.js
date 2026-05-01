/**
 * notifyTenantOnMeterUpload — HTTPS callable: pushes LINE Flex bill
 * notification for a freshly written meter_data doc.
 *
 * Why callable (not Firestore trigger):
 *   Firestore lives in asia-southeast3 (Jakarta). Eventarc — the trigger
 *   backbone for both Gen1 and Gen2 Firestore triggers — does NOT list
 *   asia-southeast3 as a supported region (verified at deploy: "Trigger
 *   region 'asia-southeast3' is not supported"). This blocks every
 *   Firestore-trigger approach to auto-notify on meter writes.
 *
 *   The legacy generateBillsOnMeterUpdate (Gen1 Firestore trigger) is in
 *   the same boat — it's deployed but never fires for the current
 *   Firestore region, which is why bills haven't been auto-generated
 *   despite the trigger's existence.
 *
 *   HTTPS callable bypasses Eventarc entirely. Admin client calls this
 *   function after each successful meter_data write, getting auto-notify
 *   semantics without depending on a region we can't trigger on.
 *
 * Why this exists (architectural):
 *   meter_data (Firestore) is the single source of truth for bill content.
 *   Bills are derived views — both admin "บิล & ชำระ" and tenant_app
 *   render amounts by computing on the fly from meter_data + rooms_config.
 *
 * Auth:
 *   Admin custom claim required. Tenant clients can't trigger this.
 *
 * Idempotency:
 *   meter_data/{docId}.notifiedAt is written after a successful push.
 *   Repeat calls with the same docId early-exit when meter values
 *   haven't changed since last notify.
 *
 *   Coordinates with notifyBillOnCreate via meter_data.notifiedAt: that
 *   CF reads this field and skips when set, preventing double pushes if
 *   the legacy bills/ chain ever does fire.
 *
 * Setup:
 *   firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN  (already set)
 * Deploy:
 *   firebase deploy --only functions:notifyTenantOnMeterUpload
 *
 * Caller payload (from approvePendingImportWithFirebase):
 *   { docId: "rooms_69_5_15" }
 *   or
 *   { building, year, month, roomId }   — function builds docId itself
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const { loadRoomConfig, computeBill, buildBillFlex } = require('./_billFlex');

const LINE_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');

function meterValuesEqual(a, b) {
  if (!a || !b) return false;
  return Number(a.eOld) === Number(b.eOld) &&
         Number(a.eNew) === Number(b.eNew) &&
         Number(a.wOld) === Number(b.wOld) &&
         Number(a.wNew) === Number(b.wNew);
}

async function notifyOne({ docId, force = false }) {
  const docRef = firestore.collection('meter_data').doc(docId);
  const snap = await docRef.get();
  if (!snap.exists) {
    return { docId, skipped: 'doc_not_found' };
  }
  const data = snap.data() || {};

  // Idempotency: already notified for these meter values → skip (unless force)
  if (!force && data.notifiedAt && data.lastNotifiedSignature ===
      `${data.eOld}|${data.eNew}|${data.wOld}|${data.wNew}`) {
    return { docId, skipped: 'already_notified' };
  }

  const building = data.building;
  const roomId   = data.roomId != null ? String(data.roomId) : null;
  const year     = data.year;
  const month    = data.month;
  if (!building || !roomId || year == null || month == null) {
    return { docId, skipped: 'missing_fields' };
  }

  const cfg  = await loadRoomConfig(building, roomId);
  const bill = computeBill({
    building, roomId, year, month,
    eOld: data.eOld, eNew: data.eNew, wOld: data.wOld, wNew: data.wNew
  }, cfg);
  if (!bill) {
    return { docId, skipped: 'rent_zero' };
  }

  const token = LINE_TOKEN.value();
  if (!token) {
    return { docId, skipped: 'no_line_token' };
  }

  let usersSnap;
  try {
    usersSnap = await firestore.collection('liffUsers')
      .where('building', '==', building)
      .where('room',     '==', String(roomId))
      .where('status',   '==', 'approved')
      .get();
  } catch (e) {
    return { docId, error: `liffUsers_query_failed: ${e.message}` };
  }

  if (usersSnap.empty) {
    await docRef.update({
      notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      notifiedSkipReason: 'no_approved_tenant',
      lastNotifiedSignature: `${data.eOld}|${data.eNew}|${data.wOld}|${data.wNew}`
    });
    return { docId, skipped: 'no_approved_tenant' };
  }

  const flexMsg = buildBillFlex(bill);
  const { enqueueLineRetry } = require('./_lineRetry');
  const results = await Promise.allSettled(usersSnap.docs.map(udoc => {
    const lineUserId = udoc.id;
    return fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: lineUserId, messages: [flexMsg] })
    }).then(r => r.ok
      ? Promise.resolve(lineUserId)
      : r.text().then(t => Promise.reject({ lineUserId, error: new Error(`LINE ${r.status}: ${t}`) }))
    );
  }));

  const pushed   = results.filter(r => r.status === 'fulfilled').length;
  const failures = results.filter(r => r.status === 'rejected').map(r => r.reason);

  for (const f of failures) {
    const userId = f?.lineUserId || 'unknown';
    const errMsg = f?.error?.message || String(f);
    await enqueueLineRetry({
      lineUserId: userId,
      message: flexMsg,
      context: { source: 'notifyTenantOnMeterUpload', building, roomId, docId, year, month },
      idempotencyKey: `meter-${building}-${roomId}-${year}-${month}-${userId}`,
      error: errMsg
    });
  }

  if (pushed > 0) {
    await docRef.update({
      notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      notifiedCount: pushed,
      lastNotifiedSignature: `${data.eOld}|${data.eNew}|${data.wOld}|${data.wNew}`
    });
  }

  return { docId, pushed, failed: failures.length };
}

exports.notifyTenantOnMeterUpload = onCall(
  {
    region: 'asia-southeast1',
    secrets: [LINE_TOKEN]
  },
  async (request) => {
    if (!request.auth || !request.auth.token?.admin) {
      throw new HttpsError('permission-denied', 'Admin claim required');
    }

    const { docIds, docId, building, year, month, roomId, force } = request.data || {};

    let ids = [];
    if (Array.isArray(docIds) && docIds.length) {
      ids = docIds.filter(Boolean);
    } else if (docId) {
      ids = [docId];
    } else if (building && year != null && month != null && roomId) {
      ids = [`${building}_${year}_${month}_${roomId}`];
    } else {
      throw new HttpsError('invalid-argument', 'Provide docId, docIds[], or {building,year,month,roomId}');
    }

    const results = [];
    for (const id of ids) {
      try {
        results.push(await notifyOne({ docId: id, force: !!force }));
      } catch (e) {
        results.push({ docId: id, error: e.message });
      }
    }

    const pushed = results.reduce((s, r) => s + (r.pushed || 0), 0);
    const failed = results.reduce((s, r) => s + (r.failed || 0), 0);
    const skipped = results.filter(r => r.skipped).length;
    console.log(`📨 notifyTenantOnMeterUpload: ${ids.length} docs → ${pushed} pushed, ${failed} failed, ${skipped} skipped`);

    return { count: ids.length, pushed, failed, skipped, results };
  }
);
