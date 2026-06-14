/**
 * cancelPetPlaydate — the host (or an admin) cancels a playdate (Meaning Layer
 * #11). Flips petPlaydates/{id} → status:'cancelled' inside a transaction
 * (single-winner: a double-tap can only commit once), then best-effort LINE
 * pushes EVERY joined attendee EXCEPT the host (D3 — notify attendees on cancel
 * only; the host knows). Each recipient gets a unique idempotency key so a retry
 * never double-sends.
 *
 * Auth: host room (playdate.hostRoom == caller's room) or admin. No points (D7).
 *
 * §7-NN callable (never a Firestore trigger). LINE notify reuses the existing
 * LINE_CHANNEL_ACCESS_TOKEN secret (§7-WW-safe). Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { canCancel } = require('./_petPlaydateEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

function _cancelledMessage(title, hostName) {
  return {
    type: 'text',
    text: `🐾 นัดเล่น "${title || 'นัดเล่นของน้อง'}" ถูกยกเลิกแล้ว` +
      (hostName ? `\nโดย: ${hostName}` : '') +
      `\n\nเปิดแอป → Pet Park → นัดเล่น เพื่อหานัดอื่น`,
  };
}

exports.cancelPetPlaydate = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { building, roomId, playdateId } = data || {};
    if (!building || !roomId || !playdateId) {
      throw new functions.https.HttpsError('invalid-argument',
        'building, roomId and playdateId are required');
    }
    const canonicalBuilding = String(building).toLowerCase();
    if (!['rooms', 'nest'].includes(canonicalBuilding)) {
      throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
    }
    const room = String(roomId);
    const isAdmin = (context.auth.token || {}).admin === true;

    // Auth: caller must be the tenant of THEIR room (the host's room) — or admin.
    await assertTenantAccess({
      building: canonicalBuilding, roomId: room,
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    const ref = firestore.collection('petPlaydates').doc(String(playdateId));

    const result = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบนัดเล่นนี้');
      }
      const playdate = snap.data() || {};

      const verdict = canCancel(playdate, canonicalBuilding, room, { isAdmin });
      if (!verdict.ok) {
        const code = verdict.reason === 'not-found' ? 'not-found'
          : (verdict.reason === 'not-host' || verdict.reason === 'cross-building') ? 'permission-denied'
            : 'failed-precondition';
        const msg = verdict.reason === 'already-cancelled' ? 'นัดเล่นนี้ถูกยกเลิกไปแล้ว'
          : (verdict.reason === 'not-host' || verdict.reason === 'cross-building') ? 'ยกเลิกนัดนี้ไม่ได้'
            : 'ยกเลิกไม่ได้';
        throw new functions.https.HttpsError(code, msg);
      }

      tx.update(ref, {
        status: 'cancelled',
        cancelledBy: isAdmin ? 'admin' : 'host',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        title: String(playdate.title || ''),
        hostName: String(playdate.hostName || ''),
        hostRoom: String(playdate.hostRoom || ''),
        attendees: Array.isArray(playdate.attendees) ? playdate.attendees : [],
      };
    });

    // Best-effort LINE push to every joined attendee EXCEPT the host (D3). Never
    // fails the cancel. One idempotency key per recipient room so a retry can't
    // double-send.
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token) {
        const message = _cancelledMessage(result.title, result.hostName);
        // De-dup rooms (a room holds one slot, but guard anyway) and drop the host.
        const rooms = [...new Set(
          result.attendees
            .map((a) => String(a && a.room || ''))
            .filter((r) => r && r !== result.hostRoom),
        )];
        for (const attendeeRoom of rooms) {
          const { docs } = await lookupApprovedRoomUsers(firestore, canonicalBuilding, attendeeRoom);
          if (docs && docs.length) {
            await pushAndRetry({
              docs,
              message,
              token,
              source: 'cancelPetPlaydate',
              context: { building: canonicalBuilding, roomId: attendeeRoom, playdateId: String(playdateId) },
              idempotencyKeyFn: (userId) => `playdate-cancel-${playdateId}-${userId}`,
            });
          }
        }
      }
    } catch (e) {
      console.warn('cancelPetPlaydate notify failed (non-fatal):', e.message);
    }

    return { success: true, playdateId: String(playdateId), status: 'cancelled' };
  });
