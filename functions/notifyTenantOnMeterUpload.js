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
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { assignInvoiceNo } = require('./_invoiceCounter');
const { appendActionAudit } = require('./_actionAudit');
const { writeBillOnIssue } = require('./_billWrite');

const LINE_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');

function meterValuesEqual(a, b) {
  if (!a || !b) return false;
  return Number(a.eOld) === Number(b.eOld) &&
         Number(a.eNew) === Number(b.eNew) &&
         Number(a.wOld) === Number(b.wOld) &&
         Number(a.wNew) === Number(b.wNew);
}

/**
 * Get-or-mint the gapless invoice number for this (building, room, period) and
 * persist the immutable invoices/{key} document-of-record + a BILL_ISSUED audit
 * row, all in ONE transaction (Roadmap 1.2).
 *
 * Deterministic key invoices/{building}_{room}_{period} makes a re-notify (meter
 * correction / force) idempotent: the same period returns the SAME number and
 * burns no counter, so the INV- sequence stays gapless. A genuine correction is
 * handled by void + re-issue (Phase 1.3), not by overwriting this snapshot.
 *
 * `bill.year` is already a 4-digit BE (computeBill normalizes 2-digit → BE), so
 * it doubles as the counter's BE year and avoids the §7-E year-format trap.
 *
 * @returns {Promise<string>} the INV- number (existing or freshly minted).
 */
