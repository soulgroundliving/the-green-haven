/**
 * _billWrite.js — canonical RTDB bill writer (Option C, 2026-06-08).
 *
 * THE CONNECTION POINT between admin + tenant. Before this, on a meter upload
 * `notifyTenantOnMeterUpload` wrote meter_data + an INV- invoice number + a LINE
 * message, but NO RTDB bill (the legacy `generateBillsOnMeterUpdate` Firestore
 * trigger is frozen — Eventarc can't watch the SE3 Firestore region, §7-NN). So
 * the "bill" existed in three fragmented forms that never converged:
 *   - admin dashboard reads RTDB `bills/` only  → never saw the month
 *   - tenant app synthesizes from meter_data     → saw a `SYNTH-…` pending bill
 *   - payment lives in `verifiedSlips`           → a third, separate record
 *
 * Option C creates the ONE canonical bill at issuance (admin "อนุมัติ meter
 * import" = ออกบิล). Both sides then read + update the SAME `bills/{b}/{r}/{billId}`
 * doc, and the client synth twin auto-dedups by year+month
 * (BillStore.dedupSynthetic, shared/billing-system.js).
 *
 * Shape mirrors the frozen `generateBillsOnMeterUpdate.js` EXACTLY (deterministic
 * id `TGH-{BE}{MM}-{room}`, nested charges/meterReadings, `status:'pending'`,
 * `year` as 4-digit BE int) so every existing reader — admin grid,
 * markBillPaidInRTDB's `matched>0` flip (verifySlip.js), aging, the synth dedup —
 * keeps working unchanged.
 *
 * Used by:
 *   notifyTenantOnMeterUpload  — Option C live path (one bill at meter-approve)
 *   tools/backfill-synth-bills — one-shot reconcile of synth-only legacy months
 */

const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

// generatedBy markers we are allowed to overwrite (auto-created bills). A bill an
// admin hand-crafted (any other marker) is preserved — mirrors generateBills'
// `existing.generatedBy !== 'auto_cf'` guard.
const AUTO_GENERATED_MARKERS = new Set(['auto_cf', 'meter_upload_cf', 'backfill_synth']);

const BKK_OFFSET_MS = 7 * 3600 * 1000;

/**
 * Normalize a year to 4-digit BE (2569). Accepts 2-digit BE (69), 4-digit BE
 * (2569) — never CE here (computeBill already hands us BE).
 */
function toBE(year) {
  const y = Number(year) || 0;
  return y < 100 ? 2500 + y : y;
}

/**
 * Deterministic bill id — one per room-month, matches generateBillsOnMeterUpdate
 * so a re-issue merges and never duplicates.
 */
function billIdFor(beYear, month, roomId) {
  const mm = String(Number(month)).padStart(2, '0');
  return `TGH-${beYear}${mm}-${String(roomId)}`;
}

/**
 * CE YYYYMM the tenant's occupancy starts, or 0 when unknown/unparseable.
 *
 * Field precedence mirrors BillStore.tenantBoundaryYM (shared/billing-system.js):
 * moveInDate (occupancy) → startDate. NEVER contractStart — that can legitimately
 * be a FUTURE renewal-term date (§7-BBB) and must not gate occupancy billing.
 * Reads the `tenants/{b}/list/{r}` doc shape (flat OR nested `.lease`).
 */
function moveInBoundaryYM(tenantData) {
  if (!tenantData) return 0;
  const lease = tenantData.lease || {};
  const start = lease.moveInDate || tenantData.moveInDate || lease.startDate || tenantData.startDate;
  if (!start) return 0;
  const d = new Date(start);
  if (isNaN(d.getTime())) return 0;
  // Month granularity → UTC components are TZ-stable for a date-only string.
  return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1);
}

/**
 * §7-BBB move-in gate (pure). Skip creating a bill for `billCeYM` ONLY when there
 * is a real PAST move-in boundary and the bill predates it. A FUTURE boundary
 * (renewal-term `contractStart` leaking into moveInDate/startDate) is ignored —
 * it must never suppress a legitimate current bill. All args are CE YYYYMM ints.
 */
