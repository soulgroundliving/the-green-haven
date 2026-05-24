/**
 * cleanupMarketplaceChat — self-destruct chats when their parent marketplace
 * post is closed or deleted.
 *
 * Trigger: Firestore onWrite on `marketplace/{postId}`.
 *
 * Fires cleanup when:
 *   - the post is DELETED entirely (admin/owner deleted), OR
 *   - the post's `status` field is `COMPLETED` after the write.
 *
 * Why we re-check on every status=COMPLETED write (instead of only the
 * transition INTO COMPLETED): the trigger fires once, and if cleanup throws
 * (transient network error, rate limit, etc.) the chats would be orphaned
 * because the next update would have `before.status === 'COMPLETED'` and
 * any "transition only" gate would skip. Re-running on every write is
 * idempotent (collection query returns empty after first success) and cheap.
 *
 * What gets cleared:
 *   - every doc in `marketplace_chats` where `postId == {postId}` AND
 *   - every doc in each such chat's `messages` sub-collection
 *
 * Deploy: firebase deploy --only functions:cleanupMarketplaceChat
 *
 * Sprint 1 — Privacy-First Marketplace Chat (Nest Marketplace Spec v1.0 §3.2).
 * Related: §7-DD (sibling-collection cleanup must include the messages
 * sub-collection, not just the chat doc).
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

// Firestore batch limit is 500 ops; leave headroom for the chat-doc delete
// that follows the message-delete batch.
const BATCH_FLUSH_AT = 450;

/**
 * Pure cleanup logic — extracted so unit tests can exercise it without
 * spinning up the trigger wrapper. Treats `firestore` as an injected
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

exports.cleanupMarketplaceChat = functions
  .region('asia-southeast1')
  .firestore.document('marketplace/{postId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    const postId = context.params.postId;

    // Skip unless the post was deleted OR is now in the COMPLETED end-state.
    const shouldClean = !after || after.status === 'COMPLETED';
    if (!shouldClean) return null;

    try {
      const result = await cleanupChatsForPost(admin.firestore(), postId);
      if (result.chatsDeleted > 0 || result.messagesDeleted > 0) {
        console.log(
          `[cleanupMarketplaceChat] post=${postId} cleared chats=${result.chatsDeleted} messages=${result.messagesDeleted}`
        );
      }
      return result;
    } catch (e) {
      console.error(`[cleanupMarketplaceChat] post=${postId} failed:`, e.message);
      // Re-throw so Cloud Functions records the failure. The next write to
      // this post (status remains COMPLETED) will re-trigger and retry.
      throw e;
    }
  });
