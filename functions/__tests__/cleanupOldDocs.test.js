/**
 * Unit tests for cleanupOldDocs — three scheduled sweeps + HTTP trigger.
 *
 * Covers:
 *   cleanupRateLimitsScheduled: empty collections, stale/fresh docs with every
 *     supported timestamp shape (Timestamp, ISO string, number), missing fields,
 *     both collections counted together, error propagation.
 *   cleanupMaintenanceRTDBScheduled: empty RTDB, done/pending/completed/resolved
 *     status handling, recency gate, completedAt fallback to updatedAt, null
 *     completedAt skip, invalid date skip, multi-building support.
 *   cleanupLiffUsersRejectedScheduled: empty, stale/fresh Timestamp, stale ISO
 *     string, missing rejectedAt skip.
 *   cleanupOldDocs HTTP: OPTIONS/GET method gates, requireAdmin short-circuit,
 *     POST success shape, one-sweep-throws → 500.
 *
 * Run: node --test functions/__tests__/cleanupOldDocs.test.js
 */
'use strict';

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

// fsState: map of collectionName → array of { id, data }
let fsState = {};

// Track batch operations per collection scan
let batchDeleteRefs = [];
let batchCommitted = false;

// RTDB state: { [building]: { [roomId]: { [ticketId]: ticketData } } }
let rtdbState = {};
let rtdbRemoveCount = 0;

// requireAdmin stub — returns decoded token or null
let requireAdminStub;

function resetStubs() {
  fsState = {};
  batchDeleteRefs = [];
  batchCommitted = false;
  rtdbState = {};
  rtdbRemoveCount = 0;
  requireAdminStub = async (_req, _res) => ({ uid: 'admin1', email: 'admin@test.com' });
}
resetStubs();

// ── Firestore helpers ─────────────────────────────────────────────────────────

function makeFsDoc(id, data) {
  return {
    id,
    data: () => data,
    ref: { _id: id },
  };
}

function makeSnap(docs) {
  return {
    size: docs.length,
    forEach: (fn) => docs.forEach(fn),
  };
}

// Firestore batch stub — accumulates delete refs, tracks commit
const batchStub = {
  delete: (ref) => { batchDeleteRefs.push(ref); },
  commit: async () => { batchCommitted = true; },
};

// Firestore instance stub
const fsInstance = {
  collection: (name) => ({
    // Used by rateLimits + phoneOtpRateLimit (no where, limit then get)
    limit: () => ({
      get: async () => {
        const docs = (fsState[name] || []).map(d => makeFsDoc(d.id, d.data));
        return makeSnap(docs);
      },
    }),
    // Used by liffUsers (where status==rejected, limit, get)
    where: (_field, _op, _val) => ({
      limit: () => ({
        get: async () => {
          const docs = (fsState[name] || []).map(d => makeFsDoc(d.id, d.data));
          return makeSnap(docs);
        },
      }),
    }),
  }),
  batch: () => {
    batchDeleteRefs = [];
    batchCommitted = false;
    return batchStub;
  },
};

// ── RTDB instance stub ────────────────────────────────────────────────────────

const rtdbInstance = {
  ref: (path) => {
    const parts = path.split('/');
    return {
      once: async (_evt) => {
        // path is 'maintenance/{building}' or 'maintenance/{building}/{roomId}/{ticketId}'
        if (parts.length === 2 && parts[0] === 'maintenance') {
          const building = parts[1];
          return { val: () => rtdbState[building] || null };
        }
        return { val: () => null };
      },
      remove: async () => {
        rtdbRemoveCount++;
      },
    };
  },
};

// ── Admin stub ────────────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => fsInstance, {
    Timestamp: {
      fromMillis: (ms) => ({ _ms: ms, toMillis: () => ms }),
    },
    FieldValue: {
      serverTimestamp: () => 'ST',
      increment: (n) => n,
      delete: () => 'DEL',
    },
  }),
  database: () => rtdbInstance,
};

// ── firebase-functions/v1 stub ────────────────────────────────────────────────

