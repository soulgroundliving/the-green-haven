/**
 * Unit tests for notifyMaintenanceTenant.
 * Run: node --test functions/__tests__/notifyMaintenanceTenant.test.js
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────
// Both `firestore` and `rtdb` are captured as module-level singletons when
// notifyMaintenanceTenant.js is first required, so these closure variables must
// be in place BEFORE the require() call at the bottom of this file.

let stubLiffUsers = [];   // [{ id: string, data: {} }]
let rtdbSetCalls  = [];   // [{ path: string, value: any }]
let fetchResponses = [];  // [{ ok: boolean, status?: number, text?: string }]
let retryCalls    = [];   // [{ ...enqueueLineRetry arg }]

function resetStubs() {
  stubLiffUsers  = [];
  rtdbSetCalls   = [];
  fetchResponses = [];
  retryCalls     = [];
}
resetStubs();

// ── Module._load interception ─────────────────────────────────────────────────
// Must run BEFORE requiring the CF so that the module-level singleton captures
// in notifyMaintenanceTenant.js pick up these stubs.

const Module = require('module');
const _origLoad = Module._load;

Module._load = function (id, parent, ...rest) {
  // ── firebase-admin ──────────────────────────────────────────────────────────
  if (id === 'firebase-admin') {
    // firestore() — returns a query stub whose results come from stubLiffUsers.
    const firestoreStub = () => ({
      collection: () => ({
        where: function () { return this; },
        get: async () => ({
          empty: stubLiffUsers.length === 0,
          docs: stubLiffUsers.map(u => ({ id: u.id, data: () => u.data })),
        }),
      }),
    });

    // database() — captures the path passed to .ref().set() for assertion.
    const rtdbStub = () => ({
      ref: (path) => ({
        set: async (value) => { rtdbSetCalls.push({ path, value }); },
      }),
    });

    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreStub,
      database: rtdbStub,
    };
  }

  // ── firebase-functions/v1 ──────────────────────────────────────────────────
  // Chain: functions.region(...).runWith({...}).https.onCall(fn) → fn directly.
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    const self = {
      region: () => self,
      runWith: () => self,
      https: { onCall: (fn) => fn, HttpsError },
      HttpsError,
    };
    return self;
  }

  // ── _lineRetry ─────────────────────────────────────────────────────────────
  if (id === './_lineRetry') {
    return {
      enqueueLineRetry: async (arg) => { retryCalls.push(arg); },
    };
  }

  return _origLoad.call(this, id, parent, ...rest);
};

// ── global.fetch stub ─────────────────────────────────────────────────────────
// LINE push calls go through global fetch inside the CF.
const origFetch = typeof global.fetch === 'function' ? global.fetch : null;
global.fetch = async (_url, _opts) => {
  const reply = fetchResponses.shift() || { ok: true, status: 200, text: '' };
  return {
    ok: reply.ok,
    status: reply.status || (reply.ok ? 200 : 500),
    text: async () => reply.text || '',
  };
};

after(() => {
  Module._load = _origLoad;
  if (origFetch === null) delete global.fetch;
  else global.fetch = origFetch;
});

// ── Require CF after stubs are installed ──────────────────────────────────────
delete require.cache[require.resolve('../notifyMaintenanceTenant.js')];
const { notifyMaintenanceTenant: handler } = require('../notifyMaintenanceTenant.js');

// ── Context helpers ───────────────────────────────────────────────────────────

function adminCtx(uid = 'admin-uid') {
  return { auth: { uid, token: { admin: true } } };
}
function tenantCtx(uid = 'line:U1') {
  return { auth: { uid, token: {} } };
}
const noAuth = { auth: null };

// Valid payload that satisfies all required-field checks
const validData = {
  ticketId: 'T001',
  building: 'rooms',
  roomId: '15',
  newStatus: 'done',
  category: 'electric',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('notifyMaintenanceTenant', () => {
  beforeEach(() => {
    resetStubs();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token-abc';
  });

  // 1. Unauthenticated caller
  it('throws unauthenticated when no auth context is provided', async () => {
    await assert.rejects(
      () => handler(validData, noAuth),
      (err) => {
        assert.equal(err.code, 'unauthenticated');
        return true;
      }
    );
  });

  // 2. Non-admin caller
  it('throws permission-denied when caller is not an admin', async () => {
    await assert.rejects(
      () => handler(validData, tenantCtx()),
      (err) => {
        assert.equal(err.code, 'permission-denied');
        return true;
      }
    );
  });

  // 3. Missing required field — ticketId omitted
  it('throws invalid-argument when ticketId is missing', async () => {
    const { ticketId: _dropped, ...withoutTicketId } = validData;
    await assert.rejects(
      () => handler(withoutTicketId, adminCtx()),
      (err) => {
        assert.equal(err.code, 'invalid-argument');
        return true;
      }
    );
  });

  // 3b. Missing required field — building omitted
  it('throws invalid-argument when building is missing', async () => {
    const { building: _dropped, ...withoutBuilding } = validData;
    await assert.rejects(
      () => handler(withoutBuilding, adminCtx()),
      (err) => {
        assert.equal(err.code, 'invalid-argument');
        return true;
      }
    );
  });

  // 3c. Missing required field — roomId omitted
  it('throws invalid-argument when roomId is missing', async () => {
    const { roomId: _dropped, ...withoutRoom } = validData;
    await assert.rejects(
      () => handler(withoutRoom, adminCtx()),
      (err) => {
        assert.equal(err.code, 'invalid-argument');
        return true;
      }
    );
  });

  // 3d. Missing required field — newStatus omitted
  it('throws invalid-argument when newStatus is missing', async () => {
    const { newStatus: _dropped, ...withoutStatus } = validData;
    await assert.rejects(
      () => handler(withoutStatus, adminCtx()),
      (err) => {
        assert.equal(err.code, 'invalid-argument');
        return true;
      }
    );
  });

  // 4. LINE token not set
  it('returns { sent: 0 } when LINE_CHANNEL_ACCESS_TOKEN env var is absent', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const result = await handler(validData, adminCtx());
    assert.deepEqual(result, { sent: 0 });
    // No fetch calls should have been made
    assert.equal(fetchResponses.length, 0, 'fetch must not have been consumed');
  });

  // 5. No approved LINE users for the room
  it('returns { sent: 0 } when no approved LINE-linked users exist for the room', async () => {
    stubLiffUsers = [];   // empty — query returns nothing
    const result = await handler(validData, adminCtx());
    assert.deepEqual(result, { sent: 0 });
    assert.equal(rtdbSetCalls.length, 0, 'RTDB must not be written when nobody was notified');
  });

  // 6. Happy path — one approved user, fetch succeeds
  it('sends notification and returns { sent: 1 } when one approved user is found', async () => {
    stubLiffUsers = [{ id: 'UABC123', data: {} }];
    fetchResponses = [{ ok: true }];

    const result = await handler(validData, adminCtx());

    assert.deepEqual(result, { sent: 1 });
    // The RTDB statusNotifiedAt path must include building/roomId/ticketId
    assert.equal(rtdbSetCalls.length, 1, 'statusNotifiedAt must be written after a successful send');
    assert.ok(
      rtdbSetCalls[0].path.includes('maintenance/rooms/15/T001/statusNotifiedAt'),
      `unexpected RTDB path: ${rtdbSetCalls[0].path}`
    );
    assert.ok(
      typeof rtdbSetCalls[0].value === 'string' && rtdbSetCalls[0].value.length > 0,
      'statusNotifiedAt value must be a non-empty ISO timestamp string'
    );
  });

  // 6b. Happy path — multiple approved users
  it('returns { sent: N } matching the number of successful LINE pushes', async () => {
    stubLiffUsers = [
      { id: 'UA', data: {} },
      { id: 'UB', data: {} },
    ];
    fetchResponses = [{ ok: true }, { ok: true }];

    const result = await handler(validData, adminCtx());

    assert.equal(result.sent, 2);
    assert.equal(rtdbSetCalls.length, 1, 'statusNotifiedAt written once regardless of user count');
  });

  // 7. Fetch failure → enqueueLineRetry called, sent = 0
  it('enqueues a retry and returns { sent: 0 } when LINE push fails', async () => {
    stubLiffUsers = [{ id: 'UFAIL', data: {} }];
    fetchResponses = [{ ok: false, status: 500, text: 'Internal Server Error' }];

    const result = await handler(validData, adminCtx());

    assert.equal(result.sent, 0);
    assert.equal(retryCalls.length, 1, 'enqueueLineRetry must be called once');
    assert.equal(retryCalls[0].lineUserId, 'UFAIL');
    assert.ok(
      retryCalls[0].idempotencyKey.includes('T001'),
      `idempotency key must embed ticketId; got: ${retryCalls[0].idempotencyKey}`
    );
    assert.equal(retryCalls[0].context.source, 'notifyMaintenanceTenant');
    // No RTDB write because sent === 0
    assert.equal(rtdbSetCalls.length, 0);
  });

  // 8. Mixed result — one succeeds, one fails
  it('counts only fulfilled pushes and enqueues retries for failures', async () => {
    stubLiffUsers = [
      { id: 'UPASS', data: {} },
      { id: 'UFAIL', data: {} },
    ];
    // First fetch succeeds, second fails
    fetchResponses = [
      { ok: true },
      { ok: false, status: 429, text: 'Too Many Requests' },
    ];

    const result = await handler(validData, adminCtx());

    assert.equal(result.sent, 1);
    assert.equal(retryCalls.length, 1);
    assert.equal(retryCalls[0].lineUserId, 'UFAIL');
    // RTDB must be written because sent > 0
    assert.equal(rtdbSetCalls.length, 1);
  });

  // 9. STATUS_LABEL unknown value — newStatus not in the map
  it('falls back to raw newStatus string when status label is not in the map', async () => {
    stubLiffUsers = [{ id: 'UA', data: {} }];
    fetchResponses = [{ ok: true }];
    const customStatus = 'awaiting_parts';

    const result = await handler({ ...validData, newStatus: customStatus }, adminCtx());
    assert.equal(result.sent, 1);
    // Handler must not throw; the message body uses the raw newStatus as fallback
  });

  // 10. CATEGORY_LABEL unknown value — category not in the map
  it('falls back to raw category string when category label is not in the map', async () => {
    stubLiffUsers = [{ id: 'UA', data: {} }];
    fetchResponses = [{ ok: true }];

    const result = await handler({ ...validData, category: 'elevator' }, adminCtx());
    assert.equal(result.sent, 1);
  });

  // 11. No category provided — defaults to 'งานซ่อม'
  it('uses default category label when category field is absent', async () => {
    stubLiffUsers = [{ id: 'UA', data: {} }];
    fetchResponses = [{ ok: true }];
    const { category: _dropped, ...withoutCategory } = validData;

    const result = await handler(withoutCategory, adminCtx());
    assert.equal(result.sent, 1);
  });
});
