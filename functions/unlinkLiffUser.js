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

    // 2. Clear LINE link from tenant doc (if exists)
    if (building && room) {
      const tenantRef = db
        .collection('tenants').doc(String(building))
        .collection('list').doc(String(room));
      const tenantSnap = await tenantRef.get();
      if (tenantSnap.exists) {
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
        batch.update(doc.ref, {
          lineUserId: FieldValue.delete(),
          linkedAuthUid: FieldValue.delete(),
          lineDisplayName: FieldValue.delete(),
        });
        peopleCleared++;
      });
    }

    await batch.commit();

    console.log(
      `🔌 unlinkLiffUser: ${lineUserId} unlinked by ${adminUid} ` +
      `· tenant=${building || '-'}/${room || '-'} · people=${peopleCleared}`
    );

    return {
      success: true,
      lineUserId,
      building: building || null,
      room: room || null,
      peopleCleared,
    };
  });
