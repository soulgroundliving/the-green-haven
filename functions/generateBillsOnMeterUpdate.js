/**
 * Firestore trigger: auto-generate bill when a meter_data doc is written.
 *
 * Doc id pattern: {building}_{yearBE2digit}_{month}_{roomId}
 *   e.g., rooms_69_04_15  →  building='rooms', year=69(BE)=2026, month=4, roomId=15
 *
 * Fields read:  eOld, eNew, wOld, wNew  (from the meter_data doc)
 * Config source: RTDB rooms_config/{building}/{roomId}  (synced from admin UI via
 *                RoomConfigManager.syncToFirebase)
 * Output: RTDB bills/{building}/{roomId}/{billId}  — tenant app reads this live
 *
 * Deploy: firebase deploy --only functions:generateBillsOnMeterUpdate
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}
const rtdb = admin.database();
const firestore = admin.firestore();

const DEFAULTS = {
  rooms: { rentPrice: 1200, electricRate: 8, waterRate: 20, trashRate: 20 },
  nest:  { rentPrice: 5800, electricRate: 8, waterRate: 20, trashRate: 40 }
};

function parseDocId(id) {
  // e.g., "rooms_69_04_15" OR "rooms_67_10_15" (month may be 1-2 digits)
  const parts = String(id).split('_');
  if (parts.length < 4) return null;
  // Last segment is roomId, rest parsed from front
  const roomId = parts.slice(3).join('_'); // handles roomIds with underscores
  const building = parts[0];
  const year = Number(parts[1]);   // BE 2-digit (67-99) or 4-digit
  const month = Number(parts[2]);  // 1-12
  if (!building || isNaN(year) || isNaN(month)) return null;
  // Normalize to 4-digit BE
  const beYear = year < 100 ? 2500 + year : year;
  // Tenant display prefers CE but billId keeps BE-style; store both
  const ceYear = beYear - 543;
  return { building, roomId, beYear, ceYear, month };
}

async function loadRoomConfig(building, roomId) {
  try {
    const snap = await rtdb.ref(`rooms_config/${building}/${roomId}`).once('value');
    const cfg = snap.val();
    if (cfg && cfg.rentPrice) return cfg;
  } catch (e) { console.warn('rooms_config read failed:', e.message); }
  // Fallback: defaults per building
  return DEFAULTS[building] || DEFAULTS.rooms;
}

exports.generateBillsOnMeterUpdate = functions.region('asia-southeast1')
  .firestore.document('meter_data/{docId}')
  .onWrite(async (change, context) => {
    const docId = context.params.docId;
    const meterData = change.after.exists ? change.after.data() : null;

    if (!meterData) {
      console.log(`⏭ meter_data/${docId} deleted — skip`);
      return null;
    }

    // Use fields from doc if present, else parse from id
    let building = meterData.building;
    let roomId = meterData.roomId != null ? String(meterData.roomId) : null;
    let year = meterData.year;   // BE 2-digit typical (e.g., 67)
    let month = meterData.month;

    if (!building || !roomId || year == null || month == null) {
      const parsed = parseDocId(docId);
      if (!parsed) { console.warn(`❌ cannot parse ${docId}`); return null; }
      building = parsed.building;
      roomId = parsed.roomId;
      year = parsed.beYear; // keep BE-style
      month = parsed.month;
    }

    const beYear = Number(year) < 100 ? 2500 + Number(year) : Number(year);
    const ceYear = beYear - 543;
    const mm = String(month).padStart(2, '0');

    // Pull room rates
    const roomCfg = await loadRoomConfig(building, roomId);
    const rent = Number(roomCfg.rentPrice) || 0;
    const eRate = Number(roomCfg.electricRate) || 8;
    const wRate = Number(roomCfg.waterRate) || 20;
    const trash = Number(roomCfg.trashRate) || 20;

    // Skip if rent=0 — probably empty room or misconfigured
    if (rent <= 0) {
      console.log(`⏭ ${building}/${roomId} rent=0 (vacancy or missing config) — skip bill gen`);
      return null;
    }

    const eOld = Number(meterData.eOld) || 0;
    const eNew = Number(meterData.eNew) || 0;
    const wOld = Number(meterData.wOld) || 0;
    const wNew = Number(meterData.wNew) || 0;
    const eUnits = Math.max(0, eNew - eOld);
    const wUnits = Math.max(0, wNew - wOld);
    const eCost = eUnits * eRate;
    const wCost = wUnits * wRate;
    const total = rent + eCost + wCost + trash;

    // Deterministic bill id = one per room-month (re-running meter update overwrites)
    const billId = `TGH-${beYear}${mm}-${roomId}`;

    // Due date = 5th of next month (CE, for Date compatibility)
    const dueYear = month === 12 ? ceYear + 1 : ceYear;
    const dueMonth = month === 12 ? 1 : month + 1;
    const dueDate = `${dueYear}-${String(dueMonth).padStart(2, '0')}-05`;
    const billDate = `${ceYear}-${mm}-${new Date().getDate()}`.replace(/-(\d)$/,'-0$1');

    const bill = {
      billId,
      room: roomId,
      building,  // canonical ('rooms'/'nest')
      month,
      year: beYear,
      status: 'pending',
      billDate,
      dueDate,
      totalCharge: total,
      totalAmount: total,
      charges: {
        rent,
        rentLabel: 'ค่าเช่าห้อง',
        electric: { cost: eCost, old: eOld, new: eNew, units: eUnits, rate: eRate },
        water:    { cost: wCost, old: wOld, new: wNew, units: wUnits, rate: wRate },
        trash,
        common: 0
      },
      meterReadings: {
        electric: { old: eOld, new: eNew, units: eUnits },
        water:    { old: wOld, new: wNew, units: wUnits }
      },
      note: '',
      generatedBy: 'auto_cf',
      generatedAt: new Date().toISOString(),
      meterDocId: docId,
      createdAt: new Date().toISOString()
    };

    // Only create if no bill exists yet OR the existing bill has no charges (ghost stub)
    // Never overwrite a paid bill — preserves tenant's SlipOK verification history
    const existingSnap = await rtdb.ref(`bills/${building}/${roomId}/${billId}`).once('value');
    const existing = existingSnap.val();
    if (existing && existing.status === 'paid') {
      console.log(`⏭ ${building}/${roomId}/${billId} already paid — preserve, not regenerated`);
      return null;
    }
    if (existing && existing.totalCharge > 0 && existing.generatedBy !== 'auto_cf') {
      console.log(`⏭ ${building}/${roomId}/${billId} manually generated — preserve`);
      return null;
    }

    await rtdb.ref(`bills/${building}/${roomId}/${billId}`).set(bill);
    console.log(`✅ Auto-generated: ${building}/${roomId}/${billId} total=฿${total}`);

    // Audit log (optional — RTDB audit_logs for transparency)
    try {
      const auditRef = rtdb.ref(`audit_logs/bills`).push();
      await auditRef.set({
        action: 'bill_auto_generated',
        billId, building, room: roomId,
        meterDocId: docId,
        total,
        actor: 'CF:generateBillsOnMeterUpdate',
        at: admin.database.ServerValue.TIMESTAMP
      });
    } catch (e) { /* audit best-effort */ }

    return { success: true, billId, total };
  });
