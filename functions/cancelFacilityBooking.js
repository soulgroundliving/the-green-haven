/**
 * cancelFacilityBooking — cancel a confirmed facility slot booking.
 *
 * Tenants may cancel their own future bookings.
 * Admins may cancel any booking.
 * Past-date bookings cannot be cancelled.
 *
 * Input:  { bookingId: string }
 * Returns: { cancelled: true }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

exports.cancelFacilityBooking = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { bookingId } = data || {};
    if (!bookingId || typeof bookingId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'bookingId is required');
    }

    const tok = context.auth.token || {};
    const isAdmin = tok.admin === true;
    const callerUid = context.auth.uid;

    const ref = firestore.collection('facilityBookings').doc(bookingId);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Booking not found');
    }

    const booking = snap.data();

    if (booking.status !== 'confirmed') {
      throw new functions.https.HttpsError('failed-precondition',
        `Booking is already ${booking.status}`);
    }

    // Tenants may only cancel their own booking
    if (!isAdmin && booking.tenantUid !== callerUid) {
      throw new functions.https.HttpsError('permission-denied',
        'You can only cancel your own bookings');
    }

    // Cannot cancel past-date bookings
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bookingDate = new Date(booking.date + 'T00:00:00');
    if (bookingDate < today) {
      throw new functions.https.HttpsError('failed-precondition',
        'Cannot cancel a past booking');
    }

    await ref.update({
      status:      'cancelled',
      cancelledBy: isAdmin ? 'admin' : 'tenant',
      updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
    });

    console.info(`✅ cancelFacilityBooking: ${bookingId} cancelled by ${isAdmin ? 'admin' : 'tenant'} uid=${callerUid}`);
    return { cancelled: true };
  });
