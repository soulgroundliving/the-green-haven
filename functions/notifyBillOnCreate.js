/**
 * notifyBillOnCreate — RTDB trigger: pushes LINE Flex message to linked tenants
 * when a new bill appears under bills/{building}/{roomId}/{billId}.
 *
 * Why RTDB trigger (not Firestore):
 *   Firestore is in asia-southeast3 (Jakarta), not supported by Gen1/Gen2 triggers.
 *   RTDB triggers are region-agnostic. Bills live in RTDB anyway.
 *
 * Guard against duplicates:
 *   Sets billNotifiedAt on the bill after push succeeds. onCreate only fires once
 *   per new key, but re-deletion + re-creation would re-fire — the field persists
 *   on rewrite via the upstream generateBillsOnMeterUpdate (preserve-if-exists pattern).
 *
 * Setup:
 *   firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN  (already set for notifyLiffRequest)
 * Deploy:
 *   firebase deploy --only functions:notifyBillOnCreate
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();
const firestore = admin.firestore();

const TENANT_APP_URL = 'https://the-green-haven.vercel.app/tenant_app.html?page=bill';
const THAI_MONTHS_SHORT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                           'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function fmtBaht(n) {
  return `฿${Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function buildBillFlex(bill) {
  const monthLabel = `${THAI_MONTHS_SHORT[bill.month] || bill.month}/${bill.year}`;
  const c = bill.charges || {};
  const eUnits = (c.electric && c.electric.units) || 0;
  const wUnits = (c.water && c.water.units) || 0;
  const dueDateLabel = bill.dueDate
    ? (() => {
        const d = new Date(bill.dueDate + 'T00:00:00');
        return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth() + 1]} ${d.getFullYear() + 543}`;
      })()
    : '—';

  const row = (label, value) => ({
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#666666', flex: 3 },
      { type: 'text', text: value, size: 'sm', color: '#222222', flex: 2, align: 'end' }
    ]
  });

  const bubble = {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#2d8653', paddingAll: '16px',
      contents: [
        { type: 'text', text: '💰 บิลใหม่พร้อมชำระ', color: '#ffffff', weight: 'bold', size: 'lg' },
        { type: 'text', text: `ห้อง ${bill.room} • เดือน ${monthLabel}`, color: '#e8f5e9', size: 'sm', margin: 'xs' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [
        row('ค่าเช่าห้อง', fmtBaht(c.rent)),
        row(`ค่าไฟ (${eUnits} หน่วย)`, fmtBaht(c.electric && c.electric.cost)),
        row(`ค่าน้ำ (${wUnits} หน่วย)`, fmtBaht(c.water && c.water.cost)),
        row('ค่าขยะ', fmtBaht(c.trash)),
        { type: 'separator', margin: 'md' },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: 'รวมชำระ', size: 'md', weight: 'bold', flex: 3 },
            { type: 'text', text: fmtBaht(bill.totalCharge), size: 'md', weight: 'bold', color: '#2d8653', flex: 2, align: 'end' }
          ]
        },
        { type: 'text', text: `ครบกำหนด ${dueDateLabel}`, size: 'xs', color: '#999999', margin: 'sm', align: 'end' }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: [
        {
          type: 'button', style: 'primary', color: '#2d8653', height: 'sm',
          action: { type: 'uri', label: 'กดจ่ายเลย', uri: TENANT_APP_URL }
        }
      ]
    }
  };

  return {
    type: 'flex',
    altText: `บิลเดือน ${monthLabel} ห้อง ${bill.room} รวม ${fmtBaht(bill.totalCharge)}`,
    contents: bubble
  };
}

exports.notifyBillOnCreate = functions.region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .database.ref('/bills/{building}/{roomId}/{billId}')
  .onCreate(async (snap, context) => {
    const bill = snap.val();
    const { building, roomId, billId } = context.params;

    if (!bill) return null;
    if (bill.status === 'paid') {
      console.log(`⏭ ${building}/${roomId}/${billId} already paid at creation — skip`);
      return null;
    }
    if (bill.billNotifiedAt) {
      console.log(`⏭ ${building}/${roomId}/${billId} already notified — skip`);
      return null;
    }
    if (!bill.totalCharge || bill.totalCharge <= 0) {
      console.log(`⏭ ${building}/${roomId}/${billId} total=0 — skip`);
      return null;
    }

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN not set — skip notify');
      return null;
    }

    // Query linked tenant(s) — building + room + status='approved'
    let usersSnap;
    try {
      usersSnap = await firestore.collection('liffUsers')
        .where('building', '==', building)
        .where('room', '==', String(roomId))
        .where('status', '==', 'approved')
        .get();
    } catch (e) {
      console.error(`❌ liffUsers query failed for ${building}/${roomId}:`, e.message);
      return null;
    }

    if (usersSnap.empty) {
      console.log(`ℹ️ No approved LINE-linked tenant for ${building}/${roomId} — skip`);
      return null;
    }

    const flexMsg = buildBillFlex(bill);
    const results = await Promise.allSettled(usersSnap.docs.map(doc => {
      const lineUserId = doc.id;
      return fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ to: lineUserId, messages: [flexMsg] })
      }).then(r => r.ok
        ? Promise.resolve(lineUserId)
        : r.text().then(t => Promise.reject(new Error(`LINE ${r.status}: ${t}`)))
      );
    }));

    const pushed = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
    if (failed.length) console.warn(`⚠️ notify failures for ${building}/${roomId}:`, failed);

    if (pushed > 0) {
      await rtdb.ref(`bills/${building}/${roomId}/${billId}/billNotifiedAt`).set(new Date().toISOString());
      console.log(`📨 Bill notify sent to ${pushed} user(s) for ${building}/${roomId}/${billId}`);
    }
    return { pushed, failed: failed.length };
  });