function isBeforeMoveIn(billCeYM, boundaryYM, nowCeYM) {
  return boundaryYM > 0 && boundaryYM <= nowCeYM && billCeYM < boundaryYM;
}

// ── Move-in-month rent proration (owner FINAL spec 2026-06-13) ───────────────
// The move-in month bills rent at a daily rate (monthlyRent/30 × days occupied),
// with a ≤5-day grace (free) and a hard cap of one full month. Every later month
// bills full rent. RENT ONLY — utilities/water/electric/trash always bill actual.

/** Days in a CE YYYYMM month (handles leap Feb). ceYM = year*100 + month. */
function daysInMonth(ceYM) {
  const y = Math.floor(Number(ceYM) / 100);
  const m = Number(ceYM) % 100;
  if (y <= 0 || m < 1 || m > 12) return 30;             // defensive default
  return new Date(Date.UTC(y, m, 0)).getUTCDate();      // day 0 of next month = last day of this
}

/**
 * Day-of-month (1–31) the tenant's occupancy starts, or 0 when unknown. Same field
 * precedence as moveInBoundaryYM (moveInDate → startDate, NEVER contractStart §7-BBB).
 */
function moveInDay(tenantData) {
  if (!tenantData) return 0;
  const lease = tenantData.lease || {};
  const start = lease.moveInDate || tenantData.moveInDate || lease.startDate || tenantData.startDate;
  if (!start) return 0;
  const d = new Date(start);
  if (isNaN(d.getTime())) return 0;
  return d.getUTCDate();
}

/**
 * True when `billCeYM` (CE YYYYMM int) IS the tenant's move-in month — the only
 * month rent is prorated. Uses the occupancy boundary; a future renewal date never
 * counts (moveInBoundaryYM already excludes contractStart, §7-BBB).
 */
function isMoveInMonth(tenantData, billCeYM) {
  const b = moveInBoundaryYM(tenantData);
  return b > 0 && b === Number(billCeYM);
}

/**
 * Move-in-month rent (pure). daysOccupied = daysInMonth − moveInDay + 1;
 *   daysOccupied ≤ 5  → 0 (grace)
 *   else              → min(monthlyRent, round(monthlyRent/30 × daysOccupied))
 * The cap stops a day-1 move-in into a 31-day month from billing >100% of a month.
 * Unknown day (0) or non-positive rent → full rent unchanged (no proration).
 */
function proratedMoveInRent(monthlyRent, day, billCeYM) {
  const rent = Number(monthlyRent) || 0;
  const d = Number(day) || 0;
  if (rent <= 0 || d < 1) return rent;
  const daysOccupied = daysInMonth(billCeYM) - d + 1;
  if (daysOccupied <= 5) return 0;                            // ≤5-day grace → free
  return Math.min(rent, Math.round((rent / 30) * daysOccupied)); // cap at one full month
}

/**
 * Build the canonical RTDB bill object from a computeBill() result.
 * Pure — no I/O. `bill` is the `_billFlex.computeBill` output (year = 4-digit BE).
 *
 * `tenantData` (optional): when supplied AND the bill is FOR the tenant's move-in
 * month, the RENT line is daily-prorated (owner FINAL spec 2026-06-13) — utilities,
 * water, electric + trash always bill actual. Omit it (or for any later month) and the
 * bill is byte-identical to the pre-proration behaviour (full rent). The live path
 * (writeBillOnIssue ← notifyTenantOnMeterUpload) passes it; the backfill tool does not.
 */
