/**
 * Shared helpers for room-based LINE push notifications.
 *
 * Used by: notifyTenantOnMeterUpload, notifyBillOnCreate, notifyMaintenanceTenant.
 * NOT used by: notifyMarketplaceChat (1:1 direct push), notifyLiffRequest/StatusChange
 * (admin-list push + best-effort flows).
 *
 * Two primitives:
 *   lookupApprovedRoomUsers — query liffUsers for a building/room pair
 *   pushAndRetry            — push to a user list, enqueue retries for failures
 */

const { enqueueLineRetry } = require('./_lineRetry');

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

/**
 * Query approved LINE-linked users for a room.
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string} building
 * @param {string|number} roomId
 * @returns {Promise<{ docs: FirestoreDoc[] } | { docs: null, error: string }>}
 */
async function lookupApprovedRoomUsers(firestore, building, roomId) {
  try {
    const snap = await firestore.collection('liffUsers')
      .where('building', '==', building)
      .where('room', '==', String(roomId))
      .where('status', '==', 'approved')
      .get();
    return { docs: snap.docs };
  } catch (e) {
    return { docs: null, error: `liffUsers_query_failed: ${e.message}` };
  }
}

/**
 * Push a LINE message to every user doc and enqueue retries for failures.
 *
 * @param {object} opts
 * @param {FirestoreDoc[]} opts.docs        - approved liffUsers docs (doc.id = LINE user ID)
 * @param {object}         opts.message     - LINE message payload
 * @param {string}         opts.token       - LINE_CHANNEL_ACCESS_TOKEN value
 * @param {string}         opts.source      - CF name (for retry-queue context + logs)
 * @param {object}         opts.context     - Extra context fields merged into the retry doc
 * @param {function}       opts.idempotencyKeyFn - (lineUserId: string) => string
 * @returns {Promise<{ pushed: number, failed: number }>}
 */
async function pushAndRetry({ docs, message, token, source, context, idempotencyKeyFn }) {
  const results = await Promise.allSettled(docs.map(doc => {
    const lineUserId = doc.id;
    return fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: lineUserId, messages: [message] }),
    }).then(r => r.ok
      ? Promise.resolve(lineUserId)
      : r.text().then(t => Promise.reject({ lineUserId, error: new Error(`LINE ${r.status}: ${t}`) }))
    );
  }));

  const pushed = results.filter(r => r.status === 'fulfilled').length;
  const failures = results.filter(r => r.status === 'rejected').map(r => r.reason);

  for (const f of failures) {
    const userId = f?.lineUserId || 'unknown';
    const errMsg = f?.error?.message || String(f);
    await enqueueLineRetry({
      lineUserId: userId,
      message,
      context: { source, ...context },
      idempotencyKey: idempotencyKeyFn(userId),
      error: errMsg,
    });
  }

  if (failures.length) {
    const { building = '', roomId = '' } = context;
    console.warn(`⚠️ LINE ${source} failures for ${building}/${roomId} (queued ${failures.length} for retry)`);
  }

  return { pushed, failed: failures.length };
}

module.exports = { lookupApprovedRoomUsers, pushAndRetry };
