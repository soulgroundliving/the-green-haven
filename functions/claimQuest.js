/**
 * claimQuest — tenant taps "รับ" on a Community Quest (Meaning Layer #1).
 *
 * ONE unified tap-to-claim entry point; the quest's `verifyMode` decides what a
 * tap does (all server-authoritative — the client never sends a point value):
 *   - 'self'  → award immediately; idempotent per period + per-tenant daily cap.
 *   - 'auto'  → server RE-DERIVES the signal (login streak / check-in / monthly
 *               meter use) and awards only if satisfied. Tamper-proof.
 *   - 'admin' → write a `pending` claim, NO award; the owner approves later via
 *               reviewQuestClaim. The honest feed for #6 Kindness.
 *
 * Per-period idempotency + immutable audit + the admin review queue all live in
 * questClaims/{questId}__{tenantId}__{periodKey}. The tenant's cheap checklist
 * state is mirrored onto gamification.questsToday[questId] (read by the existing
 * eco-points onSnapshot — no new tenant read path, and gamification.* is already
 * rule-protected so it can't be self-set, §6).
 *
 * §7-NN: callable, not a Firestore trigger. §7-I: explicit tenant tap, never an
 * auto-click. Region asia-southeast1 (matches every points CF).
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { appendPointsLedger } = require('./_pointsLedger');
const {
  periodKeyFor, resolveState, isClaimableState,
  evaluateAutoSignal, selfCapCheck,
  isValidVerifyMode,
} = require('./_questEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

function bkkDateString(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/**
 * Electric units used (eNew-eOld) for this room's current vs previous month,
 * read from meter_data/{building}_{BE2yr}_{month}_{roomId} (§7-E: year is a
 * 2-digit BE integer; §7-AAA: month is unpadded). Returns {} on any gap so the
 * engine reports 'no-meter-data' and the quest simply stays unclaimable.
 */
async function _fetchEnergySignal(building, roomId, now) {
  if (!building || !roomId) return {};
  const ceYear = Number(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }));
  const month = Number(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', month: 'numeric' }));
  const be2 = (ceYear + 543) % 100;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevBe2 = month === 1 ? (be2 + 99) % 100 : be2; // 1 BE-year back, mod 100
  const curId = `${building}_${be2}_${month}_${roomId}`;
  const prevId = `${building}_${prevBe2}_${prevMonth}_${roomId}`;
  try {
    const [curSnap, prevSnap] = await Promise.all([
      firestore.collection('meter_data').doc(curId).get(),
      firestore.collection('meter_data').doc(prevId).get(),
    ]);
    if (!curSnap.exists || !prevSnap.exists) return {};
    const c = curSnap.data() || {};
    const p = prevSnap.data() || {};
    const currentKwh = Number(c.eNew) - Number(c.eOld);
    const previousKwh = Number(p.eNew) - Number(p.eOld);
    if (!Number.isFinite(currentKwh) || !Number.isFinite(previousKwh)) return {};
    return { currentKwh, previousKwh };
  } catch (e) {
    console.warn('[claimQuest] energy signal read failed:', e && e.message);
    return {};
  }
}

/**
 * The award/claim transaction, shared by the tenant + player paths.
 * @param {DocumentReference} ref   tenants/{b}/list/{r} OR people/{tenantId}
 * @param {object} identity         { tenantId?, building, roomId } (building/roomId null for players)
 * @param {object} energySignal     pre-fetched { currentKwh, previousKwh } or {}
 */
