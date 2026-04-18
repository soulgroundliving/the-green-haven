/**
 * Revenue + tax aggregation for Green Haven (residential rental — VAT-exempt).
 *
 * Reads RTDB bills/{building}/{room}/{billId} and computes per-month + per-year
 * summaries written to Firestore taxSummary/{yearBE} with structure:
 *
 * taxSummary/2569 = {
 *   year: 2569,
 *   updatedAt: ...,
 *   months: {
 *     1: { rentIncome, electricIncome, waterIncome, trashIncome, totalRevenue,
 *          paidCount, paidRevenue, pendingCount, pendingRevenue,
 *          byBuilding: { rooms: {...}, nest: {...} } },
 *     2: {...}, ..., 12: {...}
 *   },
 *   annual: { rentIncome, electricIncome, waterIncome, trashIncome, totalRevenue,
 *             paidRevenue, pendingRevenue,
 *             // Tax estimates (Thai personal income tax — บุคคลธรรมดา)
 *             standardDeduction30: totalRevenue * 0.30,
 *             netRevenueAfterStdDed: totalRevenue * 0.70,
 *             // Note: actual income tax also depends on personal allowances,
 *             // other income, and progressive brackets — show estimate only
 *           }
 * }
 *
 * Triggers:
 *   - Scheduled (cron '7 2 1 * *') — runs 1st of every month at 02:07 BKK
 *   - HTTP endpoint — POST to manually re-aggregate any year
 *
 * Region: asia-southeast1
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}
const rtdb = admin.database();
const firestore = admin.firestore();

const BUILDINGS = ['rooms', 'nest'];
const EMPTY_MONTH = () => ({
  rentIncome: 0, electricIncome: 0, waterIncome: 0, trashIncome: 0,
  totalRevenue: 0,
  paidCount: 0, paidRevenue: 0,
  pendingCount: 0, pendingRevenue: 0,
  byBuilding: {
    rooms: { rent: 0, electric: 0, water: 0, trash: 0, total: 0, paid: 0, pending: 0 },
    nest:  { rent: 0, electric: 0, water: 0, trash: 0, total: 0, paid: 0, pending: 0 }
  }
});

function normalizeBeYear(y) {
  const n = Number(y);
  if (n < 100) return 2500 + n;          // BE 2-digit (e.g., 69)
  if (n < 2400) return 2500 + (n % 100); // safety
  return n;                              // already 4-digit BE
}

async function aggregateYear(yearBE) {
  // Initialize all 12 months
  const months = {};
  for (let m = 1; m <= 12; m++) months[m] = EMPTY_MONTH();

  // Walk all bills for both buildings
  for (const building of BUILDINGS) {
    const buildingSnap = await rtdb.ref(`bills/${building}`).once('value');
    const rooms = buildingSnap.val() || {};
    for (const roomId of Object.keys(rooms)) {
      const billsObj = rooms[roomId] || {};
      for (const billId of Object.keys(billsObj)) {
        const b = billsObj[billId];
        if (!b || typeof b !== 'object') continue;
        const billYearBE = normalizeBeYear(b.year);
        if (billYearBE !== yearBE) continue;
        const month = Number(b.month);
        if (!month || month < 1 || month > 12) continue;
        // Skip orphan/ghost stubs (no charges + no totalCharge)
        const total = Number(b.totalCharge || b.totalAmount || b.total) || 0;
        if (total <= 0 && !b.charges) continue;

        const m = months[month];
        const rent  = Number(b.charges?.rent) || 0;
        const elec  = Number(b.charges?.electric?.cost) || 0;
        const water = Number(b.charges?.water?.cost) || 0;
        const trash = Number(b.charges?.trash) || 0;
        const isPaid = b.status === 'paid';

        m.rentIncome     += rent;
        m.electricIncome += elec;
        m.waterIncome    += water;
        m.trashIncome    += trash;
        m.totalRevenue   += total;
        if (isPaid) {
          m.paidCount++;
          m.paidRevenue += total;
        } else {
          m.pendingCount++;
          m.pendingRevenue += total;
        }
        // Per-building breakdown
        const bb = m.byBuilding[building];
        if (bb) {
          bb.rent += rent; bb.electric += elec; bb.water += water; bb.trash += trash;
          bb.total += total;
          if (isPaid) bb.paid += total; else bb.pending += total;
        }
      }
    }
  }

  // Annual totals
  const annual = {
    rentIncome: 0, electricIncome: 0, waterIncome: 0, trashIncome: 0,
    totalRevenue: 0, paidRevenue: 0, pendingRevenue: 0,
    paidCount: 0, pendingCount: 0,
    byBuilding: {
      rooms: { rent: 0, electric: 0, water: 0, trash: 0, total: 0, paid: 0, pending: 0 },
      nest:  { rent: 0, electric: 0, water: 0, trash: 0, total: 0, paid: 0, pending: 0 }
    }
  };
  for (let m = 1; m <= 12; m++) {
    const x = months[m];
    annual.rentIncome     += x.rentIncome;
    annual.electricIncome += x.electricIncome;
    annual.waterIncome    += x.waterIncome;
    annual.trashIncome    += x.trashIncome;
    annual.totalRevenue   += x.totalRevenue;
    annual.paidRevenue    += x.paidRevenue;
    annual.pendingRevenue += x.pendingRevenue;
    annual.paidCount      += x.paidCount;
    annual.pendingCount   += x.pendingCount;
    BUILDINGS.forEach(b => {
      const a = annual.byBuilding[b]; const s = x.byBuilding[b];
      if (!a || !s) return;
      ['rent','electric','water','trash','total','paid','pending'].forEach(k => { a[k] += s[k]; });
    });
  }

  // Tax estimates — Thai personal income tax (40(5)(ก) ทรัพย์สิน)
  // Standard deduction 30% for buildings rental income (no need to prove costs)
  // Owner can switch to actual-cost deduction if higher; we show 30% as default
  annual.taxEstimate = {
    method: 'standard_deduction_30pct',
    grossRevenue: annual.totalRevenue,
    standardDeduction: Math.round(annual.totalRevenue * 0.30),
    netRevenue: Math.round(annual.totalRevenue * 0.70),
    note: 'ประมาณการสำหรับยื่น ภ.ง.ด.90 (บุคคลธรรมดา ม.40(5)(ก) ทรัพย์สิน) — ค่าใช้จ่ายเหมา 30%. ภาษีจริงขึ้นกับรายได้รวมจากแหล่งอื่น + ค่าลดหย่อนส่วนบุคคล'
  };

  return { months, annual };
}

async function writeSummary(yearBE) {
  const { months, annual } = await aggregateYear(yearBE);
  const docRef = firestore.collection('taxSummary').doc(String(yearBE));
  const payload = {
    year: yearBE,
    months,
    annual,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    aggregatedAt: new Date().toISOString()
  };
  await docRef.set(payload);
  console.log(`✅ taxSummary/${yearBE} updated: total ฿${annual.totalRevenue.toLocaleString()} (paid ฿${annual.paidRevenue.toLocaleString()})`);
  return { yearBE, totalRevenue: annual.totalRevenue, paidRevenue: annual.paidRevenue };
}

// ============================================================
// Scheduled — runs 1st of each month at 02:07 BKK
// Aggregates the just-ended month + the current ongoing year
// ============================================================
exports.aggregateMonthlyRevenueScheduled = functions
  .region('asia-southeast1')
  .pubsub.schedule('7 2 1 * *')
  .timeZone('Asia/Bangkok')
  .onRun(async (context) => {
    try {
      const now = new Date();
      // Current BE year
      const currentBE = now.getFullYear() + 543;
      // Previous BE year (only if Jan — then we need to close last year too)
      const tasks = [writeSummary(currentBE)];
      if (now.getMonth() === 0) tasks.push(writeSummary(currentBE - 1));
      const results = await Promise.all(tasks);
      console.log('🗓️ Monthly aggregation done:', results);
      return null;
    } catch (e) {
      console.error('aggregateMonthlyRevenueScheduled failed:', e);
      throw e;
    }
  });

// ============================================================
// HTTP — POST { year: 2569 } to re-aggregate any year on demand
// ============================================================
exports.aggregateMonthlyRevenue = functions
  .region('asia-southeast1')
  .https.onRequest(async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
    try {
      let years = [];
      const body = req.body || {};
      if (body.year) {
        years = [Number(body.year)];
      } else if (Array.isArray(body.years)) {
        years = body.years.map(Number);
      } else {
        // Default: aggregate current BE year + previous (covers Jan rollover)
        const currentBE = new Date().getFullYear() + 543;
        years = [currentBE, currentBE - 1];
      }
      const out = [];
      for (const y of years) {
        const r = await writeSummary(y);
        out.push(r);
      }
      return res.status(200).json({ ok: true, aggregated: out });
    } catch (e) {
      console.error('aggregateMonthlyRevenue HTTP failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });
