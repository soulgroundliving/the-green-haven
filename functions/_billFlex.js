/**
 * Shared bill computation + LINE Flex builders.
 *
 * Single source of truth for:
 *   - Bill calculation from meter readings + room config (rent/rates).
 *   - LINE Flex "ใบแจ้งหนี้" (blue) — new bill notification.
 *   - LINE Flex "ใบเสร็จรับเงิน" (green) — post-payment receipt.
 *
 * Used by:
 *   notifyTenantOnMeterUpload  — Firestore meter_data trigger (primary path)
 *   notifyBillOnCreate         — RTDB bills trigger (manual admin bill path)
 *   verifySlip                 — sends receipt after slip verified
 */

const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();

// LIFF URL — opens in LINE in-app browser so the LIFF SDK is available,
// the tenant gets auto-signed-in via liffSignIn CF (LINE ID token →
// Firebase custom token), and claims/bills load. Using vercel.app
// directly here would open Safari/Chrome where LIFF SDK is unavailable
// → "Failed to create custom token" → tenant lands on default page
// without auth and never sees their bill.
const LIFF_ID = '2009790149-Db7T76sd';
const TENANT_APP_PAYMENT_URL = `https://liff.line.me/${LIFF_ID}?page=payment`;
const TENANT_APP_BILL_URL    = `https://liff.line.me/${LIFF_ID}?page=bill`;
const THAI_MONTHS_SHORT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                           'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_MONTHS_FULL  = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                           'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const DEFAULTS = {
  rooms: { rentPrice: 1200, electricRate: 8, waterRate: 20, trashRate: 20 },
  nest:  { rentPrice: 5800, electricRate: 8, waterRate: 20, trashRate: 40 }
};

// ─── Loaders ────────────────────────────────────────────────────────────────

async function loadRoomConfig(building, roomId) {
  try {
    const snap = await rtdb.ref(`rooms_config/${building}/${roomId}`).once('value');
    const cfg = snap.val();
    if (cfg && cfg.rentPrice) return cfg;
  } catch (e) { /* fall through to defaults */ }
  return DEFAULTS[building] || DEFAULTS.rooms;
}

async function loadOwnerInfo() {
  try {
    const snap = await admin.firestore().collection('owner_info').doc('main').get();
    const d = snap.data() || {};
    return { bankName: d.bankName || '', bankAccount: d.bankAccount || '', name: d.name || '' };
  } catch (e) {
    return { bankName: '', bankAccount: '', name: '' };
  }
}

// ─── Bill computation ────────────────────────────────────────────────────────

/**
 * Compute bill from meter readings + room config.
 * Returns null when room is vacant / misconfigured (rent <= 0).
 */
