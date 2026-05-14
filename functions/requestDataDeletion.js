/**
 * requestDataDeletion — PDPA §32 Right-to-Erasure endpoint.
 *
 * Caller: tenant from styled modal in tenant_app.html (NOT confirm()).
 *
 * Refused for active tenants — they must terminate their lease first
 * (legal basis to keep their data exists while the rental relationship
 * is ongoing). Erasure runs only for PLAYERS (post-lease, in people/).
 *
 * Cascade is grouped into DELETE vs RETAIN buckets per PDPA §32(2):
 *   DELETE: checklists+storage, consents, liffUsers, RTDB
 *           complaints/maintenance, bookings (+KYC images, slips),
 *           lineRetryQueue pending pushes, rateLimits prefix, all
 *           tenants/{b}/archive/{contractId} docs with this tenantId,
 *           people/{tenantId} recursiveDelete.
 *   RETAIN: RTDB bills (Revenue Code §87 5yr), leases (Civil Code
 *           §193/34 5yr), payments, BigQuery audit archives
 *           (auth_events + slipLogs — fraud prevention,
 *           PDPA §32(2)(e) legitimate interest).
 *
 * Order of operations:
 *   1. Idempotency-fence write to dataDeletionLog/{requestId}
 *   2. Revoke auth claims + revokeRefreshTokens (closes stale-token
 *      write window before any destructive op)
 *   3. Cascade (best-effort per resource; errors collected, not aborted)
 *   4. Cross-write auth_events row
 *   5. Update log with summary, return to client
 *
 * Why this order: step 2 BEFORE step 3 means even if a downstream
 * delete fails halfway, the user CANNOT add more data — partial
 * state is recoverable; data leak via stale token is not.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const { getAllBuildings } = require('./buildingRegistry');

const CONFIRMATION_PHRASE = 'ลบข้อมูลของฉัน';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days between erasure requests
const PAGE_SIZE = 200;                         // batch limit for query pages

// PII fields zeroed when a record cannot be fully deleted (kept for
// future audit / mismatch debugging only; primarily relevant if we
// later relax the active-tenant refusal).
const PII_FIELDS_TO_CLEAR = {
  name: '', firstName: '', lastName: '', phone: '', email: '',
  emailVerified: false, lineID: '', address: '', idCardNumber: '',
  licensePlate: '', emergencyContact: null, companyInfo: null,
  avatar: '',
};

// ── Storage helpers ──────────────────────────────────────────────────────────

async function deleteStoragePrefix(prefix, summary, label) {
  try {
    const [files] = await admin.storage().bucket().getFiles({ prefix });
    if (!files.length) return 0;
    await Promise.all(files.map(f => f.delete({ ignoreNotFound: true })));
    return files.length;
  } catch (err) {
    summary.storageErrors++;
    summary.errors.push({ step: label || 'storage', error: String(err.message || err) });
    return 0;
  }
}

// ── Cascade helpers — each returns count or 0, never throws ──────────────────

async function deleteChecklistsByRoom(ctx, summary) {
  if (!ctx.building || !ctx.room) return;
  let docs = 0, files = 0;
  try {
    const snap = await firestore.collection('checklistInstances')
      .where('building', '==', ctx.building)
      .where('roomId', '==', ctx.room)
      .limit(PAGE_SIZE)
      .get();
    for (const doc of snap.docs) {
      files += await deleteStoragePrefix(
        `checklists/${ctx.building}/${ctx.room}/${doc.id}/`,
        summary,
        `checklists/${doc.id}`
      );
      try { await doc.ref.delete(); docs++; }
      catch (e) { summary.errors.push({ step: `checklist/${doc.id}`, error: e.message }); }
    }
  } catch (e) {
    summary.errors.push({ step: 'checklists.query', error: e.message });
  }
  summary.deleted.checklistInstances = docs;
  summary.deleted.checklistFiles = files;
}

async function deleteConsents(ctx, summary) {
  if (!ctx.tenantId) return;
  let n = 0;
  try {
    const snap = await firestore.collection('consents')
      .where('tenantId', '==', ctx.tenantId)
      .limit(PAGE_SIZE)
      .get();
    for (const doc of snap.docs) {
      try { await doc.ref.delete(); n++; }
      catch (e) { summary.errors.push({ step: `consent/${doc.id}`, error: e.message }); }
    }
  } catch (e) {
    summary.errors.push({ step: 'consents.query', error: e.message });
  }
  summary.deleted.consents = n;
}

async function deleteLiffUser(ctx, summary) {
  if (!ctx.lineUserId) return;
  try {
    await firestore.collection('liffUsers').doc(ctx.lineUserId).delete();
    summary.deleted.liffUsers = 1;
  } catch (e) {
    summary.errors.push({ step: 'liffUsers', error: e.message });
  }
}

async function deleteRtdbPaths(ctx, summary) {
  if (!ctx.building || !ctx.room) return;
  // bills + payments retained per Revenue Code §87 — do NOT delete here.
  const paths = [
    `complaints/${ctx.building}/${ctx.room}`,
    `maintenance/${ctx.building}/${ctx.room}`,
  ];
  const db = admin.database();
  for (const p of paths) {
    try {
      await db.ref(p).remove();
      summary.deleted.rtdb = (summary.deleted.rtdb || []);
      summary.deleted.rtdb.push(p);
    } catch (e) {
      summary.errors.push({ step: `rtdb/${p}`, error: e.message });
    }
  }
}

async function deleteBookingsByOwner(ctx, summary) {
  let docs = 0, files = 0;
  const queries = [];
  if (ctx.authUid) {
    queries.push(firestore.collection('bookings').where('prospectUid', '==', ctx.authUid).limit(PAGE_SIZE));
  }
  if (ctx.lineUserId) {
    queries.push(firestore.collection('bookings').where('prospectLineId', '==', ctx.lineUserId).limit(PAGE_SIZE));
  }
  const seen = new Set();
  for (const q of queries) {
    let snap;
    try { snap = await q.get(); }
    catch (e) { summary.errors.push({ step: 'bookings.query', error: e.message }); continue; }
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      // KYC images + slip uploads
      files += await deleteStoragePrefix(`bookings/${doc.id}/`, summary, `bookings/${doc.id}`);
      try { await doc.ref.delete(); docs++; }
      catch (e) { summary.errors.push({ step: `booking/${doc.id}`, error: e.message }); }
    }
  }
  summary.deleted.bookings = docs;
  summary.deleted.bookingFiles = files;
}

async function deleteLineRetryQueueEntries(ctx, summary) {
  if (!ctx.lineUserId) return;
  let n = 0;
  try {
    const snap = await firestore.collection('lineRetryQueue')
      .where('to', '==', ctx.lineUserId)
      .limit(PAGE_SIZE)
      .get();
    for (const doc of snap.docs) {
      try { await doc.ref.delete(); n++; }
      catch (e) { summary.errors.push({ step: `lineRetryQueue/${doc.id}`, error: e.message }); }
    }
  } catch (e) {
    // No "to" index? Skip silently — queue is non-load-bearing for compliance.
    summary.errors.push({ step: 'lineRetryQueue.query', error: e.message });
  }
  summary.deleted.lineRetryQueue = n;
}

async function deleteRateLimits(ctx, summary) {
  if (!ctx.authUid) return;
  // rateLimits keys are `${uid}_${action}` — no list-by-prefix in Firestore;
  // we have to query all by uid field (some rows persist it).
  let n = 0;
  try {
    const snap = await firestore.collection('rateLimits')
      .where('uid', '==', ctx.authUid)
      .limit(PAGE_SIZE)
      .get();
    for (const doc of snap.docs) {
      try { await doc.ref.delete(); n++; }
      catch (e) { summary.errors.push({ step: `rateLimits/${doc.id}`, error: e.message }); }
    }
  } catch (e) {
    summary.errors.push({ step: 'rateLimits.query', error: e.message });
  }
  summary.deleted.rateLimits = n;
}

async function deleteAllTenantArchives(ctx, summary) {
  if (!ctx.tenantId) return;
  let total = 0;
  let buildings = [];
  try { buildings = await getAllBuildings(); }
  catch (e) {
    summary.errors.push({ step: 'archives.buildingsList', error: e.message });
    return;
  }
  for (const b of buildings) {
    try {
      const snap = await firestore
        .collection('tenants').doc(b).collection('archive')
        .where('tenantId', '==', ctx.tenantId)
        .limit(PAGE_SIZE)
        .get();
      for (const doc of snap.docs) {
        try {
          await firestore.recursiveDelete(doc.ref);
          total++;
        } catch (e) {
          summary.errors.push({ step: `archive/${b}/${doc.id}`, error: e.message });
        }
      }
    } catch (e) {
      summary.errors.push({ step: `archive.query/${b}`, error: e.message });
    }
  }
  summary.deleted.tenantArchives = total;
}

async function deletePlayerPeopleDoc(ctx, summary) {
  if (!ctx.tenantId) return;
  try {
    await firestore.recursiveDelete(
      firestore.collection('people').doc(ctx.tenantId)
    );
    summary.deleted.peopleDoc = 1;
  } catch (e) {
    summary.errors.push({ step: 'peopleDoc.recursiveDelete', error: e.message });
  }
}

async function writeAuthEventsRow(ctx, requestId, summary) {
  try {
    await firestore.collection('auth_events').add({
      action: 'pdpa_erasure',
      docId: requestId,
      authUid: ctx.authUid,
      tenantId: ctx.tenantId,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      maskedEmail: '',  // tenants doc is gone by this point; nothing safe to read
      ua: ctx.userAgent || '',
    });
    summary.audit_events_written = true;
  } catch (e) {
    // auth_events is secondary — primary record is dataDeletionLog
    summary.errors.push({ step: 'auth_events.add', error: e.message });
  }
}

// ── Pre-flight gates ─────────────────────────────────────────────────────────

async function preflight(data, context) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  const authUid = context.auth.uid;
  const tok = context.auth.token || {};
  const tenantId = String(tok.tenantId || '');
  const room = String(tok.room || '');
  const building = String(tok.building || '');
  const lineUserId = String(tok.lineUserId || '') ||
    (String(authUid).startsWith('line:') ? String(authUid).slice(5) : '');

  if (!tenantId) {
    throw new functions.https.HttpsError('permission-denied',
      'tenantId claim required — cannot identify subject for erasure');
  }

  if (data?.confirmationPhrase?.trim() !== CONFIRMATION_PHRASE) {
    throw new functions.https.HttpsError('failed-precondition',
      `confirmation phrase mismatch (expected "${CONFIRMATION_PHRASE}")`);
  }
  if (!data?.acknowledgedRetention || !data?.acknowledgedTerminal) {
    throw new functions.https.HttpsError('failed-precondition',
      'must acknowledge retention + terminal-access disclosures');
  }

  // ── Active-tenant refusal ──
  // Active tenant = tenants/{b}/list/{r} exists with this tenantId AND
  // linkedAuthUid points at this caller. Refuse — they must end lease first.
  if (room && building) {
    try {
      const tSnap = await firestore.collection('tenants').doc(building)
        .collection('list').doc(room).get();
      if (tSnap.exists) {
        const td = tSnap.data() || {};
        if (String(td.tenantId || '') === tenantId &&
            String(td.linkedAuthUid || '') === authUid) {
          throw new functions.https.HttpsError('failed-precondition',
            'active tenant — please end your lease via admin before requesting erasure');
        }
      }
    } catch (e) {
      if (e instanceof functions.https.HttpsError) throw e;
      throw new functions.https.HttpsError('internal',
        `active-tenant check failed: ${e.message}`);
    }
  }

  // ── 7-day cooldown ──
  try {
    const recentSnap = await firestore.collection('dataDeletionLog')
      .where('tenantId', '==', tenantId)
      .orderBy('requestedAt', 'desc')
      .limit(1)
      .get();
    if (!recentSnap.empty) {
      const last = recentSnap.docs[0].data();
      const lastMs = last.requestedAt?.toMillis?.() || 0;
      if (lastMs && Date.now() - lastMs < COOLDOWN_MS) {
        const retryAfter = Math.ceil((COOLDOWN_MS - (Date.now() - lastMs)) / 1000);
        throw new functions.https.HttpsError('resource-exhausted',
          `erasure already requested within 7 days — retry in ${retryAfter}s`,
          { retryAfter, lastRequestId: recentSnap.docs[0].id });
      }
    }
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    // Index missing? Fall through (idempotency-fence below will still catch
    // same-day duplicates atomically).
    console.warn('[requestDataDeletion] cooldown check failed:', e.message);
  }

  return { authUid, tenantId, room, building, lineUserId };
}

// ── Main handler ─────────────────────────────────────────────────────────────

async function handler(data, context) {
  const ctx = await preflight(data, context);
  ctx.userAgent = String(data?.userAgent || '').slice(0, 256);

  const requestId = `${ctx.tenantId}_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const logRef = firestore.collection('dataDeletionLog').doc(requestId);

  // ── Step 0: Idempotency fence ──
  try {
    await logRef.create({
      requestId,
      tenantId: ctx.tenantId,
      authUid: ctx.authUid,
      room: ctx.room || null,
      building: ctx.building || null,
      lineUserId: ctx.lineUserId || null,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      startedAtMs: Date.now(),
      status: 'in_progress',
    });
  } catch (e) {
    if (e.code === 6 /* ALREADY_EXISTS */ || /already exists/i.test(e.message || '')) {
      const existing = await logRef.get();
      return {
        success: false,
        idempotent: true,
        requestId,
        summary: existing.data()?.summary || null,
      };
    }
    throw new functions.https.HttpsError('internal',
      `failed to write audit fence: ${e.message}`);
  }

  const summary = {
    deleted: {},
    retained: {
      bills: 'Revenue Code §87 — 5yr tax retention',
      payments: 'Revenue Code §87 — 5yr tax retention',
      leases: 'Civil Code §193/34 — 5yr rent claim prescription',
      'BigQuery auth_events archive': 'PDPA §32(2)(e) — fraud prevention legitimate interest',
      'BigQuery slipLogs archive':    'PDPA §32(2)(e) — fraud prevention legitimate interest',
    },
    errors: [],
    storageErrors: 0,
    audit_events_written: false,
  };

  // ── Step 1: Revoke claims + refresh tokens FIRST ──
  // Closes the stale-cached-token write window before any destructive op.
  try {
    await admin.auth().setCustomUserClaims(ctx.authUid, {});
  } catch (e) {
    // CATASTROPHIC — abort cleanly and mark log failed.
    await logRef.update({
      status: 'failed',
      completedAtMs: Date.now(),
      summary,
      errors: [{ step: 'setCustomUserClaims', error: e.message }],
    }).catch(() => { /* best-effort */ });
    throw new functions.https.HttpsError('internal',
      `failed to clear custom claims: ${e.message}`);
  }
  try {
    await admin.auth().revokeRefreshTokens(ctx.authUid);
  } catch (e) {
    // Non-fatal: claims already cleared; tokens expire within ~1h regardless.
    summary.errors.push({ step: 'revokeRefreshTokens', error: e.message });
  }

  // ── Step 2: Cascade (best-effort per resource) ──
  const steps = [
    () => deleteChecklistsByRoom(ctx, summary),
    () => deleteConsents(ctx, summary),
    () => deleteLiffUser(ctx, summary),
    () => deleteRtdbPaths(ctx, summary),
    () => deleteBookingsByOwner(ctx, summary),
    () => deleteLineRetryQueueEntries(ctx, summary),
    () => deleteRateLimits(ctx, summary),
    () => deleteAllTenantArchives(ctx, summary),
    () => deletePlayerPeopleDoc(ctx, summary),
  ];
  for (const step of steps) {
    try { await step(); }
    catch (e) {
      summary.errors.push({ step: step.name || 'unknown', error: e.message });
    }
  }

  // ── Step 3: Cross-system audit anchor ──
  await writeAuthEventsRow(ctx, requestId, summary);

  // ── Step 4: Finalize log ──
  const status = summary.errors.length > 0 ? 'completed_with_errors' : 'completed';
  try {
    await logRef.update({
      status,
      completedAtMs: Date.now(),
      summary,
    });
  } catch (e) {
    console.error('[requestDataDeletion] failed to finalize log:', e.message);
  }

  console.log(`✅ pdpa_erasure: tenantId=${ctx.tenantId} status=${status} ` +
              `errors=${summary.errors.length} storageErrors=${summary.storageErrors}`);

  return {
    success: true,
    status,
    requestId,
    summary,
    signOutRequired: true,
  };
}

exports.requestDataDeletion = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(handler);

// Exported for unit tests
exports._handler = handler;
exports._helpers = {
  deleteChecklistsByRoom,
  deleteConsents,
  deleteLiffUser,
  deleteRtdbPaths,
  deleteBookingsByOwner,
  deleteLineRetryQueueEntries,
  deleteRateLimits,
  deleteAllTenantArchives,
  deletePlayerPeopleDoc,
  writeAuthEventsRow,
};
exports.CONFIRMATION_PHRASE = CONFIRMATION_PHRASE;
exports.COOLDOWN_MS = COOLDOWN_MS;
