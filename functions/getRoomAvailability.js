/**
 * getRoomAvailability — aggregated room status for the booking calendar.
 *
 * Why a CF instead of direct Firestore read: prospects are signed in but
 * their auth.uid (book:LINEID) doesn't match any tenants/{b}/list/{r}.
 * linkedAuthUid, so they cannot read tenant docs directly (rules block
 * cross-room reads to prevent PII leak — name, phone, idCard, lease, etc.).
 *
 * This CF aggregates server-side via admin SDK and returns ONLY non-PII
 * fields: roomId + occupied flag + (for bookings) lockedUntil. Everything
 * else stays gated.
 *
 * Region: asia-southeast1
 * Auth: caller must have role='prospect' OR admin claim
 * Body: { building: 'rooms' | 'nest' }
 * Returns: { occupied: [roomId,...], activeBookings: [{roomId, status, lockedUntil}] }
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const VALID_BUILDINGS = ['rooms', 'nest'];

exports.getRoomAvailability = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  const tok = context.auth.token || {};
  if (tok.admin !== true && tok.role !== 'prospect') {
    throw new functions.https.HttpsError('permission-denied',
      'Only prospects or admins can query room availability');
  }

  const { building } = data || {};
  if (!building || !VALID_BUILDINGS.includes(String(building).toLowerCase())) {
    throw new functions.https.HttpsError('invalid-argument', `Unknown building: ${building}`);
  }
  const canonicalBuilding = String(building).toLowerCase();

  // ── Occupied rooms (active tenants) ─────────────────────────────────────
  const occupied = [];
  try {
    const snap = await firestore
      .collection('tenants').doc(canonicalBuilding)
      .collection('list')
      .get();
    snap.docs.forEach(d => {
      const td = d.data() || {};
      // Active tenant heuristic: has name AND not flagged as moved out.
      // Same heuristic createBookingLock uses for occupancy gate.
      if (td.name && String(td.name).trim() && !td.movedOut) {
        occupied.push(d.id);
      }
    });
  } catch (e) {
    console.error('getRoomAvailability: tenants query failed:', e.message);
    throw new functions.https.HttpsError('internal', 'Tenant query failed');
  }

  // ── Active bookings (locked / paid / kyc_*) ─────────────────────────────
  const activeBookings = [];
  const blockingStatuses = ['locked', 'paid', 'kyc_pending', 'kyc_approved'];
  const nowMs = Date.now();
  try {
    const snap = await firestore
      .collection('bookings')
      .where('building', '==', canonicalBuilding)
      .where('status', 'in', blockingStatuses)
      .get();
    snap.docs.forEach(d => {
      const b = d.data() || {};
      // Skip expired locks — they're effectively cancelled even if expireBookingLocks
      // hasn't ticked yet.
      if (b.status === 'locked') {
        const lu = b.lockedUntil;
        const luMs = lu && typeof lu.toMillis === 'function' ? lu.toMillis() : 0;
        if (luMs <= nowMs) return;
      }
      activeBookings.push({
        roomId: String(b.roomId),
        status: String(b.status),
        lockedUntil: b.lockedUntil && typeof b.lockedUntil.toMillis === 'function'
          ? b.lockedUntil.toMillis() : null,
      });
    });
  } catch (e) {
    console.error('getRoomAvailability: bookings query failed:', e.message);
    throw new functions.https.HttpsError('internal', 'Bookings query failed');
  }

  return {
    building: canonicalBuilding,
    occupied,
    activeBookings,
    fetchedAt: nowMs,
  };
});
