/**
 * Unit tests for aggregateMonthlyRevenue.js
 *
 * Covers:
 *   - normalizeBeYear (via full pipeline)
 *   - aggregateYear core math (paid, pending, orphan stub, wrong-year, invalid month,
 *     byBuilding breakdown, tax estimate)
 *   - writeSummary (Firestore set path, payload shape, return value)
 *   - aggregateMonthlyRevenueScheduled (handler captured, happy path, January double-year)
 *   - aggregateMonthlyRevenue HTTP (OPTIONS, method guard, requireAdmin, body.year,
 *     body.years, no-body default, error path)
 *
 * Run: node --test functions/__tests__/aggregateMonthlyRevenue.test.js
 */
'use strict';

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ─────────────────────────────────────────────────────────────────

/**
 * RTDB tree shape:
 *   { [building]: { [roomId]: { [billId]: billObj } } }
 * e.g. { rooms: { '15': { b1: { year: 2569, month: 5, ... } } } }
 */
let rtdbState = {};

/** Recorded Firestore .set() calls: [{ path, data }] */
let fsSetCalls = [];

/** Buildings returned by getAllBuildings() */
let buildingsList = ['rooms', 'nest'];

/**
 * requireAdmin stub: null = not authed (returns null, writes res),
 * else returns the decoded-token object.
 */
let requireAdminStub = null;

function resetStubs() {
  rtdbState = {};
  fsSetCalls = [];
  buildingsList = ['rooms', 'nest'];
  requireAdminStub = null;
}
resetStubs();

// ── RTDB stub ──────────────────────────────────────────────────────────────────

const rtdbInstance = {
  ref: (path) => ({
    once: async () => {
      // path like 'bills/rooms' → ['bills', 'rooms']
      const parts = path.split('/');
      let node = rtdbState;
      for (const p of parts) node = (node || {})[p];
      return { val: () => node ?? null };
    },
  }),
};

// ── Firestore stub ─────────────────────────────────────────────────────────────

const fsInstance = {
  collection: (name) => ({
    doc: (id) => ({
      set: async (data) => {
        fsSetCalls.push({ path: `${name}/${id}`, data });
      },
    }),
  }),
};

// ── admin stub ─────────────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  database: () => rtdbInstance,
  firestore: Object.assign(
    () => fsInstance,
    {
      FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
      Timestamp: { fromMillis: (ms) => new Date(ms) },
    }
  ),
};

// ── firebase-functions/v1 stub ─────────────────────────────────────────────────
// Both exports live under .region() but different chains:
//   scheduled: region → pubsub → schedule → timeZone → onRun
//   http:      region → https → onRequest

let scheduledHandler = null;
let httpHandler = null;

function makeFunctionsStub() {
  class HttpsError extends Error {
    constructor(code, msg) { super(msg); this.code = code; }
  }

  const onRun = (h) => { scheduledHandler = h; return h; };
  const onRequest = (h) => { httpHandler = h; return h; };

  const regionObj = {
    pubsub: {
      schedule: () => ({
        timeZone: () => ({ onRun }),
      }),
    },
    https: { onRequest, HttpsError },
  };

  return {
    region: () => regionObj,
    https: { onRequest, HttpsError },
  };
}

