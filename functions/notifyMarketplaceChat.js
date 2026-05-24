/**
 * notifyMarketplaceChat — LINE push to the counterparty when a new chat
 * message lands in marketplace_chats/{chatId}/messages.
 *
 * Trigger: Firestore onCreate on `marketplace_chats/{chatId}/messages/{messageId}`.
 *
 * Why: without this, the privacy-first chat from Sprint 1 (which replaced
 * the line.me/ti/p personal-LINE link) is silent — recipients never know a
 * new message arrived unless their LIFF tab is open. Per
 * Nest_Marketplace_Specification.pdf v1.0 §3.3, the spec calls this CF out
 * as required for chat usefulness.
 *
 * Flow:
 *   1. Read parent chat doc → get participants, postTitle, postImageUrl
 *   2. Recipient = the participant who is NOT senderId
 *   3. Convert recipientUid `line:<userId>` → lineUserId (strip 'line:')
 *   4. Anti-spam throttle (§S2.2): skip if last-notify to this recipient on
 *      this chat was less than NOTIFY_THROTTLE_MS ago
 *   5. Resolve sender displayName from liffUsers/{senderLineUserId}
 *   6. Build flex bubble with post context + sender + preview + deep-link
 *      button → LIFF ?chat=<chatId> (client handles via §7-GG localStorage)
 *   7. Push via LINE Messaging API push
 *      - 4xx (blocked OA, invalid user) → log permanent, no retry
 *      - 5xx / network → enqueueLineRetry with idempotencyKey messageId
 *   8. On success: update chat doc lastNotifyAt.{recipientUid} = now
 *
 * §7-AA: grep'd functions/ for existing notify CFs — modeled on
 * notifyMaintenanceTenant.js (region, runWith, fetch pattern, retry hook).
 *
 * Deploy: firebase deploy --only functions:notifyMarketplaceChat
 *
 * Sprint 2 — LINE OA Notification Broker (Nest Marketplace Spec v1.0 §3.3).
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

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

exports._buildMessage = buildMessage;          // for tests
exports._stripLinePrefix = stripLinePrefix;    // for tests
exports._NOTIFY_THROTTLE_MS = NOTIFY_THROTTLE_MS;

exports.notifyMarketplaceChat = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .firestore.document('marketplace_chats/{chatId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const message = snap.data() || {};
    const chatId = context.params.chatId;
    const messageId = context.params.messageId;

    const senderUid = message.senderId;
    const text = message.text;
    if (!senderUid || !text) {
      console.log(`[notifyMarketplaceChat] skip — missing senderId/text on ${chatId}/${messageId}`);
      return null;
    }

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      console.warn('[notifyMarketplaceChat] LINE_CHANNEL_ACCESS_TOKEN not set — skip');
      return null;
    }

    const firestore = admin.firestore();
    const chatRef = firestore.collection('marketplace_chats').doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) {
      console.warn(`[notifyMarketplaceChat] chat ${chatId} not found — skip`);
      return null;
    }
    const chat = chatSnap.data() || {};
    const participants = Array.isArray(chat.participants) ? chat.participants : [];
    if (participants.length !== 2) {
      console.warn(`[notifyMarketplaceChat] chat ${chatId} has unexpected participants:`, participants);
      return null;
    }

    const recipientUid = participants.find(p => p !== senderUid);
    if (!recipientUid || recipientUid === senderUid) {
      console.log(`[notifyMarketplaceChat] no counterparty on ${chatId} — skip`);
      return null;
    }
    const recipientLineUserId = stripLinePrefix(recipientUid);
    if (!recipientLineUserId) {
      // Pre-LIFF or non-LINE participant uids cannot receive LINE pushes.
      console.log(`[notifyMarketplaceChat] recipient ${recipientUid} is not line:* — skip`);
      return null;
    }

    // Anti-spam throttle — per (chat, recipient).
    const lastNotifyMap = (chat.lastNotifyAt && typeof chat.lastNotifyAt === 'object')
      ? chat.lastNotifyAt
      : {};
    const lastIso = lastNotifyMap[recipientUid];
    if (lastIso) {
      const lastMs = Date.parse(lastIso);
      if (!isNaN(lastMs) && Date.now() - lastMs < NOTIFY_THROTTLE_MS) {
        console.log(`[notifyMarketplaceChat] throttled — last push to ${recipientUid} on ${chatId} was ${Date.now() - lastMs}ms ago`);
        return null;
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
        // Non-fatal — push succeeded, throttle just won't apply for the next round.
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
  });
