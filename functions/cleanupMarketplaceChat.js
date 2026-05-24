/**
 * cleanupMarketplaceChat — clears every chat + messages sub-collection
 * for a marketplace post.
 *
 * Why HTTPS callable (not Firestore trigger):
 *   Firestore lives in asia-southeast3 (Jakarta). Eventarc — the trigger
 *   backbone for both Gen1 and Gen2 Firestore triggers — does NOT support
 *   asia-southeast3 (verified by `notifyTenantOnMeterUpload` comment + the
 *   2026-05-24 PR #36 deploy attempt which failed with "Resource ...
 *   marketplace/{postId} is in region asia-southeast3 which is not
 *   supported"). The project pattern is HTTPS callable invoked from
 *   client after the Firestore write — same shape as notifyTenantOnMeterUpload.
 *
 * Auth: signed-in user; caller must be EITHER:
 *   - admin (custom claim admin:true), OR
 *   - the post's ownerUid (matches request.auth.uid)
 *   - if the post no longer exists (already deleted), admin-only
 *     (otherwise an attacker could call this on any postId and try to
 *     delete chats they're not party to)
 *
 * Call signature:
 *   Client → httpsCallable('cleanupMarketplaceChat')({ postId: '<id>' })
 *   Returns { chatsDeleted: N, messagesDeleted: M }
 *
 * Invocation points (tenant_app.html):
 *   - markMarketClosed(id) — after setDoc({ status: 'COMPLETED' })
 *   - deleteMarketItem(id) — BEFORE deleteDoc (post must still exist for
 *     ownership check)
 *
 * §7-DD: deletes BOTH chat doc AND messages sub-collection — orphan
 * messages would persist forever otherwise (default-deny rules don't
 * allow tenant cleanup of someone else's chats).
 *
 * Deploy: firebase deploy --only functions:cleanupMarketplaceChat
 *
 * Sprint 1 — Privacy-First Marketplace Chat (Nest Marketplace Spec v1.0 §3.2).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

// Firestore batch limit is 500 ops; leave headroom for the chat-doc delete
// that follows the message-delete batch.
const BATCH_FLUSH_AT = 450;

/**
 * Pure cleanup logic — extracted so unit tests can exercise it without
 * spinning up the callable wrapper. Treats `firestore` as an injected
 * dependency that exposes the standard Admin Firestore surface.
 *
 * @param {object} firestore — admin Firestore instance (or compatible mock).
 * @param {string} postId — the marketplace doc id whose chats should be removed.
 * @returns {Promise<{ chatsDeleted: number, messagesDeleted: number }>}
 */
async function cleanupChatsForPost(firestore, postId) {
  if (!postId) return { chatsDeleted: 0, messagesDeleted: 0 };

  const chatsSnap = await firestore
    .collection('marketplace_chats')
    .where('postId', '==', postId)
    .get();

  let chatsDeleted = 0;
  let messagesDeleted = 0;

  for (const chatDoc of chatsSnap.docs) {
    const messagesSnap = await chatDoc.ref.collection('messages').get();

    let batch = firestore.batch();
    let inBatch = 0;
    for (const m of messagesSnap.docs) {
      batch.delete(m.ref);
      inBatch++;
      messagesDeleted++;
      if (inBatch >= BATCH_FLUSH_AT) {
        await batch.commit();
        batch = firestore.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) await batch.commit();

    await chatDoc.ref.delete();
    chatsDeleted++;
  }

  return { chatsDeleted, messagesDeleted };
}

exports._cleanupChatsForPost = cleanupChatsForPost;

exports.cleanupMarketplaceChat = onCall(
  { region: 'asia-southeast1' },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign-in required');
    }
    const postId = request.data?.postId;
    if (!postId || typeof postId !== 'string') {
      throw new HttpsError('invalid-argument', 'postId (string) required');
    }

    const firestore = admin.firestore();
    const isAdmin = request.auth.token?.admin === true;

    // Authorize against the parent post.
    const postSnap = await firestore.collection('marketplace').doc(postId).get();
    if (!postSnap.exists) {
      // Orphan-cleanup path: post is gone; only admin can sweep.
      if (!isAdmin) {
        throw new HttpsError('permission-denied', 'Post not found; only admin can clean orphan chats');
      }
    } else {
      const post = postSnap.data() || {};
      const isOwner = post.ownerUid === request.auth.uid;
      if (!isAdmin && !isOwner) {
        throw new HttpsError('permission-denied', 'Only the post owner or admin can clean chats');
      }
    }

    try {
      const result = await cleanupChatsForPost(firestore, postId);
      if (result.chatsDeleted > 0 || result.messagesDeleted > 0) {
        console.log(
          `[cleanupMarketplaceChat] post=${postId} caller=${request.auth.uid} cleared chats=${result.chatsDeleted} messages=${result.messagesDeleted}`
        );
      }
      return result;
    } catch (e) {
      console.error(`[cleanupMarketplaceChat] post=${postId} failed:`, e.message);
      throw new HttpsError('internal', `cleanup failed: ${e.message}`);
    }
  }
);
