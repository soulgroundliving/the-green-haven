/**
 * claimWellnessQuizPoints — server-trusted wellness article quiz claim.
 *
 * Replaces client-side localStorage trust (Session A `awardQuizPoints` direct
 * point write). Server reads canonical quiz from wellness_articles/{articleId},
 * grades caller's answers, decides pass/fail + reward, and writes idempotent
 * marker subcollection doc.
 *
 * Schema:
 *   - Tenant marker: tenants/{building}/list/{roomId}/wellnessQuizPassed/{articleId}_{ym}
 *   - Player marker: people/{tenantId}/wellnessQuizPassed/{articleId}_{ym}
 *   - Marker doc fields: { articleId, monthKey, passed, score, total, passThreshold,
 *                          reward, at: serverTimestamp() }
 *
 * Idempotency key = `{articleId}_{ym}` — caller can attempt the quiz multiple
 * times within a month, but only the FIRST submission writes a marker. Second
 * call throws `already-exists`. Pass/fail of first attempt is final until next
 * month.
 *
 * Reward = 10 pts per pass (constant WELLNESS_QUIZ_REWARD); failed attempts
 * still write a marker (passed:false) but do NOT increment points. This blocks
 * "fail then immediately re-try" gaming.
 *
 * Pass threshold = ≥2 correct on 3-q quiz; 100% on shorter quizzes (matches
 * Session A client-side rule).
 *
 * Region: asia-southeast1 (matches claimDailyLoginPoints / redeemReward /
 * verifySlip).
 *
 * @see CLAUDE.md §7-Z, §7-KK — server-side trust closes localStorage marker race
 * @see lifecycle_wellness_claim.md — quiz extension section
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { appendPointsLedger } = require('./_pointsLedger');

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();

const WELLNESS_QUIZ_REWARD = 10;

function bkkMonthKey(d) {
  // Asia/Bangkok is UTC+7 with no DST.
  // 'en-CA' locale formats YYYY-MM-DD; slice the YYYY-MM prefix.
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
}

function gradeAnswers(quiz, answers) {
  if (!Array.isArray(quiz) || quiz.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'article has no quiz');
  }
  if (!Array.isArray(answers) || answers.length !== quiz.length) {
    throw new functions.https.HttpsError('invalid-argument',
      `expected ${quiz.length} answers, got ${Array.isArray(answers) ? answers.length : 'none'}`);
  }
  let correct = 0;
  quiz.forEach((q, i) => {
    if (typeof q.correctIdx === 'number' && answers[i] === q.correctIdx) correct++;
  });
  const total = quiz.length;
  const passThreshold = total >= 3 ? 2 : total;
  return { correct, total, passThreshold, passed: correct >= passThreshold };
}

async function readArticleQuiz(articleId) {
  const snap = await firestore.collection('wellness_articles').doc(String(articleId)).get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', `wellness article ${articleId} not found`);
  }
  const data = snap.data() || {};
  if (!Array.isArray(data.quiz) || data.quiz.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'article has no quiz');
  }
  return data.quiz;
}

exports.claimWellnessQuizPoints = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  const { building, roomId, tenantId: reqTenantId, articleId, answers } = data || {};
  if (!articleId) {
    throw new functions.https.HttpsError('invalid-argument', 'articleId is required');
  }
  const aid = String(articleId);
  const now = new Date();
  const ym = bkkMonthKey(now);
  const markerId = `${aid}_${ym}`;
  const quiz = await readArticleQuiz(aid);
  const grade = gradeAnswers(quiz, answers);

  // ── Player (community member) path ────────────────────────────────────────
  if (reqTenantId && !building && !roomId) {
    const tok = context.auth.token || {};
    if (tok.role !== 'player' || tok.tenantId !== String(reqTenantId)) {
      throw new functions.https.HttpsError('permission-denied',
        'You can only claim quiz points for your own player account');
    }
    const tenantId = String(reqTenantId);
    const peopleRef = firestore.collection('people').doc(tenantId);
    const markerRef = peopleRef.collection('wellnessQuizPassed').doc(markerId);
    try {
      const result = await firestore.runTransaction(async tx => {
        const peopleSnap = await tx.get(peopleRef);
        if (!peopleSnap.exists) {
          throw new functions.https.HttpsError('not-found', `player ${tenantId} not found`);
        }
        const markerSnap = await tx.get(markerRef);
        if (markerSnap.exists) {
          throw new functions.https.HttpsError('already-exists', 'ทำ quiz บทความนี้แล้วเดือนนี้');
        }
        const g = (peopleSnap.data() || {}).gamification || {};
        const reward = grade.passed ? WELLNESS_QUIZ_REWARD : 0;
        const currentPoints = Number(g.points) || 0;
        const pointsAfter = currentPoints + reward;
        tx.set(markerRef, {
          articleId: aid,
          monthKey: ym,
          passed: grade.passed,
          score: grade.correct,
          total: grade.total,
          passThreshold: grade.passThreshold,
          reward,
          at: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (reward > 0) {
          tx.update(peopleRef, {
            'gamification.points': pointsAfter,
            'gamification.wellnessPts': (Number(g.wellnessPts) || 0) + reward,
          });
          appendPointsLedger(tx, firestore, {
            tenantId, source: 'wellness_quiz', discriminator: markerId,
            points: reward, balanceAfter: pointsAfter,
            by: context.auth?.uid, refId: markerId,
          });
        }
        return { pointsBefore: currentPoints, pointsAfter, reward };
      });
      return {
        success: true,
        passed: grade.passed,
        score: grade.correct,
        total: grade.total,
        passThreshold: grade.passThreshold,
        ...result,
      };
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error('❌ claimWellnessQuizPoints (player) failed:', error);
      throw new functions.https.HttpsError('internal', error.message || 'transaction failed');
    }
  }

  // ── Regular tenant path ───────────────────────────────────────────────────
  if (!building || !roomId) {
    throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
  }
  if (!['rooms', 'nest'].includes(String(building).toLowerCase())) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  const canonicalBuilding = String(building).toLowerCase();

  // §7-Z safe ownership check — SoT fallback survives claim-strip windows.
  await assertTenantAccess({
    building: canonicalBuilding,
    roomId:   String(roomId),
    context, firestore,
    HttpsError: functions.https.HttpsError,
  });

  const tenantRef = firestore.collection('tenants').doc(canonicalBuilding).collection('list').doc(String(roomId));
  const markerRef = tenantRef.collection('wellnessQuizPassed').doc(markerId);

  try {
    const result = await firestore.runTransaction(async (tx) => {
      const tenantSnap = await tx.get(tenantRef);
      if (!tenantSnap.exists) {
        throw new functions.https.HttpsError('not-found',
          `tenant ${canonicalBuilding}/${roomId} not found`);
      }
      const markerSnap = await tx.get(markerRef);
      if (markerSnap.exists) {
        throw new functions.https.HttpsError('already-exists', 'ทำ quiz บทความนี้แล้วเดือนนี้');
      }
      const g = (tenantSnap.data() || {}).gamification || {};
      const reward = grade.passed ? WELLNESS_QUIZ_REWARD : 0;
      const currentPoints = Number(g.points) || 0;
      const pointsAfter = currentPoints + reward;
      tx.set(markerRef, {
        articleId: aid,
        monthKey: ym,
        passed: grade.passed,
        score: grade.correct,
        total: grade.total,
        passThreshold: grade.passThreshold,
        reward,
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (reward > 0) {
        tx.update(tenantRef, {
          'gamification.points': pointsAfter,
          'gamification.wellnessPts': (Number(g.wellnessPts) || 0) + reward,
        });
        appendPointsLedger(tx, firestore, {
          tenantId: (tenantSnap.data() || {}).tenantId || `${canonicalBuilding}_${roomId}`,
          building: canonicalBuilding,
          roomId: String(roomId),
          source: 'wellness_quiz', discriminator: markerId,
          points: reward, balanceAfter: pointsAfter,
          by: context.auth?.uid, refId: markerId,
        });
      }
      return { pointsBefore: currentPoints, pointsAfter, reward };
    });

    return {
      success: true,
      passed: grade.passed,
      score: grade.correct,
      total: grade.total,
      passThreshold: grade.passThreshold,
      ...result,
    };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ claimWellnessQuizPoints failed:', error);
    throw new functions.https.HttpsError('internal', error.message || 'transaction failed');
  }
});

// Exported for unit tests; do not call directly.
exports._internal = { gradeAnswers, bkkMonthKey, WELLNESS_QUIZ_REWARD };
