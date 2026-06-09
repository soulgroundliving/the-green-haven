/**
 * _foodImage — optional-photo helper for the Food sharing feed (Meaning Layer #4).
 *
 * The foodShares Firestore doc AND its Storage object are BOTH CF-only-write
 * (firestore.rules `match /foodShares/{id}` write:false · storage.rules
 * `match /foodShares/{shareId}/{file}` write:false). So unlike the pets/checklist
 * client-uploadBytes pattern (whose DOCS are client-writable), the food photo is
 * uploaded SERVER-side: the client compresses + sends base64 to `shareFood`, this
 * module decodes it and writes the object via the Admin SDK (which bypasses the
 * Storage rules) under `foodShares/{shareId}/photo.{ext}`, then builds a long-lived
 * tokenised download URL (the getDownloadURL equivalent) the client renders via a
 * plain https `<img src>` — §7-XX-safe (live img-src allows https:, never blob:).
 *
 * This keeps the food feed's strong invariant intact: ZERO new client write surface
 * (no §7-Y client uploadBytes, no §7-T writer drift). Cleanup mirrors _petStorage /
 * cleanupChecklists: a prefix delete under `foodShares/{shareId}/`, called by
 * cleanupFoodSharesScheduled so the ephemeral feed never leaks orphan images
 * (Storage cost + PDPA — §7-DD analogue for Storage).
 *
 * NO Firestore I/O here — callers do the doc writes. This module only touches
 * Cloud Storage. Pure validators (type/decode) are exported for unit tests.
 */
const admin = require('firebase-admin');
const { randomUUID } = require('crypto');

if (!admin.apps.length) admin.initializeApp();

// Browser-encodable, Storage-renderable image types only. `compressImage` on the
// client always emits image/jpeg, but accept png/webp defensively in case a
// future caller sends the raw picked file.
const ALLOWED_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Decoded-buffer ceiling. The client compresses to ~<1 MB (compressImage, 1280px
// q≈0.82); this is the server backstop, well under the 10 MB onCall request cap.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Lower-case + validate a content type → canonical type, or null if unsupported. */
function normalizeImageContentType(ct) {
  const c = String(ct == null ? '' : ct).toLowerCase().trim();
  return ALLOWED_IMAGE_TYPES[c] ? c : null;
}

/** File extension for a (validated) content type, or null. */
function imageExtForType(ct) {
  const c = normalizeImageContentType(ct);
  return c ? ALLOWED_IMAGE_TYPES[c] : null;
}

/** Strip a leading `data:<mime>;base64,` prefix if present (§7-EEE — tolerate both
 *  a full data URL and bare base64; the client sends bare, but be defensive). */
function stripDataUrlPrefix(b64) {
  const s = String(b64 == null ? '' : b64);
  const i = s.indexOf('base64,');
  return i >= 0 ? s.slice(i + 'base64,'.length) : s;
}

/** Decode a base64 (or data-URL) image payload → Buffer, or null if empty/invalid. */
function decodeImageBuffer(b64) {
  const raw = stripDataUrlPrefix(b64).trim();
  if (!raw) return null;
  const buf = Buffer.from(raw, 'base64');
  return buf && buf.length ? buf : null;
}

/**
 * Upload a decoded image buffer to `foodShares/{shareId}/photo.{ext}` and return a
 * permanent tokenised download URL + the Storage path. Throws on unsupported type
 * (callers validate first, so this is a guard, not a user-facing path).
 *
 * @returns {Promise<{ imageUrl: string, imagePath: string }>}
 */
async function uploadFoodImage(shareId, buffer, contentType) {
  if (!shareId) throw new Error('uploadFoodImage: shareId required');
  if (!buffer || !buffer.length) throw new Error('uploadFoodImage: empty buffer');
  const ct = normalizeImageContentType(contentType);
  const ext = imageExtForType(ct);
  if (!ct || !ext) throw new Error('uploadFoodImage: unsupported image type');

  const bucket = admin.storage().bucket();
  const imagePath = `foodShares/${shareId}/photo.${ext}`;
  const token = randomUUID();

  await bucket.file(imagePath).save(buffer, {
    resumable: false,
    contentType: ct,
    metadata: {
      contentType: ct,
      // The special key the Firebase download-token system reads — makes the
      // ?token= URL below valid without needing IAM signBlob (cf. getSignedUrl).
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(imagePath)}?alt=media&token=${token}`;
  return { imageUrl, imagePath };
}

/**
 * Delete every Storage file under `foodShares/{shareId}/` (best-effort).
 * Mirrors _petStorage / cleanupChecklists._deleteStoragePrefix — the trailing
 * slash is REQUIRED so `foodShares/{id}/` doesn't also match `foodShares/{id}9/`.
 * @returns {Promise<number>} count of files deleted (0 on any failure).
 */
async function deleteFoodImagesForShare(shareId) {
  if (!shareId) return 0;
  const prefix = `foodShares/${shareId}/`;
  try {
    const bucket = admin.storage().bucket();
    const [files] = await bucket.getFiles({ prefix });
    if (!files.length) return 0;
    await Promise.all(files.map(f => f.delete({ ignoreNotFound: true })));
    return files.length;
  } catch (err) {
    console.warn(`[_foodImage] storage cleanup failed for ${shareId}:`, err.message || err);
    return 0;
  }
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  normalizeImageContentType,
  imageExtForType,
  stripDataUrlPrefix,
  decodeImageBuffer,
  uploadFoodImage,
  deleteFoodImagesForShare,
};
