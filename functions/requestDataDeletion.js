/**
 * requestDataDeletion — PDPA §32 admin-triggered erasure.
 *
 * Caller: admin only. Tenants do NOT self-serve erasure — they contact
 * admin (via LINE/email/in-person), admin runs this CF with target params.
 *
 * Why admin-only:
 *   1. Tenant self-service deletion is a footgun for non-power users —
 *      a misclick = irreversible cascade across 9 resources.
 *   2. PDPA §32 doesn't mandate a self-service button — the data
 *      controller (admin) decides how to receive requests.
 *   3. Routine cleanup is already automatic: cleanupChecklistsScheduled
 *      (2yr/5yr retention) + cleanupPlayersOver1Year (1yr post-transition)
 *      + cleanupOldDocs* (rateLimits/maintenance/liffUsers-rejected).
 *      This CF handles only ad-hoc §32 requests above-and-beyond.
 *
 * Refused for active tenants — admin must run transitionToPlayer first
 * to archive the contract, then call this CF on the resulting player.
 *
 * Cascade is grouped into DELETE vs RETAIN buckets per PDPA §32(2):
 *   DELETE: checklists+storage, consents, pet social graph (profiles+links),
 *           pet meaning-layer feeds (alerts #13 / playdates #11 / caretaker #14),
 *           liffUsers, RTDB complaints/maintenance, bookings (+KYC images, slips),
 *           lineRetryQueue pending pushes, rateLimits prefix, all
 *           tenants/{b}/archive/{contractId} docs with this tenantId (incl. the
 *           #16 farewellSummary field that archives with the doc),
 *           people/{tenantId} recursiveDelete.
 *   RETAIN: RTDB bills (Revenue Code §87 5yr), leases (Civil Code
 *           §193/34 5yr), payments, BigQuery audit archives
 *           (auth_events + slipLogs — fraud prevention,
 *           PDPA §32(2)(e) legitimate interest).
 *
 * Order of operations:
 *   1. Idempotency-fence write to dataDeletionLog/{requestId}
 *   2. Revoke target's auth claims + revokeRefreshTokens (closes the
 *      stale-token write window before any destructive op)
 *   3. Cascade (best-effort per resource; errors collected, not aborted)
 *   4. Cross-write auth_events row
 *   5. Update log with summary, return to admin caller
 *
 * Why this order: step 2 BEFORE step 3 means even if a downstream
 * delete fails halfway, the target user CANNOT add more data — partial
 * state is recoverable; data leak via stale token is not.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const { getAllBuildings } = require('./buildingRegistry');
const { cleanupPetSocialByTenant } = require('./_petSocialCleanup');

const CONFIRMATION_PHRASE = 'ลบข้อมูลของฉัน';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days between erasure requests
const PAGE_SIZE = 200;                         // batch limit for query pages

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

async function deletePetSocial(ctx, summary) {
  // Pet Social Graph (Meaning Layer #10) — petProfiles/{petId} + petLinks/{linkId}
  // are top-level collections keyed on the canonical tenantId. archiveTenantOnMoveOut
  // already sweeps them at move-out; this is the §32 defense-in-depth pass for any
  // orphan that survived (e.g. a profile published after the contract archive).
  if (!ctx.tenantId) return;
  try {
    const { profiles, links } = await cleanupPetSocialByTenant(firestore, ctx.tenantId);
    summary.deleted.petProfiles = profiles;
    summary.deleted.petLinks = links;
  } catch (e) {
    summary.errors.push({ step: 'petSocial', error: e.message });
  }
}

async function deletePetMeaningLayerFeeds(ctx, summary) {
  // Pet meaning-layer feeds (#11 playdates / #13 alerts / #14 caretaker) — the
  // departed tenant's own ephemeral pet-feature docs. The scheduled sweeps
  // (cleanupPetAlerts/PetPlaydatesScheduled) already auto-expire these by time;
  // this is the §32 immediate-erasure pass for any still-live doc they own.
  // petAlerts/petPlaydates key the canonical tenantId (ownerTenantId/hostTenantId,
  // same id as consents/trustScores); caretakerRequests keys requesterUid (its
  // requesterTenantId is `building_room`, not the canonical id). All single-field
  // equality (§7-N). NOTE: a residual attendee SNAPSHOT (name + pet emoji) inside
  // ANOTHER tenant's still-open playdate is building-scoped + auto-expires via the
  // sweep — accepted as a time-bounded residual under §32 + the ephemeral design.
  const jobs = [];
  if (ctx.tenantId) {
    jobs.push(['petAlerts', firestore.collection('petAlerts').where('ownerTenantId', '==', ctx.tenantId)]);
    jobs.push(['petPlaydates', firestore.collection('petPlaydates').where('hostTenantId', '==', ctx.tenantId)]);
  }
  if (ctx.authUid) {
    jobs.push(['caretakerRequests', firestore.collection('caretakerRequests').where('requesterUid', '==', ctx.authUid)]);
  }
  for (const [name, baseQuery] of jobs) {
    let n = 0;
    try {
      const snap = await baseQuery.limit(PAGE_SIZE).get();
      for (const doc of snap.docs) {
        try { await doc.ref.delete(); n++; }
        catch (e) { summary.errors.push({ step: `${name}/${doc.id}`, error: e.message }); }
      }
    } catch (e) {
      summary.errors.push({ step: `${name}.query`, error: e.message });
    }
    summary.deleted[name] = n;
  }
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
    // Index missing? Skip — queue is non-load-bearing for compliance.
    summary.errors.push({ step: 'lineRetryQueue.query', error: e.message });
  }
  summary.deleted.lineRetryQueue = n;
}

async function deleteRateLimits(ctx, summary) {
  if (!ctx.authUid) return;
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

async function writeAuthEventsRow(ctx, requestId, summary, adminInfo) {
  try {
    await firestore.collection('auth_events').add({
      action: 'pdpa_erasure',
      docId: requestId,
      targetAuthUid: ctx.authUid,
      targetTenantId: ctx.tenantId,
      initiatedBy: adminInfo.uid,
      initiatedByEmail: adminInfo.email || '',
      reason: adminInfo.reason || '',
      ts: admin.firestore.FieldValue.serverTimestamp(),
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
  // ADMIN-ONLY: tenants do not self-serve erasure (see file header).
  if (context.auth.token?.admin !== true) {
    throw new functions.https.HttpsError('permission-denied',
      'Admin claim required — tenants cannot self-trigger erasure');
  }

  const adminUid = context.auth.uid;
  const adminEmail = String(context.auth.token?.email || '');

  // Required target identifiers (admin specifies which tenant to erase)
  const targetTenantId = String(data?.targetTenantId || '').trim();
  const targetAuthUid  = String(data?.targetAuthUid  || '').trim();
  const targetRoom     = String(data?.targetRoom     || '').trim();
  const targetBuilding = String(data?.targetBuilding || '').trim();
  const targetLineUserId = String(data?.targetLineUserId || '').trim() ||
    (targetAuthUid.startsWith('line:') ? targetAuthUid.slice(5) : '');
  const reason = String(data?.reason || '').slice(0, 500);

  if (!targetTenantId) {
    throw new functions.https.HttpsError('invalid-argument',
      'targetTenantId required');
  }
  if (!targetAuthUid) {
    throw new functions.https.HttpsError('invalid-argument',
      'targetAuthUid required (for token revocation)');
  }
  if (data?.confirmationPhrase?.trim() !== CONFIRMATION_PHRASE) {
    throw new functions.https.HttpsError('failed-precondition',
      `confirmation phrase mismatch (expected "${CONFIRMATION_PHRASE}")`);
  }

  // ── Active-tenant refusal ──
  // If target tenant is still active in tenants/{b}/list/{r}, admin must
  // run transitionToPlayer first to archive the contract, then call this CF
  // on the resulting player. Prevents accidental erasure of paying tenants.
  if (targetRoom && targetBuilding) {
    try {
      const tSnap = await firestore.collection('tenants').doc(targetBuilding)
        .collection('list').doc(targetRoom).get();
      if (tSnap.exists) {
        const td = tSnap.data() || {};
        if (String(td.tenantId || '') === targetTenantId &&
            String(td.linkedAuthUid || '') === targetAuthUid) {
          throw new functions.https.HttpsError('failed-precondition',
            'target is still an active tenant — run transitionToPlayer first');
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
      .where('tenantId', '==', targetTenantId)
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
    console.warn('[requestDataDeletion] cooldown check failed:', e.message);
  }

  return {
    target: {
      authUid: targetAuthUid,
      tenantId: targetTenantId,
      room: targetRoom,
      building: targetBuilding,
      lineUserId: targetLineUserId,
    },
    admin: { uid: adminUid, email: adminEmail, reason },
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

async function handler(data, context) {
  const { target: ctx, admin: adminInfo } = await preflight(data, context);

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
      initiatedBy: adminInfo.uid,
      initiatedByEmail: adminInfo.email,
      reason: adminInfo.reason,
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

  // ── Step 1: Revoke target's claims + refresh tokens FIRST ──
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
      `failed to clear target's custom claims: ${e.message}`);
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
    () => deletePetSocial(ctx, summary),
    () => deletePetMeaningLayerFeeds(ctx, summary),
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
  await writeAuthEventsRow(ctx, requestId, summary, adminInfo);

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

  return {
    success: true,
    status,
    requestId,
    summary,
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
  deletePetSocial,
  deletePetMeaningLayerFeeds,
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
