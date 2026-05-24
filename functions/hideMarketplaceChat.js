/**
 * hideMarketplaceChat — one-sided "delete" of a marketplace chat from the
 * caller's list. The counterparty still sees the full thread.
 *
 * Why CF (not client-side update):
 *   Letting clients write directly to `hiddenBy.{uid}` requires loosening
 *   the chat-doc update rule (already permissive — would need to add a
 *   constraint that prevents writing hiddenBy[other-uid]). The CF
 *   approach keeps the rule strict: client can only write the fields it
 *   used to (lastReadAt, unreadCount, lastMessage, lastMessageTime) and
 *   anything touching hidden state goes through us.
 *
 * Auth: signed-in user; caller MUST be a participant of the chat.
 *
 * Call signature:
 *   Client → httpsCallable('hideMarketplaceChat')({ chatId })
 *   Returns { ok: true } on success.
 *
 * Effect:
 *   marketplace_chats/{chatId}.set({
 *     hiddenBy: { [callerUid]: <now ISO> }
 *   }, {merge: true})
 *
 *   Client filters `_chatList.filter(c => !(c.hiddenBy && c.hiddenBy[myUid]))`
 *   so the row disappears from the chat list. Messages sub-collection is
 *   untouched — the counterparty's view is unaffected.
 *
 * Un-hide:
 *   When the counterparty sends a new message, notifyMarketplaceChat
 *   clears the recipient's hiddenBy entry (matches LINE behavior — the
 *   thread "reappears" when there's new activity).
 *
 * Deploy: firebase deploy --only functions:hideMarketplaceChat
 *
 * S3 PR 3 — LINE-parity chat UX (Marketplace Chat Sprint S3, plan in
 * tasks/todo-chat-s3.md).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

/**
 * Pure hide logic — extracted for unit tests. `firestore` is an
 * injected dep.
 */
async function hideChat(firestore, { uid, chatId, nowMs }) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign-in required');
  if (!chatId || typeof chatId !== 'string') {
    throw new HttpsError('invalid-argument', 'chatId required');
  }

  const chatRef = firestore.collection('marketplace_chats').doc(chatId);
  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) {
    throw new HttpsError('not-found', 'Chat not found');
  }
  const participants = chatSnap.data()?.participants || [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'Not a participant');
  }

  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  await chatRef.set({
    hiddenBy: { [uid]: new Date(now).toISOString() },
  }, { merge: true });

  return { ok: true };
}

exports._hideChat = hideChat;

exports.hideMarketplaceChat = onCall(
  { region: 'asia-southeast1' },
  async (request) => {
    const uid = request.auth?.uid;
    const { chatId } = request.data || {};
    return hideChat(admin.firestore(), { uid, chatId });
  }
);
