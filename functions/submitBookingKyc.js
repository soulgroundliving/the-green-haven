/**
 * submitBookingKyc — flip booking from 'paid' → 'kyc_pending' after the
 * prospect has uploaded their KYC documents to Storage.
 *
 * The prospect uploads files directly to Storage (path:
 * bookings/{bookingId}/kyc/{type}.jpg) — Storage rules gate writes on
 * status ∈ {'paid','kyc_pending'} + image/PDF + 5MB cap, so the upload
 * itself is safe without a CF. Where a CF IS needed: flipping the booking
 * doc status (rules block all client writes to bookings/*).
 *
 * What this CF does:
 *   1. Validates caller owns the booking (or is admin).
 *   2. Lists Storage bookings/{bookingId}/kyc/* via admin SDK so we can
 *      enforce server-side that the required docs (idCardFront +
 *      idCardBack) actually exist — client could lie about uploading them.
 *   3. Updates booking.status = 'kyc_pending' + records uploaded types.
 *
 * Region: asia-southeast1
 * Auth: caller must own the booking (prospectUid match) OR have admin claim.
 * Input:  { bookingId }
 * Output: { success, bookingId, status:'kyc_pending', uploadedTypes: [...] }
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

// Whitelist of acceptable KYC document types. Filenames in Storage MUST match
// `{type}.jpg` (or .pdf) — both client and CF agree on these names so server
// can list-and-verify without trusting client-provided file lists.
const KYC_TYPES = ['idCardFront', 'idCardBack', 'houseReg', 'employmentLetter'];
const REQUIRED_TYPES = ['idCardFront', 'idCardBack'];

exports.submitBookingKyc = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  // ── Auth ────────────────────────────────────────────────────────────────
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  const tok = context.auth.token || {};
  const isAdmin = tok.admin === true;
  const isProspect = tok.role === 'prospect';
  if (!isAdmin && !isProspect) {
    throw new functions.https.HttpsError('permission-denied',
      'Only prospects (LIFF booking) or admins can submit KYC');
  }

  // ── Input ──────────────────────────────────────────────────────────────
  const { bookingId } = data || {};
  if (!bookingId || typeof bookingId !== 'string' || !/^[A-Za-z0-9]{4,40}$/.test(bookingId)) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId is required');
  }

  // ── Read booking + ownership/status check ──────────────────────────────
  const bookingRef = firestore.collection('bookings').doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) {
    throw new functions.https.HttpsError('not-found', `Booking ${bookingId} not found`);
  }
  const booking = bookingSnap.data();
  if (!isAdmin && booking.prospectUid !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied',
      'You can only submit KYC for your own booking');
  }
  // KYC submission only meaningful in 'paid' state. 'kyc_pending' allowed too —
  // re-submitting overwrites, so admins can re-trigger the review (e.g. after
  // a failed photo, ask prospect to re-upload + re-submit).
  if (booking.status !== 'paid' && booking.status !== 'kyc_pending') {
    throw new functions.https.HttpsError('failed-precondition',
      `Booking status is '${booking.status}'; KYC submission only allowed when status is 'paid' or 'kyc_pending'`);
  }

  // ── List Storage to verify uploads server-side (don't trust client) ─────
  let bucket;
  try {
    bucket = admin.storage().bucket();
  } catch (e) {
    console.error('submitBookingKyc: storage init failed:', e.message);
    throw new functions.https.HttpsError('internal', 'Storage not initialized');
  }
  const prefix = `bookings/${bookingId}/kyc/`;
  let files;
  try {
    [files] = await bucket.getFiles({ prefix });
  } catch (e) {
    console.error('submitBookingKyc: bucket.getFiles failed:', e.message);
    throw new functions.https.HttpsError('internal', 'Could not list KYC files');
  }

  // Map filenames → kyc types. Filename pattern: {type}.{ext} (jpg/png/pdf/etc)
  const uploadedTypes = new Set();
  for (const f of files) {
    const base = f.name.slice(prefix.length);                // e.g. 'idCardFront.jpg'
    const dotIdx = base.lastIndexOf('.');
    const stem = dotIdx >= 0 ? base.slice(0, dotIdx) : base;
    if (KYC_TYPES.includes(stem)) {
      uploadedTypes.add(stem);
    }
  }

  // Required docs check
  const missing = REQUIRED_TYPES.filter(t => !uploadedTypes.has(t));
  if (missing.length > 0) {
    throw new functions.https.HttpsError('failed-precondition',
      `Missing required KYC documents: ${missing.join(', ')}. Upload them first then re-submit.`);
  }

  // ── Update booking → status='kyc_pending' ──────────────────────────────
  const uploadedList = [...uploadedTypes];
  try {
    await bookingRef.update({
      status: 'kyc_pending',
      kycSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
      kycDocsTypes: uploadedList,
      kycDocsPath: prefix,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('submitBookingKyc: booking update failed:', e.message);
    throw new functions.https.HttpsError('internal', 'Could not update booking status');
  }

  console.log(`📋 submitBookingKyc: ${bookingId} → kyc_pending (${uploadedList.length} docs: ${uploadedList.join(', ')})`);
  return {
    success: true,
    bookingId,
    status: 'kyc_pending',
    uploadedTypes: uploadedList,
  };
});
