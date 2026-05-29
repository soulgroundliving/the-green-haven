/**
 * Cloud Functions for Complaint Management and Gamification System
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
// Shared gamification rules (auto-synced from shared/gamification-rules.js on deploy)
const { BADGE_CATALOG, badgeId, normaliseBadges, getLevelProgress } = require('./gamification-rules');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();
const firestore = admin.firestore();

// ===== COMPLAINT MANAGEMENT FUNCTIONS =====

// onComplaintCreated + sendComplaintConfirmation removed 2026-05-14: both
// onCall CFs had zero client callers since launch — complaints are written
// directly to RTDB by tenant_app and read by dashboard listeners, no CF in
// the loop. sendComplaintConfirmation also referenced a never-set env var
// (COMPLAINT_TOKEN) and a never-implemented email service stub.

/**
 * Auto-close resolved complaints after 30 days
 */
exports.cleanupResolvedComplaints = functions.region('asia-southeast1').pubsub
  .schedule('0 2 * * *') // Run daily at 2 AM
  .onRun(async (context) => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const buildingsSnap = await firestore.collection('buildings').get();

      for (const buildingDoc of buildingsSnap.docs) {
        const buildingId = buildingDoc.id;
        const roomsSnap = await buildingDoc.ref.collection('rooms').get();

        for (const roomDoc of roomsSnap.docs) {
          const roomId = roomDoc.id;
          const complaintsSnap = await roomDoc.ref
            .collection('complaintHistory')
            .where('status', '==', 'resolved')
            .get();

          let archivedCount = 0;

          for (const complaintDoc of complaintsSnap.docs) {
            const complaint = complaintDoc.data();
            const resolvedDate = new Date(complaint.resolvedDate);

            if (resolvedDate < thirtyDaysAgo) {
              // Archive old resolved complaint
              await firestore
                .collection('archived_complaints')
                .doc(complaintDoc.id)
                .set({
                  building: buildingId,
                  room: roomId,
                  ...complaint,
                  archivedAt: new Date().toISOString()
                });

              // Delete from active complaints
              await complaintDoc.ref.delete();
              archivedCount++;
            }
          }
        }
      }

      return true;
    } catch (error) {
      console.error('❌ Error cleaning up complaints:', error);
      return false;
    }
  });

// ===== GAMIFICATION FUNCTIONS =====

// awardRentPaymentPoints removed 2026-04-28: no caller, used dead flat path
// `tenants/{tenantId}`, and accepted points value from client without auth
// check (any signed-in user could inflate any tenant's points).
// On-time rent points are now awarded server-side by verifySlip via
// gamification-rules.js EARNING_SOURCES.rent_paid.

// Shared logic — extracted so both the scheduled trigger and the
// admin-only HTTP trigger (manual / dry-run) can share it.
async function _runAwardComplaintFreeMonth({ dryRun = false } = {}) {
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthKey = prevMonthStart.slice(0, 7);

  const complaintsSnap = await firestore.collection('complaints')
    .where('createdAt', '>=', prevMonthStart)
    .where('createdAt', '<',  prevMonthEnd)
    .get();

  const complainedRooms = new Set();
  complaintsSnap.forEach(d => {
    const c = d.data();
    if (c.building === 'nest' && c.room) complainedRooms.add(String(c.room));
  });

  const nestSnap = await firestore.collection('tenants').doc('nest').collection('list').get();
  let awarded = 0, skippedAlreadyAwarded = 0, skippedHadComplaint = 0;
  const wouldAward = [];  // names of tenants who'd get points (dry-run only)

  for (const tenantDoc of nestSnap.docs) {
    const roomId = tenantDoc.id;
    if (complainedRooms.has(String(roomId))) { skippedHadComplaint++; continue; }

    const markerRef = tenantDoc.ref.collection('complaintFreeMonthAwarded').doc(monthKey);
    const markerSnap = await markerRef.get();
    if (markerSnap.exists) { skippedAlreadyAwarded++; continue; }

    if (dryRun) {
      wouldAward.push(roomId);
      continue;
    }

    const batch = firestore.batch();
    batch.update(tenantDoc.ref, {
      'gamification.points': admin.firestore.FieldValue.increment(40),
      'metadata.updatedAt': new Date().toISOString()
    });
    batch.set(markerRef, { awardedAt: new Date().toISOString(), points: 40 });
    await batch.commit();
    awarded++;
  }

  return {
    monthKey, awarded, skippedAlreadyAwarded, skippedHadComplaint,
    total: nestSnap.size,
    complaintsLastMonth: complaintsSnap.size,
    complainedRooms: Array.from(complainedRooms),
    ...(dryRun ? { dryRun: true, wouldAward } : {})
  };
}