async function issueInvoiceNo({ building, roomId, bill, auditActor }) {
  const be = Number(bill.year); // computeBill already normalized to 4-digit BE
  const period = `${be}${String(bill.month).padStart(2, '0')}`;
  const safeRoom = String(roomId).replace(/[\/.#$\[\]]/g, '_');
  const key = `${building}_${safeRoom}_${period}`;
  const invoiceRef = firestore.collection('invoices').doc(key);

  return firestore.runTransaction(async (tx) => {
    // READ 1 (dedup) — before any write, per all-reads-before-writes.
    const existing = await tx.get(invoiceRef);
    if (existing.exists && existing.data().invoiceNo) {
      // A VOIDED invoice must NOT be silently reused — re-issuing a corrected
      // invoice (new number, reissueOf) is a deliberate admin action, not an
      // auto-renotify side effect (Phase 1.3). Skip minting; the Flex falls back
      // to the legacy ref until the admin re-issues.
      if (existing.data().status === 'void') return null;
      return existing.data().invoiceNo; // idempotent re-notify — no counter burn
    }

    // READ 2 + first WRITE — mint from the gapless per-building/BE counter.
    const { invoiceNo } = await assignInvoiceNo(tx, firestore, { building, be });

    tx.set(invoiceRef, {
      invoiceNo,
      building,
      room: String(roomId),
      period,
      be,
      month: Number(bill.month),
      status: 'issued',
      amount: Number(bill.totalCharge) || 0,
      charges: {
        rent:     Number(bill.rent)   || 0,
        electric: Number(bill.eCost)  || 0,
        water:    Number(bill.wCost)  || 0,
        trash:    Number(bill.trash)  || 0,
        eUnits:   Number(bill.eUnits) || 0,
        wUnits:   Number(bill.wUnits) || 0,
      },
      issuedAt: admin.firestore.FieldValue.serverTimestamp(),
      issuedBy: (auditActor && auditActor.actor) || 'system',
    });

    appendActionAudit(tx, firestore, {
      actor:      (auditActor && auditActor.actor) || 'system',
      actorEmail: (auditActor && auditActor.actorEmail) || null,
      actorRole:  (auditActor && auditActor.actorRole) || null,
      action:     'BILL_ISSUED',
      targetType: 'invoice',
      targetId:   invoiceNo,
      building,
      roomId:     String(roomId),
      after:      { period, amount: Number(bill.totalCharge) || 0 },
      ip:         (auditActor && auditActor.ip) || null,
      source:     'cf:notifyTenantOnMeterUpload',
      idempotencyKey: `invoice-${key}`, // one BILL_ISSUED row per invoice, ever
    });

    return invoiceNo;
  });
}

async function notifyOne({ docId, force = false, auditActor = null }) {
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

  const tenantSnap = await firestore.collection('tenants').doc(building).collection('list').doc(String(roomId)).get();
  const tenantData = tenantSnap.exists ? (tenantSnap.data() || {}) : {};
  const tenantName = tenantData.name || '';

  const { docs: userDocs, error: lookupErr } = await lookupApprovedRoomUsers(firestore, building, roomId);
  if (lookupErr) return { docId, error: lookupErr };

  if (!userDocs.length) {
    await docRef.update({
      notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      notifiedSkipReason: 'no_approved_tenant',
      lastNotifiedSignature: `${data.eOld}|${data.eNew}|${data.wOld}|${data.wNew}`
    });
    return { docId, skipped: 'no_approved_tenant' };
  }

  // Mint the gapless invoice number + persist the document-of-record at the real
  // issuance moment — AFTER the no-approved-tenant guard so a recipient-less room
  // never burns a number. Non-fatal: the counter tx is atomic (a failure creates
  // no gap), and a tenant must still be notified — the Flex falls back to the
  // legacy ref and the next re-notify mints the number.
  let invoiceNo = null;
  try {
    invoiceNo = await issueInvoiceNo({ building, roomId, bill, auditActor });
  } catch (e) {
    console.error('[notifyTenantOnMeterUpload] issueInvoiceNo failed for', docId, ':', e?.message || e);
  }

  // Option C (2026-06-08): admin "อนุมัติ meter import" = ออกบิล. Create the ONE
  // canonical RTDB bill (status 'pending') so admin dashboard + tenant app read +
  // update the SAME doc — RTDB is SoT, the client synth twin auto-dedups by
  // year+month. Idempotent + never overwrites a paid/manual bill + §7-BBB move-in
  // boundary (all inside _billWrite). Best-effort: a failure here must NOT break
  // the LINE notify (the primary job) — a re-notify or the backfill retries.
  let billWrite = null;
  try {
    billWrite = await writeBillOnIssue({ building, roomId, bill, invoiceNo, tenantData, meterDocId: docId });
  } catch (e) {
    console.error('[notifyTenantOnMeterUpload] writeBillOnIssue failed for', docId, ':', e?.message || e);
  }

  const flexMsg = buildBillFlex(bill, { tenantName, invoiceNo });
  const { pushed, failed: failedCount } = await pushAndRetry({
    docs: userDocs,
    message: flexMsg,
    token,
    source: 'notifyTenantOnMeterUpload',
    context: { building, roomId, docId, year, month },
    idempotencyKeyFn: (userId) => `meter-${building}-${roomId}-${year}-${month}-${userId}`,
  });

  if (pushed > 0) {
    await docRef.update({
      notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      notifiedCount: pushed,
      lastNotifiedSignature: `${data.eOld}|${data.eNew}|${data.wOld}|${data.wNew}`
    });
  }

  return { docId, pushed, failed: failedCount, bill: (billWrite && billWrite.action) || null, billId: (billWrite && billWrite.billId) || null };
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

    // Server-stamped actor for the BILL_ISSUED audit row (never client-supplied).
    const _tok = request.auth.token || {};
    const auditActor = {
      actor: request.auth.uid,
      actorEmail: _tok.email || null,
      actorRole: _tok.admin === true ? 'admin' : (_tok.role || null),
      ip: request.rawRequest?.ip || null,
    };

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
        results.push(await notifyOne({ docId: id, force: !!force, auditActor }));
      } catch (e) {
        results.push({ docId: id, error: e.message });
      }
    }

    const pushed = results.reduce((s, r) => s + (r.pushed || 0), 0);
    const failed = results.reduce((s, r) => s + (r.failed || 0), 0);
    const skipped = results.filter(r => r.skipped).length;
    return { count: ids.length, pushed, failed, skipped, results };
  }
);
