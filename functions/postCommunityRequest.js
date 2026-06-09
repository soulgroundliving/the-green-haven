/**
 * postCommunityRequest — a tenant posts a neighbour borrow/share request (Meaning
 * Layer #3 — the micro-economy board).
 *
 * Creates communityRequests/{auto-id} with status:'open'. The requesterUid is
 * taken from context.auth.uid (server-set, never the client) so a request can't
 * be spoofed onto another resident. Rate-limited 5/day per uid (anti board-spam).
 *
 * Auth: the caller must be the registered tenant of {building, roomId} —
 * assertTenantAccess (claim fast-path + Firestore SoT fallback, §7-Z/HH/P).
 * v1 is tenants-only (players have no building/room → can't post).
 *
 * §7-NN: callable, not a Firestore trigger (Eventarc can't watch SE3 Firestore).
 * Region asia-southeast1 (matches every gamification CF). No points are ever
 * awarded by this board (see _communityRequestEngine header).
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { checkRateLimit } = require('./_rateLimit');
const { sanitizeTitle, sanitizeDetail, isValidCategory, isValidKind, normalizeKind } = require('./_communityRequestEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const MAX_NAME_LEN = 60;

exports.postCommunityRequest = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }

  const { building, roomId, title, detail, category, requestKind, requesterName } = data || {};
  if (!building || !roomId) {
    throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
  }
  const canonicalBuilding = String(building).toLowerCase();
  if (!['rooms', 'nest'].includes(canonicalBuilding)) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  const cleanTitle = sanitizeTitle(title);
  if (!cleanTitle) {
    throw new functions.https.HttpsError('invalid-argument', 'กรุณาระบุสิ่งที่ต้องการขอ/ยืม');
  }
  if (!isValidCategory(category)) {
    throw new functions.https.HttpsError('invalid-argument', 'หมวดหมู่ไม่ถูกต้อง');
  }
  if (!isValidKind(requestKind)) {
    throw new functions.https.HttpsError('invalid-argument', 'ประเภทคำขอไม่ถูกต้อง');
  }

  // Auth: caller must be the tenant of this room (claim match, else SoT crosscheck).
  const { tenantData } = await assertTenantAccess({
    building: canonicalBuilding,
    roomId: String(roomId),
    context, firestore,
    HttpsError: functions.https.HttpsError,
  });

  // Anti-spam: max 5 posts/day per uid.
  await checkRateLimit(context.auth.uid, 'postCommunityRequest', 5, 86400);

  const name = String(
    requesterName
    || (tenantData && (tenantData.name || tenantData.displayName))
    || `ห้อง ${roomId}`
  ).trim().slice(0, MAX_NAME_LEN);

  const ref = await firestore.collection('communityRequests').add({
    requesterUid: context.auth.uid,                  // server-set — anti-spoof
    requesterTenantId: `${canonicalBuilding}_${roomId}`,
    requesterName: name,
    building: canonicalBuilding,
    room: String(roomId),
    title: cleanTitle,
    detail: sanitizeDetail(detail) || null,
    category: (category && isValidCategory(category)) ? category : null,
    requestKind: normalizeKind(requestKind),
    status: 'open',
    offererUid: null,
    offererTenantId: null,
    offererBuilding: null,
    offererRoom: null,
    offererName: null,
    thankNote: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, requestId: ref.id };
});
