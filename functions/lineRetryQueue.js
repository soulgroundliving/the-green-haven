/**
 * Drains the lineRetryQueue Firestore collection every 15 min.
 *
 * Each item in the queue represents a LINE push that failed in some other
 * CF (notifyBillOnCreate, remindLatePayments, etc.). We retry with
 * exponential backoff and abandon after MAX_ATTEMPTS so a permanently bad
 * lineUserId doesn't loop forever.
 *
 * Backoff schedule (after the initial 5-min wait set by enqueue):
 *   attempt 1: +5  min
 *   attempt 2: +10 min
 *   attempt 3: +20 min
 *   attempt 4: +40 min
 *   attempt 5: abandoned, status='abandoned' for ops review
 *
 * Idempotency: items live at lineRetryQueue/{idempotencyKey} so the same
 * underlying event only ever enqueues once.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Node 22 has fetch globally — no require needed (matches notifyBillOnCreate).

if (!admin.apps.length) admin.initializeApp();

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 minutes
const BACKOFF_MULTIPLIER = 2;
const PROCESS_BATCH_LIMIT = 20; // cap per run so we don't blow the CF timeout

exports.processLineRetryQueue = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 120, memory: '256MB', secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .pubsub.schedule('*/15 * * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      console.warn('LINE_CHANNEL_ACCESS_TOKEN not set — retry queue idle');
      return null;
    }

    const db = admin.firestore();
    const now = new Date().toISOString();

    // Pull due items. Composite index (status, nextAttemptAt) declared in
    // firestore.indexes.json.
    const snap = await db.collection('lineRetryQueue')
      .where('status', '==', 'pending')
      .where('nextAttemptAt', '<=', now)
      .orderBy('nextAttemptAt', 'asc')
      .limit(PROCESS_BATCH_LIMIT)
      .get();

    if (snap.empty) return { processed: 0, recovered: 0, failed: 0, abandoned: 0 };

    let recovered = 0;
    let failed = 0;
    let abandoned = 0;

    for (const doc of snap.docs) {
      const item = doc.data();
      const newAttempts = (item.attempts || 0) + 1;

      try {
        const r = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ to: item.lineUserId, messages: [item.message] })
        });

        if (r.ok) {
          await doc.ref.update({
            status: 'sent',
            sentAt: new Date().toISOString(),
            attempts: newAttempts
          });
          recovered++;
          continue;
        }

        const text = await r.text();
        const errMsg = `LINE ${r.status}: ${text.slice(0, 200)}`;

        if (r.status === 400 || r.status === 403) {
          // Permanent: invalid user, blocked bot, etc. Abandon now.
          await doc.ref.update({ status: 'abandoned', lastError: errMsg, attempts: newAttempts });
          abandoned++;
          console.warn(`📵 Abandoned LINE retry (permanent ${r.status}):`, doc.id, item.context);
        } else if (newAttempts >= MAX_ATTEMPTS) {
          await doc.ref.update({ status: 'abandoned', lastError: errMsg, attempts: newAttempts });
          abandoned++;
          console.error(`📵 Abandoned LINE retry after ${MAX_ATTEMPTS} attempts:`, doc.id, item.context);
        } else {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, newAttempts - 1);
          await doc.ref.update({
            attempts: newAttempts,
            nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
            lastError: errMsg
          });
          failed++;
        }
      } catch (e) {
        const errMsg = String(e?.message || e).slice(0, 200);
        if (newAttempts >= MAX_ATTEMPTS) {
          await doc.ref.update({ status: 'abandoned', lastError: errMsg, attempts: newAttempts });
          abandoned++;
        } else {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, newAttempts - 1);
          await doc.ref.update({
            attempts: newAttempts,
            nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
            lastError: errMsg
          });
          failed++;
        }
      }
    }

    const result = { processed: snap.size, recovered, failed, abandoned };
    console.log('📨 lineRetryQueue:', JSON.stringify(result));
    return result;
  });
