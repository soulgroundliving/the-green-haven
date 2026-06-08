/**
 * Integration tests for notifyTenantOnMeterUpload.js
 *
 * Tests the meter-upload → LINE notification path without Firebase or LINE API.
 * All external calls are replaced with stubs via Module._load interception and
 * global.fetch override.
 *
 * Pure helpers (meterValuesEqual) are extracted inline for direct coverage.
 *
 * Run: node --test functions/__tests__/notifyMeter.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── stub state (reset per test) ────────────────────────────────────────────────
let stubState = {};
let docUpdates = {};
let rtdbStore = {};   // seeded RTDB reads: { 'bills/rooms/15': {...}, ... }
let rtdbWrites = [];  // captured RTDB writes: [{ path, op:'set'|'update', value }]

function makeSnap(exists, data) {
  return { exists, data: () => data || {} };
}

function resetStubs(overrides = {}) {
  docUpdates = {};
  rtdbStore = {};
  rtdbWrites = [];
  stubState = {
    meterExists: true,
    meterData: {
      building: 'rooms', roomId: '15', year: 68, month: 4,
      eOld: 100, eNew: 150, wOld: 30, wNew: 35,
      notifiedAt: null, lastNotifiedSignature: null
    },
    tenantName: 'สมชาย',
    tenantLease: undefined,   // Option C §7-BBB boundary source (lease.moveInDate)
    liffUsers: [{ id: 'Uabc123' }],
    lineToken: 'test-token',
    fetchCalls: [],
    ...overrides
  };
}
resetStubs();

// ── Module._load stubs ─────────────────────────────────────────────────────────
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const fakeQuery = {
      where: function () { return fakeQuery; },
      get: async () => ({
        empty: stubState.liffUsers.length === 0,
        size: stubState.liffUsers.length,
        docs: stubState.liffUsers.map(u => ({ id: u.id }))
      })
    };

    const firestoreFn = () => ({
      collection: (coll) => {
        if (coll === 'meter_data') return {
          doc: () => ({
            get: async () => makeSnap(stubState.meterExists, stubState.meterData),
            update: async (updates) => { Object.assign(docUpdates, updates); }
          })
        };
        if (coll === 'liffUsers') return fakeQuery;
        if (coll === 'tenants') return {
          doc: () => ({
            collection: () => ({
              doc: () => ({
                get: async () => makeSnap(!!stubState.tenantName, { name: stubState.tenantName, lease: stubState.tenantLease })
              })
            })
          })
        };
        return { doc: () => ({ get: async () => makeSnap(false, {}), update: async () => {} }) };
      },
      // Minimal tx so issueInvoiceNo mints a number (fresh counter) instead of throwing.
      runTransaction: async (fn) => fn({
        get: async () => ({ exists: false, data: () => ({}) }),
        set: () => {},
      }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => '__ts__' };

    return {
      apps: { length: 1 },
      initializeApp: () => {},
      database: () => {
        // Store-backed ref so the Option C bill-write path (writeBillOnIssue →
        // writeCanonicalBillIdempotent: roomRef.once + roomRef.child().set/update)
        // is observable. Seed reads via rtdbStore, assert writes via rtdbWrites.
        const makeRef = (path) => ({
          once: async () => ({ val: () => (path in rtdbStore ? rtdbStore[path] : null) }),
          child: (id) => makeRef(path + '/' + id),
          set: async (v) => { rtdbStore[path] = v; rtdbWrites.push({ path, op: 'set', value: v }); },
          update: async (v) => { rtdbStore[path] = { ...(rtdbStore[path] || {}), ...v }; rtdbWrites.push({ path, op: 'update', value: v }); },
        });
        return { ref: makeRef };
      },
      firestore: firestoreFn
    };
  }
  if (id === 'firebase-functions/v2/https') {
    return {
      onCall: (opts, fn) => (typeof fn === 'function' ? fn : opts),
      HttpsError: class HttpsError extends Error {
        constructor(code, msg) { super(msg); this.code = code; }
      }
    };
  }
  if (id === 'firebase-functions/params') {
    return {
      defineSecret: (name) => ({
        value: () => name === 'LINE_CHANNEL_ACCESS_TOKEN' ? stubState.lineToken : 'dummy',
        __secretType: name
      }),
      defineString: () => ({ value: () => '' })
    };
  }
  if (id.endsWith('_lineRetry')) {
    return { enqueueLineRetry: async () => {} };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

// Stub global fetch for LINE API calls (used by notifyTenantOnMeterUpload — no node-fetch import)
global.fetch = async (url, opts) => {
  stubState.fetchCalls.push({ url, body: JSON.parse(opts?.body || '{}') });
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
};

const { notifyTenantOnMeterUpload } = require('../notifyTenantOnMeterUpload');

// ── pure helpers extracted for testing ────────────────────────────────────────
// Mirrors meterValuesEqual in notifyTenantOnMeterUpload.js — regression guard.
function meterValuesEqual(a, b) {
  if (!a || !b) return false;
  return Number(a.eOld) === Number(b.eOld) &&
         Number(a.eNew) === Number(b.eNew) &&
         Number(a.wOld) === Number(b.wOld) &&
         Number(a.wNew) === Number(b.wNew);
}

function makeRequest(data, isAdmin = true) {
  return { auth: { token: { admin: isAdmin } }, data };
}

// ── Tests: meterValuesEqual ───────────────────────────────────────────────────

describe('meterValuesEqual', () => {
  it('returns true for identical values', () => {
    const v = { eOld: 100, eNew: 150, wOld: 30, wNew: 35 };
    assert.ok(meterValuesEqual(v, { ...v }));
  });

  it('returns false when eNew differs', () => {
    assert.ok(!meterValuesEqual(
      { eOld: 100, eNew: 150, wOld: 30, wNew: 35 },
      { eOld: 100, eNew: 151, wOld: 30, wNew: 35 }
    ));
  });

  it('returns false when wOld differs', () => {
    assert.ok(!meterValuesEqual(
      { eOld: 100, eNew: 150, wOld: 30, wNew: 35 },
      { eOld: 100, eNew: 150, wOld: 31, wNew: 35 }
    ));
  });

  it('returns false when either arg is null', () => {
    const v = { eOld: 100, eNew: 150, wOld: 30, wNew: 35 };
    assert.ok(!meterValuesEqual(null, v));
    assert.ok(!meterValuesEqual(v, null));
  });

  it('coerces string numbers correctly', () => {
    assert.ok(meterValuesEqual(
      { eOld: '100', eNew: '150', wOld: '30', wNew: '35' },
      { eOld: 100, eNew: 150, wOld: 30, wNew: 35 }
    ));
  });
});

// ── Tests: notifyOne via exported handler ─────────────────────────────────────

describe('notifyTenantOnMeterUpload — notifyOne integration', () => {
  beforeEach(() => { resetStubs(); });

  it('throws permission-denied when admin claim is absent', async () => {
    await assert.rejects(
      () => notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }, false)),
      (err) => { assert.equal(err.code, 'permission-denied'); return true; }
    );
  });

  it('skips when meter_data doc does not exist', async () => {
    resetStubs({ meterExists: false });
    const result = await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }));
    assert.equal(result.results[0].skipped, 'doc_not_found');
    assert.equal(result.skipped, 1);
  });

  it('skips when already notified with same meter signature', async () => {
    resetStubs({
      meterData: {
        building: 'rooms', roomId: '15', year: 68, month: 4,
        eOld: 100, eNew: 150, wOld: 30, wNew: 35,
        notifiedAt: Date.now(),
        lastNotifiedSignature: '100|150|30|35'
      }
    });
    const result = await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }));
    assert.equal(result.results[0].skipped, 'already_notified');
    assert.equal(stubState.fetchCalls.length, 0, 'should not call LINE');
  });

  it('processes when signature differs even if notifiedAt is set (meter re-read)', async () => {
    resetStubs({
      meterData: {
        building: 'rooms', roomId: '15', year: 68, month: 4,
        eOld: 100, eNew: 150, wOld: 30, wNew: 35,
        notifiedAt: Date.now(),
        lastNotifiedSignature: '100|140|30|35'  // different — previous reading
      }
    });
    const result = await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }));
    assert.notEqual(result.results[0].skipped, 'already_notified');
  });

  it('force flag bypasses idempotency check', async () => {
    resetStubs({
      meterData: {
        building: 'rooms', roomId: '15', year: 68, month: 4,
        eOld: 100, eNew: 150, wOld: 30, wNew: 35,
        notifiedAt: Date.now(),
        lastNotifiedSignature: '100|150|30|35'
      }
    });
    const result = await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15', force: true }));
    assert.notEqual(result.results[0].skipped, 'already_notified');
  });

  it('skips when LINE token is not set', async () => {
    resetStubs({ lineToken: '' });
    const result = await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }));
    assert.equal(result.results[0].skipped, 'no_line_token');
    assert.equal(stubState.fetchCalls.length, 0);
  });

  it('skips + writes notifiedAt when no approved tenants in liffUsers', async () => {
    resetStubs({ liffUsers: [] });
    const result = await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }));
    assert.equal(result.results[0].skipped, 'no_approved_tenant');
    assert.equal(docUpdates.notifiedAt, '__ts__', 'should record notifiedAt even on skip');
    assert.equal(stubState.fetchCalls.length, 0);
  });

  it('happy path: pushes flex to LINE and writes signature', async () => {
    const result = await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }));
    assert.equal(result.pushed, 1);
    assert.equal(result.failed, 0);
    assert.equal(stubState.fetchCalls.length, 1, 'exactly one LINE push');
    assert.ok(stubState.fetchCalls[0].url.includes('api.line.me'), 'calls LINE API');
    assert.equal(stubState.fetchCalls[0].body.to, 'Uabc123', 'targets correct user');
    assert.ok(Array.isArray(stubState.fetchCalls[0].body.messages), 'messages array present');
    assert.equal(docUpdates.lastNotifiedSignature, '100|150|30|35', 'writes signature');
    assert.equal(docUpdates.notifiedAt, '__ts__', 'writes notifiedAt');
  });

  it('builds docId from {building,year,month,roomId} params', async () => {
    const result = await notifyTenantOnMeterUpload(
      makeRequest({ building: 'rooms', year: 68, month: 4, roomId: '15' })
    );
    assert.equal(result.results[0].docId, 'rooms_68_4_15', 'constructs expected docId');
    assert.equal(result.results.length, 1);
  });

  it('processes multiple docIds and returns per-doc results', async () => {
    const result = await notifyTenantOnMeterUpload(
      makeRequest({ docIds: ['rooms_68_4_15', 'rooms_68_4_16'] })
    );
    assert.equal(result.count, 2);
    assert.equal(result.results.length, 2);
  });
});

// ── Option C — meter-approve creates the canonical 'pending' bill ──────────────
// INTEGRATION test: the REAL notifyTenantOnMeterUpload + the REAL _billWrite
// (NOT stubbed) writing to a captured mock RTDB. This proves the meter-approve
// path end-to-end without waiting for a live admin meter import. (The companion
// verifySlip materialize covers the PAYMENT path; this covers ISSUANCE.)
describe('Option C — canonical bill write (real _billWrite, integration)', () => {
  beforeEach(() => resetStubs());

  it('writes a pending RTDB bill with computed charges when the month has none', async () => {
    const result = await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }));
    assert.equal(result.results[0].bill, 'created', 'per-doc result reports the bill action');
    const w = rtdbWrites.find(x => x.op === 'set' && x.path === 'bills/rooms/15/TGH-256804-15');
    assert.ok(w, 'a canonical bill must be written to bills/rooms/15/TGH-256804-15');
    const bill = w.value;
    assert.equal(bill.status, 'pending');          // §7-T: canonical unpaid value
    assert.equal(bill.billId, 'TGH-256804-15');
    assert.equal(bill.year, 2568);
    assert.equal(bill.month, 4);
    assert.equal(bill.generatedBy, 'meter_upload_cf');
    assert.ok(bill.charges, 'has charges');
    assert.equal(bill.meterReadings.electric.units, 50);  // 150 - 100
  });

  it('does NOT overwrite an existing PAID bill for that month (legacy suffixed id)', async () => {
    rtdbStore['bills/rooms/15'] = {
      'TGH-256804-15-9999': { status: 'paid', year: 2568, month: 4, totalCharge: 5000 },
    };
    await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }));
    const w = rtdbWrites.find(x => x.op === 'set' && x.path.startsWith('bills/rooms/15/'));
    assert.equal(w, undefined, 'existing paid bill preserved — no duplicate created');
  });

  it('skips the bill for a month before move-in (§7-BBB) but still notifies', async () => {
    // meter month 2568-04 = CE 2025-04; move-in 2025-06 (past vs now) → skip the write
    resetStubs({ tenantLease: { moveInDate: '2025-06-01' } });
    const result = await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }));
    const w = rtdbWrites.find(x => x.op === 'set' && x.path.startsWith('bills/rooms/15/'));
    assert.equal(w, undefined, 'no bill written before move-in');
    assert.equal(result.pushed, 1, 'LINE notify still proceeds (bill write is additive)');
  });

  it('a future move-in boundary does NOT block the bill (renewal-term leak, §7-BBB)', async () => {
    resetStubs({ tenantLease: { moveInDate: '2099-01-01' } });
    await notifyTenantOnMeterUpload(makeRequest({ docId: 'rooms_68_4_15' }));
    const w = rtdbWrites.find(x => x.op === 'set' && x.path === 'bills/rooms/15/TGH-256804-15');
    assert.ok(w, 'future boundary ignored — bill still created');
  });
});
