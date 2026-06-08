/**
 * completeHelpRequest — the REQUESTER confirms the help is done and rates the
 * helper 1-5 (Meaning Layer #2). This is the peer-confirmed award point: only
 * the helped party can mark done, so the helper can never self-farm kindness
 * points (§6 "never self-claim"; mirrors the quests `admin`-verify stance).
 *
 * On success (status accepted → done) the helper earns HELPER_REWARD_POINTS:
 *   - tenants/{helperBuilding}/list/{helperRoom}.gamification.points += reward
 *   - pointsLedger append (source:'help_completed', discriminator/refId = requestId)
 * both in ONE transaction (balance + event history never drift). Idempotent
 * twice over: the discriminator collapses the ledger row, and the status guard
 * (must be 'accepted', set to 'done' in the same tx) blocks a double-complete.
 * The ledger row feeds the future #6 Kindness score + #7 Verified Helper.
 *
 * The helper then gets a best-effort LINE push. §7-NN callable; LINE reuses the
 * existing LINE_CHANNEL_ACCESS_TOKEN secret (§7-WW-safe). Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { appendPointsLedger } = require('./_pointsLedger');
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { canComplete, isValidRating, sanitizeAppreciation, APPRECIATION_LABELS, HELPER_REWARD_POINTS, KINDNESS_DAILY_CAP, kindnessCapCheck, MAX_RATING_NOTE_LEN } = require('./_helpRequestEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

function bkkDateString(d) { return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); }

function _completedMessage(title, tags, note, awarded, capped) {
  const praise = (tags && tags.length) ? tags.map(k => APPRECIATION_LABELS[k] || k).join(' · ') : '';
  let text = `💚 ขอบคุณสำหรับน้ำใจ!\n\nเพื่อนบ้านยืนยันว่าคุณช่วย “${title}” เสร็จแล้ว`;
  if (praise) text += `\nคำชม: ${praise}`;
  if (note) text += `\n“${note}”`;
  if (awarded > 0) text += `\nคุณได้รับ +${awarded} แต้มน้ำใจ 💚`;
  else if (capped) text += `\n(วันนี้รับแต้มน้ำใจครบ ${KINDNESS_DAILY_CAP}/วันแล้ว — แต่น้ำใจของคุณยังนับเข้าคะแนนน้ำใจ 💚)`;
  return { type: 'text', text };
}

exports.completeHelpRequest = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { requestId, appreciationTags, rating, ratingNote } = data || {};
    if (!requestId) {
      throw new functions.https.HttpsError('invalid-argument', 'requestId is required');
    }
    // New: warm appreciation tags (the requester thanks, not grades). Legacy: a
    // 1-5 rating — still accepted so an old client mid-deploy doesn't break. At
    // least one is required.
    const tags = sanitizeAppreciation(appreciationTags);
    const hasTags = tags.length > 0;
    const hasRating = isValidRating(rating);
    if (!hasTags && !hasRating) {
      throw new functions.https.HttpsError('invalid-argument', 'กรุณาเลือกคำชมน้ำใจอย่างน้อย 1 อย่าง');
    }
    const callerUid = context.auth.uid;
    const ratingInt = hasRating ? Math.round(Number(rating)) : null;
    const now = new Date();
    const reqRef = firestore.collection('helpRequests').doc(String(requestId));

    const result = await firestore.runTransaction(async (tx) => {
      // ── All reads first (Firestore tx rule) ───────────────────────────────
      const snap = await tx.get(reqRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบคำขอนี้');
      }
      const req = snap.data() || {};

      const verdict = canComplete(req, callerUid);
      if (!verdict.ok) {
        if (verdict.reason === 'not-requester') {
          throw new functions.https.HttpsError('permission-denied', 'เฉพาะผู้ขอเท่านั้นที่ยืนยันได้');
        }
        if (verdict.reason === 'not-accepted') {
          throw new functions.https.HttpsError('failed-precondition',
            req.status === 'done' ? 'คำขอนี้เสร็จสิ้นแล้ว' : 'คำขอนี้ยังไม่มีผู้รับ');
        }
        throw new functions.https.HttpsError('failed-precondition', 'ไม่สามารถยืนยันคำขอนี้ได้');
      }

      const helperBuilding = String(req.helperBuilding || '');
      const helperRoom = String(req.helperRoom || '');
      const helperTenantId = String(req.helperTenantId
        || (helperBuilding && helperRoom ? `${helperBuilding}_${helperRoom}` : ''));

      let helperRef = null;
      let helperGami = null;
      if (helperBuilding && helperRoom && helperTenantId) {
        helperRef = firestore.collection('tenants').doc(helperBuilding).collection('list').doc(helperRoom);
        const helperSnap = await tx.get(helperRef);          // read BEFORE any write
        helperGami = helperSnap.exists ? ((helperSnap.data() || {}).gamification || {}) : null;
      }

      // ── Writes ────────────────────────────────────────────────────────────
      // Daily kindness-points cap: beyond it the help still completes + records
      // the kindness (feeds #6) + gives appreciation, but awards 0 more points.
      let awarded = 0;
      let capped = false;
      if (helperRef && helperGami) {
        const today = bkkDateString(now);
        const cc = kindnessCapCheck({
          kindnessDay: helperGami.kindnessDay, kindnessToday: helperGami.kindnessToday,
          today, reward: HELPER_REWARD_POINTS, cap: KINDNESS_DAILY_CAP,
        });
        awarded = cc.award;
        capped = cc.capped;
        // Always advance the daily counter (when capped it just stays at the cap).
        const patch = { 'gamification.kindnessDay': today, 'gamification.kindnessToday': cc.newToday };
        if (awarded > 0) {
          const pointsAfter = (Number(helperGami.points) || 0) + awarded;
          patch['gamification.points'] = pointsAfter;
          tx.update(helperRef, patch);
          appendPointsLedger(tx, firestore, {
            tenantId: helperTenantId,
            building: helperBuilding,
            roomId: helperRoom,
            source: 'help_completed',
            discriminator: String(requestId),   // one award per request, ever
            points: awarded,
            balanceAfter: pointsAfter,
            by: callerUid,
            refId: String(requestId),
            note: req.title || null,
          });
        } else {
          tx.update(helperRef, patch);          // capped → counter only, no points/ledger
        }
      }

      const cleanNote = ratingNote ? String(ratingNote).slice(0, MAX_RATING_NOTE_LEN) : null;
      tx.update(reqRef, {
        status: 'done',
        appreciationTags: hasTags ? tags : null,
        rating: ratingInt,                 // legacy/null — kept for back-compat display
        ratingNote: cleanNote,
        helperPointsAwarded: awarded,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        helperBuilding, helperRoom, title: req.title || '',
        tags: hasTags ? tags : [], note: cleanNote || '', awarded, capped,
      };
    });

    // Best-effort LINE push to the helper — never fails the completion.
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token && result.helperBuilding && result.helperRoom) {
        const { docs } = await lookupApprovedRoomUsers(firestore, result.helperBuilding, result.helperRoom);
        if (docs && docs.length) {
          await pushAndRetry({
            docs,
            message: _completedMessage(result.title, result.tags, result.note, result.awarded, result.capped),
            token,
            source: 'completeHelpRequest',
            context: { building: result.helperBuilding, roomId: result.helperRoom, requestId },
            idempotencyKeyFn: (userId) => `help-${requestId}-completed-${userId}`,
          });
        }
      }
    } catch (e) {
      console.warn('completeHelpRequest notify failed (non-fatal):', e.message);
    }

    return { success: true, requestId: String(requestId), tags: result.tags, awarded: result.awarded, capped: result.capped };
  });