function buildCanonicalBill(bill, { invoiceNo = null, status = 'pending', source = 'cf:notifyTenantOnMeterUpload', generatedBy = 'meter_upload_cf', meterDocId = null, tenantData = null } = {}) {
  const beYear = toBE(bill.year);
  const ceYear = beYear - 543;
  const month = Number(bill.month);
  const mm = String(month).padStart(2, '0');
  const nowIso = new Date().toISOString();
  const billCeYM = ceYear * 100 + month;

  // ── Move-in-month rent proration (RENT only) ───────────────────────────────
  const fullRent = Number(bill.rent) || 0;
  let rentValue = fullRent;
  let rentProration = null;
  if (tenantData && isMoveInMonth(tenantData, billCeYM)) {
    const day = moveInDay(tenantData);
    const daysOccupied = daysInMonth(billCeYM) - day + 1;
    rentValue = proratedMoveInRent(fullRent, day, billCeYM);
    rentProration = {
      moveInDay: day,
      daysOccupied,
      graced: daysOccupied <= 5,                                                  // ≤5 days → free
      capped: daysOccupied > 5 && Math.round((fullRent / 30) * daysOccupied) > fullRent, // day-1 of a 31-day month etc.
      fullRent,
      proratedRent: rentValue,
    };
  }
  // Proration only lowers (or holds) rent → adjust the bill total by the delta so the
  // metered charges are never disturbed. computeBill's totalCharge included full rent.
  const totalCharge = (Number(bill.totalCharge) || 0) + (rentValue - fullRent);

  const obj = {
    billId: billIdFor(beYear, month, bill.room),
    room: String(bill.room),
    building: bill.building,
    month,
    year: beYear,                              // 4-digit BE int — matches generateBills (§7-E)
    status,
    billDate: `${ceYear}-${mm}-01`,            // first of the bill's own month (CE), deterministic
    dueDate: bill.dueDate || null,
    totalCharge,
    totalAmount: totalCharge,
    charges: {
      rent: rentValue,
      rentLabel: 'ค่าเช่าห้อง',
      electric: {
        cost: Number(bill.eCost) || 0, old: Number(bill.eOld) || 0,
        new: Number(bill.eNew) || 0, units: Number(bill.eUnits) || 0,
        rate: Number(bill.eRate) || 8,
      },
      water: {
        cost: Number(bill.wCost) || 0, old: Number(bill.wOld) || 0,
        new: Number(bill.wNew) || 0, units: Number(bill.wUnits) || 0,
        rate: Number(bill.wRate) || 20,
      },
      trash: Number(bill.trash) || 0,
      common: 0,
    },
    meterReadings: {
      electric: { old: Number(bill.eOld) || 0, new: Number(bill.eNew) || 0, units: Number(bill.eUnits) || 0 },
      water:    { old: Number(bill.wOld) || 0, new: Number(bill.wNew) || 0, units: Number(bill.wUnits) || 0 },
    },
    invoiceNo: invoiceNo || null,
    note: '',
    generatedBy,
    generatedAt: nowIso,
    meterDocId: meterDocId || null,
    createdAt: nowIso,
    source,
  };
  if (rentProration) obj.rentProration = rentProration; // self-describing audit of the move-in-month rent
  return obj;
}

/**
 * Find an existing bill for the given BE-year + month under ANY id in the room's
 * bills map. Matches by year+month, NOT exact id — legacy admin-generated bills
 * carry a non-deterministic id (`TGH-{BE}{MM}-{room}-{suffix}`, e.g.
 * `TGH-256904-13-4725`) AND a string `year` ("2569"), so an exact-id lookup would
 * miss them and create a DUPLICATE bill for a month that already has one (a §7-D/E
 * id/format-drift trap). Returns { id, bill } or null.
 */
function findBillForMonth(billsForRoom, beYear, month) {
  if (!billsForRoom) return null;
  const m = Number(month);
  for (const id of Object.keys(billsForRoom)) {
    const b = billsForRoom[id];
    if (!b) continue;
    if (toBE(b.year) === beYear && Number(b.month) === m) return { id, bill: b };
  }
  return null;
}

/**
 * Idempotently write `billObject` to bills/{building}/{room}/{billId}.
 *
 * Dedups by room+MONTH (any existing id format), not by exact id, so a month that
 * already has a bill — even one with a legacy suffixed id / string year — is never
 * duplicated.
 *
 * Contract (money-path, §7-I safe):
 *   - PAID bill exists for month → preserve, never touch (tenant's slip history).
 *   - manual bill exists (>0,    → preserve (admin hand-crafted it).
 *     non-auto generatedBy)
 *   - no bill for month          → create (deterministic id).
 *   - unpaid auto bill exists     → refresh meter-derived amounts on the EXISTING
 *                                  id (correction) WITHOUT disturbing status /
 *                                  payment fields / a non-null invoiceNo.
 *
 * @returns {Promise<{action: string, billId: string}>}
 */
async function writeCanonicalBillIdempotent(rtdb, { building, roomId, billObject }) {
  const roomRef = rtdb.ref(`bills/${building}/${roomId}`);
  const allBills = (await roomRef.once('value')).val() || {};
  const match = findBillForMonth(allBills, billObject.year, billObject.month);

  if (match) {
    const existing = match.bill;
    if (String(existing.status).toLowerCase() === 'paid') {
      return { action: 'preserved_paid', billId: match.id };
    }
    if (Number(existing.totalCharge) > 0 &&
        existing.generatedBy && !AUTO_GENERATED_MARKERS.has(existing.generatedBy)) {
      return { action: 'preserved_manual', billId: match.id };
    }
    // exists + unpaid + auto → refresh amounts only, on the EXISTING id (no twin).
    const update = {
      totalCharge: billObject.totalCharge,
      totalAmount: billObject.totalAmount,
      charges: billObject.charges,
      meterReadings: billObject.meterReadings,
      dueDate: billObject.dueDate,
      updatedAt: new Date().toISOString(),
    };
    if (billObject.invoiceNo) update.invoiceNo = billObject.invoiceNo;  // don't clobber a real number with null
    if (billObject.rentProration) update.rentProration = billObject.rentProration; // keep move-in-month metadata in sync on a meter correction
    await roomRef.child(match.id).update(update);
    return { action: 'updated', billId: match.id };
  }

  await roomRef.child(billObject.billId).set(billObject);
  return { action: 'created', billId: billObject.billId };
}

/**
 * Option C entry point: create/refresh the canonical bill at issuance.
 *
 * §7-BBB move-in boundary: skip ONLY when there is a real PAST boundary and the
 * bill predates it. A FUTURE boundary (renewal-term `contractStart` leaking into
 * moveInDate/startDate) must NEVER suppress a legitimate current bill — so it is
 * ignored, mirroring the client's defensive future-boundary guard.
 *
 * @returns {Promise<{action: string, billId: string}>}
 */
async function writeBillOnIssue({ building, roomId, bill, invoiceNo = null, tenantData = null, meterDocId = null, status = 'pending', nowMs = Date.now() }) {
  const beYear = toBE(bill.year);
  const ceYear = beYear - 543;
  const month = Number(bill.month);
  const billYM = ceYear * 100 + month;

  const boundaryYM = moveInBoundaryYM(tenantData);
  const nb = new Date(nowMs + BKK_OFFSET_MS);
  const nowCeYM = nb.getUTCFullYear() * 100 + (nb.getUTCMonth() + 1);
  if (isBeforeMoveIn(billYM, boundaryYM, nowCeYM)) {
    return { action: 'skipped_before_movein', billId: billIdFor(beYear, month, bill.room) };
  }

  const billObject = buildCanonicalBill(bill, { invoiceNo, status, meterDocId, tenantData });
  return writeCanonicalBillIdempotent(admin.database(), { building, roomId, billObject });
}

module.exports = {
  toBE,
  billIdFor,
  moveInBoundaryYM,
  isBeforeMoveIn,
  daysInMonth,
  moveInDay,
  isMoveInMonth,
  proratedMoveInRent,
  findBillForMonth,
  buildCanonicalBill,
  writeCanonicalBillIdempotent,
  writeBillOnIssue,
  AUTO_GENERATED_MARKERS,
  BKK_OFFSET_MS,
};
