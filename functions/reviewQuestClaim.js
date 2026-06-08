/**
 * reviewQuestClaim — admin approves / rejects a pending `admin`-mode quest claim
 * (Meaning Layer #1). The honest half of the Kindness feed (#6): a human confirms
 * the real-world action before any points move.
 *
 * approve → credit the claim's stored reward to the tenant's balance, mirror
 *           gamification.questsToday[questId]='approved', append the pointsLedger
 *           row (source:'quest'), and stamp the claim approved. The in-tx
 *           status==='pending' check is the idempotency fence — a double-approve
 *           is a no-op, never a double-credit.
 * reject  → stamp the claim rejected + mirror questsToday='rejected' (the tenant
 *           may re-claim). No balance change, no ledger.
 *
 * §7-NN: callable, not a Firestore trigger. §7-I: invoked from an explicit admin
 * tap in the dashboard review queue, never auto-clicked. Admin claim required.
 * Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { appendPointsLedger } = require('./_pointsLedger');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

exports.reviewQuestClaim = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  if ((context.auth.token || {}).admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Admin claim required');
  }

  const { claimId, decision } = data || {};
  if (!claimId) {
    throw new functions.https.HttpsError('invalid-argument', 'claimId is required');
  }
  if (decision !== 'approve' && decision !== 'reject') {
    throw new functions.https.HttpsError('invalid-argument', "decision must be 'approve' or 'reject'");
  }

  const claimRef = firestore.collection('questClaims').doc(String(claimId));

  try {
    return await firestore.runTransaction(async (tx) => {
      const claimSnap = await tx.get(claimRef);
      if (!claimSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบคำขอเควสนี้');
      }
      const claim = claimSnap.data() || {};

      // Idempotency fence: only a still-pending claim can be acted on.
      if (claim.status !== 'pending') {
        throw new functions.https.HttpsError('failed-precondition',
          `คำขอนี้ถูก${claim.status === 'approved' ? 'อนุมัติ' : 'ดำเนินการ'}ไปแล้ว`);
      }

      const { questId, tenantId, building, roomId, periodKey } = claim;
      const reward = Math.max(0, Math.floor(Number(claim.points) || 0));

      // Resolve the owning gamification doc (tenant room, else player people doc).
      const targetRef = (building && roomId)
        ? firestore.collection('tenants').doc(building).collection('list').doc(String(roomId))
        : firestore.collection('people').doc(String(tenantId));
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบบัญชีผู้เช่า/สมาชิก');
      }
      const g = (targetSnap.data() || {}).gamification || {};

      const reviewStamp = {
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedBy: context.auth.uid,
      };

      if (decision === 'reject') {
        const questsToday = { ...(g.questsToday || {}) };
        questsToday[questId] = { status: 'rejected', periodKey, points: 0 };
        tx.update(targetRef, { 'gamification.questsToday': questsToday });
        tx.set(claimRef, { ...claim, status: 'rejected', ...reviewStamp });
        return { success: true, decision: 'reject', questId };
      }

      // approve → credit reward
      const currentPoints = Number(g.points) || 0;
      const pointsAfter = currentPoints + reward;
      const questsToday = { ...(g.questsToday || {}) };
      questsToday[questId] = { status: 'approved', periodKey, points: reward };

      const patch = { 'gamification.questsToday': questsToday };
      if (reward > 0) patch['gamification.points'] = pointsAfter;
      tx.update(targetRef, patch);

      tx.set(claimRef, { ...claim, status: 'approved', ...reviewStamp });

      if (reward > 0) {
        appendPointsLedger(tx, firestore, {
          tenantId,
          building: building || null,
          roomId: roomId || null,
          source: 'quest',
          discriminator: `${questId}__${periodKey}`,
          points: reward,
          balanceAfter: pointsAfter,
          by: context.auth.uid,
          refId: questId,
          note: claim.questTitle || null,
        });
      }

      return { success: true, decision: 'approve', questId, reward, pointsAfter };
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ reviewQuestClaim failed:', error);
    throw new functions.https.HttpsError('internal', error.message || 'transaction failed');
  }
});
