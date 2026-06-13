/**
 * rollupBehaviorEventsScheduled.js — Behavioral Analytics Phase 1b.
 *
 * Daily (05:20 BKK) rollup of the raw behaviorEvents RTDB tree (written by
 * shared/tenant-analytics.js, Phase 1a) into ONE identity-free Firestore aggregate
 * doc — behavioralRollup/adoption — the dead-feature detector's data source. Then
 * PURGES raw flushes older than RAW_TTL_DAYS so the RTDB node stays bounded
 * (mirrors cleanupMaintenanceRTDBScheduled).
 *
 * §7-NN: a SCHEDULED CF (pubsub.schedule), NEVER a Firestore trigger — project
 *        Firestore is SE3 (Eventarc unsupported). Region SE1.
 * §7-AA: grepped functions/ — no pre-existing behavioral rollup CF.
 * §7-CCC: exported top-level in functions/index.js (CI deploy regex).
 * Pure aggregation lives in _behaviorRollup.js (mirrors _reputation.js — testable
 * without loading firebase).
 */
'use strict';

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();
const firestore = admin.firestore();

const { computeAdoption } = require('./_behaviorRollup');
const { getAllBuildings } = require('./buildingRegistry');

const WINDOW_DAYS = 30;     // adoption window
const RAW_TTL_DAYS = 60;    // purge raw flushes older than this
const DAY_MS = 86400000;

// Occupied rooms = the adoption denominator (how many rooms COULD use a feature).
// Mirrors the trust sweep's tenant read.
async function countOccupiedRooms() {
  let n = 0;
  let buildings;
  try { buildings = await getAllBuildings(); } catch (_) { buildings = ['rooms', 'nest']; }
  for (const b of buildings) {
    try {
      const snap = await firestore.collection('tenants').doc(b).collection('list').get();
      snap.forEach((d) => { const t = d.data() || {}; if (t.tenantId && t.status !== 'vacant') n += 1; });
    } catch (e) { console.warn('[rollupBehaviorEvents] tenants read', b, e.message); }
  }
  return n;
}

// Delete flush nodes older than the TTL so behaviorEvents stays bounded.
async function purgeOldFlushes(tree, nowMs) {
  const cutoff = nowMs - RAW_TTL_DAYS * DAY_MS;
  const ops = [];
  Object.keys(tree || {}).forEach((b) => {
    const rooms = tree[b] || {};
    Object.keys(rooms).forEach((r) => {
      const pushes = rooms[r] || {};
      Object.keys(pushes).forEach((pid) => {
        const fa = Number((pushes[pid] || {}).flushedAt);
        if (isFinite(fa) && fa < cutoff) {
          ops.push(rtdb.ref('behaviorEvents/' + b + '/' + r + '/' + pid).remove().catch(() => {}));
        }
      });
    });
  });
  await Promise.all(ops);
  return ops.length;
}

async function runRollup() {
  const nowMs = Date.now();
  const tree = (await rtdb.ref('behaviorEvents').once('value')).val() || {};
  const occupiedRooms = await countOccupiedRooms();
  const rollup = computeAdoption(tree, { occupiedRooms, nowMs, windowDays: WINDOW_DAYS });
  await firestore.collection('behavioralRollup').doc('adoption').set(
    Object.assign({}, rollup, { generatedAt: admin.firestore.FieldValue.serverTimestamp() })
  );
  const purged = await purgeOldFlushes(tree, nowMs);
  return {
    totalEvents: rollup.totalEvents,
    totalFlushes: rollup.totalFlushes,
    activeRooms: rollup.activeRooms,
    occupiedRooms,
    pages: rollup.pages.length,
    actions: rollup.actions.length,
    purged,
  };
}

exports.rollupBehaviorEventsScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .pubsub.schedule('20 5 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try {
      const summary = await runRollup();
      console.log('[rollupBehaviorEvents] done:', JSON.stringify(summary));
      return null;
    } catch (e) {
      console.error('rollupBehaviorEventsScheduled failed:', e);
      throw e;
    }
  });

// Exported for the admin/unit harness; the daily run uses the scheduled trigger.
exports.runRollup = runRollup;