function computeBill({ building, roomId, year, month, eOld, eNew, wOld, wNew }, cfg) {
  const rent  = Number(cfg.rentPrice)    || 0;
  if (rent <= 0) return null;
  const eRate = Number(cfg.electricRate) || 8;
  const wRate = Number(cfg.waterRate)    || 20;
  const trash = Number(cfg.trashRate)    || 20;

  const eU = Math.max(0, (Number(eNew) || 0) - (Number(eOld) || 0));
  const wU = Math.max(0, (Number(wNew) || 0) - (Number(wOld) || 0));
  const eCost = eU * eRate;
  const wCost = wU * wRate;
  const total = rent + eCost + wCost + trash;

  const beYear = Number(year) < 100 ? 2500 + Number(year) : Number(year);
  const ceYear = beYear - 543;
  const dueYear  = month === 12 ? ceYear + 1 : ceYear;
  const dueMonth = month === 12 ? 1 : Number(month) + 1;
  const dueDate  = `${dueYear}-${String(dueMonth).padStart(2, '0')}-05`;

  return {
    building, room: String(roomId), year: beYear, month: Number(month),
    rent, eRate, wRate, trash,
    eOld: Number(eOld) || 0, eNew: Number(eNew) || 0, eUnits: eU, eCost,
    wOld: Number(wOld) || 0, wNew: Number(wNew) || 0, wUnits: wU, wCost,
    totalCharge: total, dueDate
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtBaht(n) {
  return `฿${Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtThaiDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${THAI_MONTHS_FULL[d.getMonth() + 1]} ${d.getFullYear() + 543}`;
}

function fmtThaiDateFull(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getDate()} ${THAI_MONTHS_FULL[d.getMonth() + 1]} ${d.getFullYear() + 543}`;
}

// ─── Shared row builder ───────────────────────────────────────────────────────

function row(label, value, opts = {}) {
  return {
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: opts.labelColor || '#666666', flex: 3 },
      { type: 'text', text: value, size: 'sm', color: opts.valueColor || '#222222', flex: 2, align: 'end',
        weight: opts.bold ? 'bold' : 'regular' }
    ]
  };
}

// ─── Bill normalizer (handles RTDB shape + computeBill output) ────────────────

function normalizeBill(bill) {
  const c     = bill.charges || {};
  const rent  = c.rent    != null ? c.rent    : bill.rent;
  const eCost = (c.electric && c.electric.cost) != null ? c.electric.cost : bill.eCost;
  const wCost = (c.water   && c.water.cost)     != null ? c.water.cost    : bill.wCost;
  const trash = c.trash   != null ? c.trash   : bill.trash;
  const eUnits = (c.electric && c.electric.units) != null ? c.electric.units : bill.eUnits;
  const wUnits = (c.water   && c.water.units)     != null ? c.water.units    : bill.wUnits;
  const total  = bill.totalCharge != null ? bill.totalCharge : bill.totalAmount;
  return { rent, eCost, wCost, trash, eUnits, wUnits, total,
           room: bill.room, month: bill.month, year: bill.year,
           building: bill.building, dueDate: bill.dueDate };
}

// ─── Invoice Flex (blue — "ใบแจ้งหนี้") ──────────────────────────────────────

/**
 * Build LINE Flex "ใบแจ้งหนี้" bubble.
 *
 * @param {object} bill     - computeBill output or RTDB bill shape
 * @param {object} [opts]
 * @param {string} [opts.tenantName] - Full tenant name (shown as "คุณ ...")
 */
function buildBillFlex(bill, opts = {}) {
  const { tenantName = '' } = opts;
  const b = normalizeBill(bill);

  const monthLabel   = `${THAI_MONTHS_SHORT[b.month] || b.month}/${b.year}`;
  const dueDateLabel = fmtThaiDate(b.dueDate);

  const buildingInitial = String(b.building || '').charAt(0).toUpperCase() || 'X';
  const invoiceRef = `INV-${buildingInitial}${b.room}-${String(b.year % 100).padStart(2,'0')}${String(b.month).padStart(2,'0')}`;

  const nameLabel = tenantName ? `คุณ ${tenantName}` : `ห้อง ${b.room}`;

  const footerButtons = [
    {
      type: 'button', style: 'primary', color: '#1565c0', height: 'sm',
      action: { type: 'uri', label: 'ดูใบแจ้งหนี้', uri: TENANT_APP_PAYMENT_URL }
    }
  ];

  const bubble = {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#1565c0', paddingAll: '16px',
      contents: [
        { type: 'text', text: 'ใบแจ้งหนี้', color: '#ffffff', weight: 'bold', size: 'xl' },
        { type: 'text', text: `${nameLabel} • เดือน ${monthLabel}`,
          color: '#bbdefb', size: 'sm', margin: 'xs' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [
        row('ผู้เช่า', nameLabel),
        row('เลขที่บิล', invoiceRef),
        row('ครบกำหนด', dueDateLabel),
        { type: 'separator', margin: 'md' },
        row('ค่าเช่า', fmtBaht(b.rent), { labelColor: '#444444' }),
        row(`ค่าน้ำ (${b.wUnits || 0} หน่วย)`, fmtBaht(b.wCost), { labelColor: '#444444' }),
        row(`ค่าไฟ (${b.eUnits || 0} หน่วย)`, fmtBaht(b.eCost), { labelColor: '#444444' }),
        row('ค่าขยะ', fmtBaht(b.trash), { labelColor: '#444444' }),
        { type: 'separator', margin: 'md' },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: 'ยอดชำระทั้งสิ้น', size: 'sm', weight: 'bold', flex: 3, color: '#333333' },
            { type: 'text', text: fmtBaht(b.total), size: 'xl', weight: 'bold', color: '#1565c0', flex: 2, align: 'end' }
          ]
        }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: footerButtons
    }
  };

  return {
    type: 'flex',
    altText: `ใบแจ้งหนี้เดือน ${monthLabel} ห้อง ${b.room} ยอด ${fmtBaht(b.total)} ครบกำหนด ${dueDateLabel}`,
    contents: bubble
  };
}

// ─── Receipt Flex (green — "ใบเสร็จรับเงิน") ─────────────────────────────────

/**
 * Build LINE Flex "ใบเสร็จรับเงิน" bubble.
 *
 * @param {object} bill       - computeBill output or RTDB bill shape
 * @param {object} [opts]
 * @param {string} [opts.tenantName] - Full tenant name
 * @param {Date}   [opts.paidAt]     - Payment timestamp
 */
function buildReceiptFlex(bill, opts = {}) {
  const { tenantName = '', paidAt } = opts;
  const b = normalizeBill(bill);

  const monthLabel = `${THAI_MONTHS_SHORT[b.month] || b.month}/${b.year}`;
  const paidDateLabel = fmtThaiDateFull(paidAt || new Date());

  const buildingInitial = String(b.building || '').charAt(0).toUpperCase() || 'X';
  const receiptRef = `RCP-${buildingInitial}${b.room}-${String(b.year % 100).padStart(2,'0')}${String(b.month).padStart(2,'0')}`;

  const nameLabel = tenantName ? `คุณ ${tenantName}` : `ห้อง ${b.room}`;

  const bubble = {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#2d8653', paddingAll: '16px',
      contents: [
        { type: 'text', text: 'ใบเสร็จรับเงิน', color: '#ffffff', weight: 'bold', size: 'xl' },
        { type: 'text', text: `${nameLabel} • เดือน ${monthLabel}`,
          color: '#c8e6c9', size: 'sm', margin: 'xs' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [
        row('ผู้เช่า', nameLabel),
        row('เลขที่บิล', receiptRef),
        row('วันที่ชำระ', paidDateLabel),
        { type: 'separator', margin: 'md' },
        row('ค่าเช่า', fmtBaht(b.rent), { labelColor: '#444444' }),
        row(`ค่าน้ำ (${b.wUnits || 0} หน่วย)`, fmtBaht(b.wCost), { labelColor: '#444444' }),
        row(`ค่าไฟ (${b.eUnits || 0} หน่วย)`, fmtBaht(b.eCost), { labelColor: '#444444' }),
        row('ค่าขยะ', fmtBaht(b.trash), { labelColor: '#444444' }),
        { type: 'separator', margin: 'md' },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: 'ยอดที่ชำระ', size: 'sm', weight: 'bold', flex: 3, color: '#333333' },
            { type: 'text', text: fmtBaht(b.total), size: 'xl', weight: 'bold', color: '#2d8653', flex: 2, align: 'end' }
          ]
        }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: [
        {
          type: 'button', style: 'primary', color: '#2d8653', height: 'sm',
          action: { type: 'uri', label: 'ดูใบเสร็จรับเงิน', uri: TENANT_APP_BILL_URL }
        }
      ]
    }
  };

  return {
    type: 'flex',
    altText: `ชำระบิลเดือน ${monthLabel} ห้อง ${b.room} เรียบร้อยแล้ว ${fmtBaht(b.total)}`,
    contents: bubble
  };
}

module.exports = {
  loadRoomConfig,
  loadOwnerInfo,
  computeBill,
  buildBillFlex,
  buildReceiptFlex,
  DEFAULTS,
  THAI_MONTHS_SHORT
};
