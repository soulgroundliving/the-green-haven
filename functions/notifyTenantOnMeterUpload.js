/**
 * notifyTenantOnMeterUpload — Firestore (Gen2) trigger: pushes LINE Flex
 * bill notification the moment a meter_data doc is written.
 *
 * Why Gen2:
 *   Firestore lives in asia-southeast3 (Jakarta). Gen1 Firestore triggers
 *   only support asia-southeast1, so a Gen1 trigger on this collection
 *   fails at deploy with "region asia-southeast3 not supported". Gen2
 *   triggers are region-aware and can listen to asia-southeast3 from a
 *   function deployed in asia-southeast1.
 *
 * Why this exists (architectural):
 *   meter_data (Firestore) is the single source of truth for bill content.
 *   Bills are derived views — both admin "บิล & ชำระ" and tenant_app render
 *   amounts by reading meter_data + rooms_config and computing on the fly.
 *
 *   The legacy chain went meter_data → generateBillsOnMeterUpdate → RTDB
 *   bills/ → notifyBillOnCreate. That made bills/ feel like a SoT and added
 *   two failure points between upload and tenant notification. This CF
 *   short-circuits to LINE directly so tenants are notified on upload even
 *   if the bills/ chain fails or is later removed.
 *
 * Idempotency:
 *   meter_data/{docId}.notifiedAt is written after a successful push. The
 *   trigger early-exits if the meter values haven't changed.
 *
 *   Coordinates with notifyBillOnCreate via meter_data.notifiedAt: that CF
 *   reads this field and skips when set, preventing double pushes from the
 *   legacy chain that may still be live.
 *
 * Setup:
 *   firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN  (already set)
 * Deploy:
 *   firebase deploy --only functions:notifyTenantOnMeterUpload
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const { loadRoomConfig, computeBill, buildBillFlex } = require('./_billFlex');

const LINE_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');

function parseDocId(id) {
  const parts = String(id).split('_');
  if (parts.length < 4) return null;
  const building = parts[0];
  const year     = Number(parts[1]);
  const month    = Number(parts[2]);
  const roomId   = parts.slice(3).join('_'); // handle roomIds with underscores
  if (!building || isNaN(year) || isNaN(month)) return null;
  return { building, roomId, year, month };
}

function meterValuesEqual(a, b) {
  if (!a || !b) return false;
  return Number(a.eOld) === Number(b.eOld) &&
         Number(a.eNew) === Number(b.eNew) &&
         Number(a.wOld) === Number(b.wOld) &&
         Number(a.wNew) === Number(b.wNew);
}

exports.notifyTenantOnMeterUpload = onDocumentWritten(
  {
    document: 'meter_data/{docId}',
    region: 'asia-southeast1',
    secrets: [LINE_TOKEN]
  },
  async (event) => {
    const docId = event.params.docId;
    const after  = event.data?.after?.data() || null;
    const before = event.data?.before?.data() || null;

    if (!after) {
      return null; // deleted — ignore
    }

    // Idempotency #1: already notified for these meter values → skip
    if (after.notifiedAt && meterValuesEqual(after, before)) {
      console.log(`⏭ ${docId} already notified, values unchanged — skip`);
      return null;
    }

    // Idempotency #2: write that ONLY touches notifiedAt itself (recursive trigger) → skip
    if (before && meterValuesEqual(after, before) &&
        before.notifiedAt !== after.notifiedAt) {
      return null;
    }

    // Resolve building/year/month/roomId — prefer doc fields, fall back to docId parse
    let building = after.building;
    let roomId   = after.roomId != null ? String(after.roomId) : null;
    let year     = after.year;
    let month    = after.month;
    if (!building || !roomId || year == null || month == null) {
      const parsed = parseDocId(docId);
      if (!parsed) {
        console.warn(`❌ cannot parse meter_data id: ${docId}`);
        return null;
      }
      building = parsed.building;
      roomId   = parsed.roomId;
      year     = parsed.year;
      month    = parsed.month;
    }

    const cfg  = await loadRoomConfig(building, roomId);
    const bill = computeBill({
      building, roomId, year, month,
      eOld: after.eOld, eNew: after.eNew, wOld: after.wOld, wNew: after.wNew
    }, cfg);
    if (!bill) {
      console.log(`⏭ ${building}/${roomId} rent=0 (vacant or misconfigured) — skip`);
      return null;
    }

    const token = LINE_TOKEN.value();
    if (!token) {
      console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN not set — skip notify');
      return null;
    }

    let usersSnap;
    try {
      usersSnap = await firestore.collection('liffUsers')
        .where('building', '==', building)
        .where('room',     '==', String(roomId))
        .where('status',   '==', 'approved')
        .get();
    } catch (e) {
      console.error(`❌ liffUsers query failed for ${building}/${roomId}:`, e.message);
      return null;
    }

    if (usersSnap.empty) {
      console.log(`ℹ️ No approved LINE-linked tenant for ${building}/${roomId} — skip`);
      // Still mark notifiedAt so we don't keep retrying when a tenant gets approved later;
      // approval flow will re-fetch bills via tenant_app's meter_data subscription.
      if (event.data?.after?.ref) {
        await event.data.after.ref.update({
          notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          notifiedSkipReason: 'no_approved_tenant'
        });
      }
      return null;
    }

    const flexMsg = buildBillFlex(bill);
    const { enqueueLineRetry } = require('./_lineRetry');
    const results = await Promise.allSettled(usersSnap.docs.map(doc => {
      const lineUserId = doc.id;
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
    if (failures.length) {
      console.warn(`⚠️ notify failures for ${building}/${roomId} (queued for retry):`, failures.length);
    }

    if (pushed > 0 && event.data?.after?.ref) {
      await event.data.after.ref.update({
        notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        notifiedCount: pushed
      });
      console.log(`📨 Meter-upload notify sent to ${pushed} user(s) for ${building}/${roomId}/${year}-${month}`);
    }

    return { pushed, failed: failures.length };
  }
);
