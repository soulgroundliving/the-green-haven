/**
 * claimDailyLoginPoints — daily check-in reward with 7-day streak bonus.
 *
 * Schema (per SSoT shared/gamification-rules.js EARNING_SOURCES.daily_login):
 *   Base: +1 pt/day. Every 7th consecutive day: +3 bonus.
 *
 * Persists to tenants/{building}/list/{roomId}.gamification:
 *   - points: running total (shared with verifySlip/redeemReward)
 *   - lastDailyClaim: "YYYY-MM-DD" in Asia/Bangkok (idempotency key)
 *   - dailyStreak: consecutive-day counter (resets to 1 on gap)
 *   - lastDailyClaimAt: serverTimestamp (for audit)
 *
 * Transaction prevents double-claim when the tenant taps twice quickly.
 * Region: asia-southeast1 (matches redeemReward / verifySlip).
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();

function bkkDateString(d) {
  // 'en-CA' locale emits YYYY-MM-DD. Asia/Bangkok is UTC+7 (no DST).
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

exports.claimDailyLoginPoints = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  const { building, roomId } = data || {};

  if (!building || !roomId) {
    throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
  }
  if (!['rooms', 'nest'].includes(String(building).toLowerCase())) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  const canonicalBuilding = String(building).toLowerCase();
  const tenantRef = firestore.collection('tenants').doc(canonicalBuilding).collection('list').doc(String(roomId));

  const now = new Date();
  const today = bkkDateString(now);
  const yesterday = bkkDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  try {
    const result = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(tenantRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', `tenant ${canonicalBuilding}/${roomId} not found`);
      }
      const d = snap.data() || {};
      const g = d.gamification || {};
      if (g.lastDailyClaim === today) {
        throw new functions.https.HttpsError('already-exists', 'รับพ้อยท์ของวันนี้ไปแล้วครับ');
      }

      const prevStreak = Number(g.dailyStreak) || 0;
      const streak = g.lastDailyClaim === yesterday ? prevStreak + 1 : 1;
      const bonus = streak > 0 && streak % 7 === 0 ? 3 : 0;
      const reward = 1 + bonus;

      const currentPoints = Number(g.points) || 0;
      const pointsAfter = currentPoints + reward;

      tx.update(tenantRef, {
        'gamification.points': pointsAfter,
        'gamification.lastDailyClaim': today,
        'gamification.dailyStreak': streak,
        'gamification.lastDailyClaimAt': admin.firestore.FieldValue.serverTimestamp()
      });

      return { pointsBefore: currentPoints, pointsAfter, reward, bonus, streak };
    });

    console.log(`📱 Daily check-in: ${canonicalBuilding}/${roomId} +${result.reward} (streak=${result.streak}, bonus=${result.bonus})`);
    return { success: true, ...result };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ claimDailyLoginPoints failed:', error);
    throw new functions.https.HttpsError('internal', error.message || 'transaction failed');
  }
});
