/**
 * unsendMarketplaceMessage — sender-only "recall" for a marketplace chat
 * message, with a 24-hour window after send.
 *
 * Why CF (not client-side update):
 *   The existing message-update rule only allows toggling `isRead` — sender
 *   cannot edit their own text via the client, which is the correct
 *   integrity story (chat history is otherwise immutable). The CF runs
 *   under the Admin SDK and bypasses rules so it can clear `text` and
 *   set the tombstone fields atomically.
 *
 * Auth: signed-in user; caller MUST be the message's senderId AND the
 * message MUST be < 24h old.
 *
 * Call signature:
 *   Client → httpsCallable('unsendMarketplaceMessage')({ chatId, messageId })
 *   Returns { ok: true } on success; throws HttpsError otherwise.
 *
 * Effect:
 *   marketplace_chats/{chatId}/messages/{messageId}.set({
 *     text: '',
 *     unsent: true,
 *     unsentAt: <now ISO>
 *   }, {merge: true})
 *
 *   Counterparty sees the tombstone via onSnapshot immediately. Bubble
 *   stays in place (so layout doesn't jump) but renders dim + italic
 *   "ข้อความถูกยกเลิก".
 *
 * Deploy: firebase deploy --only functions:unsendMarketplaceMessage
 *
 * S3 PR 3 — LINE-parity chat UX (Marketplace Chat Sprint S3, plan in
 * tasks/todo-chat-s3.md).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const UNSEND_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Pure unsend logic — extracted so unit tests can exercise it without
 * spinning up the callable wrapper. `firestore` is an injected dep.
 *
 * @param {object} firestore — admin Firestore instance (or compatible mock)
 * @param {object} args
 * @param {string} args.uid       — auth uid of caller
 * @param {string} args.chatId
 * @param {string} args.messageId
 * @param {number} [args.nowMs]   — clock injection for tests
 * @returns {Promise<{ ok: true }>} — throws on failure
 */
async function unsendMessage(firestore, { uid, chatId, messageId, nowMs }) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign-in required');
  if (!chatId || typeof chatId !== 'string') {
    throw new HttpsError('invalid-argument', 'chatId required');
  }
  if (!messageId || typeof messageId !== 'string') {
    throw new HttpsError('invalid-argument', 'messageId required');
  }

  const msgRef = firestore
    .collection('marketplace_chats').doc(chatId)
    .collection('messages').doc(messageId);

  const msgSnap = await msgRef.get();
  if (!msgSnap.exists) {
    throw new HttpsError('not-found', 'Message not found');
  }
  const msg = msgSnap.data() || {};

  if (msg.senderId !== uid) {
    throw new HttpsError('permission-denied', 'Can only unsend own messages');
  }

  if (msg.unsent) {
    // Idempotent: already unsent, treat as success.
    return { ok: true, alreadyUnsent: true };
  }

  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const sentAtMs = msg.timestamp ? Date.parse(msg.timestamp) : NaN;
  if (!Number.isFinite(sentAtMs)) {
    throw new HttpsError('failed-precondition', 'Message has no parseable timestamp');
  }
  if (now - sentAtMs > UNSEND_WINDOW_MS) {
    throw new HttpsError('failed-precondition', 'Unsend window (24h) has expired');
  }

  await msgRef.set({
    text: '',
    unsent: true,
    unsentAt: new Date(now).toISOString(),
  }, { merge: true });

  return { ok: true };
}

exports._unsendMessage = unsendMessage;
exports.UNSEND_WINDOW_MS = UNSEND_WINDOW_MS;

exports.unsendMarketplaceMessage = onCall(
  { region: 'asia-southeast1' },
  async (request) => {
    const uid = request.auth?.uid;
    const { chatId, messageId } = request.data || {};
    return unsendMessage(admin.firestore(), { uid, chatId, messageId });
  }
);
