/**
 * Unit tests for remindLatePayments.js
 *
 * Tests the core runReminders() logic through the captured pubsub onRun handler.
 * All Firebase and LINE API calls are stubbed — no network required.
 *
 * Run: node --test functions/__tests__/remindLatePayments.test.js
 */

'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured  = {};

function resetStubs(overrides = {}) {
  stubState = {
    token: 'line-token-123',
    buildings: ['rooms'],
    // RTDB: { [building]: { [roomId]: { [billId]: billObj } } }
    billsData: {},
    // Firestore liffUsers: { ["{building}_{roomId}"]: [lineUserId, ...] }
    liffUsers: {},
    liffQueryError: null,
    lineOk: true,
    ...overrides,
  };
  captured = {
    rtdbUpdates: {},   // "{path}" → data
    fetchCalls: [],    // [{ url, opts }]
  };
  if (stubState.token) {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = stubState.token;
  } else {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  }
}
resetStubs();

// ── RTDB stub ─────────────────────────────────────────────────────────────────
// makeRtdbRef is used by the module-level `rtdb = admin.database()` singleton,
// so it reads `stubState` at call time (not at construction time).

function makeRtdbRef(path) {
  return {
    path,
    once: async (_event) => {
      // path is e.g. "bills/rooms"
      const parts = path.split('/');
      const building = parts[1];
      return { val: () => (stubState.billsData[building] || null) };
    },
    update: async (data) => {
      captured.rtdbUpdates[path] = data;
    },
  };
}
const rtdbStub = { ref: (path) => makeRtdbRef(path) };

// ── Firestore stub ────────────────────────────────────────────────────────────
// Accumulates the building and room values from chained .where() calls so the
// final .get() can look up the right key in stubState.liffUsers.

function makeFirestoreCollStub(coll) {
  if (coll !== 'liffUsers') {
    return { where: () => ({ get: async () => ({ empty: true, docs: [] }) }) };
  }

  let pendingBuilding = '';
  let pendingRoom     = '';

  const q = {
    where: (field, _op, val) => {
      if (field === 'building') pendingBuilding = val;
      if (field === 'room')     pendingRoom     = val;
      return q;
    },
    get: async () => {
      if (stubState.liffQueryError) throw stubState.liffQueryError;
      const key   = `${pendingBuilding}_${pendingRoom}`;
      const users = stubState.liffUsers[key] || [];
      return {
        empty: users.length === 0,
        docs:  users.map(uid => ({ id: uid })),
      };
    },
  };
  return q;
}

const firestoreStub = () => ({ collection: makeFirestoreCollStub });
firestoreStub.FieldValue = {
  serverTimestamp: () => ({ _type: 'FieldValue.serverTimestamp' }),
  delete:          () => ({ _type: 'FieldValue.delete' }),
};

// ── admin stub ────────────────────────────────────────────────────────────────

const adminStub = {
  apps:         [{}],
  initializeApp: () => {},
  database:      () => rtdbStub,
  firestore:     firestoreStub,
};

// ── buildingRegistry stub ─────────────────────────────────────────────────────

const buildingRegistryStub = {
  getAllBuildings: async () => stubState.buildings,
};

// ── firebase-functions/v1 stub — captures pubsub onRun handler ────────────────

let capturedScheduledHandler = null;

function makeFunctionsStub() {
  class HttpsError extends Error {
    constructor(code, msg) { super(msg); this.code = code; }
  }
  const onRun = (h) => { capturedScheduledHandler = h; return h; };
  const chainEnd   = { onRun };
  const schedChain = { timeZone: () => chainEnd };
  const pubsubObj  = { schedule: () => schedChain };
  const runWithResult = {
    pubsub: pubsubObj,
    https:  { HttpsError, onRequest: (h) => h },
  };
  return {
    region:  () => ({ runWith: () => runWithResult }),
    runWith: ()   => runWithResult,
    https:   { HttpsError, onRequest: (h) => h },
  };
}

// ── Module._load intercept ────────────────────────────────────────────────────

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin')               return adminStub;
  if (request === 'firebase-functions/v1')        return makeFunctionsStub();
  if (
    request.endsWith('/buildingRegistry') ||
    request === './buildingRegistry'
  ) return buildingRegistryStub;
  return originalLoad.call(this, request, parent, isMain);
};