// We need to capture scheduled handlers in registration order.
// cleanupOldDocs.js registers: rateLimits (1st), maintenance (2nd), liffRejected (3rd),
// and one HTTP handler.
let scheduledHandlers = [];
let capturedHttpHandler = null;

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const functionsStub = {
  region: () => functionsStub,
  runWith: () => functionsStub,
  pubsub: {
    schedule: () => ({
      timeZone: () => ({
        onRun: (h) => {
          scheduledHandlers.push(h);
          return 'cf';
        },
      }),
    }),
  },
  https: {
    onRequest: (h) => {
      capturedHttpHandler = h;
      return 'cf';
    },
    HttpsError,
  },
};

// ── buildingRegistry stub ─────────────────────────────────────────────────────

const buildingRegistryStub = {
  getAllBuildings: async () => ['rooms', 'nest'],
  getValidBuildings: async () => new Set(['rooms', 'nest']),
};

// ── Module._load intercept ────────────────────────────────────────────────────

const _origLoad = Module._load;

before(() => {
  Module._load = function (request, parent, ...rest) {
    if (request === 'firebase-admin') return adminStub;
    if (request === 'firebase-functions/v1') return functionsStub;
    if (request === './buildingRegistry' || request === 'buildingRegistry') return buildingRegistryStub;
    if (request === './_auth') {
      return {
        requireAdmin: async (req, res) => requireAdminStub(req, res),
      };
    }
    return _origLoad.call(this, request, parent, ...rest);
  };

  // Clear any cached version before loading
  delete require.cache[require.resolve('../cleanupOldDocs.js')];
  require('../cleanupOldDocs.js');
});

after(() => {
  Module._load = _origLoad;
});

beforeEach(() => {
  resetStubs();
});

// ── Request / response helpers ────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return { method: 'POST', body: {}, headers: {}, ...overrides };
}

