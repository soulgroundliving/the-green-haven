/**
 * notifyLiffRequest — HTTP function: called by tenant app after creating
 * a pending liffUsers doc, pushes LINE message to admin(s).
 *
 * Why HTTP instead of Firestore trigger:
 *   Firestore is in asia-southeast3 (Jakarta), not supported as trigger region
 *   by Cloud Functions (Gen1 or Gen2). HTTP is region-agnostic.
 *
 * Setup required:
 *   firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
 *   firebase functions:secrets:set LINE_ADMIN_USER_IDS  (comma-separated)
 *
 * Deploy: firebase deploy --only functions:notifyLiffRequest
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const LINE_CHANNEL_ACCESS_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');
const LINE_ADMIN_USER_IDS = defineSecret('LINE_ADMIN_USER_IDS');

exports.notifyLiffRequest = onRequest(
  {
    region: 'asia-southeast1',
    cors: true,
    secrets: [LINE_CHANNEL_ACCESS_TOKEN, LINE_ADMIN_USER_IDS]
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
      const { lineUserId } = req.body || {};
      if (!lineUserId) { res.status(400).json({ error: 'lineUserId required' }); return; }

      // Read the doc from Firestore (verify it actually exists + get current data)
      const db = admin.firestore();
      const snap = await db.collection('liffUsers').doc(lineUserId).get();
      if (!snap.exists) { res.status(404).json({ error: 'liffUsers doc not found' }); return; }
      const data = snap.data() || {};
      if (data.status !== 'pending') {
        res.status(200).json({ skipped: true, reason: 'not pending' });
        return;
      }

      const token = LINE_CHANNEL_ACCESS_TOKEN.value();
      const adminIds = (LINE_ADMIN_USER_IDS.value() || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!token || !adminIds.length) {
        res.status(500).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN / LINE_ADMIN_USER_IDS not set' });
        return;
      }

      const buildingLabel = data.building === 'nest' ? '🏢 Nest' : '🏠 ห้องแถว';
      const dashboardUrl = 'https://the-green-haven.vercel.app/dashboard.html?page=requests-approvals&tab=liff';
      const text = `🔗 คำขอเชื่อมบัญชีใหม่\n\n`
        + `👤 ${data.lineDisplayName || '—'}\n`
        + `🏠 ห้อง ${data.room || '—'} (${buildingLabel})\n`
        + (data.phone ? `📱 ${data.phone}\n` : '')
        + `\nอนุมัติได้ที่:\n${dashboardUrl}`;

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
        }).then(r => r.ok ? Promise.resolve(to) : r.text().then(t => Promise.reject(new Error(`LINE ${r.status}: ${t}`))))
      ));

      const pushed = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
      res.status(200).json({ ok: true, pushed, failed });
    } catch (err) {
      console.error('notifyLiffRequest error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);
