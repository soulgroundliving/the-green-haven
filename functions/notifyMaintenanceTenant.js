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
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');

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
    const { docs: userDocs, error: lookupErr } = await lookupApprovedRoomUsers(firestore, building, roomId);
    if (lookupErr) {
      console.error(`❌ liffUsers query failed for ${building}/${roomId}:`, lookupErr);
      return { sent: 0 };
    }
    if (!userDocs.length) return { sent: 0 };

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

    const { pushed: sent } = await pushAndRetry({
      docs: userDocs,
      message,
      token,
      source: 'notifyMaintenanceTenant',
      context: { building, roomId, ticketId, newStatus },
      idempotencyKeyFn: (userId) => `maint-${building}-${roomId}-${ticketId}-${newStatus}-${userId}`,
    });

    if (sent > 0) {
      // Mark ticket as notified in RTDB
      try {
        await rtdb.ref(`maintenance/${building}/${roomId}/${ticketId}/statusNotifiedAt`).set(new Date().toISOString());
      } catch (e) {
        console.warn('statusNotifiedAt write failed (non-critical):', e.message);
      }
    }

    return { sent };
  });
