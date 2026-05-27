/**
 * claimContractQuizPoints — server-trusted contract quiz claim.
 *
 * The contract quiz is DYNAMIC: questions are derived from the tenant's own
 * lease (endDate, monthlyRent) plus 3-4 fixed policy questions. Tenant_app
 * shuffles the option order each time; the underlying answer values stay
 * fixed. Server grades by:
 *
 *   - kind 'leaseEndDate' → compare userAnswer to tenant.lease.endDate
 *   - kind 'monthlyRent'  → compare userAnswer to tenant.lease.monthlyRent
 *   - kind 'policy'       → look up question text in POLICY_ANSWERS map
 *
 * Caller sends back ONLY their chosen answer STRING per question — the option
 * shuffle is irrelevant to the server. Idempotency via subcollection marker
 * `tenants/{b}/list/{r}/contractQuizPassed/{ym}` (singleton per month — no
 * articleId since the contract quiz is single-shot per tenant per month).
 *
 * Reward = 20 pts per pass (constant CONTRACT_QUIZ_REWARD). Failed attempts
 * still write a marker (passed:false) but do NOT grant points. Pass threshold
 * is the same 2/3 (or 100% on shorter quizzes) as the wellness quiz to match
 * Session A client-side expectations.
 *
 * Tenant-only — players don't sign contracts so there is no player branch.
 *
 * Region: asia-southeast1.
 *
 * @see claimWellnessQuizPoints.js — same trust + idempotency pattern
 * @see CLAUDE.md §7-Z, §7-KK
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();

const CONTRACT_QUIZ_REWARD = 20;

// Canonical policy answers — same questions hardcoded in tenant_app
// buildContractQuiz pool (~line 12083). If admin ever changes these in
// tenant_app, mirror the change here.
const POLICY_ANSWERS = Object.freeze({
  'ต้องแจ้งย้ายออกล่วงหน้าอย่างน้อยกี่วัน?': '30 วัน',
  'เงินประกัน (deposit) ปกติกี่เดือน?':       '2 เดือน',
  'ผิดสัญญาก่อนครบกำหนด จะเสียอะไร?':         'ไม่ได้เงินประกันคืน',
  'ค่าเช่าต้องชำระภายในวันที่เท่าไรของเดือน?': 'วันที่ 5',
});

// Question text for the two lease-derived questions (used for `kind` recovery).
const QUESTION_TEXT = Object.freeze({
  leaseEndDate: 'สัญญาของคุณสิ้นสุดวันใด?',
  monthlyRent:  'ค่าเช่ารายเดือนของห้องคุณคือเท่าไร?',
});

function bkkMonthKey(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
}

// Strip non-digit characters so "8,500 บาท" / "8500 บาท" / "8500" all match.
function normalizeRent(s) {
  return String(s || '').replace(/[^0-9]/g, '');
}

// Tenant_app formats lease end-date as a string when building Q1 options; the
// shape varies (toLocaleDateString or string passthrough). For now, accept any
// string that resolves to the same canonical Asia/Bangkok yyyy-mm-dd as the
// stored lease.endDate. Caller is expected to send back the literal string
// shown in their option button.
function normalizeDate(s) {
  if (!s) return '';
  // Accept ISO date, locale-formatted, or any string; collapse whitespace.
  return String(s).trim().replace(/\s+/g, ' ');
}

function activeLeaseOf(tenantData) {
  if (!tenantData) return null;
  // Slim-tenant shape (Phase 4): lease subobject on tenant doc.
  if (tenantData.lease && typeof tenantData.lease === 'object') return tenantData.lease;
  // Legacy shape with embedded contract fields.
  if (tenantData.contract && typeof tenantData.contract === 'object') return tenantData.contract;
  return null;
}

function gradeAnswers(answers, lease) {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'answers required');
  }
  let correct = 0;
  for (const a of answers) {
    if (!a || typeof a !== 'object') continue;
    const kind = String(a.kind || '');
    const userAnswer = a.userAnswer != null ? String(a.userAnswer) : '';
    if (!userAnswer) continue;
    if (kind === 'leaseEndDate') {
      if (!lease) continue;
      const expected = normalizeDate(lease.endDate || lease.end_date || '');
      if (expected && normalizeDate(userAnswer) === expected) correct++;
    } else if (kind === 'monthlyRent') {
      if (!lease) continue;
      const expected = normalizeRent(lease.monthlyRent ?? lease.rent ?? '');
      if (expected && normalizeRent(userAnswer) === expected) correct++;
    } else if (kind === 'policy') {
      const q = String(a.q || '');
      const expected = POLICY_ANSWERS[q];
      if (expected && userAnswer === expected) correct++;
    }
    // Unknown kinds silently fail (no credit) — never throw, so an authoring
    // mistake on the client doesn't break the whole submission.
  }
  const total = answers.length;
  const passThreshold = total >= 3 ? 2 : total;
  return { correct, total, passThreshold, passed: correct >= passThreshold };
}

exports.claimContractQuizPoints = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  const { building, roomId, answers } = data || {};
  if (!building || !roomId) {
    throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
  }
  if (!['rooms', 'nest'].includes(String(building).toLowerCase())) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  const canonicalBuilding = String(building).toLowerCase();

  // §7-Z safe ownership check. Returns tenantData on Path 1b/2a, null on admin/manager.
  const access = await assertTenantAccess({
    building: canonicalBuilding,
    roomId:   String(roomId),
    context, firestore,
    HttpsError: functions.https.HttpsError,
  });

  const tenantRef = firestore.collection('tenants').doc(canonicalBuilding).collection('list').doc(String(roomId));
  const now = new Date();
  const ym = bkkMonthKey(now);
  const markerRef = tenantRef.collection('contractQuizPassed').doc(ym);

  try {
    const result = await firestore.runTransaction(async (tx) => {
      const tenantSnap = await tx.get(tenantRef);
      if (!tenantSnap.exists) {
        throw new functions.https.HttpsError('not-found',
          `tenant ${canonicalBuilding}/${roomId} not found`);
      }
      const markerSnap = await tx.get(markerRef);
      if (markerSnap.exists) {
        throw new functions.https.HttpsError('already-exists', 'ทำ quiz เดือนนี้แล้ว');
      }
      const tenantData = access.tenantData || tenantSnap.data() || {};
      const lease = activeLeaseOf(tenantData);
      const grade = gradeAnswers(answers, lease);
      const g = tenantData.gamification || {};
      const reward = grade.passed ? CONTRACT_QUIZ_REWARD : 0;
      const currentPoints = Number(g.points) || 0;
      const pointsAfter = currentPoints + reward;
      tx.set(markerRef, {
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
          'gamification.contractQuizPts': (Number(g.contractQuizPts) || 0) + reward,
        });
      }
      return {
        success: true,
        passed: grade.passed,
        score: grade.correct,
        total: grade.total,
        passThreshold: grade.passThreshold,
        pointsBefore: currentPoints,
        pointsAfter,
        reward,
      };
    });

    console.info(`📜 Contract quiz: ${canonicalBuilding}/${roomId} passed=${result.passed} +${result.reward}`);
    return result;
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ claimContractQuizPoints failed:', error);
    throw new functions.https.HttpsError('internal', error.message || 'transaction failed');
  }
});

// Exported for unit tests; do not call directly.
exports._internal = {
  gradeAnswers,
  bkkMonthKey,
  activeLeaseOf,
  normalizeRent,
  normalizeDate,
  POLICY_ANSWERS,
  CONTRACT_QUIZ_REWARD,
};
