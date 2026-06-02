/**
 * Unit tests for notifyTenantOnMeterUpload.js
 *
 * Design notes:
 *   - admin.firestore() is called at MODULE LOAD TIME (singleton), so
 *     Module._load intercept must be installed BEFORE the require().
 *   - LINE_TOKEN.value() is read inside notifyOne at call time, so
 *     lineTokenValue is read via closure and can be changed per test.
 *   - _lineRetry is lazily required inside notifyOne; Module._load must
 *     stay active for the full test lifetime to intercept it.
 *   - global.fetch is overridden to simulate LINE API responses.
 *   - All mutable stub state lives in per-test closure vars reset in resetStubs().
 *
 * Run: node --test functions/__tests__/notifyTenantOnMeterUpload.test.js
 */

'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state (reset per test) ────────────────────────────────────────────────

let meterDataState;     // { [docId]: data } — null means doc not found
let docUpdateArgs;      // { [docId]: last update call args }
let tenantSnapState;    // { [`${building}/${roomId}`]: data }
let liffUsersState;     // array of { id: lineUserId }
let liffUsersThrow;     // Error or null
let lineTokenValue;     // string
let loadRoomConfigResult;
let computeBillResult;
let buildBillFlexResult;
let enqueueLineRetryArgs;
let fetchResponses;     // array of { ok, status, body } — consumed in order
let fetchCallCount;
let fetchCallArgs;      // array of { url, opts }
let invoicesState;      // { [key]: invoice doc } — Roadmap 1.2 mint
let countersState;      // { [counterId]: { seq } }
let auditWrites;        // array of { id, data } written to actionAudit
let buildBillFlexCalls; // array of { bill, opts } — assert invoiceNo passed through
let autoIdSeq;          // actionAudit server-autoId counter

function resetStubs() {
  meterDataState = {
    'rooms_69_5_15': {
      building: 'rooms', roomId: '15', year: 69, month: 5,
      eOld: 100, eNew: 150, wOld: 30, wNew: 35,
      notifiedAt: null, lastNotifiedSignature: null
    }
  };
  docUpdateArgs = {};
  tenantSnapState = {
    'rooms/15': { name: 'สมชาย' }
  };
  liffUsersState = [{ id: 'Uabc123' }];
  liffUsersThrow = null;
  lineTokenValue = 'tok123';
  loadRoomConfigResult = { rentPrice: 3000, electricRate: 8, waterRate: 20 };
  // Full computeBill output shape (year already 4-digit BE) so the invoice mint
  // path (Roadmap 1.2) exercises real be/period derivation.
  computeBillResult = {
    building: 'rooms', room: '15', year: 2569, month: 5,
    rent: 3000, eCost: 400, wCost: 100, trash: 20, eUnits: 50, wUnits: 5,
    totalCharge: 3520, dueDate: '2026-06-05',
  };
  buildBillFlexResult = { type: 'flex', altText: 'bill' };
  enqueueLineRetryArgs = [];
  fetchResponses = [];
  fetchCallCount = 0;
  fetchCallArgs = [];
  invoicesState = {};
  countersState = {};
  auditWrites = [];
  buildBillFlexCalls = [];
  autoIdSeq = 0;
}

resetStubs();

// ── Firestore stub (module-load-time singleton) ────────────────────────────────