// ── Module._load intercept ─────────────────────────────────────────────────────

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') return makeFunctionsStub();
  if (request === './buildingRegistry' || request.endsWith('/buildingRegistry')) {
    return { getAllBuildings: async () => buildingsList };
  }
  if (request === './_auth' || request.endsWith('/_auth')) {
    return {
      requireAdmin: async (req, res) => {
        if (requireAdminStub === null) {
          res.status(403).json({ error: 'not authed' });
          return null;
        }
        return requireAdminStub;
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

// ── Load CF after stubs are installed ─────────────────────────────────────────

let cf;
before(() => {
  delete require.cache[require.resolve('../aggregateMonthlyRevenue.js')];
  cf = require('../aggregateMonthlyRevenue.js');
});

after(() => {
  Module._load = originalLoad;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seed a bill into rtdbState under the path bills/<building>/<roomId>/<billId>. */
function seedBill(bill, building = 'rooms', roomId = '15', billId = 'b1') {
  if (!rtdbState.bills) rtdbState.bills = {};
  if (!rtdbState.bills[building]) rtdbState.bills[building] = {};
  if (!rtdbState.bills[building][roomId]) rtdbState.bills[building][roomId] = {};
  rtdbState.bills[building][roomId][billId] = bill;
}

/** Build a minimal valid bill for a given yearBE and month. */
function makeBill(yearBE, month, extra = {}) {
  return {
    year: yearBE,
    month,
    status: 'paid',
    totalCharge: 1000,
    charges: {
      rent: 800,
      electric: { cost: 100 },
      water: { cost: 50 },
      trash: 50,
    },
    ...extra,
  };
}

/** Create a minimal Express-like req/res pair. */
function makeReq(overrides = {}) {
  return {
    method: 'POST',
    body: {},
    ...overrides,
  };
}

function makeRes() {
  const r = { _status: null, _body: null };
  r.set = () => r;
  r.status = (code) => {
    r._status = code;
    return {
      json: (b) => { r._body = b; return r; },
      send: (b) => { r._body = b; return r; },
    };
  };
  return r;
}

// ── Sanity check ──────────────────────────────────────────────────────────────

// Tests rely on the handlers being captured at require-time.
// The before() above runs before any test, so we assert inside the first suite.

// ─────────────────────────────────────────────────────────────────────────────
// Test suites
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateMonthlyRevenue', () => {

  beforeEach(() => resetStubs());

  // ── Handler capture sanity ──────────────────────────────────────────────────

  describe('handler capture', () => {
    it('scheduledHandler is captured as a function', () => {
      assert.equal(typeof scheduledHandler, 'function',
        'pubsub onRun handler must be captured at require-time');
    });

    it('httpHandler is captured as a function', () => {
      assert.equal(typeof httpHandler, 'function',
        'https onRequest handler must be captured at require-time');
    });
  });

  // ── normalizeBeYear (via full pipeline) ────────────────────────────────────

  describe('normalizeBeYear — via pipeline', () => {
    it('2-digit year 69 is treated as BE 2569', async () => {
      buildingsList = ['rooms'];
      // Seed a bill with 2-digit year 69 for month 3
      seedBill({ year: 69, month: 3, status: 'paid', totalCharge: 500,
                 charges: { rent: 500, electric: { cost: 0 }, water: { cost: 0 }, trash: 0 } });
      const res = await scheduledHandler({});
      // After run, fsSetCalls should include the year that 69 normalised to
      const call2569 = fsSetCalls.find(c => c.path === 'taxSummary/2569');
      assert.ok(call2569, 'should have written taxSummary/2569 from 2-digit year 69');
      const monthData = call2569.data.months[3];
      assert.equal(monthData.totalRevenue, 500, 'bill with 2-digit year should be counted');
    });

    it('4-digit year 2569 passes through unchanged', async () => {
      buildingsList = ['rooms'];
      seedBill(makeBill(2569, 4));
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === 'taxSummary/2569');
      assert.ok(call, 'should write taxSummary/2569');
      assert.equal(call.data.months[4].totalRevenue, 1000);
    });
  });

  // ── aggregateYear core math ─────────────────────────────────────────────────

  describe('aggregateYear — core math', () => {
    it('empty RTDB → all months zero, annual zero', async () => {
      buildingsList = ['rooms'];
      // No bills seeded
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.data && c.data.year);
      assert.ok(call, 'should write at least one taxSummary doc');
      const { annual, months } = call.data;
      assert.equal(annual.totalRevenue, 0);
      assert.equal(annual.paidRevenue, 0);
      assert.equal(annual.pendingRevenue, 0);
      for (let m = 1; m <= 12; m++) {
        assert.equal(months[m].totalRevenue, 0, `month ${m} should be zero`);
      }
    });

    it('single paid bill for rooms month 5 → paidCount=1, paidRevenue=1000', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      seedBill(makeBill(currentBE, 5, { status: 'paid', totalCharge: 1000 }));
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      assert.ok(call, 'must write the current year doc');
      const m5 = call.data.months[5];
      assert.equal(m5.paidCount, 1);
      assert.equal(m5.paidRevenue, 1000);
      assert.equal(m5.pendingCount, 0);
      assert.equal(m5.pendingRevenue, 0);
      assert.equal(m5.totalRevenue, 1000);
    });

    it('otherIncome captures the reconciling remainder (late fee / other charges)', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      // totalCharge 1100, named charges (rent+elec+water+trash) sum to 1000 -> other = 100
      seedBill(makeBill(currentBE, 8, { status: 'paid', totalCharge: 1100 }));
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      const m8 = call.data.months[8];
      assert.equal(m8.otherIncome, 100, 'remainder = total - rent - elec - water - trash');
      // Category breakdown must reconcile to the total
      assert.equal(
        m8.rentIncome + m8.electricIncome + m8.waterIncome + m8.trashIncome + m8.otherIncome,
        m8.totalRevenue, 'categories must sum to totalRevenue');
      assert.equal(call.data.annual.otherIncome, 100, 'annual rolls up otherIncome');
      assert.equal(m8.byBuilding.rooms.other, 100, 'per-building carries other');
    });

    it('otherIncome is 0 when the bill total equals the named charges', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      seedBill(makeBill(currentBE, 9, { status: 'paid', totalCharge: 1000 }));
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      assert.equal(call.data.months[9].otherIncome, 0);
    });

    it('refunded bill is excluded from all revenue (paid, pending, and totals)', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      seedBill(makeBill(currentBE, 5, { status: 'paid', totalCharge: 1000 }), 'rooms', '15', 'b1');
      // A refunded bill must NOT count anywhere — not paid, and crucially not pending.
      seedBill(makeBill(currentBE, 5, { status: 'refunded', totalCharge: 3520 }), 'rooms', '16', 'b2');
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      const m5 = call.data.months[5];
      assert.equal(m5.paidCount, 1, 'only the paid bill is counted');
      assert.equal(m5.paidRevenue, 1000);
      assert.equal(m5.pendingCount, 0, 'refunded bill must NOT fall into pending');
      assert.equal(m5.pendingRevenue, 0, 'refunded amount must not inflate pendingRevenue');
      assert.equal(m5.totalRevenue, 1000, 'refunded amount excluded from totalRevenue');
    });

    it('single pending (unpaid) bill → pendingCount=1, pendingRevenue correct', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      seedBill(makeBill(currentBE, 6, { status: 'unpaid', totalCharge: 2500 }));
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      const m6 = call.data.months[6];
      assert.equal(m6.pendingCount, 1);
      assert.equal(m6.pendingRevenue, 2500);
      assert.equal(m6.paidCount, 0);
      assert.equal(m6.paidRevenue, 0);
    });

    it('orphan stub (total=0, no charges) is skipped', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      // orphan: totalCharge=0 AND no charges field
      seedBill({ year: currentBE, month: 7, status: 'paid', totalCharge: 0 });
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      assert.ok(call, 'still writes doc');
      const m7 = call.data.months[7];
      assert.equal(m7.totalRevenue, 0, 'orphan stub must be skipped');
      assert.equal(m7.paidCount, 0);
    });

    it('bill with wrong year is skipped', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      // Bill year is one year ahead — should be skipped in currentBE aggregation
      seedBill(makeBill(currentBE + 1, 5, { status: 'paid', totalCharge: 999 }));
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      assert.ok(call);
      // Every month should be zero because the bill's year doesn't match
      for (let m = 1; m <= 12; m++) {
        assert.equal(call.data.months[m].totalRevenue, 0, `month ${m} must be 0 (wrong year bill)`);
      }
    });

    it('bill with invalid month 13 is skipped', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      seedBill(makeBill(currentBE, 13, { status: 'paid', totalCharge: 888 }));
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      // annual total should still be 0 because month 13 is invalid
      assert.equal(call.data.annual.totalRevenue, 0, 'invalid month bill must be skipped');
    });

    it('bill with month 0 is skipped', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      seedBill(makeBill(currentBE, 0, { status: 'paid', totalCharge: 777 }));
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      assert.equal(call.data.annual.totalRevenue, 0, 'month=0 bill must be skipped');
    });

    it('byBuilding breakdown — rooms and nest tracked separately', async () => {
      buildingsList = ['rooms', 'nest'];
      const currentBE = new Date().getFullYear() + 543;
      // rooms bill: totalCharge=1000
      seedBill(makeBill(currentBE, 5, { status: 'paid', totalCharge: 1000 }), 'rooms', '15', 'b1');
      // nest bill: totalCharge=2000
      seedBill(makeBill(currentBE, 5, { status: 'paid', totalCharge: 2000,
        charges: { rent: 1500, electric: { cost: 300 }, water: { cost: 100 }, trash: 100 },
      }), 'nest', 'N101', 'b2');
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      const m5 = call.data.months[5];
      assert.equal(m5.byBuilding.rooms.total, 1000, 'rooms building total should be 1000');
      assert.equal(m5.byBuilding.nest.total, 2000, 'nest building total should be 2000');
      assert.equal(m5.totalRevenue, 3000, 'combined month revenue should be 3000');
    });

    it('tax estimate: standardDeduction = round(totalRevenue * 0.30), netRevenue = round(totalRevenue * 0.70)', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      seedBill(makeBill(currentBE, 5, { status: 'paid', totalCharge: 10000 }));
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      const { taxEstimate } = call.data.annual;
      assert.ok(taxEstimate, 'annual.taxEstimate must exist');
      assert.equal(taxEstimate.grossRevenue, 10000);
      assert.equal(taxEstimate.standardDeduction, Math.round(10000 * 0.30));
      assert.equal(taxEstimate.netRevenue, Math.round(10000 * 0.70));
    });
  });

  // ── writeSummary ────────────────────────────────────────────────────────────

  describe('writeSummary', () => {
    it('fires Firestore set at taxSummary/<yearBE>', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      seedBill(makeBill(currentBE, 3, { status: 'paid', totalCharge: 500 }));
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      assert.ok(call, `must write to taxSummary/${currentBE}`);
    });

    it('set payload has year, months (12 entries), annual, updatedAt, aggregatedAt', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      assert.ok(call, 'must have a set call');
      const { data } = call;
      assert.equal(data.year, currentBE);
      assert.ok(data.months && typeof data.months === 'object', 'months must be an object');
      assert.equal(Object.keys(data.months).length, 12, 'must have 12 month entries');
      assert.ok(data.annual && typeof data.annual === 'object', 'annual must be an object');
      assert.ok('updatedAt' in data, 'must have updatedAt');
      assert.ok('aggregatedAt' in data, 'must have aggregatedAt');
    });

    it('updatedAt is the serverTimestamp sentinel value', async () => {
      buildingsList = ['rooms'];
      const currentBE = new Date().getFullYear() + 543;
      await scheduledHandler({});
      const call = fsSetCalls.find(c => c.path === `taxSummary/${currentBE}`);
      assert.equal(call.data.updatedAt, '__serverTimestamp__');
    });

    it('writeSummary return value has yearBE, totalRevenue, paidRevenue', async () => {
      buildingsList = ['rooms'];
      requireAdminStub = { admin: true };
      const currentBE = new Date().getFullYear() + 543;
      seedBill(makeBill(currentBE, 5, { status: 'paid', totalCharge: 3000 }));
      const req = makeReq({ body: { year: currentBE } });
      const res = makeRes();
      await httpHandler(req, res);
      assert.equal(res._status, 200);
      const [result] = res._body.aggregated;
      assert.equal(result.yearBE, currentBE);
      assert.equal(result.totalRevenue, 3000);
      assert.equal(result.paidRevenue, 3000);
    });
  });

  // ── aggregateMonthlyRevenueScheduled ───────────────────────────────────────

  describe('aggregateMonthlyRevenueScheduled', () => {
    it('non-January: writes taxSummary for currentBE only (1 set call)', async () => {
      buildingsList = ['rooms'];
      const now = new Date();
      // Force a non-January month check via the actual date
      if (now.getMonth() === 0) {
        // In January, the scheduled handler writes 2 docs — skip this assertion
        return;
      }
      await scheduledHandler({});
      const currentBE = now.getFullYear() + 543;
      const callCount = fsSetCalls.filter(c => c.path === `taxSummary/${currentBE}`).length;
      assert.equal(callCount, 1, 'should write exactly 1 taxSummary doc outside January');
    });

    it('January: writes taxSummary for currentBE AND currentBE-1 (2 set calls)', async () => {
      buildingsList = ['rooms'];
      // Simulate January by patching Date — use a fixed January date
      const OrigDate = global.Date;
      const JAN_2026 = new OrigDate('2026-01-01T03:00:00Z'); // month === 0
      let dateCallCount = 0;

      // eslint-disable-next-line no-global-assign
      global.Date = class FakeDate extends OrigDate {
        constructor(...args) {
          if (args.length === 0) {
            super(JAN_2026.getTime());
          } else {
            super(...args);
          }
        }
        static now() { return JAN_2026.getTime(); }
      };

      try {
        // Clear any prior set calls
        fsSetCalls = [];
        // Force a fresh require so the new Date() in onRun captures January
        delete require.cache[require.resolve('../aggregateMonthlyRevenue.js')];
        const cfFresh = require('../aggregateMonthlyRevenue.js');
        // scheduledHandler is re-captured by makeFunctionsStub during require
        await scheduledHandler({});

        const expectedBE = JAN_2026.getFullYear() + 543; // 2026 + 543 = 2569
        const paths = fsSetCalls.map(c => c.path);
        assert.ok(
          paths.includes(`taxSummary/${expectedBE}`),
          `must write taxSummary/${expectedBE} in January`
        );
        assert.ok(
          paths.includes(`taxSummary/${expectedBE - 1}`),
          `must write taxSummary/${expectedBE - 1} in January (prior-year close)`
        );
      } finally {
        global.Date = OrigDate;
        // Restore to committed version
        delete require.cache[require.resolve('../aggregateMonthlyRevenue.js')];
        cf = require('../aggregateMonthlyRevenue.js');
      }
    });
  });

  // ── aggregateMonthlyRevenue HTTP ───────────────────────────────────────────

  describe('aggregateMonthlyRevenue — HTTP', () => {
    it('OPTIONS → 204', async () => {
      const req = makeReq({ method: 'OPTIONS' });
      const res = makeRes();
      await httpHandler(req, res);
      assert.equal(res._status, 204);
    });

    it('GET → 405', async () => {
      const req = makeReq({ method: 'GET' });
      const res = makeRes();
      await httpHandler(req, res);
      assert.equal(res._status, 405);
    });

    it('PUT → 405', async () => {
      const req = makeReq({ method: 'PUT' });
      const res = makeRes();
      await httpHandler(req, res);
      assert.equal(res._status, 405);
    });

    it('requireAdmin returns null → no Firestore writes, returns early', async () => {
      requireAdminStub = null; // stub will call res.status(403) and return null
      const req = makeReq();
      const res = makeRes();
      await httpHandler(req, res);
      assert.equal(fsSetCalls.length, 0, 'no Firestore writes when not authed');
    });

    it('body.year specified → aggregates that year only (1 Firestore set call)', async () => {
      requireAdminStub = { admin: true };
      buildingsList = ['rooms'];
      const req = makeReq({ body: { year: 2568 } });
      const res = makeRes();
      await httpHandler(req, res);
      assert.equal(res._status, 200);
      assert.equal(res._body.ok, true);
      assert.equal(res._body.aggregated.length, 1, 'should aggregate exactly 1 year');
      assert.equal(res._body.aggregated[0].yearBE, 2568);
      assert.equal(fsSetCalls.length, 1);
      assert.equal(fsSetCalls[0].path, 'taxSummary/2568');
    });

    it('body.years array → aggregates each year', async () => {
      requireAdminStub = { admin: true };
      buildingsList = ['rooms'];
      const req = makeReq({ body: { years: [2567, 2568, 2569] } });
      const res = makeRes();
      await httpHandler(req, res);
      assert.equal(res._status, 200);
      assert.equal(res._body.aggregated.length, 3, 'should aggregate 3 years');
      const paths = fsSetCalls.map(c => c.path);
      assert.ok(paths.includes('taxSummary/2567'));
      assert.ok(paths.includes('taxSummary/2568'));
      assert.ok(paths.includes('taxSummary/2569'));
    });

    it('no body → aggregates 2 years (currentBE + currentBE-1)', async () => {
      requireAdminStub = { admin: true };
      buildingsList = ['rooms'];
      const req = makeReq({ body: {} });
      const res = makeRes();
      await httpHandler(req, res);
      assert.equal(res._status, 200);
      assert.equal(res._body.aggregated.length, 2, 'default should aggregate 2 years');
      const currentBE = new Date().getFullYear() + 543;
      const years = res._body.aggregated.map(r => r.yearBE);
      assert.ok(years.includes(currentBE), `should include currentBE ${currentBE}`);
      assert.ok(years.includes(currentBE - 1), `should include currentBE-1 ${currentBE - 1}`);
    });

    it('response body has ok:true and aggregated array on success', async () => {
      requireAdminStub = { admin: true };
      buildingsList = ['rooms'];
      const req = makeReq({ body: { year: 2569 } });
      const res = makeRes();
      await httpHandler(req, res);
      assert.equal(res._body.ok, true);
      assert.ok(Array.isArray(res._body.aggregated));
    });

    it('Firestore set error → responds with 500', async () => {
      requireAdminStub = { admin: true };
      buildingsList = ['rooms'];
      // Override fsInstance.collection to throw
      const originalSet = fsInstance.collection;
      fsInstance.collection = () => ({
        doc: () => ({
          set: async () => { throw new Error('Firestore write failed'); },
        }),
      });
      const req = makeReq({ body: { year: 2569 } });
      const res = makeRes();
      await httpHandler(req, res);
      assert.equal(res._status, 500, 'should return 500 on Firestore error');
      assert.ok(res._body.error, 'should include error message');
      // Restore
      fsInstance.collection = originalSet;
    });
  });
});