// ── global.fetch stub ─────────────────────────────────────────────────────────

const originalFetch = global.fetch;
global.fetch = async (url, opts) => {
  captured.fetchCalls.push({ url, opts });
  if (!stubState.lineOk) {
    return { ok: false, status: 429, text: async () => 'rate limited' };
  }
  return { ok: true };
};

// ── Require CF after stubs are installed ──────────────────────────────────────
// This populates capturedScheduledHandler via the onRun interception above.

delete require.cache[require.resolve('../remindLatePayments.js')];
require('../remindLatePayments.js');

// ── Restore globals after all tests ──────────────────────────────────────────

after(() => {
  Module._load = originalLoad;
  if (originalFetch == null) delete global.fetch;
  else global.fetch = originalFetch;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a bill object whose dueDate is `daysOverdue` days before today.
 * Positive values are past due; negative values are future-due.
 */
function makeBill(daysOverdue, extra = {}) {
  const dueMs  = Date.now() - daysOverdue * 24 * 60 * 60 * 1000;
  const dueDate = new Date(dueMs).toISOString().slice(0, 10); // YYYY-MM-DD
  return {
    status:      'unpaid',
    dueDate,
    totalCharge: 3000,
    room:        '15',
    month:       5,
    year:        2569,
    ...extra,
  };
}

/** Seeds one bill into billsData for `building / roomId / billId`. */
function seedBill(bill, building = 'rooms', roomId = '15', billId = 'b1') {
  stubState.billsData[building] = {
    [roomId]: { [billId]: bill },
  };
}

/** Seeds liffUsers for the given key (default = "rooms_15"). */
function seedUsers(lineUserIds, key = 'rooms_15') {
  stubState.liffUsers[key] = lineUserIds;
}

/** Invokes runReminders through the captured scheduled handler. */
async function run() {
  return capturedScheduledHandler();
}

// ── Sanity check ──────────────────────────────────────────────────────────────

assert.ok(
  typeof capturedScheduledHandler === 'function',
  'capturedScheduledHandler must be a function — check the pubsub onRun stub'
);

// ─────────────────────────────────────────────────────────────────────────────
// Test suites
// ─────────────────────────────────────────────────────────────────────────────

describe('remindLatePayments — runReminders', () => {
  beforeEach(() => resetStubs());

  // ── no token → early return ─────────────────────────────────────────────────

  describe('no LINE token → early return', () => {
    it('returns scanned=0 and sent=0 when LINE_CHANNEL_ACCESS_TOKEN is empty', async () => {
      resetStubs({ token: '' });
      const result = await run();
      assert.equal(result.scanned, 0);
      assert.equal(result.sent,    0);
    });

    it('does not call LINE API when token is missing', async () => {
      resetStubs({ token: '' });
      await run();
      assert.equal(captured.fetchCalls.length, 0);
    });
  });

  // ── bill eligibility filters ────────────────────────────────────────────────

  describe('bill eligibility filters', () => {
    it('skips a paid bill and increments scanned + skipped', async () => {
      seedBill(makeBill(5, { status: 'paid' }));
      seedUsers(['Uabc']);
      const result = await run();
      assert.ok(result.scanned >= 1, 'scanned should count the bill');
      assert.ok(result.skipped >= 1, 'paid bill should be skipped');
      assert.equal(captured.fetchCalls.length, 0, 'LINE must not be called for paid bills');
    });

    it('skips a bill with no dueDate', async () => {
      const bill = makeBill(5);
      delete bill.dueDate;
      seedBill(bill);
      seedUsers(['Uabc']);
      const result = await run();
      assert.ok(result.scanned >= 1);
      assert.ok(result.skipped >= 1);
      assert.equal(captured.fetchCalls.length, 0);
    });

    it('skips a bill with totalCharge === 0', async () => {
      seedBill(makeBill(5, { totalCharge: 0 }));
      seedUsers(['Uabc']);
      const result = await run();
      assert.ok(result.scanned >= 1);
      assert.ok(result.skipped >= 1);
      assert.equal(captured.fetchCalls.length, 0);
    });

    it('skips a bill that is not yet overdue (dueDate in the future)', async () => {
      // dueDate 2 days from now → daysOverdue is negative → skip
      const futureDue = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      seedBill(makeBill(0, { dueDate: futureDue }));
      seedUsers(['Uabc']);
      const result = await run();
      assert.ok(result.scanned >= 1);
      assert.ok(result.skipped >= 1);
      assert.equal(captured.fetchCalls.length, 0);
    });

    it('skips a bill with null/undefined bill object in RTDB structure', async () => {
      // RTDB can contain null slots
      stubState.billsData['rooms'] = { '15': { b_null: null } };
      const result = await run();
      // null bill: scanned stays at 0 (guard `if (!bill || typeof bill !== 'object')`)
      assert.equal(result.scanned, 0);
      assert.equal(captured.fetchCalls.length, 0);
    });

    it('returns zero counts when a building has no bills', async () => {
      // val() returns null for an empty building
      stubState.billsData['rooms'] = null;
      const result = await run();
      assert.equal(result.scanned, 0);
      assert.equal(result.sent,    0);
    });
  });

  // ── tier logic ──────────────────────────────────────────────────────────────

  describe('tier logic via RTDB update', () => {
    it('applies tier=soft for daysOverdue=3 (1-7 range)', async () => {
      seedBill(makeBill(3));
      seedUsers(['Uabc']);
      const result = await run();
      assert.equal(result.sent, 1);
      const update = captured.rtdbUpdates['bills/rooms/15/b1'];
      assert.ok(update, 'RTDB update must exist');
      assert.equal(update.lastLateTier, 'soft');
    });

    it('applies tier=firm for daysOverdue=10 (8-14 range)', async () => {
      seedBill(makeBill(10));
      seedUsers(['Uabc']);
      const result = await run();
      assert.equal(result.sent, 1);
      const update = captured.rtdbUpdates['bills/rooms/15/b1'];
      assert.ok(update, 'RTDB update must exist');
      assert.equal(update.lastLateTier, 'firm');
    });

    it('applies tier=stern for daysOverdue=20 (15+ range)', async () => {
      seedBill(makeBill(20));
      seedUsers(['Uabc']);
      const result = await run();
      assert.equal(result.sent, 1);
      const update = captured.rtdbUpdates['bills/rooms/15/b1'];
      assert.ok(update, 'RTDB update must exist');
      assert.equal(update.lastLateTier, 'stern');
    });

    it('boundary: upper edge of soft tier (daysOverdue=6) → soft', async () => {
      // Use 6 days to avoid the BKK +07:00 T23:59:59 rounding from tipping
      // a 7-day-old bill into "not yet late" on some hour-of-day combinations.
      seedBill(makeBill(6));
      seedUsers(['Uabc']);
      await run();
      const update = captured.rtdbUpdates['bills/rooms/15/b1'];
      assert.equal(update.lastLateTier, 'soft');
    });

    it('boundary: lower edge of firm tier (daysOverdue=9) → firm', async () => {
      // daysOverdue=9 lands safely in the firm range (8-14) regardless of
      // the T23:59:59+07:00 rounding applied to the dueDate in runReminders.
      seedBill(makeBill(9));
      seedUsers(['Uabc']);
      await run();
      const update = captured.rtdbUpdates['bills/rooms/15/b1'];
      assert.equal(update.lastLateTier, 'firm');
    });

    it('boundary: upper edge of firm tier (daysOverdue=13) → firm', async () => {
      seedBill(makeBill(13));
      seedUsers(['Uabc']);
      await run();
      const update = captured.rtdbUpdates['bills/rooms/15/b1'];
      assert.equal(update.lastLateTier, 'firm');
    });

    it('boundary: lower edge of stern tier (daysOverdue=16) → stern', async () => {
      // Use 16 to give a day of safety margin around the 15-day boundary due
      // to the T23:59:59+07:00 rounding used in runReminders.
      seedBill(makeBill(16));
      seedUsers(['Uabc']);
      await run();
      const update = captured.rtdbUpdates['bills/rooms/15/b1'];
      assert.equal(update.lastLateTier, 'stern');
    });
  });

  // ── anti-spam ───────────────────────────────────────────────────────────────

  describe('anti-spam gate', () => {
    it('skips when last reminder was 3 days ago and tier has NOT escalated', async () => {
      const lastAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      seedBill(makeBill(5, { lastLateReminderAt: lastAt, lastLateTier: 'soft' }));
      seedUsers(['Uabc']);
      const result = await run();
      // Same tier (soft→soft), only 3 days since last send (< MIN_RESEND_DAYS=7)
      assert.ok(result.skipped >= 1, 'should be skipped by anti-spam');
      assert.equal(captured.fetchCalls.length, 0, 'LINE must not be called');
    });

    it('fires when last reminder was 3 days ago but tier has escalated (soft→firm)', async () => {
      const lastAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      // daysOverdue=10 → firm, but lastLateTier was 'soft'
      seedBill(makeBill(10, { lastLateReminderAt: lastAt, lastLateTier: 'soft' }));
      seedUsers(['Uabc']);
      const result = await run();
      assert.equal(result.sent, 1, 'tier escalation should bypass anti-spam');
      assert.equal(captured.fetchCalls.length, 1);
    });

    it('fires when last reminder was 8 days ago (>= MIN_RESEND_DAYS) even for same tier', async () => {
      const lastAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      seedBill(makeBill(5, { lastLateReminderAt: lastAt, lastLateTier: 'soft' }));
      seedUsers(['Uabc']);
      const result = await run();
      assert.equal(result.sent, 1, 'sufficient time elapsed — should resend');
      assert.equal(captured.fetchCalls.length, 1);
    });

    it('fires when lastLateReminderAt is absent (first reminder ever)', async () => {
      // No lastLateReminderAt in bill object
      seedBill(makeBill(5));
      seedUsers(['Uabc']);
      const result = await run();
      assert.equal(result.sent, 1, 'first reminder should always fire');
    });

    it('fires exactly at MIN_RESEND_DAYS=7 boundary (7 days since last)', async () => {
      const lastAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      seedBill(makeBill(5, { lastLateReminderAt: lastAt, lastLateTier: 'soft' }));
      seedUsers(['Uabc']);
      const result = await run();
      // daysBetween(lastAt, now) === 7, which is NOT < 7, so anti-spam gate passes
      assert.equal(result.sent, 1);
    });
  });

  // ── LINE push and RTDB update ───────────────────────────────────────────────

  describe('LINE push and RTDB update', () => {
    it('sends to 1 user when line push succeeds and writes RTDB update', async () => {
      seedBill(makeBill(5));
      seedUsers(['Uabc123']);
      const result = await run();

      assert.equal(result.sent, 1, 'one message sent');
      assert.equal(captured.fetchCalls.length, 1, 'exactly one fetch call to LINE');
      assert.ok(
        captured.fetchCalls[0].url.includes('api.line.me'),
        'must call LINE Messaging API'
      );

      const update = captured.rtdbUpdates['bills/rooms/15/b1'];
      assert.ok(update, 'RTDB update must be written after successful push');
      assert.ok(
        typeof update.lastLateReminderAt === 'string' && update.lastLateReminderAt.length > 0,
        'lastLateReminderAt must be a non-empty ISO string'
      );
      assert.equal(update.lastLateTier, 'soft', 'tier recorded in RTDB');
    });

    it('sends to multiple users in same room (all succeed)', async () => {
      seedBill(makeBill(5));
      seedUsers(['U001', 'U002', 'U003']);
      const result = await run();
      assert.equal(result.sent, 3);
      assert.equal(captured.fetchCalls.length, 3);
      // RTDB update written once per bill (not once per user)
      assert.ok(captured.rtdbUpdates['bills/rooms/15/b1'], 'single RTDB update for the bill');
    });

    it('skips and does NOT update RTDB when no liffUsers for the room', async () => {
      seedBill(makeBill(5));
      // No users seeded for rooms_15
      const result = await run();
      assert.ok(result.skipped >= 1, 'empty liffUsers → skip');
      assert.equal(captured.fetchCalls.length, 0, 'no LINE call');
      assert.equal(
        Object.keys(captured.rtdbUpdates).length, 0,
        'no RTDB update when nobody was notified'
      );
    });

    it('records errors and does NOT write RTDB when LINE push fails', async () => {
      seedBill(makeBill(5));
      seedUsers(['Ufail']);
      stubState.lineOk = false;
      const result = await run();
      assert.ok(result.errors >= 1, 'LINE failure should increment errors');
      assert.equal(result.sent, 0, 'sent must be 0 when LINE push failed');
      assert.equal(
        Object.keys(captured.rtdbUpdates).length, 0,
        'no RTDB write when ok=0'
      );
    });

    it('sets correct Authorization header on LINE push', async () => {
      seedBill(makeBill(5));
      seedUsers(['Uabc']);
      await run();
      const opts = captured.fetchCalls[0].opts;
      const auth = opts && opts.headers && opts.headers['Authorization'];
      assert.ok(
        typeof auth === 'string' && auth.includes('line-token-123'),
        `Authorization header must include the token; got: ${auth}`
      );
    });

    it('sends to the correct lineUserId in the request body', async () => {
      seedBill(makeBill(5));
      seedUsers(['U_specific_user']);
      await run();
      const body = JSON.parse(captured.fetchCalls[0].opts.body);
      assert.equal(body.to, 'U_specific_user');
    });

    it('sends a flex message in the messages array', async () => {
      seedBill(makeBill(5));
      seedUsers(['Uabc']);
      await run();
      const body = JSON.parse(captured.fetchCalls[0].opts.body);
      assert.ok(Array.isArray(body.messages), 'messages must be an array');
      assert.equal(body.messages.length, 1, 'one message per push call');
      assert.equal(body.messages[0].type, 'flex', 'message type must be flex');
    });
  });

  // ── Firestore liffUsers query error ────────────────────────────────────────

  describe('Firestore query error handling', () => {
    it('increments errors and continues when liffUsers query throws', async () => {
      seedBill(makeBill(5));
      stubState.liffQueryError = new Error('Firestore unavailable');
      const result = await run();
      assert.ok(result.errors >= 1, 'Firestore error should increment errors counter');
      assert.equal(result.sent, 0, 'nothing sent on query failure');
      assert.equal(captured.fetchCalls.length, 0);
    });
  });

  // ── return shape ────────────────────────────────────────────────────────────

  describe('return shape', () => {
    it('returns exact { scanned:1, sent:0, skipped:1, errors:0 } when all bills paid', async () => {
      seedBill(makeBill(5, { status: 'paid' }));
      const result = await run();
      assert.deepEqual(result, { scanned: 1, sent: 0, skipped: 1, errors: 0 });
    });

    it('result has scanned, sent, skipped, errors keys on success', async () => {
      seedBill(makeBill(5));
      seedUsers(['Uabc']);
      const result = await run();
      assert.ok('scanned' in result, 'result must have scanned');
      assert.ok('sent'    in result, 'result must have sent');
      assert.ok('skipped' in result, 'result must have skipped');
      assert.ok('errors'  in result, 'result must have errors');
    });

    it('returns { scanned:0, sent:0, skipped:0, errors:0 } for empty building', async () => {
      // billsData not set → rtdb returns null → no bills to process
      const result = await run();
      assert.deepEqual(result, { scanned: 0, sent: 0, skipped: 0, errors: 0 });
    });

    it('returns early object { scanned:0, sent:0, skipped:0 } when token absent', async () => {
      resetStubs({ token: '' });
      const result = await run();
      assert.equal(result.scanned, 0);
      assert.equal(result.sent,    0);
      assert.equal(result.skipped, 0);
    });

    it('accumulates counts across multiple bills in the same room', async () => {
      stubState.billsData['rooms'] = {
        '15': {
          b1: makeBill(5),                        // unpaid, overdue → fires
          b2: makeBill(5, { status: 'paid' }),    // paid → skipped
          b3: makeBill(5, { totalCharge: 0 }),    // zero charge → skipped
        },
      };
      seedUsers(['Uabc']);
      const result = await run();
      assert.equal(result.scanned, 3);
      assert.equal(result.sent,    1);
      assert.equal(result.skipped, 2);
      assert.equal(result.errors,  0);
    });

    it('accumulates counts across multiple buildings', async () => {
      stubState.buildings = ['rooms', 'nest'];
      stubState.billsData = {
        rooms: { '15': { b1: makeBill(5) } },
        nest:  { 'N101': { b2: makeBill(10) } },
      };
      seedUsers(['U_rooms'], 'rooms_15');
      seedUsers(['U_nest'],  'nest_N101');
      const result = await run();
      assert.equal(result.scanned, 2);
      assert.equal(result.sent,    2);
      assert.equal(result.skipped, 0);
    });
  });

  // ── edge cases ───────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles buildings array with a single building', async () => {
      stubState.buildings = ['rooms'];
      seedBill(makeBill(5));
      seedUsers(['Uabc']);
      const result = await run();
      assert.equal(result.sent, 1);
    });

    it('handles empty buildings array — returns all-zero counts', async () => {
      stubState.buildings = [];
      const result = await run();
      assert.deepEqual(result, { scanned: 0, sent: 0, skipped: 0, errors: 0 });
    });

    it('handles a bill with daysOverdue=2 (reliably late — soft tier)', async () => {
      // daysOverdue=1 is borderline: the T23:59:59+07:00 offset in runReminders
      // means a bill from exactly 1 calendar day ago may compute to 0 overdue
      // hours depending on the time-of-day the test runs. Use 2 days instead,
      // which is unambiguously >= 1 regardless of hour.
      seedBill(makeBill(2));
      seedUsers(['Uabc']);
      const result = await run();
      assert.equal(result.sent, 1);
      assert.equal(captured.rtdbUpdates['bills/rooms/15/b1'].lastLateTier, 'soft');
    });

    it('handles a bill with a very large daysOverdue (300 days — stern tier)', async () => {
      seedBill(makeBill(300));
      seedUsers(['Uabc']);
      await run();
      assert.equal(captured.rtdbUpdates['bills/rooms/15/b1'].lastLateTier, 'stern');
    });

    it('does not process a bill-shaped value that is not a plain object (non-object guard)', async () => {
      stubState.billsData['rooms'] = { '15': { b_str: 'not-an-object' } };
      const result = await run();
      assert.equal(result.scanned, 0);
    });

    it('handles room with multiple bills of different tiers independently', async () => {
      stubState.billsData['rooms'] = {
        '15': {
          b_soft:  makeBill(3),   // soft
          b_stern: makeBill(20),  // stern
        },
      };
      seedUsers(['Uabc'], 'rooms_15');
      const result = await run();
      assert.equal(result.scanned, 2);
      assert.equal(result.sent,    2);  // two separate LINE pushes (one per bill)
      assert.equal(captured.fetchCalls.length, 2);
    });

    it('does NOT write RTDB when partial users fail and ok count is 0', async () => {
      seedBill(makeBill(5));
      seedUsers(['Ufail_1', 'Ufail_2']);
      stubState.lineOk = false;  // all fail
      await run();
      assert.equal(Object.keys(captured.rtdbUpdates).length, 0);
    });

    it('writes RTDB when at least one user succeeds in a partially-failing batch', async () => {
      // Stub fetch to succeed for the first call, fail for the second
      let callCount = 0;
      global.fetch = async (url, opts) => {
        captured.fetchCalls.push({ url, opts });
        callCount++;
        if (callCount === 1) return { ok: true };
        return { ok: false, status: 500, text: async () => 'err' };
      };

      seedBill(makeBill(5));
      seedUsers(['Upass', 'Ufail']);
      const result = await run();
      assert.equal(result.sent,   1, '1 successful push');
      assert.equal(result.errors, 1, '1 failed push counted as error');
      assert.ok(
        captured.rtdbUpdates['bills/rooms/15/b1'],
        'RTDB must be written because ok > 0'
      );

      // Restore the simple global.fetch stub for remaining tests
      global.fetch = async (url, opts) => {
        captured.fetchCalls.push({ url, opts });
        if (!stubState.lineOk) {
          return { ok: false, status: 429, text: async () => 'rate limited' };
        }
        return { ok: true };
      };
    });
  });
});
