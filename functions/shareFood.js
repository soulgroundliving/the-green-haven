/**
 * shareFood — a tenant posts leftover food to share (Meaning Layer #4).
 *
 * Creates foodShares/{auto-id} with status:'available' and a server-computed
 * `expiresAt` (default 24h, max 72h — the feed is ephemeral). The sharerUid is
 * taken from context.auth.uid (server-set, never the client). NO points are
 * awarded here — the sharer earns only when a neighbour CLAIMS (claimFood,
 * peer-confirmed anti-farm). Rate-limited 5/day per uid.
 *
 * Optional photo: the client compresses the picked image (window.compressImage)
 * and sends `photoBase64` + `photoContentType`. We decode + upload it SERVER-side
 * via the Admin SDK to `foodShares/{shareId}/photo.{ext}` (the foodShares Storage
 * path is CF-only-write) and store a tokenised download URL on the doc. The photo
 * is OPTIONAL — a transient upload error never fails the post (the text share is
 * still useful); a bad/oversized payload is rejected up-front before any write. See
 * functions/_foodImage.js. §7-XX-safe (https URL, never blob:).
 *
 * Auth: caller must be the registered tenant of {building, roomId}
 * (assertTenantAccess, §7-Z/HH/P). §7-NN callable. Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { checkRateLimit } = require('./_rateLimit');
const { sanitizeTitle, sanitizeDetail, sanitizePortions, isValidCategory, computeExpiresAtMs } = require('./_foodShareEngine');
const { decodeImageBuffer, normalizeImageContentType, uploadFoodImage, deleteFoodImagesForShare, MAX_IMAGE_BYTES } = require('./_foodImage');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const MAX_NAME_LEN = 60;

exports.shareFood = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }

  const { building, roomId, title, detail, category, portions, expiresInHours, sharerName, photoBase64, photoContentType } = data || {};
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

  // Optional photo — validate + decode BEFORE any write so a bad payload rejects
  // cleanly without leaving an orphan doc (the actual upload happens post-add,
  // once we have the shareId for the Storage path).
  let photoBuffer = null;
  let photoType = null;
  if (photoBase64) {
    photoType = normalizeImageContentType(photoContentType);
    if (!photoType) {
      throw new functions.https.HttpsError('invalid-argument', 'ชนิดรูปภาพไม่รองรับ (รองรับ JPG/PNG/WEBP)');
    }
    photoBuffer = decodeImageBuffer(photoBase64);
    if (!photoBuffer) {
      throw new functions.https.HttpsError('invalid-argument', 'รูปภาพไม่ถูกต้อง');
    }
    if (photoBuffer.length > MAX_IMAGE_BYTES) {
      throw new functions.https.HttpsError('invalid-argument', 'รูปภาพใหญ่เกินไป กรุณาลองรูปที่เล็กลง');
    }
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
    imageUrl: null,
    imagePath: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });

  // Best-effort photo upload — the share already exists (text is useful on its
  // own), so a Storage hiccup must not fail the post. On a write-back failure we
  // delete the just-uploaded object so cleanup never has to chase an orphan.
  let hasImage = false;
  if (photoBuffer) {
    try {
      const { imageUrl, imagePath } = await uploadFoodImage(ref.id, photoBuffer, photoType);
      try {
        await ref.update({ imageUrl, imagePath });
        hasImage = true;
      } catch (updateErr) {
        console.warn('shareFood photo write-back failed (non-fatal):', updateErr.message);
        try { await deleteFoodImagesForShare(ref.id); } catch (_) { /* best-effort */ }
      }
    } catch (uploadErr) {
      console.warn('shareFood photo upload failed (non-fatal):', uploadErr.message);
    }
  }

  return { success: true, shareId: ref.id, expiresAt: expiresAt.toMillis(), hasImage };
});
