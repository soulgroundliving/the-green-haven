/**
 * computeTrustScoresScheduled — daily recompute of every active tenant's
 * Reputation score → write-locked `trustScores/{tenantId}` (Roadmap Phase 3.2a v1).
 *
 * WHY a server CF, not client-on-read (unlike the Phase 3.1 behavioural cards):
 * trust MUST be tamper-proof / server-computed (CLAUDE.md §6 — the retention moat
 * collapses if the client can influence its own score) and it derives from RTDB
 * bills + Firestore leases + Firestore complaints across ALL tenants (too heavy +
 * too sensitive for the browser). Project Firestore lives in SE3 where Eventarc
 * triggers can't deploy (§7-NN) → a daily SCHEDULED sweep + an admin on-demand
 * callable (recomputeTrustScores.js), both sharing the pure `_reputation` core.
 *
 * Trust ≠ points (§6): this never reads the spendable `points` balance — only
 * verifiable events (paid bills, lease tenure, complaint record).
 *
 * Data gathered (a handful of reads — cheap at this scale):
 *   - bills    RTDB  `bills/{building}/{room}/{billId}`  (status / dueDate / paidAt)
 *   - tenure   FS    `leases/{building}/list` where status==active → moveInDate
 *   - roster   FS    `tenants/{building}/list`            (tenantId + occupancy gate)
 *   - complaints FS  `complaints` (top-level, bounded by a streak-cap cutoff)
 *   - kindness FS    `pointsLedger` where source in {quest,food_share,help_completed}
 *                    (Meaning Layer #6 — ONE global read; joined to a roster tenant by
 *                    `${building}_${roomId}` first, canonical tenantId as fallback)
 *   - helper jobs FS `helpRequests` where status=='done' (Meaning Layer #7 — ONE
 *                    read; joined to a roster tenant by `${helperBuilding}_${helperRoom}`)
 *
 * Doc shape (server-write-only — rule `write: if false`):
 *   trustScores/{tenantId} = {
 *     tenantId, building, roomId,            // identity context (single writer → no §7-T drift)
 *     reputation: 0–100,
 *     provisional: bool,                     // true when 0 ratable bills (payment reweighted out)
 *     factors: { paymentScore, tenureScore, complaintScore, onTimeRatio,
 *                onTimeBills, lateBills, tenureMonths, complaintFreeMonths },
 *     kindness: 0–100,                       // Meaning Layer #6 — generosity (peer-confirmed giving)
 *     kindnessProvisional: bool,             // true below the accrual-gate event count (seed state)
 *     kindnessFactors: { questPoints, foodSharePoints, helpCompletedPoints, totalPoints,
 *                        questCount, foodShareCount, helpCompletedCount, totalEvents },
 *     verifiedHelper: 0–100,                 // Meaning Layer #7 — peer-confirmed helper credential
 *     verifiedHelperProvisional: bool,       // true below the accrual-gate job count (seed state)
 *     verifiedHelperFactors: { completedCount, distinctRequesters, totalTags, tagCounts, lastCompletedAt },
 *     computedAt: serverTimestamp,
 *   }
 *
 * Idempotent: each run overwrites with `.set()` → last-write-wins, deterministic
 * for the same data + day. Schedule: 05:40 BKK — after cleanupPlayers (05:00),
 * before remindLeaseExpiry (08:00); clear of the 02:00–04:20 backup/cleanup window.
 *
 * Region: asia-southeast1.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();
const firestore = admin.firestore();

const { getAllBuildings } = require('./buildingRegistry');
const { computeReputation, reputationTier, REPUTATION_CONSTANTS } = require('./_reputation');
const { computeKindness, kindnessTier, KINDNESS_SOURCES } = require('./_kindness');
const { computeVerifiedHelper, verifiedHelperTier } = require('./_verifiedHelper');

const { MONTH_MS, COMPLAINT_CLEAN_MAX_MONTHS } = REPUTATION_CONSTANTS;

// Firestore batches cap at 500 ops — flush before then. At ~60 tenants one batch
// suffices, but chunking keeps the sweep correct as the roster grows.
const BATCH_LIMIT = 400;

/**
 * Gather signals across all buildings, compute each active tenant's reputation
 * via the pure core, and batch-write `trustScores/*`. Shared by the scheduled CF
 * and the admin recompute callable.
 *
 * @param {object} [opts]
 * @param {number} [opts.nowMs] injected "now" (defaults to Date.now()) — lets the
 *                              sweep stay deterministic under test.
 * @returns {Promise<object>} summary { scored, skippedVacant, provisional,
 *                              complaintsScanned, kindnessProvisional,
 *                              kindnessEventsScanned, buildings:[{building,written}], errors }
 */
