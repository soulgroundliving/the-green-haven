/**
 * notifyMaintenanceTenant — admin callable: sends LINE push to tenant
 * when maintenance ticket status changes.
 *
 * Auth:   admin only.
 * Input:  { ticketId, building, roomId, newStatus, category }
 * Returns: { sent: number }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();
const rtdb = admin.database();

const STATUS_LABEL = {
  inprogress: 'กำลังดำเนินการ',
  done: 'เสร็จสิ้นแล้ว',
  pending: 'รอดำเนินการ',
};

const CATEGORY_LABEL = {
  electric: 'ไฟฟ้า',
  water: 'ประปา',
  aircon: 'แอร์',
  furniture: 'เฟอร์นิเจอร์',
  door: 'ประตู/หน้าต่าง',
  internet: 'อินเทอร์เน็ต',
  other: 'อื่นๆ',
};

exports.notifyMaintenanceTenant = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    if (context.auth.token?.admin !== true) {
      throw new functions.https.HttpsError('permission-denied', 'Admin only');
    }

    const { ticketId, building, roomId, newStatus, category } = data || {};
    if (!ticketId || !building || !roomId || !newStatus) {
      throw new functions.https.HttpsError('invalid-argument', 'ticketId, building, roomId, newStatus are required');
    }

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN not set — skip notify');
      return { sent: 0 };
    }

    // Look up approved LINE-linked tenants for this room
    let usersSnap;
    try {
      usersSnap = await firestore.collection('liffUsers')
        .where('building', '==', building)
        .where('room', '==', String(roomId))
        .where('status', '==', 'approved')
        .get();
    } catch (e) {
      console.error(`❌ liffUsers query failed for ${building}/${roomId}:`, e.message);
      return { sent: 0 };
    }

    if (usersSnap.empty) {
      console.log(`ℹ️ No approved LINE-linked tenant for ${building}/${roomId} — skip`);
      return { sent: 0 };
    }

    const statusLabel = STATUS_LABEL[newStatus] || newStatus;
    const categoryLabel = CATEGORY_LABEL[category] || category || 'งานซ่อม';

    const message = {
      type: 'flex',
      altText: `🔧 อัปเดตงานซ่อม: ${categoryLabel} — ${statusLabel}`,
      contents: {
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: newStatus === 'done' ? '#27AE60' : '#2C7A4B',
          paddingAll: '12px',
          contents: [{
            type: 'text',
            text: newStatus === 'done' ? '✅ งานซ่อมเสร็จสิ้น' : '🔧 อัปเดตงานซ่อม',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'md',
          }],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          paddingAll: '14px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'ประเภท', color: '#888888', size: 'sm', flex: 2 },
                { type: 'text', text: categoryLabel, size: 'sm', flex: 3, wrap: true },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'สถานะ', color: '#888888', size: 'sm', flex: 2 },
                { type: 'text', text: statusLabel, size: 'sm', flex: 3, weight: 'bold',
                  color: newStatus === 'done' ? '#27AE60' : '#2C7A4B' },
              ],
            },
            {
              type: 'text',
              text: `รหัสแจ้ง: ${ticketId}`,
              color: '#AAAAAA',
              size: 'xs',
              margin: 'sm',
            },
          ],
        },
      },
    };

    const { enqueueLineRetry } = require('./_lineRetry');
    const results = await Promise.allSettled(usersSnap.docs.map(doc => {
      const lineUserId = doc.id;
      return fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to: lineUserId, messages: [message] }),
      }).then(r => r.ok
        ? Promise.resolve(lineUserId)
        : r.text().then(t => Promise.reject({ lineUserId, error: new Error(`LINE ${r.status}: ${t}`) }))
      );
    }));

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failures = results.filter(r => r.status === 'rejected').map(r => r.reason);

    for (const f of failures) {
      const userId = f?.lineUserId || 'unknown';
      const errMsg = f?.error?.message || String(f);
      await enqueueLineRetry({
        lineUserId: userId,
        message,
        context: { source: 'notifyMaintenanceTenant', building, roomId, ticketId, newStatus },
        idempotencyKey: `maint-${building}-${roomId}-${ticketId}-${newStatus}-${userId}`,
        error: errMsg,
      });
    }

    if (failures.length) {
      console.warn(`⚠️ LINE notify failures for ${building}/${roomId} ticket ${ticketId}:`, failures.length);
    }
    if (sent > 0) {
      // Mark ticket as notified in RTDB
      try {
        await rtdb.ref(`maintenance/${building}/${roomId}/${ticketId}/statusNotifiedAt`).set(new Date().toISOString());
      } catch (e) {
        console.warn('statusNotifiedAt write failed (non-critical):', e.message);
      }
      console.log(`📨 Maintenance notify sent to ${sent} user(s) — ${building}/${roomId}/${ticketId} → ${newStatus}`);
    }

    return { sent };
  });
