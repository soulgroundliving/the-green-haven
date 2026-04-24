/**
 * remindLatePayments — scheduled CF that nudges tenants whose bill is past
 * the due date and still unpaid.
 *
 * Why: the admin used to manually scan payment status + message each late
 * tenant on LINE. 30 rooms × monthly cycle = 1–2 hours/month of grinding
 * admin. This automates it via LINE Flex messages, escalating tone by
 * days overdue.
 *
 * Schedule: daily 09:00 BKK — one day's granularity is enough (overdue is
 * measured in days) and morning timing matches when Thai tenants check LINE.
 *
 * Reminder tiers (days past dueDate):
 *   1–7   → friendly nudge (green, "อย่าลืมชำระ")
 *   8–14  → firm reminder (orange, "เลยกำหนดแล้ว X วัน")
 *   15+   → overdue notice (red, "ติดค้าง X วัน — กรุณาติดต่อ")
 *
 * Anti-spam: each bill carries lastLateReminderAt. We re-send only if the
 * last reminder was > 7 days ago OR the tier just escalated. So a freshly
 * late bill gets one ping; an unpaid bill sees weekly follow-ups + an
 * immediate escalation message the day it crosses tier 2/3.
 *
 * Cost: LINE Messaging API free tier is 200 push/mo. Expected send volume
 * at 30 rooms × ~15% late × 4 reminders = ~18 pushes/mo. Deep in free tier.
 *
 * Region: asia-southeast1 (matches the rest of the stack).
 * Secret: LINE_CHANNEL_ACCESS_TOKEN (already configured for notifyBillOnCreate).
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();
const firestore = admin.firestore();

const TENANT_APP_URL = 'https://the-green-haven.vercel.app/tenant_app.html?page=bill';
const THAI_MONTHS_SHORT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                           'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MIN_RESEND_DAYS = 7;
const BUILDINGS = ['rooms', 'nest'];

function fmtBaht(n) {
  return `฿${Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function daysBetween(olderIso, newerMs) {
  const older = new Date(olderIso).getTime();
  return Math.floor((newerMs - older) / (1000 * 60 * 60 * 24));
}

function tierFor(daysOverdue) {
  if (daysOverdue <= 7) {
    return { key: 'soft', color: '#f57f17', title: '⏰ ใกล้ครบกำหนดชำระ',
             subtitleFn: d => `เลยกำหนดมาแล้ว ${d} วัน` };
  }
  if (daysOverdue <= 14) {
    return { key: 'firm', color: '#e65100', title: '⚠️ เลยกำหนดชำระแล้ว',
             subtitleFn: d => `ติดค้าง ${d} วัน — กรุณาชำระโดยเร็ว` };
  }
  return { key: 'stern', color: '#c62828', title: '🚨 บิลค้างชำระ',
           subtitleFn: d => `ติดค้าง ${d} วัน — กรุณาติดต่อผู้ดูแลทันที` };
}

function buildLateFlex(bill, tier, daysOverdue) {
  const monthLabel = `${THAI_MONTHS_SHORT[bill.month] || bill.month}/${bill.year}`;
  const dueLabel = bill.dueDate
    ? (() => {
        const d = new Date(bill.dueDate + 'T00:00:00');
        return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth() + 1]} ${d.getFullYear() + 543}`;
      })()
    : '—';

  const bubble = {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: tier.color, paddingAll: '16px',
      contents: [
        { type: 'text', text: tier.title, color: '#ffffff', weight: 'bold', size: 'lg' },
        { type: 'text', text: `ห้อง ${bill.room} • เดือน ${monthLabel}`, color: '#ffffff', size: 'sm', margin: 'xs' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [
        { type: 'text', text: tier.subtitleFn(daysOverdue), size: 'md', color: tier.color, weight: 'bold', wrap: true },
        { type: 'separator', margin: 'md' },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: 'ยอดค้างชำระ', size: 'md', weight: 'bold', flex: 3 },
            { type: 'text', text: fmtBaht(bill.totalCharge), size: 'md', weight: 'bold', color: tier.color, flex: 2, align: 'end' }
          ]
        },
        { type: 'text', text: `ครบกำหนด ${dueLabel}`, size: 'xs', color: '#999999', margin: 'sm', align: 'end' }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: [
        {
          type: 'button', style: 'primary', color: tier.color, height: 'sm',
          action: { type: 'uri', label: 'กดจ่ายเลย', uri: TENANT_APP_URL }
        }
      ]
    }
  };

  return {
    type: 'flex',
    altText: `${tier.title} ห้อง ${bill.room} ติดค้าง ${daysOverdue} วัน ${fmtBaht(bill.totalCharge)}`,
    contents: bubble
  };
}

async function pushLineMessage(lineUserId, flex, token) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: lineUserId, messages: [flex] })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`LINE ${res.status}: ${txt.slice(0, 200)}`);
  }
  return lineUserId;
}

/** Core: scans all bills across both buildings, dispatches reminders. */
async function runReminders() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN not set — aborting');
    return { scanned: 0, sent: 0, skipped: 0 };
  }

  const todayMs = Date.now();
  let scanned = 0, sent = 0, skipped = 0, errors = 0;

  for (const building of BUILDINGS) {
    const bldSnap = await rtdb.ref(`bills/${building}`).once('value');
    const rooms = bldSnap.val() || {};

    for (const roomId of Object.keys(rooms)) {
      const billsForRoom = rooms[roomId] || {};
      for (const billId of Object.keys(billsForRoom)) {
        const bill = billsForRoom[billId];
        if (!bill || typeof bill !== 'object') continue;
        scanned++;

        // Eligible only if unpaid + has valid dueDate + has amount owed
        if (bill.status === 'paid') { skipped++; continue; }
        if (!bill.dueDate) { skipped++; continue; }
        if (!bill.totalCharge || bill.totalCharge <= 0) { skipped++; continue; }

        const dueDate = new Date(bill.dueDate + 'T23:59:59+07:00').getTime();
        const daysOverdue = Math.floor((todayMs - dueDate) / (1000 * 60 * 60 * 24));
        if (daysOverdue < 1) { skipped++; continue; }  // not yet late

        const tier = tierFor(daysOverdue);

        // Anti-spam: last reminder must be >= MIN_RESEND_DAYS ago OR this is a
        // fresh tier escalation. We track lastLateReminderAt + lastLateTier.
        const prevAt = bill.lastLateReminderAt;
        const prevTier = bill.lastLateTier;
        if (prevAt) {
          const daysSince = daysBetween(prevAt, todayMs);
          if (daysSince < MIN_RESEND_DAYS && prevTier === tier.key) {
            skipped++;
            continue;
          }
        }

        // Find linked LINE users for this building+room
        let usersSnap;
        try {
          usersSnap = await firestore.collection('liffUsers')
            .where('building', '==', building)
            .where('room', '==', String(roomId))
            .where('status', '==', 'approved')
            .get();
        } catch (e) {
          console.error(`❌ liffUsers query failed ${building}/${roomId}: ${e.message}`);
          errors++;
          continue;
        }

        if (usersSnap.empty) { skipped++; continue; }

        const flex = buildLateFlex(bill, tier, daysOverdue);
        const results = await Promise.allSettled(
          usersSnap.docs.map(doc => pushLineMessage(doc.id, flex, token))
        );

        const ok = results.filter(r => r.status === 'fulfilled').length;
        const fail = results.length - ok;
        if (fail > 0) {
          errors++;
          const reasons = results.filter(r => r.status === 'rejected').map(r => r.reason.message).join(' | ');
          console.warn(`⚠️ partial push ${building}/${roomId}/${billId}: ok=${ok} fail=${fail} ${reasons}`);
        }

        if (ok > 0) {
          sent += ok;
          await rtdb.ref(`bills/${building}/${roomId}/${billId}`).update({
            lastLateReminderAt: new Date().toISOString(),
            lastLateTier: tier.key
          });
          console.log(`📨 [${tier.key}] ${building}/${roomId} d${daysOverdue} → ${ok} user(s)`);
        }
      }
    }
  }

  console.log(`🗓️ Late-payment sweep: scanned=${scanned} sent=${sent} skipped=${skipped} errors=${errors}`);
  return { scanned, sent, skipped, errors };
}

// ============================================================
// Scheduled — daily 09:00 BKK
// ============================================================
exports.remindLatePaymentsScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB', secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .pubsub.schedule('0 9 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try { return await runReminders(); }
    catch (e) { console.error('remindLatePaymentsScheduled failed:', e); throw e; }
  });

// ============================================================
// HTTP — admin manual trigger / testing
// POST https://asia-southeast1-<project>.cloudfunctions.net/remindLatePayments
// ============================================================
exports.remindLatePayments = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB', secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { requireAdmin } = require('./_auth');
    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    try {
      const result = await runReminders();
      return res.status(200).json({ success: true, ...result });
    } catch (e) {
      console.error('remindLatePayments HTTP failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });
