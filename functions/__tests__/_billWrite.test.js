/**
 * Unit tests for _billWrite.js — Option C canonical RTDB bill writer.
 *
 *   - buildCanonicalBill / moveInBoundaryYM / billIdFor / toBE are pure.
 *   - writeCanonicalBillIdempotent + writeBillOnIssue take a mock RTDB
 *     (admin.database() is stubbed via Module._load before require).
 *
 * Run: node --test functions/__tests__/_billWrite.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Mock RTDB (per-test state) ────────────────────────────────────────────────
let rtdbStore;          // { 'bills/rooms/15/TGH-256905-15': {...} }
let setCalls;           // [{ path, value }]
let updateCalls;        // [{ path, value }]

function resetRtdb() {
  rtdbStore = {};
  setCalls = [];
  updateCalls = [];
}
resetRtdb();

function makeRef(path) {
  return {
    once: async () => ({ val: () => (path in rtdbStore ? rtdbStore[path] : null) }),
    set: async (value) => { rtdbStore[path] = value; setCalls.push({ path, value }); },
    update: async (value) => {
      rtdbStore[path] = { ...(rtdbStore[path] || {}), ...value };
      updateCalls.push({ path, value });
    },
    child: (id) => makeRef(path + '/' + id),
  };
}

const databaseStub = { ref: (path) => makeRef(path) };

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  database: () => databaseStub,
};

const _origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-admin') return adminStub;
  return _origLoad.apply(this, arguments);
};

delete require.cache[require.resolve('../_billWrite.js')];
const {
  toBE, billIdFor, moveInBoundaryYM, isBeforeMoveIn, findBillForMonth, buildCanonicalBill,
  writeCanonicalBillIdempotent, writeBillOnIssue,
  daysInMonth, moveInDay, isMoveInMonth, proratedMoveInRent,
} = require('../_billWrite.js');

after(() => { Module._load = _origLoad; });

// A representative computeBill() output (year already 4-digit BE).
function sampleBill(over = {}) {
  return {
    building: 'rooms', room: '15', year: 2569, month: 5,
    rent: 3000, eRate: 8, wRate: 20, trash: 20,
    eOld: 100, eNew: 150, eUnits: 50, eCost: 400,
    wOld: 30, wNew: 35, wUnits: 5, wCost: 100,
    totalCharge: 3520, dueDate: '2026-06-05',
    ...over,
  };
}

describe('_billWrite — pure helpers', () => {
  it('toBE normalizes 2-digit and 4-digit BE, never CE', () => {
    assert.equal(toBE(69), 2569);
    assert.equal(toBE(2569), 2569);
    assert.equal(toBE('67'), 2567);
  });

  it('billIdFor builds the deterministic TGH-{BE}{MM}-{room} id', () => {
    assert.equal(billIdFor(2569, 5, '15'), 'TGH-256905-15');
    assert.equal(billIdFor(2569, 12, '7'), 'TGH-256912-7');  // 2-digit month padding
  });

  describe('moveInBoundaryYM', () => {
    it('returns 0 for missing/unparseable dates', () => {
      assert.equal(moveInBoundaryYM(null), 0);
      assert.equal(moveInBoundaryYM({}), 0);
      assert.equal(moveInBoundaryYM({ lease: {} }), 0);
      assert.equal(moveInBoundaryYM({ lease: { moveInDate: 'not-a-date' } }), 0);
    });
    it('reads nested lease.moveInDate as CE YYYYMM', () => {
      assert.equal(moveInBoundaryYM({ lease: { moveInDate: '2026-01-21' } }), 202601);
    });
    it('reads flat moveInDate', () => {
      assert.equal(moveInBoundaryYM({ moveInDate: '2025-12-05' }), 202512);
    });
    it('prefers moveInDate over startDate (occupancy, not contract term)', () => {
      assert.equal(
        moveInBoundaryYM({ lease: { moveInDate: '2026-01-21', startDate: '2027-01-21' } }),
        202601
      );
    });
    it('falls back to startDate when moveInDate absent', () => {
      assert.equal(moveInBoundaryYM({ lease: { startDate: '2026-03-01' } }), 202603);
    });
    it('NEVER uses contractStart (would let a future renewal date gate billing — §7-BBB)', () => {
      assert.equal(moveInBoundaryYM({ lease: { contractStart: '2027-01-21' } }), 0);
    });
  });

  describe('isBeforeMoveIn (§7-BBB gate)', () => {
    const NOW = 202606; // CE June 2026
    it('skips a bill strictly before a real PAST boundary', () => {
      assert.equal(isBeforeMoveIn(202603, 202605, NOW), true);
    });
    it('does NOT skip a bill at/after the boundary', () => {
      assert.equal(isBeforeMoveIn(202605, 202605, NOW), false);
      assert.equal(isBeforeMoveIn(202606, 202605, NOW), false);
    });
    it('does NOT skip when boundary is unknown (0)', () => {
      assert.equal(isBeforeMoveIn(202601, 0, NOW), false);
    });
    it('does NOT skip when boundary is in the FUTURE (renewal-term leak)', () => {
      assert.equal(isBeforeMoveIn(202606, 202701, NOW), false);
    });
  });

  describe('buildCanonicalBill', () => {
    it('mirrors the generateBills shape (id, BE-int year, nested charges/meterReadings)', () => {
      const b = buildCanonicalBill(sampleBill(), { invoiceNo: 'INV-rooms-2569-00001' });
      assert.equal(b.billId, 'TGH-256905-15');
      assert.equal(b.room, '15');
      assert.equal(b.building, 'rooms');
      assert.equal(b.month, 5);
      assert.equal(b.year, 2569);              // 4-digit BE int (§7-E)
      assert.equal(b.status, 'pending');       // §7-T: 'pending' is the canonical unpaid value
      assert.equal(b.totalCharge, 3520);
      assert.equal(b.totalAmount, 3520);
      assert.equal(b.dueDate, '2026-06-05');
      assert.equal(b.billDate, '2026-05-01');  // first of the bill's own month (CE), deterministic
      assert.equal(b.invoiceNo, 'INV-rooms-2569-00001');
      assert.equal(b.charges.rent, 3000);
      assert.equal(b.charges.electric.cost, 400);
      assert.equal(b.charges.electric.units, 50);
      assert.equal(b.charges.electric.rate, 8);
      assert.equal(b.charges.water.cost, 100);
      assert.equal(b.charges.trash, 20);
      assert.equal(b.charges.common, 0);
      assert.equal(b.meterReadings.electric.old, 100);
      assert.equal(b.meterReadings.electric.new, 150);
      assert.equal(b.meterReadings.water.units, 5);
      assert.equal(b.generatedBy, 'meter_upload_cf');
    });
    it('defaults invoiceNo to null and honours an explicit status', () => {
      const b = buildCanonicalBill(sampleBill(), { status: 'paid', generatedBy: 'backfill_synth' });
      assert.equal(b.invoiceNo, null);
      assert.equal(b.status, 'paid');
      assert.equal(b.generatedBy, 'backfill_synth');
    });
    it('accepts a 2-digit BE year and normalizes to 4-digit', () => {
      const b = buildCanonicalBill(sampleBill({ year: 69 }));
      assert.equal(b.year, 2569);
      assert.equal(b.billId, 'TGH-256905-15');
    });
  });
});

describe('_billWrite — writeCanonicalBillIdempotent (dedups by room+month)', () => {
  beforeEach(() => { resetRtdb(); });

  it('creates the bill when the room has none for that month', async () => {
    const billObject = buildCanonicalBill(sampleBill());
    const r = await writeCanonicalBillIdempotent(databaseStub, { building: 'rooms', roomId: '15', billObject });
    assert.equal(r.action, 'created');
    assert.equal(r.billId, 'TGH-256905-15');
    assert.equal(setCalls.length, 1);
    assert.equal(rtdbStore['bills/rooms/15/TGH-256905-15'].status, 'pending');
  });

  it('NEVER overwrites a paid bill — even one with a legacy SUFFIXED id + string year (the live ห้อง13 case)', async () => {
    // exactly the shape found in prod: TGH-256905-13-1356, year "2569" (string), status paid
    rtdbStore['bills/rooms/15'] = {
      'TGH-256905-15-1356': { status: 'paid', year: '2569', month: 5, totalCharge: 2044, paidRef: 'ABC' },
    };
    const billObject = buildCanonicalBill(sampleBill({ totalCharge: 9999 }));
    const r = await writeCanonicalBillIdempotent(databaseStub, { building: 'rooms', roomId: '15', billObject });
    assert.equal(r.action, 'preserved_paid');
    assert.equal(r.billId, 'TGH-256905-15-1356', 'returns the EXISTING suffixed id, not the deterministic one');
    assert.equal(setCalls.length, 0, 'no duplicate bill created');
    assert.equal(updateCalls.length, 0);
  });

  it('preserves a manually-generated bill (non-auto generatedBy) for that month', async () => {
    rtdbStore['bills/rooms/15'] = {
      'TGH-256905-15': { status: 'pending', month: 5, year: 2569, totalCharge: 3000, generatedBy: 'admin_manual' },
    };
    const billObject = buildCanonicalBill(sampleBill());
    const r = await writeCanonicalBillIdempotent(databaseStub, { building: 'rooms', roomId: '15', billObject });
    assert.equal(r.action, 'preserved_manual');
    assert.equal(setCalls.length, 0);
    assert.equal(updateCalls.length, 0);
  });

  it('refreshes amounts on an existing UNPAID auto bill (meter correction) without disturbing status', async () => {
    rtdbStore['bills/rooms/15'] = {
      'TGH-256905-15': {
        status: 'pending', month: 5, year: 2569, totalCharge: 3000,
        generatedBy: 'meter_upload_cf', invoiceNo: 'INV-rooms-2569-00001',
      },
    };
    const billObject = buildCanonicalBill(sampleBill({ totalCharge: 3520 }), { invoiceNo: null });
    const r = await writeCanonicalBillIdempotent(databaseStub, { building: 'rooms', roomId: '15', billObject });
    assert.equal(r.action, 'updated');
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].path, 'bills/rooms/15/TGH-256905-15');
    assert.equal(rtdbStore['bills/rooms/15/TGH-256905-15'].totalCharge, 3520, 'amount refreshed');
    assert.equal(rtdbStore['bills/rooms/15/TGH-256905-15'].status, undefined, 'status NOT in the update set (preserved)');
    assert.ok(!('invoiceNo' in updateCalls[0].value), 'null invoiceNo not written (existing one preserved)');
  });

  it('does NOT duplicate when an unpaid bill for the month sits under a suffixed id — updates THAT id', async () => {
    rtdbStore['bills/rooms/15'] = {
      'TGH-256905-15-9999': { status: 'pending', month: 5, year: '2569', totalCharge: 3000, generatedBy: 'auto_cf' },
    };
    const billObject = buildCanonicalBill(sampleBill({ totalCharge: 3520 }));
    const r = await writeCanonicalBillIdempotent(databaseStub, { building: 'rooms', roomId: '15', billObject });
    assert.equal(r.action, 'updated');
    assert.equal(r.billId, 'TGH-256905-15-9999');
    assert.equal(setCalls.length, 0, 'no new deterministic-id twin created');
    assert.equal(updateCalls[0].path, 'bills/rooms/15/TGH-256905-15-9999');
  });
});

describe('_billWrite — findBillForMonth', () => {
  it('matches by year+month across id formats and string/int year', () => {
    const room = {
      'TGH-256904-15-4725': { year: '2569', month: 4, status: 'paid' },
      'TGH-256905-15':      { year: 2569,   month: 5, status: 'pending' },
    };
    assert.equal(findBillForMonth(room, 2569, 4).id, 'TGH-256904-15-4725');
    assert.equal(findBillForMonth(room, 2569, 5).id, 'TGH-256905-15');
    assert.equal(findBillForMonth(room, 2569, 6), null);
    assert.equal(findBillForMonth(null, 2569, 4), null);
  });
});

describe('_billWrite — writeBillOnIssue (boundary + integration)', () => {
  beforeEach(() => { resetRtdb(); });

  // now = 2026-06 (BKK). A bill for 2026-05 is at/after a Jan-2026 move-in.
  const NOW_JUN_2026 = Date.UTC(2026, 5, 8, 0, 0, 0); // June 8, 2026 UTC

  it('creates a pending bill for a month at/after move-in', async () => {
    const r = await writeBillOnIssue({
      building: 'rooms', roomId: '15', bill: sampleBill(), invoiceNo: 'INV-x',
      tenantData: { lease: { moveInDate: '2026-01-21' } }, meterDocId: 'rooms_69_5_15',
      nowMs: NOW_JUN_2026,
    });
    assert.equal(r.action, 'created');
    assert.equal(rtdbStore['bills/rooms/15/TGH-256905-15'].status, 'pending');
    assert.equal(rtdbStore['bills/rooms/15/TGH-256905-15'].invoiceNo, 'INV-x');
    assert.equal(rtdbStore['bills/rooms/15/TGH-256905-15'].meterDocId, 'rooms_69_5_15');
  });

  it('SKIPS a month strictly before a real past move-in (§7-BBB)', async () => {
    // bill = 2026-03, move-in = 2026-05 (past relative to now=2026-06) → skip
    const r = await writeBillOnIssue({
      building: 'rooms', roomId: '15', bill: sampleBill({ month: 3 }),
      tenantData: { lease: { moveInDate: '2026-05-01' } }, nowMs: NOW_JUN_2026,
    });
    assert.equal(r.action, 'skipped_before_movein');
    assert.equal(setCalls.length, 0, 'no bill written before move-in');
  });

  it('does NOT skip when the move-in boundary is in the FUTURE (renewal-term leak, §7-BBB)', async () => {
    // A bogus future moveInDate (e.g. renewal contractStart leaked in) must not
    // suppress the legitimate current bill.
    const r = await writeBillOnIssue({
      building: 'rooms', roomId: '15', bill: sampleBill(),  // 2026-05
      tenantData: { lease: { moveInDate: '2027-01-21' } }, nowMs: NOW_JUN_2026,
    });
    assert.equal(r.action, 'created', 'future boundary ignored — bill still created');
  });

  it('creates the bill when move-in is unknown (no boundary)', async () => {
    const r = await writeBillOnIssue({
      building: 'rooms', roomId: '15', bill: sampleBill(), tenantData: {}, nowMs: NOW_JUN_2026,
    });
    assert.equal(r.action, 'created');
  });
});

describe('_billWrite — move-in proration helpers (pure)', () => {
  it('daysInMonth handles 30/31-day + leap Feb', () => {
    assert.equal(daysInMonth(202604), 30); // Apr
    assert.equal(daysInMonth(202605), 31); // May
    assert.equal(daysInMonth(202602), 28); // Feb 2026
    assert.equal(daysInMonth(202802), 29); // Feb 2028 (leap)
  });
  it('moveInDay reads the day from the occupancy date (nested/flat), 0 when unknown', () => {
    assert.equal(moveInDay({ lease: { moveInDate: '2026-05-15' } }), 15);
    assert.equal(moveInDay({ moveInDate: '2026-05-01' }), 1);
    assert.equal(moveInDay({ lease: { startDate: '2026-05-09' } }), 9);
    assert.equal(moveInDay({}), 0);
    assert.equal(moveInDay({ lease: { contractStart: '2026-05-09' } }), 0); // §7-BBB: never contractStart
  });
  it('isMoveInMonth true only for the occupancy month', () => {
    const td = { lease: { moveInDate: '2026-05-15' } };
    assert.equal(isMoveInMonth(td, 202605), true);
    assert.equal(isMoveInMonth(td, 202606), false);
    assert.equal(isMoveInMonth({}, 202605), false);
  });
  describe('proratedMoveInRent (rent/30 × daysOccupied, ≤5 grace, cap = 1 month)', () => {
    it('day 15 of a 31-day month → rent/30 × 17', () => {
      assert.equal(proratedMoveInRent(3000, 15, 202605), 1700); // 31−15+1=17 → round(100×17)
    });
    it('day 1 of a 30-day month → exactly full rent', () => {
      assert.equal(proratedMoveInRent(3000, 1, 202604), 3000); // 30 days → round(100×30)
    });
    it('day 1 of a 31-day month → CAPPED at full rent (not 3100)', () => {
      assert.equal(proratedMoveInRent(3000, 1, 202605), 3000); // raw 3100 → min(3000,3100)
    });
    it('day 26 of a 31-day month → 6 days billed', () => {
      assert.equal(proratedMoveInRent(3000, 26, 202605), 600); // 31−26+1=6
    });
    it('day 27 of a 31-day month → grace (5 days ≤ 5 = free)', () => {
      assert.equal(proratedMoveInRent(3000, 27, 202605), 0);
    });
    it('last day → grace (1 day = free)', () => {
      assert.equal(proratedMoveInRent(3000, 31, 202605), 0);
    });
    it('unknown day (0) or zero rent → no proration', () => {
      assert.equal(proratedMoveInRent(3000, 0, 202605), 3000);
      assert.equal(proratedMoveInRent(0, 15, 202605), 0);
    });
  });
});

describe('_billWrite — buildCanonicalBill move-in proration', () => {
  it('prorates RENT for the move-in month + adjusts total; utilities untouched', () => {
    const b = buildCanonicalBill(sampleBill(), { tenantData: { lease: { moveInDate: '2026-05-15' } } });
    assert.equal(b.charges.rent, 1700);
    assert.equal(b.totalCharge, 2220);          // 3520 − (3000−1700)
    assert.equal(b.totalAmount, 2220);
    assert.equal(b.charges.electric.cost, 400); // untouched
    assert.equal(b.charges.water.cost, 100);    // untouched
    assert.equal(b.charges.trash, 20);          // untouched
    assert.deepEqual(b.rentProration, { moveInDay: 15, daysOccupied: 17, graced: false, capped: false, fullRent: 3000, proratedRent: 1700 });
  });
  it('grace: a ≤5-day move-in month bills 0 rent (meter charges only)', () => {
    const b = buildCanonicalBill(sampleBill(), { tenantData: { lease: { moveInDate: '2026-05-27' } } });
    assert.equal(b.charges.rent, 0);
    assert.equal(b.totalCharge, 520);           // 3520 − 3000
    assert.equal(b.rentProration.graced, true);
    assert.equal(b.rentProration.daysOccupied, 5);
  });
  it('day-1 of a 31-day month → full rent, capped flag set', () => {
    const b = buildCanonicalBill(sampleBill(), { tenantData: { lease: { moveInDate: '2026-05-01' } } });
    assert.equal(b.charges.rent, 3000);
    assert.equal(b.totalCharge, 3520);
    assert.equal(b.rentProration.capped, true);
    assert.equal(b.rentProration.graced, false);
  });
  it('a NON-move-in month bills full rent with NO rentProration field', () => {
    const b = buildCanonicalBill(sampleBill(), { tenantData: { lease: { moveInDate: '2026-01-21' } } }); // bill is month 5
    assert.equal(b.charges.rent, 3000);
    assert.equal(b.totalCharge, 3520);
    assert.equal(b.rentProration, undefined);
  });
  it('NO tenantData → unchanged (backfill / legacy callers)', () => {
    const b = buildCanonicalBill(sampleBill());
    assert.equal(b.charges.rent, 3000);
    assert.equal(b.totalCharge, 3520);
    assert.equal(b.rentProration, undefined);
  });
  it('§7-BBB: a future contractStart never triggers proration', () => {
    const b = buildCanonicalBill(sampleBill(), { tenantData: { lease: { contractStart: '2026-05-01' } } });
    assert.equal(b.charges.rent, 3000);         // contractStart ignored → not a move-in month
    assert.equal(b.rentProration, undefined);
  });
});

describe('_billWrite — writeBillOnIssue prorates the move-in month', () => {
  beforeEach(() => { resetRtdb(); });
  const NOW_JUN_2026 = Date.UTC(2026, 5, 8);
  it('writes a prorated rent for the move-in-month bill', async () => {
    const r = await writeBillOnIssue({
      building: 'rooms', roomId: '15', bill: sampleBill(),                 // month 5 / 2026-05
      tenantData: { lease: { moveInDate: '2026-05-10' } }, nowMs: NOW_JUN_2026,
    });
    assert.equal(r.action, 'created');
    const stored = rtdbStore['bills/rooms/15/TGH-256905-15'];
    assert.equal(stored.charges.rent, 2200);    // 31−10+1=22 → round(100×22)
    assert.equal(stored.totalCharge, 2720);     // 3520 − 800
    assert.equal(stored.rentProration.daysOccupied, 22);
  });
});
