/**
 * notifyMarketplaceChat — LINE push to the counterparty when a new chat
 * message lands in marketplace_chats/{chatId}/messages.
 *
 * Why HTTPS callable (not Firestore trigger):
 *   Firestore lives in asia-southeast3 (Jakarta). Eventarc — the trigger
 *   backbone for both Gen1 and Gen2 Firestore triggers — does NOT support
 *   asia-southeast3 (see cleanupMarketplaceChat.js + notifyTenantOnMeterUpload.js
 *   for the full context). The project pattern is HTTPS callable invoked
 *   from client after the Firestore write — same shape as notifyTenantOnMeterUpload.
 *
 * Why it exists:
 *   Without this, the privacy-first chat from Sprint 1 (which replaced the
 *   line.me/ti/p personal-LINE link) is silent — recipients never know a
 *   new message arrived unless their LIFF tab is open. Per
 *   Nest_Marketplace_Specification.pdf v1.0 §3.3 this CF is required for
 *   chat usefulness.
 *
 * Auth: signed-in user; caller must be:
 *   - a participant of the parent chat doc, AND
 *   - the senderId of the message they're notifying about (can't trigger
 *     pushes for a counterparty's messages)
 *
 * Call signature:
 *   Client → httpsCallable('notifyMarketplaceChat')({ chatId, messageId })
 *
 * Invocation point (tenant_app.html):
 *   - sendChatMessage() — fire-and-forget after addDoc(messages) + setDoc(parent)
 *
 * Flow:
 *   1. Auth + participant + senderId check
 *   2. Recipient = participants.find(p => p !== senderUid); skip if uid
 *      doesn't start with `line:` (legacy / prospect uids cannot receive
 *      LINE pushes)
 *   3. Anti-spam throttle (§S2.2): skip if last-notify to this recipient
 *      on this chat was within NOTIFY_THROTTLE_MS (30s)
 *   4. Resolve sender displayName from liffUsers/{senderLineUserId}
 *   5. Build flex bubble with post context + sender + preview + deep-link
 *      to LIFF ?chat=<chatId> (client handles via §7-GG localStorage)
 *   6. Push via LINE Messaging API
 *      - 4xx (blocked OA, invalid user) → log permanent, no retry
 *      - 5xx / network → enqueueLineRetry with idempotencyKey messageId
 *   7. On success: update chat doc lastNotifyAt.{recipientUid} = now
 *
 * Deploy: firebase deploy --only functions:notifyMarketplaceChat
 *
 * Sprint 2 — LINE OA Notification Broker (Nest Marketplace Spec v1.0 §3.3).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const LINE_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');

// LINE Login Channel — must match LIFF_ID used by tenant_app LIFF entry.
// Source of truth: functions/_billFlex.js L25 + functions/liffSignIn.js L29.
const LIFF_ID = '2009790149-Db7T76sd';
const NOTIFY_THROTTLE_MS = 30 * 1000;     // 30s anti-spam per (chat, recipient)
const MESSAGE_PREVIEW_MAX = 80;            // chars in the push preview
const POST_TITLE_MAX = 40;                 // chars in the push header

function stripLinePrefix(uid) {
  if (typeof uid !== 'string') return null;
  if (!uid.startsWith('line:')) return null;
  const rest = uid.slice(5);
  return rest.length > 0 ? rest : null;
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Build the LINE Flex Message payload for a new chat-message notification.
 * Pure function — exported for unit tests.
 */
