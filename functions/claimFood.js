/**
 * claimFood — a neighbour claims an AVAILABLE food share (Meaning Layer #4).
 * Atomic single-winner: the transaction re-reads status==='available' (and
 * not-expired), so if two neighbours tap "ฉันเอา" at once only the first commits.
 *
 * On a successful claim the SHARER (not the claimer) earns peer-confirmed kindness
 * points — FOOD_SHARE_REWARD, capped per day (foodShareCapCheck on its own
 * gamification.foodShareDay/foodShareToday counter) — plus a pointsLedger row
 * (source:'food_share', discriminator = shareId → one award per share, ever).
 * This is the anti-farm model: a fake share nobody claims earns nothing, and a
 * colluding pair is bounded by the daily cap. Beyond the cap the claim still
 * completes (the share doc records the kindness for #6) but awards 0 points.
 *
 * Auth: claimer must be a tenant of the SAME building (assertTenantAccess + an
 * in-tx building check). §7-NN callable; LINE reuses the existing
 * LINE_CHANNEL_ACCESS_TOKEN secret (§7-WW-safe). Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { appendPointsLedger } = require('./_pointsLedger');
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { canClaim, foodShareCapCheck, FOOD_SHARE_REWARD, FOOD_SHARE_DAILY_CAP } = require('./_foodShareEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const MAX_NAME_LEN = 60;

function bkkDateString(d) { return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); }

function _claimedMessage(title, claimerName, awarded, capped) {
  let text = `🍲 มีเพื่อนบ้านมารับ “${title}” ของคุณแล้ว\n\nผู้รับ: ${claimerName}`;
  if (awarded > 0) text += `\nคุณได้รับ +${awarded} แต้มน้ำใจ 💚 ขอบคุณที่แบ่งปัน`;
  else if (capped) text += `\n(วันนี้รับแต้มแบ่งปันครบ ${FOOD_SHARE_DAILY_CAP}/วันแล้ว — แต่น้ำใจของคุณยังนับเข้าคะแนนน้ำใจ 💚)`;
  return { type: 'text', text };
}

exports.claimFood = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { shareId, building, roomId, claimerName } = data || {};
    if (!shareId) {
      throw new functions.https.HttpsError('invalid-argument', 'shareId is required');
    }
    if (!building || !roomId) {
      throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
    }
    const canonicalBuilding = String(building).toLowerCase();
    if (!['rooms', 'nest'].includes(canonicalBuilding)) {
      throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
    }

    // Auth: caller must be the tenant of THEIR room (the claimer's room).
    await assertTenantAccess({
      building: canonicalBuilding,
      roomId: String(roomId),
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    const claimerUid = context.auth.uid;
    const now = new Date();
    const nowMs = now.getTime();
    const shareRef = firestore.collection('foodShares').doc(String(shareId));

    const result = await firestore.runTransaction(async (tx) => {
      // ── All reads first (Firestore tx rule) ───────────────────────────────
      const snap = await tx.get(shareRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบรายการนี้');
      }
      const share = snap.data() || {};

      if (share.building !== canonicalBuilding) {
        throw new functions.https.HttpsError('permission-denied', 'รายการนี้อยู่คนละอาคาร');
      }

      const verdict = canClaim(share, claimerUid, nowMs);
      if (!verdict.ok) {
        if (verdict.reason === 'self-claim') {
          throw new functions.https.HttpsError('failed-precondition', 'รับของที่ตัวเองแบ่งไม่ได้');
        }
        if (verdict.reason === 'expired') {
          throw new functions.https.HttpsError('failed-precondition', 'รายการนี้หมดเวลาแล้ว');
        }
        throw new functions.https.HttpsError('failed-precondition', 'มีคนรับรายการนี้ไปแล้ว');
      }

      const sharerBuilding = String(share.building || '');
      const sharerRoom = String(share.room || '');
      const sharerTenantId = String(share.sharerTenantId
        || (sharerBuilding && sharerRoom ? `${sharerBuilding}_${sharerRoom}` : ''));

      let sharerRef = null;
      let sharerGami = null;
      if (sharerBuilding && sharerRoom && sharerTenantId) {
        sharerRef = firestore.collection('tenants').doc(sharerBuilding).collection('list').doc(sharerRoom);
        const sharerSnap = await tx.get(sharerRef);          // read BEFORE any write
        sharerGami = sharerSnap.exists ? ((sharerSnap.data() || {}).gamification || {}) : null;
      }

      // ── Writes ────────────────────────────────────────────────────────────
      let awarded = 0;
      let capped = false;
      if (sharerRef && sharerGami) {
        const today = bkkDateString(now);
        const cc = foodShareCapCheck({
          shareDay: sharerGami.foodShareDay, shareToday: sharerGami.foodShareToday,
          today, reward: FOOD_SHARE_REWARD, cap: FOOD_SHARE_DAILY_CAP,
        });
        awarded = cc.award;
        capped = cc.capped;
        const patch = { 'gamification.foodShareDay': today, 'gamification.foodShareToday': cc.newToday };
        if (awarded > 0) {
          const pointsAfter = (Number(sharerGami.points) || 0) + awarded;
          patch['gamification.points'] = pointsAfter;
          tx.update(sharerRef, patch);
          appendPointsLedger(tx, firestore, {
            tenantId: sharerTenantId,
            building: sharerBuilding,
            roomId: sharerRoom,
            source: 'food_share',
            discriminator: String(shareId),   // one award per share, ever
            points: awarded,
            balanceAfter: pointsAfter,
            by: claimerUid,
            refId: String(shareId),
            note: share.title || null,
          });
        } else {
          tx.update(sharerRef, patch);          // capped → counter only, no points/ledger
        }
      }

      const name = String(claimerName || `ห้อง ${roomId}`).trim().slice(0, MAX_NAME_LEN);
      tx.update(shareRef, {
        status: 'claimed',
        claimerUid,
        claimerTenantId: `${canonicalBuilding}_${roomId}`,
        claimerBuilding: canonicalBuilding,
        claimerRoom: String(roomId),
        claimerName: name,
        sharerPointsAwarded: awarded,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { sharerBuilding, sharerRoom, title: share.title || '', claimerName: name, awarded, capped };
    });

    // Best-effort LINE push to the sharer — never fails the claim.
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token && result.sharerBuilding && result.sharerRoom) {
        const { docs } = await lookupApprovedRoomUsers(firestore, result.sharerBuilding, result.sharerRoom);
        if (docs && docs.length) {
          await pushAndRetry({
            docs,
            message: _claimedMessage(result.title, result.claimerName, result.awarded, result.capped),
            token,
            source: 'claimFood',
            context: { building: result.sharerBuilding, roomId: result.sharerRoom, shareId },
            idempotencyKeyFn: (userId) => `food-${shareId}-claimed-${userId}`,
          });
        }
      }
    } catch (e) {
      console.warn('claimFood notify failed (non-fatal):', e.message);
    }

    return { success: true, shareId: String(shareId), awarded: result.awarded, capped: result.capped };
  });