const firestoreStub = {
  collection: (name) => {
    if (name === 'meter_data') {
      return {
        doc: (docId) => ({
          get: async () => {
            const data = meterDataState[docId];
            return { exists: !!data, data: () => data || {} };
          },
          update: async (args) => {
            docUpdateArgs[docId] = args;
          },
        }),
      };
    }
    if (name === 'tenants') {
      return {
        doc: (building) => ({
          collection: (_sub) => ({
            doc: (roomId) => ({
              get: async () => {
                const key = `${building}/${roomId}`;
                const data = tenantSnapState[key];
                return { exists: !!data, data: () => data || {} };
              },
            }),
          }),
        }),
      };
    }
    if (name === 'liffUsers') {
      const terminal = {
        get: async () => {
          if (liffUsersThrow) throw liffUsersThrow;
          return {
            empty: liffUsersState.length === 0,
            docs: liffUsersState.map(u => ({ id: u.id })),
          };
        },
      };
      const chainable = { where: () => chainable, get: terminal.get };
      return { where: () => chainable };
    }
    // Roadmap 1.2 — invoice mint collections (ref-tagged so the tx stub routes them).
    if (name === 'invoices')    return { doc: (id) => ({ _coll: 'invoices', _id: id }) };
    if (name === 'counters')    return { doc: (id) => ({ _coll: 'counters', _id: id }) };
    if (name === 'actionAudit') return { doc: (id) => ({ _coll: 'actionAudit', _id: id || `audit_${++autoIdSeq}` }) };
    return { doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), update: async () => {} }) };
  },
  // Roadmap 1.2 — issueInvoiceNo runs the mint inside firestore.runTransaction.
  runTransaction: async (fn) => {
    const tx = {
      get: async (ref) => {
        if (ref && ref._coll === 'invoices') {
          const d = invoicesState[ref._id];
          return { exists: !!d, data: () => d || {} };
        }
        if (ref && ref._coll === 'counters') {
          const d = countersState[ref._id];
          return { exists: !!d, data: () => d || {} };
        }
        return { exists: false, data: () => ({}) };
      },
      set: (ref, data, opts) => {
        if (!ref) return;
        if (ref._coll === 'invoices') {
          invoicesState[ref._id] = (opts && opts.merge)
            ? { ...(invoicesState[ref._id] || {}), ...data }
            : data;
        } else if (ref._coll === 'counters') {
          countersState[ref._id] = (opts && opts.merge)
            ? { ...(countersState[ref._id] || {}), ...data }
            : data;
        } else if (ref._coll === 'actionAudit') {
          auditWrites.push({ id: ref._id, data });
        }
      },
    };
    return fn(tx);
  },
};

// ── firebase-admin stub ────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => firestoreStub, {
    FieldValue: {
      serverTimestamp: () => '__SERVER_TS__',
      increment: (n) => n,
      delete: () => '__DELETE__',
    },
    Timestamp: { fromMillis: (ms) => ms },
  }),
};

// ── HttpsError class ───────────────────────────────────────────────────────────

class HttpsError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}

// ── Callable handler capture ───────────────────────────────────────────────────

let capturedHandler = null;

// ── Module._load intercept ─────────────────────────────────────────────────────
// Must be installed BEFORE require('../notifyTenantOnMeterUpload') so that all
// module-level calls (admin.firestore(), require('./_billFlex'), defineSecret)
// are intercepted.  Left active after initial require so the lazy
// require('./_lineRetry') inside notifyOne is also caught.

const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;

  if (request === 'firebase-functions/v2/https') {
    return {
      onCall: (opts, handler) => {
        capturedHandler = handler;
        return 'cf';
      },
      HttpsError,
    };
  }

  if (request === 'firebase-functions/params') {
    return {
      defineSecret: (_name) => ({
        value: () => lineTokenValue,
      }),
    };
  }

  // _billFlex — top-level require in CF
  if (
    request === './_billFlex' ||
    request.replace(/\\/g, '/').endsWith('/_billFlex') ||
    request.replace(/\\/g, '/').endsWith('/_billFlex.js')
  ) {
    return {
      loadRoomConfig: async (_building, _roomId) => loadRoomConfigResult,
      computeBill: (_data, _cfg) => computeBillResult,
      buildBillFlex: (bill, opts) => { buildBillFlexCalls.push({ bill, opts: opts || {} }); return buildBillFlexResult; },
    };
  }

  // _lineRetry — lazy require inside notifyOne body
  if (
    request === './_lineRetry' ||
    request.replace(/\\/g, '/').endsWith('/_lineRetry') ||
    request.replace(/\\/g, '/').endsWith('/_lineRetry.js')
  ) {
    return {
      enqueueLineRetry: async (args) => {
        enqueueLineRetryArgs.push(args);
      },
    };
  }

  return _origLoad.apply(this, arguments);
};

