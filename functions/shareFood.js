/**
 * shareFood — a tenant posts leftover food to share (Meaning Layer #4).
 *
 * Creates foodShares/{auto-id} with status:'available' and a server-computed
 * `expiresAt` (default 24h, max 72h — the feed is ephemeral). The sharerUid is
 * taken from context.auth.uid (server-set, never the client). NO points are
 * awarded here — the sharer earns only when a neighbour CLAIMS (claimFood,
 * peer-confirmed anti-farm). Rate-limited 5/day per uid.
 *
 * Auth: caller must be the registered tenant of {building, roomId}
 * (assertTenantAccess, §7-Z/HH/P). §7-NN callable. Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { checkRateLimit } = require('./_rateLimit');
const { sanitizeTitle, sanitizeDetail, sanitizePortions, isValidCategory, computeExpiresAtMs } = require('./_foodShareEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const MAX_NAME_LEN = 60;

exports.shareFood = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }

  const { building, roomId, title, detail, category, portions, expiresInHours, sharerName } = data || {};
  if (!building || !roomId) {
    throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
  }
  const canonicalBuilding = String(building).toLowerCase();
  if (!['rooms', 'nest'].includes(canonicalBuilding)) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  const cleanTitle = sanitizeTitle(title);
  if (!cleanTitle) {
    throw new functions.https.HttpsError('invalid-argument', 'กรุณาระบุของกินที่จะแบ่งปัน');
  }
  if (!isValidCategory(category)) {
    throw new functions.https.HttpsError('invalid-argument', 'หมวดหมู่ไม่ถูกต้อง');
  }

  // Auth: caller must be the tenant of this room (claim match, else SoT crosscheck).
  const { tenantData } = await assertTenantAccess({
    building: canonicalBuilding,
    roomId: String(roomId),
    context, firestore,
    HttpsError: functions.https.HttpsError,
  });

  // Anti-spam: max 5 shares/day per uid.
  await checkRateLimit(context.auth.uid, 'shareFood', 5, 86400);

  const name = String(
    sharerName
    || (tenantData && (tenantData.name || tenantData.displayName))
    || `ห้อง ${roomId}`
  ).trim().slice(0, MAX_NAME_LEN);

  const nowMs = Date.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(computeExpiresAtMs(nowMs, expiresInHours));

  const ref = await firestore.collection('foodShares').add({
    sharerUid: context.auth.uid,                     // server-set — anti-spoof
    sharerTenantId: `${canonicalBuilding}_${roomId}`,
    sharerName: name,
    building: canonicalBuilding,
    room: String(roomId),
    title: cleanTitle,
    detail: sanitizeDetail(detail) || null,
    category: (category && isValidCategory(category)) ? category : null,
    portions: sanitizePortions(portions),
    status: 'available',
    claimerUid: null,
    claimerTenantId: null,
    claimerBuilding: null,
    claimerRoom: null,
    claimerName: null,
    sharerPointsAwarded: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });

  return { success: true, shareId: ref.id, expiresAt: expiresAt.toMillis() };
});
