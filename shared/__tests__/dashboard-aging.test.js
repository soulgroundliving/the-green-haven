/**
 * Unit tests for shared/dashboard-aging.js — the pure aging core.
 *
 * Covers the three exported pure pieces (no DOM / no "now"):
 *   - computeAging({bills, asOf})  — bucketing, per-tenant grouping, totals, carry-forward
 *   - _agingDueMs(dueDate, month, beYear) — ISO parse + 5th-of-next-month derivation
 *   - _agingIsArrears(bill) — pinned to aggregateMonthlyRevenue's pending definition
 *
 * Strategy (mirror dashboard-reconcile.test.js): load the IIFE in a vm sandbox — it
 * only sets window.X at load (DOM/Date access lives inside init/render, never called).
 *
 * Run: node --test shared/__tests__/dashboard-aging.test.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function load() {
  const window = {};
  const context = {
    window, document: { getElementById: () => null },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    JSON, Math, Number, String, Boolean, Object, Array, Map, Set, Date,
    setTimeout: () => 0, clearTimeout: () => {}, Promise, isNaN,
  };
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'dashboard-aging.js');
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: 'dashboard-aging.js' });
  return context.window;
}

const W = load();
const computeAging = W.computeAging;
const dueMs = W._agingDueMs;
const isArrears = W._agingIsArrears;

// A fixed "today" so day math is deterministic: 2026-06-04 local midnight.
const ASOF = new Date(2026, 5, 4).getTime();
const DAY = 86400000;
// Build an outstanding bill whose dueMs is `days` before ASOF (so daysOverdue == days).
const overdueBy = (days, o) => Object.assign(
  { id: 'B', building: 'rooms', room: '15', month: 1, beYear: 2569, total: 1000, dueMs: ASOF - days * DAY, name: 'สมชาย' }, o);

describe('_agingDueMs — anchor derivation', () => {
  test('prefers the persisted ISO dueDate (date-only string)', () => {
    assert.equal(dueMs('2026-05-05', 4, 2569), new Date(2026, 4, 5).getTime());
  });
  test('derives 5th of the NEXT month when dueDate is missing', () => {
    // April bill (month=4), BE 2569 (CE 2026) → due 2026-05-05
    assert.equal(dueMs(null, 4, 2569), new Date(2026, 4, 5).getTime());
  });
  test('December bill rolls over to 5th of next January', () => {
    // month=12, BE 2569 (CE 2026) → due 2027-01-05
    assert.equal(dueMs('', 12, 2569), new Date(2027, 0, 5).getTime());
  });
  test('returns NaN when neither dueDate nor month/year is usable', () => {
    assert.ok(Number.isNaN(dueMs(null, 0, 0)));
  });
});

describe('_agingIsArrears — pinned to pendingRevenue definition', () => {
  test('pending / unpaid / blank status with a positive total are arrears', () => {
    assert.equal(isArrears({ status: 'pending', total: 500 }), true);
    assert.equal(isArrears({ status: 'unpaid', total: 500 }), true);
    assert.equal(isArrears({ status: '', total: 500 }), true);
  });
  test('paid / refunded / void are NOT arrears', () => {
    assert.equal(isArrears({ status: 'paid', total: 500 }), false);
    assert.equal(isArrears({ status: 'refunded', total: 500 }), false);
    assert.equal(isArrears({ status: 'void', total: 500 }), false);
  });
  test('zero-total ghost stub with no charges is skipped', () => {
    assert.equal(isArrears({ status: 'pending', total: 0 }), false);
    assert.equal(isArrears({ status: 'pending', total: 0, hasCharges: true }), true);
  });
});

describe('computeAging — exported + bucketing', () => {
  test('window.computeAging is a function (export guard)', () => {
    assert.equal(typeof computeAging, 'function');
  });

  test('a not-yet-due bill lands in current, never counts as overdue', () => {
    const r = computeAging({ bills: [overdueBy(-10)], asOf: ASOF }); // due 10 days in the future
    assert.equal(r.summary.current, 1000);
    assert.equal(r.summary.overdueAmount, 0);
    assert.equal(r.summary.overdueBills, 0);
  });

  test('bucket boundaries: 30→1-30, 31→31-60, 60→31-60, 61→61-90, 91→90+', () => {
    const at = (d) => computeAging({ bills: [overdueBy(d)], asOf: ASOF }).summary;
    assert.equal(at(30).d1_30, 1000);
    assert.equal(at(31).d31_60, 1000);
    assert.equal(at(60).d31_60, 1000);
    assert.equal(at(61).d61_90, 1000);
    assert.equal(at(90).d61_90, 1000);
    assert.equal(at(91).d90, 1000);
  });

  test('exactly due today (0 days) is current, not overdue', () => {
    const s = computeAging({ bills: [overdueBy(0)], asOf: ASOF }).summary;
    assert.equal(s.current, 1000);
    assert.equal(s.overdueBills, 0);
  });

  test('groups multiple bills of one room into a single tenant row + sums buckets', () => {
    const r = computeAging({ bills: [
      overdueBy(10, { id: 'B1', total: 1000 }),  // 1-30
      overdueBy(100, { id: 'B2', total: 2000 }), // 90+
    ], asOf: ASOF });
    assert.equal(r.tenants.length, 1);
    const t = r.tenants[0];
    assert.equal(t.d1_30, 1000);
    assert.equal(t.d90, 2000);
    assert.equal(t.total, 3000);
    assert.equal(t.billCount, 2);
    assert.equal(t.oldestDays, 100);
    assert.equal(t.name, 'สมชาย');
  });

  test('carry-forward: bills from different BE years aggregate by room as-of-today', () => {
    const r = computeAging({ bills: [
      overdueBy(40, { beYear: 2569, month: 4, total: 1000 }),
      overdueBy(400, { beYear: 2568, month: 4, total: 1500 }), // last-year arrears still owed
    ], asOf: ASOF });
    assert.equal(r.tenants.length, 1);
    assert.equal(r.tenants[0].total, 2500);
    assert.equal(r.tenants[0].d90, 1500); // 400 days → 90+
  });

  test('sorts tenants by outstanding total descending (biggest debtor first)', () => {
    const r = computeAging({ bills: [
      overdueBy(10, { room: '15', total: 500 }),
      overdueBy(10, { room: '20', total: 3000 }),
      overdueBy(10, { room: '12', total: 1200 }),
    ], asOf: ASOF });
    assert.deepEqual(r.tenants.map((t) => t.room), ['20', '12', '15']);
  });

  test('grand-total summary: column sums + tenant/bill counts + overdue split', () => {
    const r = computeAging({ bills: [
      overdueBy(-5, { room: '15', total: 1000 }), // current
      overdueBy(45, { room: '20', total: 2000 }), // 31-60
      overdueBy(120, { room: '12', total: 4000 }),// 90+
    ], asOf: ASOF });
    const s = r.summary;
    assert.equal(s.totalOutstanding, 7000);
    assert.equal(s.tenantsInArrears, 3);
    assert.equal(s.billCount, 3);
    assert.equal(s.overdueBills, 2);
    assert.equal(s.current, 1000);
    assert.equal(s.d31_60, 2000);
    assert.equal(s.d90, 4000);
    assert.equal(s.overdueAmount, 6000); // total - current
  });

  test('a bill with no usable due date (dueMs NaN) is treated as current, not overdue', () => {
    const r = computeAging({ bills: [overdueBy(0, { dueMs: NaN, total: 800 })], asOf: ASOF });
    assert.equal(r.summary.current, 800);
    assert.equal(r.summary.overdueBills, 0);
  });

  test('zero/negative total bills are excluded from the aging math', () => {
    const r = computeAging({ bills: [overdueBy(50, { total: 0 }), overdueBy(50, { id: 'B2', total: 900 })], asOf: ASOF });
    assert.equal(r.summary.billCount, 1);
    assert.equal(r.summary.totalOutstanding, 900);
  });

  test('empty inputs → all-zero summary, no throw', () => {
    const r = computeAging({});
    assert.equal(r.tenants.length, 0);
    assert.equal(r.summary.totalOutstanding, 0);
    assert.equal(r.summary.tenantsInArrears, 0);
  });
});

describe('outstandingBillsForRoom — final/unpaid bills for the deposit settlement', () => {
  function withBillStore(cache) {
    W.BillStore = { subscribe() {}, _bld: (b) => b, _cache: cache };
    return W.outstandingBillsForRoom;
  }

  test('returns each unpaid bill with its real RTDB path key + total; skips paid/refunded/void', () => {
    const fn = withBillStore({
      rooms: { '15': {
        'TGH-A': { status: 'pending',  totalCharge: 2300, month: 5, year: 2569, roomId: '15', building: 'rooms', charges: {} },
        'TGH-B': { status: 'paid',     totalCharge: 1500, month: 4, year: 2569, roomId: '15', charges: {} },
        'TGH-C': { status: 'refunded', totalCharge: 999,  month: 3, year: 2569, roomId: '15', charges: {} },
        'TGH-D': { status: 'void',     totalCharge: 777,  month: 2, year: 2569, roomId: '15', charges: {} },
      } },
    });
    const res = fn('rooms', '15');
    assert.equal(res.total, 2300);
    assert.equal(res.bills.length, 1);
    assert.equal(res.bills[0].key, 'TGH-A');
    assert.equal(res.bills[0].path, 'bills/rooms/15/TGH-A');
    assert.equal(res.bills[0].total, 2300);
  });

  test('sums multiple unpaid bills (carry-forward arrears)', () => {
    const fn = withBillStore({ rooms: { '15': {
      M1: { status: 'pending', totalCharge: 2300, month: 5, year: 2569, roomId: '15', charges: {} },
      M2: { status: 'overdue', totalCharge: 2100, month: 4, year: 2569, roomId: '15', charges: {} },
    } } });
    const res = fn('rooms', '15');
    assert.equal(res.total, 4400);
    assert.equal(res.bills.length, 2);
  });

  test('no BillStore / empty room → { bills: [], total: 0 } (Nest no-op)', () => {
    // NB: assert primitives, not deepEqual — sandbox-realm objects have a different
    // Object.prototype than the test realm, so deepStrictEqual would false-fail.
    W.BillStore = undefined;
    const noStore = W.outstandingBillsForRoom('nest', 'N101');
    assert.equal(noStore.total, 0);
    assert.equal(noStore.bills.length, 0);
    const fn = withBillStore({ rooms: {} });
    const emptyRoom = fn('rooms', '99');
    assert.equal(emptyRoom.total, 0);
    assert.equal(emptyRoom.bills.length, 0);
  });
});
