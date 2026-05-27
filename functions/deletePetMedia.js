/**
 * deletePetMedia — admin-only one-pet delete that touches Firestore + Storage.
 *
 * Wired from admin "🗑️ Remove" button in the pet-approvals queue
 * (shared/dashboard-tenant-lease.js `removePetApproval`). Prior to this CF,
 * the client called `_deletePetFromFirestore` which only deleted the Firestore
 * doc and left `pets/{b}/{r}/{petId}/photo_*.{ext}` + `vaccineBook_*.{ext}`
 * orphan in Storage. Server-side symmetry closes the leak and ensures admin
 * remove matches archive cleanup behavior.
 *
 * Why server-side (not client direct Storage delete):
 *   - Client SDK can list files but a per-prefix delete still requires N
 *     parallel delete calls; admin SDK handles this in one call with
 *     `{ ignoreNotFound: true }` semantics
 *   - Single authentication check → consistent admin-only gate
 *   - Future PDPA audit log can be added here without touching client
 *
 * Auth: admin claim required (`context.auth.token.admin === true`)
 * Input:  { building, roomId, petId }
 * Output: { success, building, roomId, petId, storageDeleted, storageErrors }
 *
 * Region: asia-southeast1
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const { getValidBuildings } = require('./buildingRegistry');
const { deletePetStorageForPet } = require('./_petStorage');

exports.deletePetMedia = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    // ── Auth ─────────────────────────────────────────────────────────────
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    if (context.auth.token.admin !== true) {
      throw new functions.https.HttpsError('permission-denied',
        'Admin claim required to delete pet media');
    }

    // ── Input ────────────────────────────────────────────────────────────
    const { building, roomId, petId } = data || {};
    const validBuildings = await getValidBuildings();
    if (!validBuildings.has(building)) {
      throw new functions.https.HttpsError('invalid-argument',
        `building must be one of [${Array.from(validBuildings).join(', ')}] (got '${building}')`);
    }
    if (typeof roomId !== 'string' || !/^[A-Za-z0-9ก-๛]{1,20}$/.test(roomId)) {
      throw new functions.https.HttpsError('invalid-argument',
        `roomId must be 1-20 alphanumeric/Thai chars (got '${roomId}')`);
    }
    // petId is a Firestore doc id — same character class as roomId but allow
    // hyphen/underscore (uuid-style ids exist alongside timestamp-prefixed ones).
    if (typeof petId !== 'string' || !/^[A-Za-z0-9_\-]{1,64}$/.test(petId)) {
      throw new functions.https.HttpsError('invalid-argument',
        `petId must be 1-64 alphanumeric/_/- chars (got '${petId}')`);
    }

    // ── Firestore doc delete (best effort — Storage is the load-bearing
    //    cleanup; doc delete is symmetric to what the old client path did) ──
    const callerEmail = String(context.auth.token.email || '');
    const docPath = `tenants/${building}/list/${roomId}/pets/${petId}`;
    try {
      await admin.firestore().doc(docPath).delete();
    } catch (err) {
      // Doc may have been deleted already (idempotent re-run) — log + continue.
      // Real failures (rules tightening, IAM) bubble up via the next throw.
      console.warn(`deletePetMedia: Firestore delete ${docPath} threw:`, err.message);
    }

    // ── Storage cleanup ──────────────────────────────────────────────────
    let storageDeleted = 0;
    let storageErrors = 0;
    try {
      const r = await deletePetStorageForPet(building, roomId, petId, {
        reason: `admin_remove:by=${callerEmail || context.auth.uid}`,
      });
      storageDeleted = r.deletedCount;
      storageErrors  = r.errors.length;
    } catch (storageErr) {
      // Programmer-error throws only (empty inputs). Already validated above.
      console.error(`deletePetMedia: Storage cleanup threw unexpectedly:`, storageErr.message);
      throw new functions.https.HttpsError('internal',
        `Storage cleanup failed: ${storageErr.message}`);
    }

    console.info(`deletePetMedia: ${building}/${roomId}/${petId} ` +
      `(storageDeleted=${storageDeleted}, errors=${storageErrors}, by=${callerEmail || context.auth.uid})`);

    return {
      success: true,
      building,
      roomId,
      petId,
      storageDeleted,
      storageErrors,
    };
  });
