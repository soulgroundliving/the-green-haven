/**
 * expireBookingLocks — scheduled safety net that flips abandoned locks to
 * status='expired' so other prospects can grab the room.
 *
 * createBookingLock writes lockedUntil = now + 20min. If the prospect never
 * pays (closes browser, LINE crashes, etc.), the lock would stay forever
 * because there's no client-side cleanup. This scheduled job sweeps every
 * 5 minutes — worst-case ~25min lock duration, acceptable.
 *
 * Why every 5 minutes (not Firestore TTL): Firestore TTL deletes the doc,
 * losing the audit trail. We want expired locks visible to admins for
 * abandonment analytics. Setting status='expired' achieves that.
 *
 * Region: asia-southeast1, BKK timezone (matches other scheduled CFs)
 * Auth: scheduled — no caller
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const BATCH_LIMIT = 500;

exports.expireBookingLocks = functions
  .region('asia-southeast1')
  .pubsub
  .schedule('every 5 minutes')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();

    let snap;
    try {
      snap = await firestore
        .collection('bookings')
        .where('status', '==', 'locked')
        .where('lockedUntil', '<', now)
        .limit(BATCH_LIMIT)
        .get();
    } catch (e) {
      console.error('expireBookingLocks: query failed:', e.message);
      throw e;
    }

    if (snap.empty) {
      console.log('expireBookingLocks: no expired locks');
      return null;
    }

    const batch = firestore.batch();
    snap.docs.forEach(d => {
      batch.update(d.ref, {
        status: 'expired',
        expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    try {
      await batch.commit();
      console.log(`⏰ expireBookingLocks: expired ${snap.size} lock(s)`);
    } catch (e) {
      console.error('expireBookingLocks: batch commit failed:', e.message);
      throw e;
    }
    return null;
  });
