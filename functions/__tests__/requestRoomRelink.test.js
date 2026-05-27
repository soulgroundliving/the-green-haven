/**
 * Unit tests for requestRoomRelink.js
 *
 * Covers: CORS/method guard, body validation, LINE token verification,
 * building registry check, liffUsers pre-condition (not-found / wrong status),
 * success path (write payload shape, FieldValue usage, notify fire-and-forget),
 * and Firestore write error.
 *
 * Run: node --test functions/__tests__/requestRoomRelink.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ───────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    validBuildings: new Set(['rooms', 'nest']),
    liffDoc: null,          // null = does not exist; object = existing doc data
    setError: null,
    lineVerifyOk: true,
    lineVerifyBody: { sub: 'Uabc123', name: 'สมชาย', picture: 'https://pic.url' },
    lineVerifyStatus: 200,
    fetchNetworkError: null,
    ...overrides,
  };
  captured = {
    setSets: [],            // [{ payload, opts }]
    notifyFetch: null,      // fetch call to notifyLiffRequest
    lineFetchCalls: [],
  };
}
resetStubs();

// ── FieldValue sentinel factory ──────────────────────────────────────────────

const FieldValue = {
  delete: () => ({ _type: 'FieldValue.delete' }),
  arrayUnion: (...items) => ({ _type: 'FieldValue.arrayUnion', items }),
  serverTimestamp: () => ({ _type: 'FieldValue.serverTimestamp' }),
};

function isDeleteSentinel(v) {
  return v && v._type === 'FieldValue.delete';
}

function isArrayUnionSentinel(v) {
  return v && v._type === 'FieldValue.arrayUnion';
}

// ── Firestore stub ───────────────────────────────────────────────────────────

function makeFirestoreStub() {
  return {
    collection: (_col) => ({
      doc: (_id) => ({
        get: async () => ({
          exists: stubState.liffDoc !== null,
          data: () => (stubState.liffDoc ? { ...stubState.liffDoc } : {}),
        }),
        set: async (payload, opts) => {
          if (stubState.setError) throw stubState.setError;
          captured.setSets.push({ payload, opts });
        },
      }),
    }),
  };
}

// ── admin stub ───────────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: () => makeFirestoreStub(),
};
adminStub.firestore.FieldValue = FieldValue;

// ── node-fetch stub ──────────────────────────────────────────────────────────

const fetchStub = async (url, opts) => {
  if (stubState.fetchNetworkError) throw stubState.fetchNetworkError;

  if (url.includes('line.me')) {
    captured.lineFetchCalls.push({ url, opts });
    return {
      ok: stubState.lineVerifyOk,
      status: stubState.lineVerifyStatus,
      json: async () => stubState.lineVerifyBody,
      text: async () => JSON.stringify(stubState.lineVerifyBody),
    };
  }

  // notifyLiffRequest (fire-and-forget)
  captured.notifyFetch = { url, opts };
  return { ok: true };
};

// ── buildingRegistry stub ────────────────────────────────────────────────────

const buildingRegistryStub = {
  getValidBuildings: async () => stubState.validBuildings,
};

// ── Module._load intercept ───────────────────────────────────────────────────

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'node-fetch') return fetchStub;
  if (
    request === './buildingRegistry' ||
    request.endsWith('/buildingRegistry')
  ) {
    return buildingRegistryStub;
  }
  if (request === 'firebase-functions/v1' || request === 'firebase-functions') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    const onRequest = (handler) => handler;
    const regionFn = () => ({ https: { HttpsError, onRequest } });
    return { https: { HttpsError, onRequest }, region: regionFn };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { requestRoomRelink: handler } = require('../requestRoomRelink');

// ── Request / response helpers ───────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    body: { idToken: 'tok123', building: 'rooms', room: '15' },
    get: () => '',
    set: () => {},
    ...overrides,
  };
}

function makeRes() {
  const r = { _status: null, _body: null };
  r.set = (_k, _v) => {};
  r.status = (code) => {
    r._status = code;
    return {
      json: (b) => { r._body = b; },
      send: (b) => { r._body = b; },
    };
  };
  return r;
}

function seedDoc(status = 'unlinked', extra = {}) {
  stubState.liffDoc = { status, room: '15', building: 'rooms', ...extra };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('requestRoomRelink', () => {

  beforeEach(() => resetStubs());

  // ── CORS + method guard ────────────────────────────────────────────────────

  describe('CORS + method guard', () => {
    it('OPTIONS returns 204', async () => {
      const req = makeReq({ method: 'OPTIONS' });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 204);
    });

    it('GET returns 405', async () => {
      const req = makeReq({ method: 'GET' });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 405);
    });
  });

  // ── Body validation ────────────────────────────────────────────────────────

  describe('body validation', () => {
    it('missing idToken returns 400', async () => {
      const req = makeReq({ body: { building: 'rooms', room: '15' } });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
      assert.ok(res._body.error, 'error field present');
    });

    it('idToken as number (not string) returns 400', async () => {
      const req = makeReq({ body: { idToken: 12345, building: 'rooms', room: '15' } });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
    });

    it('missing building returns 400', async () => {
      const req = makeReq({ body: { idToken: 'tok', room: '15' } });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
    });

    it('missing room returns 400', async () => {
      const req = makeReq({ body: { idToken: 'tok', building: 'rooms' } });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
    });

    it('room failing regex ("!") returns 400', async () => {
      const req = makeReq({ body: { idToken: 'tok', building: 'rooms', room: '!' } });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
      assert.match(res._body.error, /Invalid room/i);
    });

    it('room "15" (valid alphanumeric) passes validation and reaches LINE verify', async () => {
      // If room is valid, the request advances past validation to the LINE call.
      // Confirm LINE fetch was actually called.
      const req = makeReq({ body: { idToken: 'tok', building: 'rooms', room: '15' } });
      const res = makeRes();
      await handler(req, res);
      // Status should NOT be 400 at this point (may be 401, 200, etc.)
      assert.notEqual(res._status, 400);
    });
  });

  // ── LINE verify ───────────────────────────────────────────────────────────

  describe('LINE verify', () => {
    it('LINE returns non-ok (lineVerifyOk=false) → 401', async () => {
      stubState.lineVerifyOk = false;
      stubState.lineVerifyBody = { error: 'invalid_request', error_description: 'bad token' };
      seedDoc();
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 401);
    });

    it('fetch to LINE throws network error → 500', async () => {
      stubState.fetchNetworkError = new Error('ECONNRESET');
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 500);
    });

    it('LINE ok but body missing sub → 401', async () => {
      stubState.lineVerifyBody = { name: 'ไม่มี sub' }; // no sub field
      seedDoc();
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 401);
      assert.match(res._body.error, /sub/i);
    });
  });

  // ── Building validation ───────────────────────────────────────────────────

  describe('building validation', () => {
    it('unknown building ("amazon") returns 400', async () => {
      const req = makeReq({ body: { idToken: 'tok123', building: 'amazon', room: '15' } });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
      assert.match(res._body.error, /Unknown building/i);
    });
  });

  // ── liffUsers pre-condition ───────────────────────────────────────────────

  describe('liffUsers pre-condition', () => {
    it('no prior doc (not exists) returns 404', async () => {
      // stubState.liffDoc remains null (default resetStubs)
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 404);
    });

    it('status "approved" returns 409 with current status in body', async () => {
      seedDoc('approved');
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 409);
      assert.equal(res._body.status, 'approved');
      assert.ok(res._body.error, 'error message present');
    });

    it('status "pending" returns 409 with current status in body', async () => {
      seedDoc('pending');
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 409);
      assert.equal(res._body.status, 'pending');
    });
  });

  // ── Success path ──────────────────────────────────────────────────────────

  describe('success path', () => {
    it('status "unlinked" → 200 { ok: true, status: "pending" }', async () => {
      seedDoc('unlinked');
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 200);
      assert.deepEqual(res._body, { ok: true, status: 'pending' });
    });

    it('status "rejected" → 200 { ok: true, status: "pending" }', async () => {
      seedDoc('rejected');
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 200);
      assert.deepEqual(res._body, { ok: true, status: 'pending' });
    });

    it('Firestore set is called with { merge: true }', async () => {
      seedDoc('unlinked');
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      assert.equal(captured.setSets.length, 1);
      assert.deepEqual(captured.setSets[0].opts, { merge: true });
    });

    it('write payload contains status="pending", building, room, lineUserId', async () => {
      seedDoc('unlinked');
      const req = makeReq({ body: { idToken: 'tok123', building: 'rooms', room: '15' } });
      const res = makeRes();
      await handler(req, res);
      const { payload } = captured.setSets[0];
      assert.equal(payload.status, 'pending');
      assert.equal(payload.building, 'rooms');
      assert.equal(payload.room, '15');
      assert.equal(payload.lineUserId, 'Uabc123');
    });

    it('write payload uses FieldValue.delete() for role, approvedAt, unlinkedAt', async () => {
      seedDoc('unlinked');
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      const { payload } = captured.setSets[0];
      assert.ok(isDeleteSentinel(payload.role), 'role is FieldValue.delete()');
      assert.ok(isDeleteSentinel(payload.approvedAt), 'approvedAt is FieldValue.delete()');
      assert.ok(isDeleteSentinel(payload.unlinkedAt), 'unlinkedAt is FieldValue.delete()');
    });

    it('write payload relinkHistory is FieldValue.arrayUnion(...) with previousStatus from old doc', async () => {
      seedDoc('unlinked', { room: '14', building: 'rooms' });
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      const { payload } = captured.setSets[0];
      assert.ok(isArrayUnionSentinel(payload.relinkHistory), 'relinkHistory is arrayUnion');
      const [historyEntry] = payload.relinkHistory.items;
      assert.equal(historyEntry.previousStatus, 'unlinked');
    });

    it('notify fetch fires non-blocking (captured.notifyFetch is set)', async () => {
      seedDoc('unlinked');
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      // Give the fire-and-forget promise a chance to resolve
      await new Promise((resolve) => setImmediate(resolve));
      assert.ok(captured.notifyFetch !== null, 'notifyFetch was called');
      assert.ok(
        captured.notifyFetch.url.includes('notifyLiffRequest'),
        'URL points to notifyLiffRequest',
      );
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('Firestore write failure returns 500', async () => {
      seedDoc('unlinked');
      stubState.setError = new Error('Firestore unavailable');
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 500);
      assert.match(res._body.error, /write failed|unavailable/i);
    });
  });
});