function makeRes() {
  const r = { _status: null, _body: null, _headers: {} };
  r.set = (k, v) => { r._headers[k] = v; return r; };
  r.status = (code) => {
    r._status = code;
    return {
      json:  (b) => { r._body = b; return r; },
      send:  (b) => { r._body = b; return r; },
    };
  };
  r.json = (b)  => { r._body = b; };
  r.send = (b)  => { r._body = b; };
  return r;
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────

// Produce a Firestore-Timestamp-like object for a given ms
function tsFromMs(ms) {
  return { toMillis: () => ms };
}

// Produce a Date slightly before cutoff (stale) or after (fresh)
const NOW = Date.now();
const STALE_RATE  = NOW - (25 * 60 * 60 * 1000);      // 25h ago  (> 24h cutoff)
const FRESH_RATE  = NOW - (1  * 60 * 60 * 1000);       // 1h ago   (< 24h cutoff)
const STALE_MAINT = NOW - (32 * 24 * 60 * 60 * 1000);  // 32 days ago (> 30d cutoff)
const FRESH_MAINT = NOW - (20 * 24 * 60 * 60 * 1000);  // 20 days ago (< 30d cutoff)
const STALE_LIFF  = NOW - (95 * 24 * 60 * 60 * 1000);  // 95 days ago (> 90d cutoff)
const FRESH_LIFF  = NOW - (60 * 24 * 60 * 60 * 1000);  // 60 days ago (< 90d cutoff)

// ── cleanupRateLimitsScheduled ────────────────────────────────────────────────

describe('cleanupRateLimitsScheduled', () => {
  it('handler is registered (captured at index 0)', () => {
    assert.equal(typeof scheduledHandlers[0], 'function',
      'first scheduled handler must be the rateLimits handler');
  });

  it('empty collections → scanned=0, deleted=0', async () => {
    fsState['rateLimits'] = [];
    fsState['phoneOtpRateLimit'] = [];
    const result = await scheduledHandlers[0]();
    assert.equal(result.scanned, 0);
    assert.equal(result.deleted, 0);
    assert.equal(batchDeleteRefs.length, 0);
  });

  it('stale doc with updatedAt as Timestamp → deleted', async () => {
    fsState['rateLimits'] = [{ id: 'd1', data: { updatedAt: tsFromMs(STALE_RATE) } }];
    fsState['phoneOtpRateLimit'] = [];
    const result = await scheduledHandlers[0]();
    assert.equal(result.deleted, 1);
    // Note: batch() is called once per _purgeStaleRateLimitDocs invocation;
    // checking result.deleted (the queued counter) is more reliable than
    // batchDeleteRefs.length which gets reset on each batch() call.
  });

  it('fresh doc with updatedAt as Timestamp → NOT deleted', async () => {
    fsState['rateLimits'] = [{ id: 'd2', data: { updatedAt: tsFromMs(FRESH_RATE) } }];
    fsState['phoneOtpRateLimit'] = [];
    const result = await scheduledHandlers[0]();
    assert.equal(result.deleted, 0);
    assert.equal(batchDeleteRefs.length, 0);
    assert.equal(batchCommitted, false);
  });

  it('stale doc with updatedAt as ISO string → deleted', async () => {
    fsState['rateLimits'] = [
      { id: 'd3', data: { updatedAt: new Date(STALE_RATE).toISOString() } },
    ];
    fsState['phoneOtpRateLimit'] = [];
    const result = await scheduledHandlers[0]();
    assert.equal(result.deleted, 1);
  });

  it('stale doc with windowStart as number → deleted', async () => {
    fsState['rateLimits'] = [{ id: 'd4', data: { windowStart: STALE_RATE } }];
    fsState['phoneOtpRateLimit'] = [];
    const result = await scheduledHandlers[0]();
    assert.equal(result.deleted, 1);
  });

  it('stale doc with windowStart as Timestamp → deleted', async () => {
    fsState['rateLimits'] = [{ id: 'd5', data: { windowStart: tsFromMs(STALE_RATE) } }];
    fsState['phoneOtpRateLimit'] = [];
    const result = await scheduledHandlers[0]();
    assert.equal(result.deleted, 1);
  });

  it('doc missing both updatedAt and windowStart → skipped (not deleted)', async () => {
    fsState['rateLimits'] = [{ id: 'd6', data: { someOtherField: 'x' } }];
    fsState['phoneOtpRateLimit'] = [];
    const result = await scheduledHandlers[0]();
    assert.equal(result.deleted, 0);
    assert.equal(batchDeleteRefs.length, 0);
  });

  it('stale docs in both collections → counts are summed', async () => {
    fsState['rateLimits'] = [
      { id: 'r1', data: { updatedAt: tsFromMs(STALE_RATE) } },
      { id: 'r2', data: { updatedAt: tsFromMs(STALE_RATE) } },
    ];
    fsState['phoneOtpRateLimit'] = [
      { id: 'p1', data: { updatedAt: tsFromMs(STALE_RATE) } },
    ];
    const result = await scheduledHandlers[0]();
    assert.equal(result.scanned, 3);
    assert.equal(result.deleted, 3);
    assert.equal(result.rateLimits.deleted, 2);
    assert.equal(result.phoneOtpRateLimit.deleted, 1);
  });

  it('CF error propagates (throws)', async () => {
    // Override fsInstance.collection to throw for this test
    const origCollection = fsInstance.collection;
    fsInstance.collection = () => {
      throw new Error('Firestore unavailable');
    };
    await assert.rejects(
      () => scheduledHandlers[0](),
      /Firestore unavailable/
    );
    fsInstance.collection = origCollection;
  });
});

// ── cleanupMaintenanceRTDBScheduled ───────────────────────────────────────────

describe('cleanupMaintenanceRTDBScheduled', () => {
  it('handler is registered (captured at index 1)', () => {
    assert.equal(typeof scheduledHandlers[1], 'function',
      'second scheduled handler must be the maintenance handler');
  });

  it('empty RTDB → scanned=0, deleted=0', async () => {
    rtdbState = {};
    const result = await scheduledHandlers[1]();
    assert.equal(result.scanned, 0);
    assert.equal(result.deleted, 0);
    assert.equal(rtdbRemoveCount, 0);
  });

  it('ticket status=done with old completedAt → remove() called, deleted=1', async () => {
    rtdbState = {
      rooms: {
        '15': {
          't1': { status: 'done', completedAt: new Date(STALE_MAINT).toISOString() },
        },
      },
    };
    const result = await scheduledHandlers[1]();
    assert.equal(result.scanned, 1);
    assert.equal(result.deleted, 1);
    assert.equal(rtdbRemoveCount, 1);
  });

  it('ticket status=pending (even if old) → NOT deleted', async () => {
    rtdbState = {
      rooms: {
        '15': {
          't2': { status: 'pending', completedAt: new Date(STALE_MAINT).toISOString() },
        },
      },
    };
    const result = await scheduledHandlers[1]();
    assert.equal(result.scanned, 1);
    assert.equal(result.deleted, 0);
    assert.equal(rtdbRemoveCount, 0);
  });

  it('ticket status=completed old → deleted', async () => {
    rtdbState = {
      rooms: {
        '15': {
          't3': { status: 'completed', completedAt: new Date(STALE_MAINT).toISOString() },
        },
      },
    };
    const result = await scheduledHandlers[1]();
    assert.equal(result.deleted, 1);
  });

  it('ticket status=resolved old → deleted', async () => {
    rtdbState = {
      rooms: {
        '15': {
          't4': { status: 'resolved', completedAt: new Date(STALE_MAINT).toISOString() },
        },
      },
    };
    const result = await scheduledHandlers[1]();
    assert.equal(result.deleted, 1);
  });

  it('ticket status=done but recent → NOT deleted', async () => {
    rtdbState = {
      rooms: {
        '15': {
          't5': { status: 'done', completedAt: new Date(FRESH_MAINT).toISOString() },
        },
      },
    };
    const result = await scheduledHandlers[1]();
    assert.equal(result.scanned, 1);
    assert.equal(result.deleted, 0);
    assert.equal(rtdbRemoveCount, 0);
  });

  it('ticket status=done, no completedAt, old updatedAt → falls back to updatedAt, deleted', async () => {
    rtdbState = {
      rooms: {
        '15': {
          't6': { status: 'done', updatedAt: new Date(STALE_MAINT).toISOString() },
        },
      },
    };
    const result = await scheduledHandlers[1]();
    assert.equal(result.deleted, 1);
  });

  it('ticket status=done, completedAt=null → completedMs=0 → condition !completedMs → skip', async () => {
    rtdbState = {
      rooms: {
        '15': {
          't7': { status: 'done', completedAt: null },
        },
      },
    };
    const result = await scheduledHandlers[1]();
    assert.equal(result.scanned, 1);
    assert.equal(result.deleted, 0);
  });

  it('ticket status=done, invalid date string → NaN → skip', async () => {
    rtdbState = {
      rooms: {
        '15': {
          't8': { status: 'done', completedAt: 'not-a-date' },
        },
      },
    };
    const result = await scheduledHandlers[1]();
    assert.equal(result.scanned, 1);
    assert.equal(result.deleted, 0);
  });

  it('multi-building: each building iterated, stale done tickets across both deleted', async () => {
    rtdbState = {
      rooms: {
        '15': { 'tA': { status: 'done', completedAt: new Date(STALE_MAINT).toISOString() } },
      },
      nest: {
        'N101': { 'tB': { status: 'done', completedAt: new Date(STALE_MAINT).toISOString() } },
      },
    };
    const result = await scheduledHandlers[1]();
    assert.equal(result.scanned, 2);
    assert.equal(result.deleted, 2);
    assert.equal(rtdbRemoveCount, 2);
  });
});

// ── cleanupLiffUsersRejectedScheduled ─────────────────────────────────────────

describe('cleanupLiffUsersRejectedScheduled', () => {
  it('handler is registered (captured at index 2)', () => {
    assert.equal(typeof scheduledHandlers[2], 'function',
      'third scheduled handler must be the liffUsers rejected handler');
  });

  it('empty liffUsers → scanned=0, deleted=0', async () => {
    fsState['liffUsers'] = [];
    const result = await scheduledHandlers[2]();
    assert.equal(result.scanned, 0);
    assert.equal(result.deleted, 0);
  });

  it('stale rejected doc with rejectedAt as Timestamp → deleted', async () => {
    fsState['liffUsers'] = [
      { id: 'lu1', data: { status: 'rejected', rejectedAt: tsFromMs(STALE_LIFF) } },
    ];
    const result = await scheduledHandlers[2]();
    assert.equal(result.deleted, 1);
    assert.equal(batchCommitted, true);
  });

  it('fresh rejected doc with rejectedAt as Timestamp → NOT deleted', async () => {
    fsState['liffUsers'] = [
      { id: 'lu2', data: { status: 'rejected', rejectedAt: tsFromMs(FRESH_LIFF) } },
    ];
    const result = await scheduledHandlers[2]();
    assert.equal(result.deleted, 0);
    assert.equal(batchCommitted, false);
  });

  it('stale rejected doc with rejectedAt as ISO string → deleted', async () => {
    fsState['liffUsers'] = [
      {
        id: 'lu3',
        data: { status: 'rejected', rejectedAt: new Date(STALE_LIFF).toISOString() },
      },
    ];
    const result = await scheduledHandlers[2]();
    assert.equal(result.deleted, 1);
  });

  it('doc missing rejectedAt → skipped (not deleted)', async () => {
    fsState['liffUsers'] = [
      { id: 'lu4', data: { status: 'rejected' } },
    ];
    const result = await scheduledHandlers[2]();
    assert.equal(result.scanned, 1);
    assert.equal(result.deleted, 0);
    assert.equal(batchCommitted, false);
  });

  it('query already filters by status — batch.delete not called for non-rejected data in snapshot', async () => {
    // Because the where() stub returns all fsState docs regardless, we simulate
    // the "query already filtered" contract by putting only rejected docs in state.
    // This test confirms the JS-level cutoff is the only gate applied post-query.
    fsState['liffUsers'] = [
      { id: 'lu5', data: { status: 'rejected', rejectedAt: tsFromMs(STALE_LIFF) } },
    ];
    const result = await scheduledHandlers[2]();
    assert.equal(result.deleted, 1);
    assert.equal(batchDeleteRefs.length, 1);
  });
});

// ── cleanupOldDocs HTTP handler ───────────────────────────────────────────────

describe('cleanupOldDocs HTTP', () => {
  it('HTTP handler is captured', () => {
    assert.equal(typeof capturedHttpHandler, 'function',
      'cleanupOldDocs HTTP handler must be captured');
  });

  it('OPTIONS → 204', async () => {
    const req = makeReq({ method: 'OPTIONS' });
    const res = makeRes();
    await capturedHttpHandler(req, res);
    assert.equal(res._status, 204);
  });

  it('GET → 405', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    await capturedHttpHandler(req, res);
    assert.equal(res._status, 405);
  });

  it('requireAdmin returns null → short-circuits without running cleanups', async () => {
    requireAdminStub = async (_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    };
    // Poison Firestore so any cleanup attempt would throw
    const origCollection = fsInstance.collection;
    let cleanupAttempted = false;
    fsInstance.collection = (name) => {
      cleanupAttempted = true;
      return origCollection(name);
    };

    const req = makeReq();
    const res = makeRes();
    await capturedHttpHandler(req, res);
    fsInstance.collection = origCollection;

    // res.status(403) was called by requireAdmin stub; cleanups not attempted
    assert.equal(cleanupAttempted, false, 'cleanup must not run when requireAdmin returns null');
  });

  it('POST success → 200 with { success, rateLimits, maintenance, liffRejected }', async () => {
    fsState['rateLimits'] = [];
    fsState['phoneOtpRateLimit'] = [];
    fsState['liffUsers'] = [];
    rtdbState = {};

    const req = makeReq({ method: 'POST' });
    const res = makeRes();
    await capturedHttpHandler(req, res);

    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.success, true);
    assert.ok(body.rateLimits && typeof body.rateLimits === 'object', 'rateLimits key must be present');
    assert.ok(body.maintenance && typeof body.maintenance === 'object', 'maintenance key must be present');
    assert.ok(body.liffRejected && typeof body.liffRejected === 'object', 'liffRejected key must be present');
    assert.ok(typeof body.rateLimits.scanned === 'number');
    assert.ok(typeof body.rateLimits.deleted === 'number');
    assert.ok(typeof body.maintenance.scanned === 'number');
    assert.ok(typeof body.maintenance.deleted === 'number');
    assert.ok(typeof body.liffRejected.scanned === 'number');
    assert.ok(typeof body.liffRejected.deleted === 'number');
  });

  it('one cleanup throws → 500 with error message', async () => {
    // Make Firestore throw on collection access to break rateLimits sweep
    const origCollection = fsInstance.collection;
    fsInstance.collection = () => {
      throw new Error('Simulated Firestore failure');
    };

    const req = makeReq({ method: 'POST' });
    const res = makeRes();
    await capturedHttpHandler(req, res);
    fsInstance.collection = origCollection;

    assert.equal(res._status, 500);
    const body = res._body;
    assert.ok(body.error, 'error field must be present on 500 response');
  });
});