/**
 * Admin-only HTTP wrapper for manual trigger and dry-run inspection.
 * Useful for verifying behavior without waiting for the monthly cron.
 *   curl -X POST -H "Authorization: Bearer <idToken>" \
 *        "https://asia-southeast1-the-green-haven.cloudfunctions.net/awardComplaintFreeMonthManual?dryRun=1"
 */
exports.awardComplaintFreeMonthManual = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 120 })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://the-green-haven.vercel.app');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { requireAdmin } = require('./_auth');
    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    try {
      const result = await _runAwardComplaintFreeMonth({ dryRun });
      return res.status(200).json({ success: true, ...result });
    } catch (e) {
      console.error('awardComplaintFreeMonthManual failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });

/**
 * Auto-award 40 points to every Nest tenant who filed no complaints in the
 * previous calendar month. Runs at 00:01 BKK on the 1st of each month.
 *
 * REWRITTEN 2026-04-26: previous version was broken — read from dead
 * collectionGroup('complaintHistory') (frontend writes 'complaints' top-level),
 * iterated wrong tenant path (top-level 'tenants' instead of canonical
 * tenants/{building}/list/{roomId}), and the inner where-clause wasn't
 * tenant-scoped. Net effect: every tenant got 40 free points unconditionally.
 *
 * Point economy is Nest-only per memory/point_economy_rules.md, so we only
 * iterate tenants/nest/list. Idempotent: writes a marker doc per (room, month)
 * so a function retry from Cloud Scheduler doesn't double-award.
 */
exports.awardComplaintFreeMonth = functions.region('asia-southeast1').pubsub
  .schedule('1 0 1 * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    const result = await _runAwardComplaintFreeMonth({ dryRun: false });
    return result;
  });

// Extracted for unit testing — called by checkAndAwardBadges when tenantId is provided.
async function _runCheckAndAwardBadgesPlayer(tenantId, authToken) {
  const tok = authToken || {};
  if (!tok.admin && tok.tenantId !== String(tenantId)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to check badges for this player');
  }
  const peopleRef = firestore.collection('people').doc(String(tenantId));
  const peopleDoc = await peopleRef.get();
  if (!peopleDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Player not found');
  }
  const playerData = peopleDoc.data();
  const points = playerData.gamification?.points || 0;
  const rawBadges = playerData.gamification?.badges || [];
  const now = new Date().toISOString();
  const normalised = normaliseBadges(rawBadges, now);
  const earnedIds = new Set(normalised.map(badgeId));
  // Sprint 6: skip event-based marketplace badges — they have their own
  // awarder (marketplaceStatsAggregator) gated by gamification.marketplaceStats,
  // not points. Mixing the two awarders would double-fire on every points
  // milestone check.
  const toAward = BADGE_CATALOG.filter(c => !c.marketplace && !earnedIds.has(c.id) && points >= c.minPts)
    .map(c => ({ id: c.id, emoji: c.emoji, label: c.label, earnedAt: now }));
  if (toAward.length > 0) {
    await peopleRef.update({ 'gamification.badges': [...normalised, ...toAward] });
  }
  return { success: true, badgesAwarded: toAward.length, newBadges: toAward };
}
exports._runCheckAndAwardBadgesPlayer = _runCheckAndAwardBadgesPlayer;

/**
 * Check and award badges based on points milestones.
 *
 * Accepts either:
 *   { building, roomId } — active tenant path (tenants/{b}/list/{r}.gamification)
 *   { tenantId }         — player path (people/{tenantId}.gamification)
 *
 * Stores badges as [{ id, emoji, label, earnedAt }] (migrates legacy string[] automatically).
 * BADGE_CATALOG is imported from shared/gamification-rules.js (SSoT).
 */
exports.checkAndAwardBadges = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  try {
    const { building, roomId, tenantId } = data;

    // ── Player path ──────────────────────────────────────────────────────────
    if (tenantId) return await _runCheckAndAwardBadgesPlayer(tenantId, context.auth?.token);

    // ── Active tenant path ───────────────────────────────────────────────────
    if (!building || !roomId) {
      throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
    }

    const tenantRef = firestore.collection('tenants').doc(building).collection('list').doc(String(roomId));
    const tenantDoc = await tenantRef.get();

    if (!tenantDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Tenant not found');
    }

    const tenantData = tenantDoc.data();
    const points = tenantData.gamification?.points || 0;
    const rawBadges = tenantData.gamification?.badges || [];

    const now = new Date().toISOString();
    const normalised = normaliseBadges(rawBadges, now);
    const earnedIds = new Set(normalised.map(badgeId));

    // Sprint 6: skip event-based marketplace badges — owned by
    // marketplaceStatsAggregator (gated on gamification.marketplaceStats).
    const toAward = BADGE_CATALOG.filter(c => !c.marketplace && !earnedIds.has(c.id) && points >= c.minPts)
      .map(c => ({ id: c.id, emoji: c.emoji, label: c.label, earnedAt: now }));

    if (toAward.length > 0) {
      await tenantRef.update({
        'gamification.badges': [...normalised, ...toAward],
        'metadata.updatedAt': now
      });
    }

    return { success: true, badgesAwarded: toAward.length, newBadges: toAward };
  } catch (error) {
    console.error('❌ Error checking badges:', error);
    throw error;
  }
});

