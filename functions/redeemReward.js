/**
 * redeemReward — atomic reward redemption Cloud Function.
 *
 * Replaces the client-side optimistic write in tenant_app.html. Validates the
 * caller, reads the canonical reward cost from Firestore, ensures the tenant
 * has enough points, then runs a transaction that:
 *   1. decrements tenants/{building}/list/{roomId}.gamification.points
 *   2. appends a redemption record to the same doc's `redemptions` subcollection
 *
 * The whole thing runs in one Firestore transaction so a tenant can't redeem
 * the same reward twice with concurrent calls. Without this, the client-side
 * optimistic UI is the only thing keeping points from going negative.
 *
 * Region: asia-southeast1 (matches verifySlip / complaintAndGamification)
 * Auth: caller's custom claims (room/building, set by liffSignIn) must match
 *       the requested building+roomId. Admin claim bypasses for ops/testing.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { checkRateLimit } = require('./_rateLimit');
const { assertTenantAccess } = require('./_authSoT');

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();

exports.redeemReward = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }

  // 5 redemptions per 24 h — prevents spam; point balance is the real floor.
  await checkRateLimit(context.auth.uid, 'redeemReward', 5, 86400);

  const tok = context.auth.token || {};

  // ── Player branch ────────────────────────────────────────────────────────
  // Players have role='player' + tenantId claim instead of room/building.
  // They store points in people/{tenantId} rather than tenants/{b}/list/{r}.
  if (tok.role === 'player') {
    const { tenantId, rewardId: playerRewardId } = data || {};
    if (!tenantId || !playerRewardId) {
      throw new functions.https.HttpsError('invalid-argument', 'tenantId and rewardId are required for player redemption');
    }
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(playerRewardId) || !/^[A-Za-z0-9_-]{1,60}$/.test(tenantId)) {
      throw new functions.https.HttpsError('invalid-argument', 'tenantId and rewardId must be alphanumeric (max 60 chars)');
    }
    if (tok.admin !== true && tok.tenantId !== tenantId) {
      throw new functions.https.HttpsError('permission-denied', 'You can only redeem rewards for your own account');
    }
    const rewardRef = firestore.collection('rewards').doc(playerRewardId);
    const peopleRef = firestore.collection('people').doc(tenantId);
    try {
      const result = await firestore.runTransaction(async (tx) => {
        const [rewardSnap, peopleSnap] = await Promise.all([tx.get(rewardRef), tx.get(peopleRef)]);
        if (!rewardSnap.exists) throw new functions.https.HttpsError('not-found', `reward ${playerRewardId} not found`);
        if (!peopleSnap.exists) throw new functions.https.HttpsError('not-found', `player ${tenantId} not found`);
        const reward = rewardSnap.data();
        if (reward.active === false) throw new functions.https.HttpsError('failed-precondition', `reward ${playerRewardId} is inactive`);
        const cost = Number(reward.cost || 0);
        if (cost <= 0) throw new functions.https.HttpsError('failed-precondition', `reward ${playerRewardId} has invalid cost`);
        const peopleData = peopleSnap.data() || {};
        const currentPoints = (peopleData.gamification && Number(peopleData.gamification.points)) || 0;
        if (currentPoints < cost) {
          throw new functions.https.HttpsError('failed-precondition', `insufficient points: have ${currentPoints}, need ${cost}`);
        }
        // Monthly quota enforcement (per-reward, per-player). Skipped when quota is unset/0.
        const monthlyQuota = Number(reward.monthlyQuota || 0);
        if (monthlyQuota > 0) {
          const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
          const prior = await tx.get(peopleRef.collection('redemptions').where('rewardId', '==', playerRewardId));
          let monthlyCount = 0;
          prior.forEach(d => {
            const ts = d.data().redeemedAt;
            const dt = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
            if (dt && dt >= monthStart) monthlyCount++;
          });
          if (monthlyCount >= monthlyQuota) {
            // Auto-generated message — no admin note text needed.
            const now = new Date();
            const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            const daysLeft = Math.ceil((nextMonth - now) / 86400000);
            throw new functions.https.HttpsError('failed-precondition',
              `ครบสิทธิ์เดือนนี้แล้ว (${monthlyCount}/${monthlyQuota} ครั้ง) · รออีก ${daysLeft} วันค่อยแลกใหม่ได้`);
          }
        }
        const newPoints = currentPoints - cost;
        const redemptionRef = peopleRef.collection('redemptions').doc();
        tx.set(redemptionRef, {
          rewardId: playerRewardId,
          rewardName: reward.name || '',
          cost,
          pointsBefore: currentPoints,
          pointsAfter: newPoints,
          redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
          tenantId,
          tenantName: peopleData.name || '',
          status: 'pending'
        });
        tx.update(peopleRef, {
          'gamification.points': newPoints,
          'gamification.totalRedeemed': admin.firestore.FieldValue.increment(cost),
          'gamification.lastRedeemedAt': admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true, rewardId: playerRewardId, rewardName: reward.name, cost, pointsBefore: currentPoints, pointsAfter: newPoints, redemptionId: redemptionRef.id };
      });
      console.log(`🎁 Player redeemed: ${tenantId} → ${playerRewardId} (cost=${result.cost}, remain=${result.pointsAfter})`);
      return result;
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error('❌ redeemReward (player) failed:', error);
      throw new functions.https.HttpsError('internal', error.message || 'transaction failed');
    }
  }
  // ── End player branch ────────────────────────────────────────────────────

  const { building, roomId, rewardId } = data || {};

  // Input validation — fail loudly so the tenant client surfaces the error
  if (!building || !roomId || !rewardId) {
    throw new functions.https.HttpsError('invalid-argument', 'building, roomId, rewardId are required');
  }
  if (!['rooms', 'nest'].includes(String(building).toLowerCase())) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(rewardId)) {
    throw new functions.https.HttpsError('invalid-argument', 'rewardId must be alphanumeric (max 60 chars)');
  }
  const canonicalBuilding = String(building).toLowerCase();

  // Ownership check — _authSoT 6-path model (admin / manager / claim /
  // tenantId-sot / uid-sot). The SoT fallback survives §7-Z claim-strip
  // windows so legitimate tenants whose ID token auto-refreshed past the
  // persistent-claim fix can still redeem without re-opening LIFF.
  await assertTenantAccess({
    building: canonicalBuilding,
    roomId:   String(roomId),
    context, firestore,
    HttpsError: functions.https.HttpsError,
  });

  const rewardRef = firestore.collection('rewards').doc(rewardId);
  const tenantRef = firestore.collection('tenants').doc(canonicalBuilding).collection('list').doc(String(roomId));

  try {
    const result = await firestore.runTransaction(async (tx) => {
      const [rewardSnap, tenantSnap] = await Promise.all([tx.get(rewardRef), tx.get(tenantRef)]);

      if (!rewardSnap.exists) {
        throw new functions.https.HttpsError('not-found', `reward ${rewardId} not found`);
      }
      if (!tenantSnap.exists) {
        throw new functions.https.HttpsError('not-found', `tenant ${canonicalBuilding}/${roomId} not found`);
      }

      const reward = rewardSnap.data();
      if (reward.active === false) {
        throw new functions.https.HttpsError('failed-precondition', `reward ${rewardId} is inactive`);
      }
      const cost = Number(reward.cost || 0);
      if (cost <= 0) {
        throw new functions.https.HttpsError('failed-precondition', `reward ${rewardId} has invalid cost`);
      }

      const tenantData = tenantSnap.data() || {};
      const currentPoints = (tenantData.gamification && Number(tenantData.gamification.points)) || 0;
      if (currentPoints < cost) {
        throw new functions.https.HttpsError('failed-precondition',
          `insufficient points: have ${currentPoints}, need ${cost}`);
      }

      // Monthly quota enforcement (per-reward, per-tenant). Skipped when unset/0.
      const monthlyQuota = Number(reward.monthlyQuota || 0);
      if (monthlyQuota > 0) {
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
        const prior = await tx.get(tenantRef.collection('redemptions').where('rewardId', '==', rewardId));
        let monthlyCount = 0;
        prior.forEach(d => {
          const ts = d.data().redeemedAt;
          const dt = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
          if (dt && dt >= monthStart) monthlyCount++;
        });
        if (monthlyCount >= monthlyQuota) {
          // Auto-generated message — no admin note text needed.
          const now = new Date();
          const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          const daysLeft = Math.ceil((nextMonth - now) / 86400000);
          throw new functions.https.HttpsError('failed-precondition',
            `ครบสิทธิ์เดือนนี้แล้ว (${monthlyCount}/${monthlyQuota} ครั้ง) · รออีก ${daysLeft} วันค่อยแลกใหม่ได้`);
        }
      }

      const newPoints = currentPoints - cost;

      // Append redemption record (auto-id) in same transaction
      const redemptionRef = tenantRef.collection('redemptions').doc();
      tx.set(redemptionRef, {
        rewardId,
        rewardName: reward.name || '',
        cost,
        pointsBefore: currentPoints,
        pointsAfter: newPoints,
        redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
        building: canonicalBuilding,
        room: String(roomId),
        tenantName: tenantData.name || '',
        status: 'pending'
      });

      tx.update(tenantRef, {
        'gamification.points': newPoints,
        'gamification.totalRedeemed': admin.firestore.FieldValue.increment(cost),
        'gamification.lastRedeemedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      return {
        success: true,
        rewardId,
        rewardName: reward.name,
        cost,
        pointsBefore: currentPoints,
        pointsAfter: newPoints,
        redemptionId: redemptionRef.id
      };
    });

    console.log(`🎁 Redeemed: ${canonicalBuilding}/${roomId} → ${rewardId} (cost=${result.cost}, remain=${result.pointsAfter})`);
    return result;
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ redeemReward failed:', error);
    throw new functions.https.HttpsError('internal', error.message || 'transaction failed');
  }
});