function buildMessage({ chatId, postTitle, senderName, text }) {
  const deepLink = `https://liff.line.me/${LIFF_ID}?chat=${encodeURIComponent(chatId)}`;
  const safeTitle = truncate(postTitle || 'สินค้า', POST_TITLE_MAX);
  const safeSender = senderName || 'เพื่อนบ้าน';
  const preview = truncate(text || '', MESSAGE_PREVIEW_MAX);
  return {
    type: 'flex',
    altText: `📩 ${safeSender}: ${preview}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2C7A4B',
        paddingAll: '12px',
        contents: [{
          type: 'text',
          text: `📩 ข้อความใหม่ — ${safeTitle}`,
          color: '#FFFFFF',
          weight: 'bold',
          size: 'sm',
          wrap: true,
        }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '14px',
        contents: [
          { type: 'text', text: safeSender, size: 'sm', color: '#888888' },
          { type: 'text', text: preview, size: 'md', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '8px',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#2C7A4B',
          height: 'sm',
          action: { type: 'uri', label: 'เปิดการสนทนา', uri: deepLink },
        }],
      },
    },
  };
}

exports._buildMessage = buildMessage;
exports._stripLinePrefix = stripLinePrefix;
exports._NOTIFY_THROTTLE_MS = NOTIFY_THROTTLE_MS;

exports.notifyMarketplaceChat = onCall(
  { region: 'asia-southeast1', secrets: [LINE_TOKEN] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign-in required');
    }
    const { chatId, messageId } = request.data || {};
    if (!chatId || !messageId) {
      throw new HttpsError('invalid-argument', 'chatId + messageId required');
    }

    const firestore = admin.firestore();
    const senderUid = request.auth.uid;

    // Load + authorize against the parent chat doc.
    const chatRef = firestore.collection('marketplace_chats').doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) {
      throw new HttpsError('not-found', 'Chat not found');
    }
    const chat = chatSnap.data() || {};
    const participants = Array.isArray(chat.participants) ? chat.participants : [];
    if (!participants.includes(senderUid)) {
      throw new HttpsError('permission-denied', 'Not a participant');
    }
    if (participants.length !== 2) {
      throw new HttpsError('failed-precondition', 'Chat has unexpected participants count');
    }

    // Verify the message exists AND was sent by the caller (can't trigger
    // pushes attributed to the counterparty).
    const msgRef = chatRef.collection('messages').doc(messageId);
    const msgSnap = await msgRef.get();
    if (!msgSnap.exists) {
      throw new HttpsError('not-found', 'Message not found');
    }
    const message = msgSnap.data() || {};
    if (message.senderId !== senderUid) {
      throw new HttpsError('permission-denied', 'Can only notify for own messages');
    }
    const text = message.text;
    if (!text) return { sent: 0, skip: 'no_text' };

    const token = LINE_TOKEN.value();
    if (!token) {
      console.warn('[notifyMarketplaceChat] LINE_CHANNEL_ACCESS_TOKEN not set — skip');
      return { sent: 0, skip: 'no_token' };
    }

    const recipientUid = participants.find(p => p !== senderUid);
    if (!recipientUid) return { sent: 0, skip: 'no_counterparty' };
    const recipientLineUserId = stripLinePrefix(recipientUid);
    if (!recipientLineUserId) {
      return { sent: 0, skip: 'non_line_recipient' };
    }

    // Anti-spam throttle — per (chat, recipient).
    const lastNotifyMap = (chat.lastNotifyAt && typeof chat.lastNotifyAt === 'object')
      ? chat.lastNotifyAt
      : {};
    const lastIso = lastNotifyMap[recipientUid];
    if (lastIso) {
      const lastMs = Date.parse(lastIso);
      if (!isNaN(lastMs) && Date.now() - lastMs < NOTIFY_THROTTLE_MS) {
        return { sent: 0, skip: 'throttled', ageMs: Date.now() - lastMs };
      }
    }

    // Resolve sender display name. Best-effort — fall back to generic label.
    let senderName = 'เพื่อนบ้าน';
    const senderLineUserId = stripLinePrefix(senderUid);
    if (senderLineUserId) {
      try {
        const liffDoc = await firestore.collection('liffUsers').doc(senderLineUserId).get();
        if (liffDoc.exists) {
          const d = liffDoc.data() || {};
          senderName = d.lineDisplayName || d.displayName || senderName;
        }
      } catch (e) {
        console.warn(`[notifyMarketplaceChat] liffUsers/${senderLineUserId} lookup failed:`, e.message);
      }
    }

    const flexMessage = buildMessage({
      chatId,
      postTitle: chat.postTitle,
      senderName,
      text,
    });

    // Push.
    let pushOk = false;
    let pushErrorBody = '';
    let pushStatus = 0;
    try {
      const resp = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to: recipientLineUserId, messages: [flexMessage] }),
      });
      pushStatus = resp.status;
      if (resp.ok) {
        pushOk = true;
      } else {
        pushErrorBody = await resp.text();
      }
    } catch (e) {
      pushErrorBody = e?.message || String(e);
      pushStatus = 0; // network failure
    }

    if (pushOk) {
      try {
        await chatRef.set({
          lastNotifyAt: { [recipientUid]: new Date().toISOString() },
        }, { merge: true });
      } catch (e) {
        console.warn(`[notifyMarketplaceChat] lastNotifyAt update failed:`, e.message);
      }
      console.log(`[notifyMarketplaceChat] pushed to ${recipientLineUserId} for ${chatId}/${messageId}`);
      return { sent: 1 };
    }

    // 4xx = permanent (e.g., recipient blocked the OA, invalid user). No retry.
    if (pushStatus >= 400 && pushStatus < 500) {
      console.warn(`[notifyMarketplaceChat] permanent failure ${pushStatus} for ${recipientLineUserId} on ${chatId}: ${pushErrorBody}`);
      return { sent: 0, permanentError: pushStatus };
    }

    // 5xx / network = transient. Hand to the retry queue.
    const { enqueueLineRetry } = require('./_lineRetry');
    await enqueueLineRetry({
      lineUserId: recipientLineUserId,
      message: flexMessage,
      context: { source: 'notifyMarketplaceChat', chatId, messageId, recipientUid },
      idempotencyKey: `chat-${chatId}-${messageId}`,
      error: `LINE ${pushStatus}: ${pushErrorBody}`,
    });
    console.warn(`[notifyMarketplaceChat] transient failure ${pushStatus} for ${recipientLineUserId} — enqueued retry`);
    return { sent: 0, retryEnqueued: true };
  }
);
