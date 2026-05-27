/**
 * unlinkLiffUser — soft-disconnect an approved LINE-↔-tenant link.
 *
 * Atomically:
 *   1. Soft-deletes liffUsers/{lineUserId} (status='unlinked' + audit fields)
 *   2. Clears linkedAuthUid / linkedAt from tenants/{building}/list/{room}
 *   3. Clears lineUserId / linkedAuthUid / lineDisplayName from people/{tenantId}
 *
 * Why soft + cleanup (not hard delete):
 *   - liffUsers doc kept for audit trail (who linked, who unlinked, when)
 *   - tenant + people docs MUST be cleared because tenant_app reads
 *     `linkedAuthUid` to decide if the LINE user is still linked; leaving
 *     stale data confuses the LIFF entry flow
 *   - Anti-pattern §7-T sibling: writer drift between liffUsers and
 *     tenants/people would surface only at next LIFF sign-in
 *
 * Caller must be a global admin (token.admin === true).
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

exports.unlinkLiffUser = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only admins can unlink LINE accounts.'
      );
    }

    const { lineUserId } = data || {};
    if (!lineUserId || typeof lineUserId !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'lineUserId (string) is required.'
      );
    }

    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    const adminUid = context.auth.uid;

    // Read liffUsers doc to discover the linked {building, room} (if any)
    const liffRef = db.collection('liffUsers').doc(lineUserId);
    const liffSnap = await liffRef.get();
    if (!liffSnap.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        `liffUsers/${lineUserId} not found.`
      );
    }
    const liffData = liffSnap.data() || {};
    const building = liffData.building;
    const room = liffData.room;

    const batch = db.batch();

    // 1. Soft-delete liffUsers doc (keep for audit)
    batch.update(liffRef, {
      status: 'unlinked',
      unlinkedAt: FieldValue.serverTimestamp(),
      unlinkedBy: adminUid,
      // preserve prior approval data for audit
    });

    // 2. Clear LINE link from tenant doc (if exists). Capture legacyAuthUid
    // BEFORE the FieldValue.delete() so we can strip its custom claims later
    // (§7-Z: claims set via setCustomUserClaims are persistent until cleared
    // — leftover claims would let the user keep full LIFF access after unlink).
    let legacyAuthUid = null;
    if (building && room) {
      const tenantRef = db
        .collection('tenants').doc(String(building))
        .collection('list').doc(String(room));
      const tenantSnap = await tenantRef.get();
      if (tenantSnap.exists) {
        legacyAuthUid = tenantSnap.data()?.linkedAuthUid || null;
        batch.update(tenantRef, {
          linkedAuthUid: FieldValue.delete(),
          linkedAt: FieldValue.delete(),
        });
      }
    }

    // 3. Clear LINE fields from people doc (lookup by lineUserId field)
    const peopleQuery = await db
      .collection('people')
      .where('lineUserId', '==', lineUserId)
      .limit(5)
      .get();
    let peopleCleared = 0;
    if (!peopleQuery.empty) {
      peopleQuery.forEach(doc => {
        // people.linkedAuthUid may also hold a UID — catch both shapes.
        if (!legacyAuthUid) {
          legacyAuthUid = doc.data()?.linkedAuthUid || null;
        }
        batch.update(doc.ref, {
          lineUserId: FieldValue.delete(),
          linkedAuthUid: FieldValue.delete(),
          lineDisplayName: FieldValue.delete(),
        });
        peopleCleared++;
      });
    }

    await batch.commit();

    // 4. Strip persistent custom claims + revoke cached refresh tokens.
    // Without this, the user's existing ID token retains {room, building,
    // tenantId} for up to ~1 h and the user record continues minting full-claim
    // tokens forever (§7-Z). Two UIDs may be in play per liffSignIn comments:
    //   - 'line:' + lineUserId — deterministic UID minted by liffSignIn
    //   - legacyAuthUid       — pre-liffSignIn anonymous UID from linkAuthUid era
    // Fire-and-forget: failures here don't break the batch (which is already
    // committed). They'll surface on the next token refresh and S2/S3 handle it.
    const deterministicUid = 'line:' + lineUserId;
    const uidsToClear = [deterministicUid];
    if (legacyAuthUid && legacyAuthUid !== deterministicUid) {
      uidsToClear.push(legacyAuthUid);
    }
    const auth = admin.auth();
    await Promise.allSettled(
      uidsToClear.map(async uid => {
        try {
          await auth.setCustomUserClaims(uid, {});
          await auth.revokeRefreshTokens(uid);
        } catch (e) {
          // user-not-found is expected when legacyAuthUid was already cleaned
          // up by cleanupAnonymousUsers — log warn, don't throw.
          console.warn(`unlinkLiffUser: claim/token clear failed for ${uid}: ${e?.message || e}`);
        }
      })
    );

    console.info(
      `🔌 unlinkLiffUser: ${lineUserId} unlinked by ${adminUid} ` +
      `· tenant=${building || '-'}/${room || '-'} · people=${peopleCleared} ` +
      `· uidsCleared=${uidsToClear.length}`
    );

    return {
      success: true,
      lineUserId,
      building: building || null,
      room: room || null,
      peopleCleared,
      uidsCleared: uidsToClear.length,
    };
  });