// ── global.fetch stub ──────────────────────────────────────────────────────────

const _origFetch = typeof global.fetch === 'function' ? global.fetch : null;

global.fetch = async (url, opts) => {
  fetchCallArgs.push({ url, opts });
  const resp = fetchResponses[fetchCallCount] || { ok: true, status: 200, body: '' };
  fetchCallCount++;
  return {
    ok: resp.ok,
    status: resp.status,
    text: async () => resp.body || '',
  };
};

// ── Load CF (stubs already in place) ──────────────────────────────────────────
delete require.cache[require.resolve('../notifyTenantOnMeterUpload.js')];
require('../notifyTenantOnMeterUpload.js');
// Module._load left active intentionally — lazy _lineRetry require inside notifyOne
// must be intercepted during each test invocation.

after(() => {
  Module._load = _origLoad;
  if (_origFetch === null) delete global.fetch;
  else global.fetch = _origFetch;
});

// ── Invocation helpers ─────────────────────────────────────────────────────────

function makeRequest(data, isAdmin = true) {
  return {
    auth: isAdmin ? { token: { admin: true } } : { token: { admin: false } },
    data: data || {},
  };
}

function makeNoAuthRequest(data) {
  return { auth: null, data: data || {} };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('notifyTenantOnMeterUpload', () => {

  // ── Auth gate ─────────────────────────────────────────────────────────────────

  describe('auth gate', () => {
    beforeEach(() => { resetStubs(); });

    it('throws permission-denied when auth is null', async () => {
      await assert.rejects(
        () => capturedHandler(makeNoAuthRequest({ docId: 'rooms_69_5_15' })),
        (err) => {
          assert.equal(err.code, 'permission-denied');
          return true;
        }
      );
    });

    it('throws permission-denied when auth.token.admin is false', async () => {
      await assert.rejects(
        () => capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }, false)),
        (err) => {
          assert.equal(err.code, 'permission-denied');
          return true;
        }
      );
    });

    it('proceeds when auth.token.admin is true', async () => {
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.ok(result, 'should return a result object');
      assert.ok('count' in result, 'result must have count field');
    });
  });

  // ── Invoice numbering (gapless INV-, Roadmap 1.2) ───────────────────────────────

  describe('invoice numbering (gapless INV-, Roadmap 1.2)', () => {
    beforeEach(() => { resetStubs(); });

    it('mints INV-{building}-{BE}-00001 on first notify + persists invoices/{key}', async () => {
      await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      const inv = invoicesState['rooms_15_256905'];
      assert.ok(inv, 'invoices/rooms_15_256905 must be persisted');
      assert.equal(inv.invoiceNo, 'INV-rooms-2569-00001');
      assert.equal(inv.status, 'issued');
      assert.equal(inv.building, 'rooms');
      assert.equal(inv.room, '15');
      assert.equal(inv.period, '256905');
      assert.equal(inv.amount, 3520);
      assert.equal(countersState['invoice_rooms_2569'].seq, 1);
    });

    it('passes the minted invoiceNo into buildBillFlex', async () => {
      await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      const call = buildBillFlexCalls[buildBillFlexCalls.length - 1];
      assert.ok(call, 'buildBillFlex must be called');
      assert.equal(call.opts.invoiceNo, 'INV-rooms-2569-00001');
    });

    it('writes one BILL_ISSUED audit row with server-stamped actor + deterministic key', async () => {
      await capturedHandler({
        auth: { uid: 'admin-uid-1', token: { admin: true, email: 'a@x.io' } },
        data: { docId: 'rooms_69_5_15' },
      });
      const audit = auditWrites.find(w => w.data.action === 'BILL_ISSUED');
      assert.ok(audit, 'a BILL_ISSUED audit row must be written');
      assert.equal(audit.data.actor, 'admin-uid-1');
      assert.equal(audit.data.actorEmail, 'a@x.io');
      assert.equal(audit.data.actorRole, 'admin');
      assert.equal(audit.data.targetType, 'invoice');
      assert.equal(audit.data.targetId, 'INV-rooms-2569-00001');
      assert.equal(audit.id, 'invoice-rooms_15_256905'); // deterministic idempotency key
    });

    it('re-notify for the same period reuses the number + burns no counter (idempotent)', async () => {
      await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      meterDataState['rooms_69_5_15'].eNew = 999; // meter changed → force a re-notify
      auditWrites.length = 0;
      await capturedHandler(makeRequest({ docId: 'rooms_69_5_15', force: true }));
      assert.equal(invoicesState['rooms_15_256905'].invoiceNo, 'INV-rooms-2569-00001');
      assert.equal(countersState['invoice_rooms_2569'].seq, 1, 'counter must NOT increment on re-notify');
      assert.equal(
        auditWrites.filter(w => w.data.action === 'BILL_ISSUED').length, 0,
        'no second BILL_ISSUED on re-notify'
      );
    });

    it('does NOT mint when the room has no approved tenant (no number burned)', async () => {
      liffUsersState = [];
      await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(Object.keys(invoicesState).length, 0, 'no invoice persisted');
      assert.equal(countersState['invoice_rooms_2569'], undefined, 'counter untouched');
    });

    it('consecutive different rooms get consecutive gapless numbers', async () => {
      meterDataState['rooms_69_5_16'] = {
        building: 'rooms', roomId: '16', year: 69, month: 5,
        eOld: 0, eNew: 10, wOld: 0, wNew: 2, notifiedAt: null, lastNotifiedSignature: null,
      };
      tenantSnapState['rooms/16'] = { name: 'สมหญิง' };
      await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      await capturedHandler(makeRequest({ docId: 'rooms_69_5_16' }));
      assert.equal(invoicesState['rooms_15_256905'].invoiceNo, 'INV-rooms-2569-00001');
      assert.equal(invoicesState['rooms_16_256905'].invoiceNo, 'INV-rooms-2569-00002');
      assert.equal(countersState['invoice_rooms_2569'].seq, 2);
    });

    it('a mint failure is non-fatal — notification still proceeds', async () => {
      computeBillResult = { ...computeBillResult, year: undefined }; // breaks be derivation
      fetchResponses = [{ ok: true, status: 200, body: '' }];
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(Object.keys(invoicesState).length, 0, 'no invoice persisted on failure');
      assert.equal(result.pushed, 1, 'tenant is still notified despite the mint failure');
      const call = buildBillFlexCalls[buildBillFlexCalls.length - 1];
      assert.equal(call.opts.invoiceNo, null, 'Flex falls back to the legacy ref (invoiceNo null)');
    });
  });

  // ── docId resolution ──────────────────────────────────────────────────────────

  describe('docId resolution', () => {
    beforeEach(() => { resetStubs(); });

    it('throws invalid-argument when no docId/docIds/building args provided', async () => {
      await assert.rejects(
        () => capturedHandler(makeRequest({})),
        (err) => {
          assert.equal(err.code, 'invalid-argument');
          return true;
        }
      );
    });

    it('uses docId directly when docId is provided', async () => {
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.count, 1);
      assert.equal(result.results[0].docId, 'rooms_69_5_15');
    });

    it('processes all items in docIds array', async () => {
      meterDataState['nest_69_6_1'] = {
        building: 'nest', roomId: '1', year: 69, month: 6,
        eOld: 200, eNew: 250, wOld: 50, wNew: 55,
        notifiedAt: null, lastNotifiedSignature: null
      };
      const result = await capturedHandler(makeRequest({
        docIds: ['rooms_69_5_15', 'nest_69_6_1']
      }));
      assert.equal(result.count, 2);
      assert.equal(result.results.length, 2);
      assert.equal(result.results[0].docId, 'rooms_69_5_15');
      assert.equal(result.results[1].docId, 'nest_69_6_1');
    });

    it('constructs docId from building + year + month + roomId params', async () => {
      const result = await capturedHandler(makeRequest({
        building: 'rooms', year: 69, month: 5, roomId: '15'
      }));
      assert.equal(result.count, 1);
      assert.equal(result.results[0].docId, 'rooms_69_5_15');
    });

    it('filters null/falsy items out of docIds array', async () => {
      const result = await capturedHandler(makeRequest({
        docIds: [null, 'rooms_69_5_15', null, undefined, '']
      }));
      assert.equal(result.count, 1, 'only the valid docId should be processed');
      assert.equal(result.results[0].docId, 'rooms_69_5_15');
    });
  });

  // ── notifyOne — doc missing ───────────────────────────────────────────────────

  describe('notifyOne — doc missing', () => {
    beforeEach(() => { resetStubs(); });

    it('returns skipped: doc_not_found when meter_data doc does not exist', async () => {
      delete meterDataState['rooms_69_5_15'];
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.results[0].skipped, 'doc_not_found');
      assert.equal(result.skipped, 1);
    });
  });

  // ── notifyOne — idempotency ───────────────────────────────────────────────────

  describe('notifyOne — idempotency', () => {
    beforeEach(() => { resetStubs(); });

    it('skips when already notified with same meter signature and no force', async () => {
      meterDataState['rooms_69_5_15'] = {
        building: 'rooms', roomId: '15', year: 69, month: 5,
        eOld: 100, eNew: 150, wOld: 30, wNew: 35,
        notifiedAt: Date.now(),
        lastNotifiedSignature: '100|150|30|35'
      };
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.results[0].skipped, 'already_notified');
      assert.equal(fetchCallCount, 0, 'must not call LINE API');
    });

    it('proceeds when force=true even if signature matches', async () => {
      meterDataState['rooms_69_5_15'] = {
        building: 'rooms', roomId: '15', year: 69, month: 5,
        eOld: 100, eNew: 150, wOld: 30, wNew: 35,
        notifiedAt: Date.now(),
        lastNotifiedSignature: '100|150|30|35'
      };
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15', force: true }));
      assert.notEqual(result.results[0].skipped, 'already_notified', 'force=true must bypass idempotency');
    });

    it('proceeds when notifiedAt is set but signature differs', async () => {
      meterDataState['rooms_69_5_15'] = {
        building: 'rooms', roomId: '15', year: 69, month: 5,
        eOld: 100, eNew: 160, wOld: 30, wNew: 35,
        notifiedAt: Date.now(),
        lastNotifiedSignature: '100|150|30|35'  // old signature
      };
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.notEqual(result.results[0].skipped, 'already_notified', 'different signature must not skip');
    });
  });

  // ── notifyOne — missing fields ────────────────────────────────────────────────

  describe('notifyOne — missing fields', () => {
    beforeEach(() => { resetStubs(); });

    it('skips when building is missing', async () => {
      meterDataState['rooms_69_5_15'] = {
        roomId: '15', year: 69, month: 5,
        eOld: 100, eNew: 150, wOld: 30, wNew: 35
      };
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.results[0].skipped, 'missing_fields');
    });

    it('skips when roomId is null', async () => {
      meterDataState['rooms_69_5_15'] = {
        building: 'rooms', roomId: null, year: 69, month: 5,
        eOld: 100, eNew: 150, wOld: 30, wNew: 35
      };
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.results[0].skipped, 'missing_fields');
    });
  });

  // ── notifyOne — computeBill returns null ──────────────────────────────────────

  describe('notifyOne — computeBill null', () => {
    beforeEach(() => { resetStubs(); });

    it('skips when computeBill returns null (rent_zero)', async () => {
      computeBillResult = null;
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.results[0].skipped, 'rent_zero');
    });
  });

  // ── notifyOne — no LINE token ─────────────────────────────────────────────────

  describe('notifyOne — no LINE token', () => {
    beforeEach(() => { resetStubs(); });

    it('skips when lineTokenValue is empty string', async () => {
      lineTokenValue = '';
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.results[0].skipped, 'no_line_token');
      assert.equal(fetchCallCount, 0, 'must not call LINE API');
    });
  });

  // ── notifyOne — no approved tenants ──────────────────────────────────────────

  describe('notifyOne — no approved tenants', () => {
    beforeEach(() => { resetStubs(); });

    it('skips with no_approved_tenant and calls docRef.update with notifiedSkipReason', async () => {
      liffUsersState = [];
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.results[0].skipped, 'no_approved_tenant');
      assert.equal(result.skipped, 1);
      const upd = docUpdateArgs['rooms_69_5_15'];
      assert.ok(upd, 'docRef.update must be called');
      assert.equal(upd.notifiedSkipReason, 'no_approved_tenant');
      assert.equal(upd.notifiedAt, '__SERVER_TS__');
      assert.equal(fetchCallCount, 0, 'must not call LINE API');
    });
  });

  // ── notifyOne — liffUsers query throws ────────────────────────────────────────

  describe('notifyOne — liffUsers query throws', () => {
    beforeEach(() => { resetStubs(); });

    it('returns error containing liffUsers_query_failed when query throws', async () => {
      liffUsersThrow = new Error('index missing');
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      const r = result.results[0];
      assert.ok(r.error, 'result must have an error field');
      assert.ok(
        r.error.includes('liffUsers_query_failed'),
        `error must contain 'liffUsers_query_failed', got: ${r.error}`
      );
    });
  });

  // ── notifyOne — successful push ───────────────────────────────────────────────

  describe('notifyOne — successful push', () => {
    beforeEach(() => { resetStubs(); });

    it('returns pushed=1, writes notifiedCount and signature to docRef', async () => {
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.pushed, 1);
      assert.equal(result.failed, 0);
      assert.equal(fetchCallCount, 1, 'exactly one LINE API call');
      assert.ok(fetchCallArgs[0].url.includes('api.line.me'), 'must call LINE API URL');
      const upd = docUpdateArgs['rooms_69_5_15'];
      assert.ok(upd, 'docRef.update must be called');
      assert.equal(upd.notifiedCount, 1);
      assert.equal(upd.notifiedAt, '__SERVER_TS__');
      assert.equal(upd.lastNotifiedSignature, '100|150|30|35', 'writes correct signature');
    });
  });

  // ── notifyOne — push failure triggers retry ───────────────────────────────────

  describe('notifyOne — push failure', () => {
    beforeEach(() => { resetStubs(); });

    it('returns pushed=0, failed=1 and calls enqueueLineRetry when fetch returns non-ok', async () => {
      fetchResponses = [{ ok: false, status: 400, body: 'bad request' }];
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.pushed, 0);
      assert.equal(result.failed, 1);
      assert.equal(enqueueLineRetryArgs.length, 1, 'enqueueLineRetry must be called once');
      const payload = enqueueLineRetryArgs[0];
      assert.equal(payload.lineUserId, 'Uabc123', 'must pass correct lineUserId');
      assert.ok(typeof payload.idempotencyKey === 'string' && payload.idempotencyKey.length > 0);
      assert.ok(payload.context, 'context must be present');
      assert.equal(payload.context.source, 'notifyTenantOnMeterUpload');
    });
  });

  // ── notifyOne — mixed push results ────────────────────────────────────────────

  describe('notifyOne — mixed push results', () => {
    beforeEach(() => { resetStubs(); });

    it('returns pushed=1, failed=1, enqueueLineRetry called once for 2 users (first ok, second fails)', async () => {
      liffUsersState = [{ id: 'Uabc123' }, { id: 'Udef456' }];
      fetchResponses = [
        { ok: true, status: 200, body: '' },
        { ok: false, status: 500, body: 'server error' },
      ];
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.equal(result.pushed, 1);
      assert.equal(result.failed, 1);
      assert.equal(enqueueLineRetryArgs.length, 1, 'enqueueLineRetry called once for the failed user');
    });
  });

  // ── Top-level aggregation ─────────────────────────────────────────────────────

  describe('top-level aggregation', () => {
    beforeEach(() => { resetStubs(); });

    it('aggregates pushed and skipped counts across multiple docIds', async () => {
      // rooms_69_5_15 → will push (default stubs: liffUsers has 1 user, fetch ok)
      // rooms_69_5_99 → doc not found → skipped
      const result = await capturedHandler(makeRequest({
        docIds: ['rooms_69_5_15', 'rooms_69_5_99']
      }));
      assert.equal(result.count, 2);
      assert.equal(result.pushed, 1);
      assert.equal(result.skipped, 1);
      assert.equal(result.results.length, 2);
    });

    it('captures error per-docId without crashing when notifyOne throws internally', async () => {
      // The CF wraps each notifyOne in try/catch:
      //   try { results.push(await notifyOne(...)) } catch(e) { results.push({ docId, error: e.message }) }
      // To trigger the catch we need notifyOne to throw (not just return an error object).
      // loadRoomConfig is awaited directly inside notifyOne (not inside Promise.allSettled),
      // so throwing from it will propagate as an uncaught throw to the outer for-loop catch.
      // We inject a throw via loadRoomConfigResult being a special sentinel and overriding
      // the _billFlex stub via Module._load for this one call.

      // Temporarily override _billFlex to throw from loadRoomConfig
      const _savedLoad = Module._load;
      let loadConfigCallCount = 0;
      Module._load = function (request, parent, ...rest) {
        if (
          request === './_billFlex' ||
          request.replace(/\\/g, '/').endsWith('/_billFlex') ||
          request.replace(/\\/g, '/').endsWith('/_billFlex.js')
        ) {
          return {
            loadRoomConfig: async () => { throw new Error('simulated loadRoomConfig failure'); },
            computeBill: (_data, _cfg) => computeBillResult,
            buildBillFlex: (_bill, _opts) => buildBillFlexResult,
          };
        }
        if (request === 'firebase-admin') return adminStub;
        if (request === 'firebase-functions/v2/https') {
          return { onCall: (opts, h) => { capturedHandler = h; return 'cf'; }, HttpsError };
        }
        if (request === 'firebase-functions/params') {
          return { defineSecret: (_name) => ({ value: () => lineTokenValue }) };
        }
        if (
          request === './_lineRetry' ||
          request.replace(/\\/g, '/').endsWith('/_lineRetry') ||
          request.replace(/\\/g, '/').endsWith('/_lineRetry.js')
        ) {
          return { enqueueLineRetry: async (args) => { enqueueLineRetryArgs.push(args); } };
        }
        return _savedLoad.apply(this, arguments);
      };

      // Re-require the CF with the new stub in place
      delete require.cache[require.resolve('../notifyTenantOnMeterUpload.js')];
      require('../notifyTenantOnMeterUpload.js');

      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));

      // Restore the original Module._load
      Module._load = _savedLoad;
      // Re-require back with original stubs for subsequent tests
      delete require.cache[require.resolve('../notifyTenantOnMeterUpload.js')];
      require('../notifyTenantOnMeterUpload.js');

      const r = result.results[0];
      assert.ok(r.error, 'result must have error field when notifyOne throws');
      assert.equal(r.docId, 'rooms_69_5_15');
      assert.ok(r.error.includes('simulated loadRoomConfig failure'), `unexpected error: ${r.error}`);
    });
  });

  // ── Returned shape ─────────────────────────────────────────────────────────────

  describe('returned shape', () => {
    beforeEach(() => { resetStubs(); });

    it('returns { count, pushed, failed, skipped, results } with correct types', async () => {
      const result = await capturedHandler(makeRequest({ docId: 'rooms_69_5_15' }));
      assert.ok(typeof result.count === 'number', 'count must be a number');
      assert.ok(typeof result.pushed === 'number', 'pushed must be a number');
      assert.ok(typeof result.failed === 'number', 'failed must be a number');
      assert.ok(typeof result.skipped === 'number', 'skipped must be a number');
      assert.ok(Array.isArray(result.results), 'results must be an array');
      assert.equal(result.count, 1);
    });
  });
});
