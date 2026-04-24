/**
 * cleanupOldDocs — three small scheduled sweeps that prune docs no reader
 * cares about anymore. Bundled in one file so they share Firebase Admin
 * init + helper utilities; each schedule is exported separately so the
 * Firebase Console treats them as distinct functions you can disable
 * independently if any one misbehaves.
 *
 * Why bundled: each individual sweep is tiny (~30 lines). Keeping them in
 * one file beats five copy-pasted scaffolds, but every CF still deploys
 * to its own URL + cron entry.
 *
 * Schedules below all run early-morning BKK so they finish before admin
 * starts work.
 *
 * --------------------------------------------------------------------
 * 1) cleanupRateLimitsScheduled — daily 04:00 BKK
 *    Purges Firestore /rateLimits/* docs whose updatedAt is > 24h old.
 *    These are written per (userId, time-window) by verifySlip.js's
 *    rate limiter; without cleanup the collection grows linearly and
 *    eventually slows down every verifySlip lookup.
 *    Note: functions/index.js had `try { require('./cleanupRateLimits') }`
 *    that was silently failing because the file didn't exist. This file
 *    finally provides it (registered as cleanupRateLimitsScheduled).
 *
 * 2) cleanupMaintenanceRTDBScheduled — daily 04:10 BKK
 *    Deletes RTDB nodes under /maintenance/{building}/{roomId}/{ticketId}
 *    where status==='done' AND completedAt is > 30 days old. The admin
 *    dashboard already auto-purges these from localStorage, but the
 *    server copy never gets cleaned, so RTDB accumulates orphans
 *    indefinitely.
 *
 * 3) cleanupLiffUsersRejectedScheduled — weekly Sunday 04:20 BKK
 *    Deletes Firestore /liffUsers/{lineUserId} docs where
 *    status==='rejected' AND rejectedAt is > 90 days old. Admin needs
 *    the rejected audit trail short-term (to remember a denied request)
 *    but keeping rejections forever bloats the listener page that the
 *    dashboard subscribes to in real-time.
 *
 * Cost: each sweep reads ~10–100 docs/run, deletes maybe 0–10. CF
 * invocations are inside the free tier; Firestore deletes cost
 * $0.02/100k → ~$0/year at this scale.
 *
 * Region: asia-southeast1.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();
const rtdb = admin.database();

const RATE_LIMITS_TTL_MS = 24 * 60 * 60 * 1000;          // 1 day
const MAINTENANCE_DONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const LIFF_REJECTED_TTL_MS = 90 * 24 * 60 * 60 * 1000;     // 90 days
const BUILDINGS = ['rooms', 'nest'];
const BATCH_SIZE = 500;

// ============================================================
// 1) rateLimits — daily delete > 1 day
// ============================================================
async function runRateLimitsCleanup() {
  const cutoffMs = Date.now() - RATE_LIMITS_TTL_MS;
  const cutoff = admin.firestore.Timestamp.fromMillis(cutoffMs);
  let deleted = 0;

  // verifySlip writes updatedAt as a Firestore Timestamp (server side) OR
  // as a Date string fallback. Query both shapes by paginating without a
  // where clause — collection is small so a full scan is cheap.
  const snapshot = await firestore.collection('rateLimits').limit(BATCH_SIZE).get();
  const batch = firestore.batch();
  let queued = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    let updatedAtMs;
    if (data.updatedAt?.toMillis) updatedAtMs = data.updatedAt.toMillis();
    else if (typeof data.updatedAt === 'string') updatedAtMs = new Date(data.updatedAt).getTime();
    else if (typeof data.windowStart === 'number') updatedAtMs = data.windowStart;
    else return;  // unknown shape — skip rather than delete blindly

    if (updatedAtMs < cutoffMs) {
      batch.delete(doc.ref);
      queued++;
    }
  });

  if (queued > 0) {
    await batch.commit();
    deleted = queued;
  }
  console.log(`🧹 rateLimits cleanup: scanned=${snapshot.size} deleted=${deleted}`);
  return { scanned: snapshot.size, deleted };
}

exports.cleanupRateLimitsScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 240, memory: '256MB' })
  .pubsub.schedule('0 4 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try { return await runRateLimitsCleanup(); }
    catch (e) { console.error('cleanupRateLimits failed:', e); throw e; }
  });

// ============================================================
// 2) RTDB maintenance — daily delete done tickets > 30 days
// ============================================================
async function runMaintenanceCleanup() {
  const cutoffMs = Date.now() - MAINTENANCE_DONE_TTL_MS;
  let scanned = 0, deleted = 0;
  const ops = [];

  for (const building of BUILDINGS) {
    const bldSnap = await rtdb.ref(`maintenance/${building}`).once('value');
    const rooms = bldSnap.val() || {};

    for (const roomId of Object.keys(rooms)) {
      const tickets = rooms[roomId] || {};
      for (const ticketId of Object.keys(tickets)) {
        const t = tickets[ticketId];
        scanned++;
        if (!t || typeof t !== 'object') continue;
        if (t.status !== 'done' && t.status !== 'completed' && t.status !== 'resolved') continue;

        const completedMs = t.completedAt
          ? new Date(t.completedAt).getTime()
          : (t.updatedAt ? new Date(t.updatedAt).getTime() : 0);
        if (!completedMs || isNaN(completedMs)) continue;
        if (completedMs >= cutoffMs) continue;

        ops.push(rtdb.ref(`maintenance/${building}/${roomId}/${ticketId}`).remove()
          .then(() => deleted++)
          .catch(e => console.warn(`del ${building}/${roomId}/${ticketId}:`, e.message)));
      }
    }
  }

  await Promise.all(ops);
  console.log(`🧹 maintenance RTDB cleanup: scanned=${scanned} deleted=${deleted}`);
  return { scanned, deleted };
}

exports.cleanupMaintenanceRTDBScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .pubsub.schedule('10 4 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try { return await runMaintenanceCleanup(); }
    catch (e) { console.error('cleanupMaintenanceRTDB failed:', e); throw e; }
  });

// ============================================================
// 3) liffUsers rejected — weekly delete > 90 days
// ============================================================
async function runLiffRejectedCleanup() {
  const cutoffMs = Date.now() - LIFF_REJECTED_TTL_MS;
  const cutoff = admin.firestore.Timestamp.fromMillis(cutoffMs);

  // status filter narrows the scan; rejectedAt cutoff is enforced in JS
  // because not every rejected doc has the field as a typed Timestamp.
  const snapshot = await firestore.collection('liffUsers')
    .where('status', '==', 'rejected')
    .limit(BATCH_SIZE).get();

  const batch = firestore.batch();
  let queued = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    let rejectedMs;
    if (data.rejectedAt?.toMillis) rejectedMs = data.rejectedAt.toMillis();
    else if (typeof data.rejectedAt === 'string') rejectedMs = new Date(data.rejectedAt).getTime();
    else return;  // missing rejectedAt — skip

    if (rejectedMs < cutoffMs) {
      batch.delete(doc.ref);
      queued++;
    }
  });

  if (queued > 0) await batch.commit();
  console.log(`🧹 liffUsers rejected cleanup: scanned=${snapshot.size} deleted=${queued}`);
  return { scanned: snapshot.size, deleted: queued };
}

exports.cleanupLiffUsersRejectedScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 240, memory: '256MB' })
  .pubsub.schedule('20 4 * * 0')  // Sunday 04:20 BKK
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try { return await runLiffRejectedCleanup(); }
    catch (e) { console.error('cleanupLiffUsersRejected failed:', e); throw e; }
  });

// ============================================================
// HTTP — single endpoint that runs ALL three sweeps for manual testing
// POST https://asia-southeast1-<project>.cloudfunctions.net/cleanupOldDocs
// ============================================================
exports.cleanupOldDocs = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    try {
      const [rateLimits, maintenance, liffRejected] = await Promise.all([
        runRateLimitsCleanup(),
        runMaintenanceCleanup(),
        runLiffRejectedCleanup()
      ]);
      return res.status(200).json({ success: true, rateLimits, maintenance, liffRejected });
    } catch (e) {
      console.error('cleanupOldDocs HTTP failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });
