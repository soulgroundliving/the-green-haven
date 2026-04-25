/**
 * notifyLiffStatusChange — HTTP function: called by dashboard's
 * approveLiffLink/rejectLiffLink, pushes a LINE message to the tenant.
 *
 * Why HTTP: Firestore is in asia-southeast3 → no trigger support.
 * Caller is dashboard JS, which already has admin auth context for the
 * Firestore write that precedes this call. This CF is best-effort: if the
 * LINE API or secret is unavailable it returns 200 with skipped:true so the
 * dashboard doesn't surface a confusing error after the status update succeeded.
 *
 * Setup (already set for notifyLiffRequest):
 *   firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
 *
 * Deploy: firebase deploy --only functions:notifyLiffStatusChange
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const LINE_CHANNEL_ACCESS_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');

exports.notifyLiffStatusChange = onRequest(
  {
    region: 'asia-southeast1',
    cors: true,
    secrets: [LINE_CHANNEL_ACCESS_TOKEN]
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
      const { lineUserId, status, reason } = req.body || {};
      if (!lineUserId || !status) {
        res.status(400).json({ error: 'lineUserId and status required' });
        return;
      }
      if (status !== 'approved' && status !== 'rejected') {
        res.status(400).json({ error: 'status must be approved or rejected' });
        return;
      }

      // Cold-start guard: secret might not be available yet.
      // Return 200 + skipped so the dashboard doesn't surface a confusing error
      // after the Firestore status update succeeded.
      const token = LINE_CHANNEL_ACCESS_TOKEN.value();
      if (!token) {
        console.warn('LINE_CHANNEL_ACCESS_TOKEN not set, skipping push');
        res.status(200).json({ ok: false, skipped: true, reason: 'no token' });
        return;
      }

      const text = status === 'approved'
        ? '🎉 บัญชีของคุณได้รับการอนุมัติแล้ว\nเปิดแอปได้เลย — ระบบจะแสดงบิล/บริการต่างๆ'
        : '❌ คำขอเชื่อมบัญชีถูกปฏิเสธ\n'
          + 'เหตุผล: ' + (reason || 'ข้อมูลไม่ตรงกับสัญญาเช่า กรุณาติดต่อเจ้าของ') + '\n\n'
          + 'หากเข้าใจผิด กรุณาส่งข้อความหาเจ้าของผ่าน LINE';

      const resp = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          to: lineUserId,
          messages: [{ type: 'text', text }]
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn('LINE push failed:', resp.status, errText);
        // Best-effort: still return 200 so dashboard doesn't show a scary error
        res.status(200).json({ ok: false, lineStatus: resp.status, error: errText });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('notifyLiffStatusChange error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);
