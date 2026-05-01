/**
 * Shared bill computation + LINE Flex builder.
 *
 * Single source of truth for:
 *   - Bill calculation from meter readings + room config (rent/rates).
 *   - LINE Flex Message structure for "บิลใหม่พร้อมชำระ" notifications.
 *
 * Used by:
 *   notifyTenantOnMeterUpload  — Firestore meter_data trigger (primary path)
 *   notifyBillOnCreate         — RTDB bills trigger (manual admin bill path)
 *
 * Why factored out: drift between two trigger paths previously caused
 * tenants to receive Flex messages with mismatched amounts (one path
 * computed totals from form input, the other from RTDB doc — sometimes
 * stale). One module = one truth.
 */

const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();

const TENANT_APP_URL = 'https://the-green-haven.vercel.app/tenant_app.html?page=bill';
const THAI_MONTHS_SHORT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                           'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const DEFAULTS = {
  rooms: { rentPrice: 1200, electricRate: 8, waterRate: 20, trashRate: 20 },
  nest:  { rentPrice: 5800, electricRate: 8, waterRate: 20, trashRate: 40 }
};

async function loadRoomConfig(building, roomId) {
  try {
    const snap = await rtdb.ref(`rooms_config/${building}/${roomId}`).once('value');
    const cfg = snap.val();
    if (cfg && cfg.rentPrice) return cfg;
  } catch (e) { /* fall through to defaults */ }
  return DEFAULTS[building] || DEFAULTS.rooms;
}

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

function fmtBaht(n) {
  return `฿${Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Build LINE Flex bubble from a bill object. Accepts BOTH:
 *   - The legacy RTDB bill shape (charges.electric.cost, charges.rent, etc.)
 *   - The fresh computeBill output (eCost, wCost, rent, etc.)
 */
function buildBillFlex(bill) {
  // Normalize either shape into local vars
  const c        = bill.charges || {};
  const rent     = c.rent != null ? c.rent : bill.rent;
  const eCost    = (c.electric && c.electric.cost) != null ? c.electric.cost : bill.eCost;
  const wCost    = (c.water && c.water.cost) != null ? c.water.cost : bill.wCost;
  const trash    = c.trash != null ? c.trash : bill.trash;
  const eUnits   = (c.electric && c.electric.units) != null ? c.electric.units : bill.eUnits;
  const wUnits   = (c.water && c.water.units) != null ? c.water.units : bill.wUnits;
  const total    = bill.totalCharge != null ? bill.totalCharge : bill.totalAmount;
  const room     = bill.room;
  const month    = bill.month;
  const year     = bill.year;
  const dueDate  = bill.dueDate;

  const monthLabel = `${THAI_MONTHS_SHORT[month] || month}/${year}`;
  const dueDateLabel = dueDate
    ? (() => {
        const d = new Date(dueDate + 'T00:00:00');
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
        { type: 'text', text: `ห้อง ${room} • เดือน ${monthLabel}`, color: '#e8f5e9', size: 'sm', margin: 'xs' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [
        row('ค่าเช่าห้อง', fmtBaht(rent)),
        row(`ค่าไฟ (${eUnits || 0} หน่วย)`, fmtBaht(eCost)),
        row(`ค่าน้ำ (${wUnits || 0} หน่วย)`, fmtBaht(wCost)),
        row('ค่าขยะ', fmtBaht(trash)),
        { type: 'separator', margin: 'md' },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: 'รวมชำระ', size: 'md', weight: 'bold', flex: 3 },
            { type: 'text', text: fmtBaht(total), size: 'md', weight: 'bold', color: '#2d8653', flex: 2, align: 'end' }
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
    altText: `บิลเดือน ${monthLabel} ห้อง ${room} รวม ${fmtBaht(total)}`,
    contents: bubble
  };
}

module.exports = { loadRoomConfig, computeBill, buildBillFlex, DEFAULTS, THAI_MONTHS_SHORT };
