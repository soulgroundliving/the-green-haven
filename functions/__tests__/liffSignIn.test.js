/**
 * Unit tests for liffSignIn.js
 *
 * Covers: CORS/method routing, body validation, LINE token verification,
 * liffUsers lookup, player path (role=player), tenant path, §7-Z claim
 * persistence (setCustomUserClaims), UID contract, and input sanitisation.
 *
 * Run: node --test functions/__tests__/liffSignIn.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state (reset per test) ───────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    lineVerifyOk: true,
    lineUserId: 'Uabc123',
    // liffUsers doc — null = not exists
    liffDoc: { status: 'approved', room: '15', building: 'rooms', lineDisplayName: 'สมชาย' },
    // tenants/rooms/list/15 doc — null = not exists
    tenantDoc: { tenantId: 'T1', status: 'active' },
    // people/{tenantId} doc — null = not exists
    peopleDoc: null,
    createCustomTokenResult: 'fake-custom-token',
    createCustomTokenError: null,
    updateUserNotFound: false,    // simulate auth/user-not-found on updateUser
    validBuildings: new Set(['rooms', 'nest']),
    ...overrides,
  };
  captured = {
    createCustomTokenCalls: [],   // [{uid, claims}]
    setCustomUserClaimsCalls: [], // [{uid, claims}]
    updateUserCalls: [],          // [{uid, props}]
    createUserCalls: [],          // [props]
    fetchCalls: [],               // [{url, method, body}]
    tenantSet: null,              // last set() on tenant doc ref
    peopleSet: null,              // last set() on people doc ref
  };
}
resetStubs();

// ── firebase-admin stub ───────────────────────────────────────────────────────

function makeSnap(path, data) {
  const snap = {
    path,
    exists: data !== undefined && data !== null,
    data: () => (data ? { ...data } : {}),
    ref: {
      path,
      set: (payload, opts) => {
        if (path.startsWith('tenants/')) captured.tenantSet = { path, payload, opts };
        else if (path.startsWith('people/')) captured.peopleSet = { path, payload, opts };
        return Promise.resolve();
      },
    },
    get: async () => snap,
    set: (payload, opts) => {
      if (path.startsWith('tenants/')) captured.tenantSet = { path, payload, opts };
      return Promise.resolve();
    },
  };
  return snap;
}

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: () => ({
    collection: (col) => ({
      doc: (id) => {
        const path = `${col}/${id}`;
        if (col === 'liffUsers') {
          const snap = makeSnap(path, stubState.liffDoc);
          return { ...snap, get: async () => makeSnap(path, stubState.liffDoc) };
        }
        if (col === 'people') {
          return {
            get: async () => makeSnap(path, stubState.peopleDoc),
            set: (payload, opts) => {
              captured.peopleSet = { path, payload, opts };
              return Promise.resolve();
            },
          };
        }
        if (col === 'tenants') {
          return {
            collection: (sub) => ({
              doc: (roomId) => {
                const tPath = `tenants/${id}/${sub}/${roomId}`;
                // Return a snap-like object for the tenant doc
                const tSnap = makeSnap(tPath, stubState.tenantDoc);
                return tSnap;
              },
            }),
          };
        }
        return makeSnap(path, null);
      },
    }),
  }),
  auth: () => ({
    createCustomToken: async (uid, claims) => {
      captured.createCustomTokenCalls.push({ uid, claims: { ...claims } });
      if (stubState.createCustomTokenError) throw stubState.createCustomTokenError;
      return stubState.createCustomTokenResult;
    },
    setCustomUserClaims: (uid, claims) => {
      captured.setCustomUserClaimsCalls.push({ uid, claims: { ...claims } });
      return Promise.resolve(); // synchronously settled — fire-and-forget chain completes before handler returns
    },
    updateUser: async (uid, props) => {
      captured.updateUserCalls.push({ uid, props });
      if (stubState.updateUserNotFound) {
        throw Object.assign(new Error('There is no user record'), { code: 'auth/user-not-found' });
      }
    },
    createUser: async (props) => {
      captured.createUserCalls.push({ ...props });
    },
  }),
};
adminStub.firestore.FieldValue = {
  serverTimestamp: () => ({ _type: 'FieldValue.serverTimestamp' }),
  delete: () => ({ _type: 'FieldValue.delete' }),
};

// ── buildingRegistry stub ─────────────────────────────────────────────────────

const buildingRegistryStub = {
  getValidBuildings: async () => stubState.validBuildings,
};

// ── node-fetch stub ───────────────────────────────────────────────────────────

// Returns a function that reads stubState at CALL time — survives resetStubs().
function makeFetchStub() {
  return async (url, opts) => {
    let body = {};
    if (opts?.body && typeof opts.body === 'string') {
      try { body = Object.fromEntries(new URLSearchParams(opts.body)); } catch (_) {}
    }
    captured.fetchCalls.push({ url, method: opts?.method, body });

    if (!stubState.lineVerifyOk) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error_description: 'The access token expired' }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ sub: stubState.lineUserId, name: 'Test User' }),
    };
  };
}

// ── Module._load intercept ────────────────────────────────────────────────────

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') return adminStub;
  if (id === 'firebase-functions/v1') {
    return {
      region: () => {
        // Tolerate the chain with OR without .runWith(...) (minInstances was
        // removed 2026-06-10 for cost — the mock shouldn't care either way).
        const chain = { https: { onRequest: (fn) => fn } };
        chain.runWith = () => chain;
        return chain;
      },
    };
  }
  if (id.endsWith('/buildingRegistry') || id === './buildingRegistry') return buildingRegistryStub;
  return _origLoad.call(this, id, parent, ...rest);
};

global.fetch = makeFetchStub();

// ── Load CF under test ────────────────────────────────────────────────────────

const { liffSignIn: handler } = require('../liffSignIn');

// ── Request/response helpers ──────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    body: { idToken: 'valid-liff-id-token' },
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    _headers: {},
    status(code) { res._status = code; return res; },
    json(body)  { res._body = body; return res; },
    send(body)  { res._body = body; return res; },
    set(key, val) { res._headers[key] = val; return res; },
  };
  return res;
}

async function call(reqOverrides = {}) {
  const req = makeReq(reqOverrides);
  const res = makeRes();
  await handler(req, res);
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('liffSignIn — CORS / method routing', () => {
  beforeEach(() => resetStubs());

  it('OPTIONS returns 204 with CORS headers', async () => {
    const res = await call({ method: 'OPTIONS' });
    assert.equal(res._status, 204);
    assert.equal(res._headers['Access-Control-Allow-Origin'], 'https://the-green-haven.vercel.app');
    assert.ok(res._headers['Access-Control-Allow-Methods']);
  });

  it('GET health-check returns 200 {status: ok, ts: <number>}', async () => {
    const res = await call({ method: 'GET', body: {} });
    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'ok');
    assert.ok(typeof res._body.ts === 'number', 'ts must be a number');
  });

  it('PUT returns 405 method-not-allowed', async () => {
    const res = await call({ method: 'PUT', body: {} });
    assert.equal(res._status, 405);
  });

  it('CORS origin header is always set on POST', async () => {
    const res = await call();
    assert.equal(res._headers['Access-Control-Allow-Origin'], 'https://the-green-haven.vercel.app');
  });
});

describe('liffSignIn — body validation', () => {
  beforeEach(() => resetStubs());

  it('rejects missing idToken', async () => {
    const res = await call({ body: {} });
    assert.equal(res._status, 400);
    assert.ok(res._body.error.includes('idToken'));
  });

  it('rejects non-string idToken (number)', async () => {
    const res = await call({ body: { idToken: 12345 } });
    assert.equal(res._status, 400);
    assert.ok(res._body.error.includes('idToken'));
  });

  it('rejects null body', async () => {
    const res = await call({ body: null });
    assert.equal(res._status, 400);
  });

  it('rejects undefined body', async () => {
    const res = await call({ body: undefined });
    assert.equal(res._status, 400);
  });
});

describe('liffSignIn — LINE token verification', () => {
  beforeEach(() => resetStubs());

  it('returns 401 when LINE API rejects the token', async () => {
    resetStubs({ lineVerifyOk: false });
    const res = await call();
    assert.equal(res._status, 401);
    assert.ok(res._body.error.length > 0);
  });

  it('returns 401 when LINE response has no sub field', async () => {
    resetStubs({ lineUserId: null });
    const res = await call();
    assert.equal(res._status, 401);
    assert.ok(res._body.error.includes('sub'));
  });

  it('POSTs to LINE /verify with id_token + client_id=2009790149', async () => {
    await call();
    const lineCall = captured.fetchCalls.find(c => c.url.includes('line.me'));
    assert.ok(lineCall, 'must call LINE verify endpoint');
    assert.equal(lineCall.method, 'POST');
    assert.equal(lineCall.body.id_token, 'valid-liff-id-token');
    assert.equal(lineCall.body.client_id, '2009790149');
  });
});

describe('liffSignIn — liffUsers lookup', () => {
  beforeEach(() => resetStubs());

  it('returns 404 when liffUsers doc does not exist', async () => {
    resetStubs({ liffDoc: null });
    const res = await call();
    assert.equal(res._status, 404);
    assert.ok(res._body.error.length > 0);
  });

  it('returns 403 with status=pending when not yet approved', async () => {
    resetStubs({ liffDoc: { status: 'pending', room: '15', building: 'rooms' } });
    const res = await call();
    assert.equal(res._status, 403);
    assert.equal(res._body.status, 'pending');
  });

  it('returns 403 with status=rejected when rejected', async () => {
    resetStubs({ liffDoc: { status: 'rejected', room: '15', building: 'rooms' } });
    const res = await call();
    assert.equal(res._status, 403);
    assert.equal(res._body.status, 'rejected');
  });
});

describe('liffSignIn — player path (role=player)', () => {
  function playerState(overrides = {}) {
    return {
      liffDoc: { status: 'approved', role: 'player', tenantId: 'T1' },
      ...overrides,
    };
  }

  beforeEach(() => resetStubs(playerState()));

  it('returns 200 with customToken + role=player + tenantId', async () => {
    const res = await call();
    assert.equal(res._status, 200);
    assert.equal(res._body.role, 'player');
    assert.equal(res._body.customToken, 'fake-custom-token');
    assert.equal(res._body.tenantId, 'T1');
  });

  it('mints token with uid=line:<lineUserId> and role=player claim', async () => {
    await call();
    const mint = captured.createCustomTokenCalls[0];
    assert.ok(mint, 'createCustomToken must be called');
    assert.equal(mint.uid, 'line:Uabc123');
    assert.equal(mint.claims.role, 'player');
    assert.equal(mint.claims.tenantId, 'T1');
  });

  it('§7-Z: setCustomUserClaims called with role + tenantId (persists past ID-token refresh)', async () => {
    await call();
    assert.ok(captured.setCustomUserClaimsCalls.length > 0, 'setCustomUserClaims must be called');
    const scc = captured.setCustomUserClaimsCalls[0];
    assert.equal(scc.uid, 'line:Uabc123');
    assert.equal(scc.claims.role, 'player');
    assert.equal(scc.claims.tenantId, 'T1');
  });

  it('returns 500 when createCustomToken throws', async () => {
    resetStubs({ ...playerState(), createCustomTokenError: new Error('Auth quota exceeded') });
    const res = await call();
    assert.equal(res._status, 500);
  });

  it('includes player name + phone when people doc exists', async () => {
    resetStubs({
      ...playerState(),
      peopleDoc: { name: 'สมชาย', phone: '0812345678' },
    });
    const res = await call();
    assert.equal(res._status, 200);
    assert.equal(res._body.name, 'สมชาย');
    assert.equal(res._body.phone, '0812345678');
  });
});

describe('liffSignIn — tenant path', () => {
  beforeEach(() => resetStubs());

  it('returns 200 with customToken, room, building', async () => {
    const res = await call();
    assert.equal(res._status, 200);
    assert.equal(res._body.customToken, 'fake-custom-token');
    assert.equal(res._body.room, '15');
    assert.equal(res._body.building, 'rooms');
  });

  it('mints token with uid=line:<lineUserId> and room+building+tenantId claims', async () => {
    await call();
    const mint = captured.createCustomTokenCalls[0];
    assert.ok(mint, 'createCustomToken must be called');
    assert.equal(mint.uid, 'line:Uabc123');
    assert.equal(mint.claims.room, '15');
    assert.equal(mint.claims.building, 'rooms');
    assert.equal(mint.claims.tenantId, 'T1');
  });

  it('§7-Z: setCustomUserClaims called with same room+building claims', async () => {
    await call();
    assert.ok(captured.setCustomUserClaimsCalls.length > 0, 'setCustomUserClaims must be called');
    const scc = captured.setCustomUserClaimsCalls[0];
    assert.equal(scc.uid, 'line:Uabc123');
    assert.equal(scc.claims.room, '15');
    assert.equal(scc.claims.building, 'rooms');
  });

  it('returns 500 when liffUsers doc has empty room field', async () => {
    resetStubs({ liffDoc: { status: 'approved', room: '', building: 'rooms' } });
    const res = await call();
    assert.equal(res._status, 500);
    assert.ok(res._body.error.includes('room'));
  });

  it('returns 400 when room format contains path traversal (../admin)', async () => {
    resetStubs({ liffDoc: { status: 'approved', room: '../admin', building: 'rooms' } });
    const res = await call();
    assert.equal(res._status, 400);
    assert.ok(res._body.error.includes('room'));
  });

  it('returns 400 when room contains special chars (SQL-like)', async () => {
    resetStubs({ liffDoc: { status: 'approved', room: "15'; DROP", building: 'rooms' } });
    const res = await call();
    assert.equal(res._status, 400);
  });

  it('returns 400 when building is not in validBuildings', async () => {
    resetStubs({ liffDoc: { status: 'approved', room: '15', building: 'unknown_bldg' } });
    const res = await call();
    assert.equal(res._status, 400);
    assert.ok(res._body.error.includes('building') || res._body.error.includes('Unknown'));
  });

  it('accepts nest as a valid building', async () => {
    resetStubs({ liffDoc: { status: 'approved', room: 'N101', building: 'nest' } });
    const res = await call();
    assert.equal(res._status, 200);
    assert.equal(res._body.building, 'nest');
  });

  it('returns 500 when createCustomToken throws', async () => {
    resetStubs({ createCustomTokenError: new Error('Token quota') });
    const res = await call();
    assert.equal(res._status, 500);
  });

  it('falls back to rooms when building field is empty (String(|| "rooms"))', async () => {
    resetStubs({ liffDoc: { status: 'approved', room: '15', building: '' } });
    const res = await call();
    // '' → building defaults to 'rooms' inside CF
    assert.equal(res._status, 200);
    assert.equal(res._body.building, 'rooms');
  });

  it('updateUser called with displayName containing building/room', async () => {
    await call();
    const upd = captured.updateUserCalls[0];
    assert.ok(upd, 'updateUser must be called');
    assert.equal(upd.uid, 'line:Uabc123');
    assert.ok(
      upd.props.displayName.includes('rooms') && upd.props.displayName.includes('15'),
      `displayName should contain building/room, got: ${upd.props.displayName}`
    );
  });

  it('createUser called as fallback when updateUser returns auth/user-not-found', async () => {
    resetStubs({ updateUserNotFound: true });
    const res = await call();
    // user-not-found is handled gracefully — request should still succeed
    assert.equal(res._status, 200);
    assert.ok(captured.createUserCalls.length > 0, 'createUser should be called as fallback');
    assert.equal(captured.createUserCalls[0].uid, 'line:Uabc123');
  });
});

describe('liffSignIn — UID contract', () => {
  beforeEach(() => resetStubs());

  it('tenant path UID is always line:<lineUserId>', async () => {
    resetStubs({ lineUserId: 'Uxyz999' });
    await call();
    assert.equal(captured.createCustomTokenCalls[0]?.uid, 'line:Uxyz999');
  });

  it('player path UID is always line:<lineUserId>', async () => {
    resetStubs({
      lineUserId: 'Uxyz999',
      liffDoc: { status: 'approved', role: 'player', tenantId: 'T2' },
    });
    await call();
    assert.equal(captured.createCustomTokenCalls[0]?.uid, 'line:Uxyz999');
  });

  it('UID never equals the raw LINE userId (always prefixed)', async () => {
    await call();
    const mint = captured.createCustomTokenCalls[0];
    assert.notEqual(mint?.uid, 'Uabc123');
    assert.ok(mint?.uid.startsWith('line:'));
  });
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

// Restore the original Module._load after the full suite so Node.js worker-thread
// teardown doesn't hit our stub intercept during cleanup.
after(() => {
  Module._load = _origLoad;
});