/**
 * Calculate tenant rank (level tier) based on points.
 * Unified with tenant-facing LEVEL_TIERS via SSoT (shared/gamification-rules.js).
 * Legacy Bronze/Silver/Gold/Platinum was replaced with Seedling/Sprout/…/Forest Master.
 */
exports.calculateTenantRank = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  try {
    const { tenantId } = data;

    const tenantDoc = await firestore.collection('tenants').doc(tenantId).get();

    if (!tenantDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Tenant not found');
    }

    const points = tenantDoc.data().gamification?.points || 0;
    const lp = getLevelProgress(points);

    return {
      success: true,
      rank: lp.tier.name,
      rankIcon: lp.tier.emoji,
      points,
      nextMilestone: lp.next ? { name: lp.next.name, points: lp.next.min } : null,
      progressToNext: lp.next ? lp.next.min - points : 0
    };
  } catch (error) {
    console.error('❌ Error calculating rank:', error);
    throw error;
  }
});

/**
 * Get leaderboard
 */
exports.getLeaderboard = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  try {
    const building = (data && data.building) || 'nest';
    if (!['rooms', 'nest'].includes(building)) {
      throw new functions.https.HttpsError('invalid-argument', 'building must be "rooms" or "nest"');
    }

    // Fetch active tenants and community members (players) in parallel.
    // Players transitioned out of their room but still hold real points in
    // people/{tenantId} — they should appear alongside current tenants.
    const [tenantSnap, peopleSnap] = await Promise.all([
      firestore
        .collection('tenants').doc(building).collection('list')
        .orderBy('gamification.points', 'desc')
        .limit(20)
        .get(),
      firestore
        .collection('people')
        .orderBy('gamification.points', 'desc')
        .limit(20)
        .get()
    ]);

    const tenantEntries = tenantSnap.docs.map(doc => {
      const d = doc.data();
      return {
        roomId: doc.id,
        tenantId: null,
        isPlayer: false,
        name: d.name || d.firstName || '(ไม่มีชื่อ)',
        points: (d.gamification && d.gamification.points) || 0,
        avatar: d.avatar || '🏡',
      };
    });

    const playerEntries = peopleSnap.docs.map(doc => {
      const d = doc.data();
      return {
        roomId: null,
        tenantId: doc.id,
        isPlayer: true,
        name: d.name || d.firstName || '(ไม่มีชื่อ)',
        points: (d.gamification && d.gamification.points) || 0,
        avatar: d.avatar || '🌿',
      };
    });

    const leaderboard = [...tenantEntries, ...playerEntries]
      .filter(e => e.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    return { success: true, leaderboard };
  } catch (error) {
    console.error('❌ Error getting leaderboard:', error);
    throw error;
  }
});