async function _runClaim({ ref, identity, questId, quest, note, energySignal, context, now }) {
  const today = bkkDateString(now);
  const periodKey = periodKeyFor(quest, now);
  const reward = Math.max(0, Math.floor(Number(quest.rewardPoints) || 0));

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'ไม่พบบัญชีผู้ใช้');
    }
    const d = snap.data() || {};
    const g = d.gamification || {};
    const tenantId = identity.tenantId || d.tenantId
      || (identity.building && identity.roomId ? `${identity.building}_${identity.roomId}` : '');
    if (!tenantId) {
      throw new functions.https.HttpsError('failed-precondition', 'ไม่พบรหัสผู้เช่า');
    }

    const claimRef = firestore.collection('questClaims').doc(`${questId}__${tenantId}__${periodKey}`);
    const claimSnap = await tx.get(claimRef);
    const existing = claimSnap.exists ? (claimSnap.data() || {}) : null;

    const state = resolveState(quest, existing, now);
    if (!isClaimableState(state)) {
      throw new functions.https.HttpsError('already-exists',
        state === 'pending' ? 'ส่งคำขอเควสนี้แล้ว กำลังรอตรวจสอบ' : 'รับเควสนี้ไปแล้ว');
    }

    // ── Decide outcome by verifyMode ─────────────────────────────────────────
    let status;   // 'self' | 'auto' | 'pending'
    let award = 0;

    if (quest.verifyMode === 'admin') {
      status = 'pending';            // no award yet — owner reviews
    } else if (quest.verifyMode === 'self') {
      const cap = selfCapCheck({
        questDay: g.questDay, questSelfToday: g.questSelfToday,
        today, reward, cap: quest.selfDailyCap,
      });
      if (!cap.allowed) {
        throw new functions.https.HttpsError('resource-exhausted',
          `วันนี้รับเควสครบโควต้าแล้ว (${cap.cap} แต้ม/วัน)`);
      }
      status = 'self';
      award = reward;
    } else { // 'auto'
      const signalData = {
        checkedInToday: g.lastDailyClaim === today,
        dailyStreak: Number(g.dailyStreak) || 0,
        ...energySignal,
      };
      const verdict = evaluateAutoSignal(quest, signalData);
      if (!verdict.satisfied) {
        throw new functions.https.HttpsError('failed-precondition', 'ยังทำภารกิจนี้ไม่ครบ');
      }
      status = 'auto';
      award = reward;
    }

    // ── Build the tenant-doc patch ───────────────────────────────────────────
    // questsToday/claim carry the quest's full `reward` (its worth — shown as
    // "+N" even while pending); the BALANCE only moves by `award` (0 until an
    // admin approves a pending claim, then reviewQuestClaim credits reward).
    const questsToday = { ...(g.questsToday || {}) };
    questsToday[questId] = { status, periodKey, points: reward };
    const patch = { 'gamification.questsToday': questsToday };

    let pointsAfter;
    if (award > 0) {
      const currentPoints = Number(g.points) || 0;
      pointsAfter = currentPoints + award;
      patch['gamification.points'] = pointsAfter;
      if (status === 'self') {
        const prior = g.questDay === today ? (Number(g.questSelfToday) || 0) : 0;
        patch['gamification.questSelfToday'] = prior + award;
        patch['gamification.questDay'] = today;
      }
    }
    tx.update(ref, patch);

    // ── Immutable claim record (idempotency fence + admin review queue) ──────
    tx.set(claimRef, {
      questId,
      questTitle: quest.title || '',
      tenantId,
      building: identity.building || null,
      roomId: identity.roomId || null,
      status,
      periodKey,
      cadence: quest.cadence || 'daily',
      verifyMode: quest.verifyMode,
      points: reward,
      note: note ? String(note).slice(0, 280) : null,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // ── Ledger (award paths only) ────────────────────────────────────────────
    if (award > 0) {
      appendPointsLedger(tx, firestore, {
        tenantId,
        building: identity.building || null,
        roomId: identity.roomId || null,
        source: 'quest',
        discriminator: `${questId}__${periodKey}`,
        points: award,
        balanceAfter: pointsAfter,
        by: context.auth && context.auth.uid,
        refId: questId,
        note: quest.title || null,
      });
    }

    return { success: true, status, reward: award, pointsAfter };
  });
}

exports.claimQuest = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  const { building, roomId, questId, tenantId: reqTenantId, note } = data || {};
  if (!questId) {
    throw new functions.https.HttpsError('invalid-argument', 'questId is required');
  }

  // Load the catalog doc (admin-authored). Not transactional with the award —
  // a mid-flight edit is negligible and the period/idempotency still holds.
  const questSnap = await firestore.collection('quests').doc(String(questId)).get();
  if (!questSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'ไม่พบเควสนี้');
  }
  const quest = questSnap.data() || {};
  if (quest.active === false) {
    throw new functions.https.HttpsError('failed-precondition', 'เควสนี้ปิดอยู่');
  }
  if (!isValidVerifyMode(quest.verifyMode)) {
    throw new functions.https.HttpsError('failed-precondition', 'เควสตั้งค่าไม่ถูกต้อง');
  }
  const now = new Date();

  // ── Player path: { tenantId } + role:'player' → people/{tenantId} ─────────
  if (reqTenantId && !building && !roomId) {
    const tok = context.auth.token || {};
    if (tok.role !== 'player' || tok.tenantId !== String(reqTenantId)) {
      throw new functions.https.HttpsError('permission-denied',
        'You can only claim quests for your own player account');
    }
    try {
      return await _runClaim({
        ref: firestore.collection('people').doc(String(reqTenantId)),
        identity: { tenantId: String(reqTenantId), building: null, roomId: null },
        questId: String(questId), quest, note, energySignal: {}, context, now,
      });
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error('❌ claimQuest (player) failed:', error);
      throw new functions.https.HttpsError('internal', error.message || 'transaction failed');
    }
  }

  // ── Tenant path: { building, roomId } ────────────────────────────────────
  if (!building || !roomId) {
    throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
  }
  if (!['rooms', 'nest'].includes(String(building).toLowerCase())) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  const canonicalBuilding = String(building).toLowerCase();

  await assertTenantAccess({
    building: canonicalBuilding,
    roomId: String(roomId),
    context, firestore,
    HttpsError: functions.https.HttpsError,
  });

  const energySignal = (quest.verifyMode === 'auto' && quest.autoSignal === 'energy_month_saver')
    ? await _fetchEnergySignal(canonicalBuilding, String(roomId), now)
    : {};

  try {
    return await _runClaim({
      ref: firestore.collection('tenants').doc(canonicalBuilding).collection('list').doc(String(roomId)),
      identity: { building: canonicalBuilding, roomId: String(roomId) },
      questId: String(questId), quest, note, energySignal, context, now,
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ claimQuest failed:', error);
    throw new functions.https.HttpsError('internal', error.message || 'transaction failed');
  }
});