async function runTrustScoreSweep({ nowMs } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const summary = {
    scored: 0, skippedVacant: 0, provisional: 0, complaintsScanned: 0,
    kindnessProvisional: 0, kindnessEventsScanned: 0,
    verifiedHelperProvisional: 0, verifiedHelperJobsScanned: 0,
    buildings: [], errors: 0,
  };

  // — complaints: one bounded read (single-field range, ISO-string compare, like
  //   complaintAndGamification.js:99 → no composite index). A complaint older than
  //   COMPLAINT_CLEAN_MAX_MONTHS yields the max complaint score whether it's counted
  //   or falls back to tenure-start, so the cutoff is correctness-preserving + cheap.
  const complaintsByRoom = new Map(); // `${building}_${room}` → [{ createdAt }]
  const cutoffISO = new Date(now - (COMPLAINT_CLEAN_MAX_MONTHS + 1) * MONTH_MS).toISOString();
  try {
    const cSnap = await firestore.collection('complaints').where('createdAt', '>=', cutoffISO).get();
    cSnap.forEach((d) => {
      const c = d.data() || {};
      if (!c.building || c.room == null) return;
      const key = `${c.building}_${c.room}`;
      if (!complaintsByRoom.has(key)) complaintsByRoom.set(key, []);
      complaintsByRoom.get(key).push({ createdAt: c.createdAt });
      summary.complaintsScanned++;
    });
  } catch (e) {
    // Non-fatal: scores still compute, just without the complaint signal this run.
    console.warn('[computeTrustScores] complaints read failed — scores omit complaint signal:', e && e.message);
    summary.errors++;
  }

  // — kindness (#6): ONE global read of the KIND-tagged points-ledger events.
  //   `where('source','in', [...])` is a single-field query → served by the
  //   automatic index (NO composite, §7-N-safe) and has NO limit → the newest
  //   events are never dropped (§7-AAA-safe).
  //
  //   JOIN by (building, roomId) FIRST: the capture CFs (claimQuest /
  //   completeHelpRequest / claimFood) tag the ledger `tenantId` with the
  //   `${building}_${room}` form (e.g. "nest_N101"), NOT the canonical roster
  //   tenantId ("TENANT_…") — verified live on prod 2026-06-10 (§7-J: the active
  //   tenant scored 0 despite 4 real quests because the ids didn't join). The
  //   roster is keyed by building/room, so room-key is the reliable join. Fall
  //   back to `tenantId` for player-path events (building/roomId null) or any
  //   future canonical-tagged event. Each event lands in EXACTLY ONE index, so the
  //   per-tenant union can't double-count. Trust ≠ points (§6): kind-EARN subset only.
  const kindnessByRoomKey = new Map();  // `${building}_${roomId}` → [{ source, points }]
  const kindnessByTenantId = new Map(); // tenantId → [{ source, points }] (player / canonical-only)
  try {
    const kSnap = await firestore.collection('pointsLedger')
      .where('source', 'in', [...KINDNESS_SOURCES]).get();
    kSnap.forEach((d) => {
      const e = d.data() || {};
      const ev = { source: e.source, points: e.points };
      if (e.building && e.roomId != null && e.roomId !== '') {
        const rk = `${e.building}_${String(e.roomId)}`;
        if (!kindnessByRoomKey.has(rk)) kindnessByRoomKey.set(rk, []);
        kindnessByRoomKey.get(rk).push(ev);
        summary.kindnessEventsScanned++;
      } else if (e.tenantId) {
        const tid = String(e.tenantId);
        if (!kindnessByTenantId.has(tid)) kindnessByTenantId.set(tid, []);
        kindnessByTenantId.get(tid).push(ev);
        summary.kindnessEventsScanned++;
      }
    });
  } catch (e) {
    // Non-fatal: reputation still computes; kindness falls back to 0/provisional this run.
    console.warn('[computeTrustScores] pointsLedger read failed — kindness omitted this run:', e && e.message);
    summary.errors++;
  }

  // — verified helper (#7): ONE global read of CONFIRMED-DONE help jobs.
  //   `where('status','==','done')` is single-field (automatic index, §7-N-safe)
  //   with NO limit (§7-AAA-safe). JOIN by `${helperBuilding}_${helperRoom}`: the
  //   help CFs stamp `helperTenantId` as the `${building}_${room}` form (NOT the
  //   canonical roster id) — the SAME §7-J #330 trap kindness hit, so an id-join
  //   would silently score every helper 0. The roster is keyed by building/room →
  //   room-key is the reliable join. Trust ≠ points (§6): this reads the JOB
  //   HISTORY (count / distinct requesters / appreciation tags), never points.
  const helperJobsByRoomKey = new Map(); // `${building}_${room}` → [{ requesterTenantId, requesterRoom, appreciationTags, completedAt }]
  try {
    const hSnap = await firestore.collection('helpRequests').where('status', '==', 'done').get();
    hSnap.forEach((d) => {
      const h = d.data() || {};
      if (!h.helperBuilding || h.helperRoom == null || h.helperRoom === '') return;
      const rk = `${h.helperBuilding}_${String(h.helperRoom)}`;
      if (!helperJobsByRoomKey.has(rk)) helperJobsByRoomKey.set(rk, []);
      helperJobsByRoomKey.get(rk).push({
        requesterTenantId: h.requesterTenantId,
        requesterRoom: h.requesterRoom,
        appreciationTags: h.appreciationTags,
        completedAt: h.completedAt,
      });
      summary.verifiedHelperJobsScanned++;
    });
  } catch (e) {
    // Non-fatal: reputation/kindness still compute; verified-helper → 0/provisional this run.
    console.warn('[computeTrustScores] helpRequests read failed — verified-helper omitted this run:', e && e.message);
    summary.errors++;
  }

  const buildings = await getAllBuildings();
  let batch = firestore.batch();
  let pending = 0;
  const flush = async () => { if (pending > 0) { await batch.commit(); batch = firestore.batch(); pending = 0; } };

  for (const building of buildings) {
    let written = 0;

    // bills (RTDB) — one read for the whole building
    let billsByRoom = {};
    try {
      const bSnap = await rtdb.ref(`bills/${building}`).once('value');
      billsByRoom = bSnap.val() || {};
    } catch (e) {
      console.warn(`[computeTrustScores] bills read failed for ${building}:`, e && e.message);
      summary.errors++;
    }

    // active leases → moveInDate per room (one query)
    const moveInByRoom = new Map();
    try {
      const lSnap = await firestore.collection(`leases/${building}/list`).where('status', '==', 'active').get();
      lSnap.forEach((d) => {
        const L = d.data() || {};
        if (L.roomId == null) return;
        moveInByRoom.set(String(L.roomId), L.moveInDate || L.startDate || L.contractStart || null);
      });
    } catch (e) {
      console.warn(`[computeTrustScores] leases read failed for ${building}:`, e && e.message);
      summary.errors++;
    }

    // tenant roster (occupancy gate)
    let tSnap;
    try {
      tSnap = await firestore.collection('tenants').doc(building).collection('list').get();
    } catch (e) {
      console.warn(`[computeTrustScores] tenants read failed for ${building}:`, e && e.message);
      summary.errors++;
      summary.buildings.push({ building, written: 0 });
      continue;
    }

    for (const tDoc of tSnap.docs) {
      const roomId = tDoc.id;
      const td = tDoc.data() || {};
      // Occupancy gate — trust is a tenant signal; vacant / unlinked rooms are skipped
      // (mirrors the complaint-free award guard in complaintAndGamification.js).
      if (!td.tenantId || td.status === 'vacant') { summary.skippedVacant++; continue; }

      const roomNode = billsByRoom[roomId];
      const roomBills = roomNode && typeof roomNode === 'object' ? Object.values(roomNode) : [];
      const moveInDate = moveInByRoom.get(String(roomId)) || td.moveInDate || td.leaseStart || null;
      const complaints = complaintsByRoom.get(`${building}_${roomId}`) || [];

      const result = computeReputation({ bills: roomBills, moveInDate, complaints, now });
      if (result.provisional) summary.provisional++;

      // Kindness (#6) — sum this tenant's kind-tagged ledger events. JOIN by room
      // key first (capture CFs tag by `${building}_${room}`), then by canonical
      // tenantId (player / canonical-only events). Each event is in exactly one
      // index, so the union never double-counts. Additive fields on the SAME
      // admin-only doc; the coarse tier is ALSO mirrored onto the tenant doc
      // below (v1.x badge — see the combined mirror write).
      const kindEvents = [
        ...(kindnessByRoomKey.get(`${building}_${String(roomId)}`) || []),
        ...(kindnessByTenantId.get(String(td.tenantId)) || []),
      ];
      const kind = computeKindness({ events: kindEvents });
      if (kind.provisional) summary.kindnessProvisional++;

      // Verified Helper (#7) — peer-confirmed helper credential from THIS room's
      // confirmed-done help jobs (join by room key, §7-J #330). Job-history, not
      // points (§6). Additive on the same admin-only doc; tier mirrored below.
      const helperJobs = helperJobsByRoomKey.get(`${building}_${String(roomId)}`) || [];
      const vh = computeVerifiedHelper({ jobs: helperJobs });
      if (vh.provisional) summary.verifiedHelperProvisional++;

      const ref = firestore.collection('trustScores').doc(String(td.tenantId));
      batch.set(ref, {
        tenantId: String(td.tenantId),
        building,
        roomId: String(roomId),
        reputation: result.reputation,
        provisional: result.provisional,
        factors: result.factors,
        kindness: kind.kindness,
        kindnessProvisional: kind.provisional,
        kindnessFactors: kind.factors,
        verifiedHelper: vh.score,
        verifiedHelperProvisional: vh.provisional,
        verifiedHelperFactors: vh.factors,
        computedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Mirror the coarse tier ENUMs onto the tenant-readable roster doc (Phase
      // 3.2a v1.x — reputation + kindness #6). The tenant_app badges read
      // `reputationTier` / `kindnessTier` off the tenant doc they already load
      // (TenantFirebaseSync.loadLease) — no new subscription, no trustScores
      // read-rule change. Tier-only: the raw numbers + factors stay in the
      // admin-only trustScores doc. ONE write carries BOTH tiers (single writer,
      // §7-T); the rules protected-field block forbids the tenant from writing
      // either (§6 tamper-proof).
      batch.set(tDoc.ref, {
        reputationTier: reputationTier(result.reputation, result.provisional),
        kindnessTier: kindnessTier(kind.kindness, kind.provisional),
        verifiedHelperTier: verifiedHelperTier(vh.score, vh.provisional),
      }, { merge: true });

      pending += 2; summary.scored++; written++;   // 2 ops: trustScores + tenant-doc mirror
      if (pending >= BATCH_LIMIT) await flush();
    }

    summary.buildings.push({ building, written });
  }

  await flush();
  return summary;
}

// ============================================================
// Scheduled — daily 05:40 BKK
// ============================================================
exports.computeTrustScoresScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .pubsub.schedule('40 5 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try {
      const summary = await runTrustScoreSweep();
      console.log('[computeTrustScores] swept:', JSON.stringify(summary));
      return null;
    } catch (e) {
      console.error('computeTrustScoresScheduled failed:', e);
      throw e;
    }
  });

// Exported for the admin recompute callable + unit tests. NOT registered in
// index.js, so it is never deployed as its own Cloud Function.
exports.runTrustScoreSweep = runTrustScoreSweep;
