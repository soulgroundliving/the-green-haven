/**
 * notifyLiffRequest — Firestore trigger: when a new liffUsers doc is created
 * with status:'pending', push a LINE message to admin(s) so they know to
 * approve the account link request.
 *
 * Setup required:
 *   firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
 *   firebase functions:secrets:set LINE_ADMIN_USER_IDS  (comma-separated LINE userIds of admins)
 *
 * Then: firebase deploy --only functions:notifyLiffRequest
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { defineSecret } = require('firebase-functions/params');

if (!admin.apps.length) admin.initializeApp();

const LINE_CHANNEL_ACCESS_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');
const LINE_ADMIN_USER_IDS = defineSecret('LINE_ADMIN_USER_IDS');

exports.notifyLiffRequest = functions
  .region('asia-southeast1')
  .runWith({ secrets: [LINE_CHANNEL_ACCESS_TOKEN, LINE_ADMIN_USER_IDS] })
  .firestore.document('liffUsers/{userId}')
  .onCreate(async (snap, context) => {
    const data = snap.data() || {};
    if (data.status !== 'pending') {
      console.log('Skip — not a pending request');
      return null;
    }

    const token = LINE_CHANNEL_ACCESS_TOKEN.value();
    const adminIds = (LINE_ADMIN_USER_IDS.value() || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!token || !adminIds.length) {
      console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN / LINE_ADMIN_USER_IDS not set');
      return null;
    }

    const buildingLabel = data.building === 'nest' ? '🏢 Nest' : '🏠 ห้องแถว';
    const text = `🔗 คำขอเชื่อมบัญชีใหม่\n\n`
      + `👤 ${data.lineDisplayName || '—'}\n`
      + `🏠 ห้อง ${data.room || '—'} (${buildingLabel})\n`
      + (data.phone ? `📱 ${data.phone}\n` : '')
      + `\nเข้า dashboard เพื่ออนุมัติ`;

    const results = await Promise.allSettled(adminIds.map(to =>
      fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          to,
          messages: [{ type: 'text', text }]
        })
      }).then(r => r.ok ? Promise.resolve() : r.text().then(t => Promise.reject(new Error(`LINE push ${r.status}: ${t}`))))
    ));

    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`❌ Push to ${adminIds[i]}:`, r.reason.message);
      else console.log(`✅ Push to ${adminIds[i]} sent`);
    });

    return null;
  });
