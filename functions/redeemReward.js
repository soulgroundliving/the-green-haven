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
 * Auth: relaxed for now — tenant app has no Firebase auth signin (room = lookup
 *       key), so we trust caller's building+roomId. Tighten when LIFF auth lands.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();

exports.redeemReward = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  const { building, roomId, rewardId } = data || {};

  // Input validation — fail loudly so the tenant client surfaces the error
  if (!building || !roomId || !rewardId) {
    throw new functions.https.HttpsError('invalid-argument', 'building, roomId, rewardId are required');
  }
  if (!['rooms', 'nest'].includes(String(building).toLowerCase())) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  const canonicalBuilding = String(building).toLowerCase();

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
