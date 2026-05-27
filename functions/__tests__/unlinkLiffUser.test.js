/**
 * Unit tests for unlinkLiffUser — soft-disconnect LINE↔tenant link.
 * Run: node --test functions/__tests__/unlinkLiffUser.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    // Full Firestore path → doc data (undefined = doc does not exist)
    docs: {},
    // 'people' query results: array of { ref: { path }, data: () => ({...}) }
    peopleQueryDocs: [],
    batchCommitError: null,
    // admin.auth() errors keyed by uid — e.g. { 'line:U123': 'user-not-found' }
    authErrors: {},
    ...overrides,
  };
  captured = {
    batchOps: [],            // { op, path, data }
    setCustomClaims: [],     // [{ uid, claims }]
    revokeRefreshTokens: [], // [uid]
  };
}
resetStubs();

// ── firebase-admin stub ───────────────────────────────────────────────────────

function makeSnap(path) {
  const data = stubState.docs[path];
  return {
    exists: data !== undefined && data !== null,
    data: () => (data !== undefined && data !== null ? data : {}),
    ref: { path },
  };
}

function makeDocRef(path) {
  return {
    path,
    collection: (sub) => makeColl(`${path}/${sub}`),
    get: async () => makeSnap(path),
  };
}

function makePeopleQueryResult(docs) {
  return {
    empty: docs.length === 0,
    docs,
    forEach: (fn) => docs.forEach(fn),
  };
}

function makeColl(path) {
  return {
    path,
    doc: (id) => makeDocRef(`${path}/${id}`),
    // Chain: .where(field, op, val).limit(n).get()
    where: (_field, _op, _val) => ({
      limit: (_n) => ({
        get: async () => {
          // Only the 'people' collection uses where().limit().get() in this CF
          const docs = stubState.peopleQueryDocs.map((d) => ({
            ref: makeDocRef(d.path),
            data: () => d.data,
          }));
          return makePeopleQueryResult(docs);
        },
      }),
    }),
    get: async () => ({ docs: [], empty: true, forEach: (_fn) => {} }),
  };
}

const fsBatch = () => ({
  set: (ref, data, opts) =>
    captured.batchOps.push({ op: 'set', path: ref.path, data, opts: opts || null }),
  update: (ref, data) =>
    captured.batchOps.push({ op: 'update', path: ref.path, data }),
  delete: (ref) =>
    captured.batchOps.push({ op: 'delete', path: ref.path }),
  commit: async () => {
    if (stubState.batchCommitError) throw new Error(stubState.batchCommitError);
  },
});

const firestoreFn = Object.assign(
  () => ({
    collection: (path) => makeColl(path),
    batch: fsBatch,
  }),
  {
    FieldValue: {
      serverTimestamp: () => '__ts__',
      delete: () => '__delete__',
    },
  }
);

const authFn = () => ({
  setCustomUserClaims: async (uid, claims) => {
    const errCode = stubState.authErrors[uid];
    if (errCode) {
      const e = new Error(`auth error for ${uid}`);
      e.code = `auth/${errCode}`;
      throw e;
    }
    captured.setCustomClaims.push({ uid, claims });
  },
  revokeRefreshTokens: async (uid) => {
    const errCode = stubState.authErrors[uid];
    if (errCode) {
      const e = new Error(`auth error for ${uid}`);
      e.code = `auth/${errCode}`;
      throw e;
    }
    captured.revokeRefreshTokens.push(uid);
  },
});

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: firestoreFn,
  auth: authFn,
};

// ── Module._load intercept (must happen before require of the CF) ─────────────

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    }
    const wrapOnCall = (handler) => {
      const fn = (data, ctx) => handler(data, ctx);
      fn.run = (data, ctx) => handler(data, ctx);
      return fn;
    };
    return {
      https: { HttpsError, onCall: wrapOnCall },
      region: () => ({ https: { HttpsError, onCall: wrapOnCall } }),
    };
  }
  return originalLoad.apply(this, arguments);
};

const { unlinkLiffUser } = require('../unlinkLiffUser');

// ── Helpers ───────────────────────────────────────────────────────────────────

function adminContext() {
  return { auth: { uid: 'admin-uid', token: { admin: true } } };
}

function nonAdminContext() {
  return { auth: { uid: 'tenant-uid', token: { admin: false } } };
}

async function expectHttpsError(promise, expectedCode) {
  let caught;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught,
    `Expected HttpsError with code='${expectedCode}' but the call succeeded`
  );
  assert.equal(
    caught.code,
    expectedCode,
    `Expected code='${expectedCode}', got '${caught.code}' (message: ${caught.message})`
  );
  return caught;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('unlinkLiffUser — auth guard', () => {
  beforeEach(() => resetStubs());

  it('throws permission-denied when caller has no admin claim', async () => {
    await expectHttpsError(
      unlinkLiffUser.run({ lineUserId: 'U123' }, nonAdminContext()),
      'permission-denied'
    );
  });

  it('throws permission-denied when auth is entirely absent', async () => {
    await expectHttpsError(
      unlinkLiffUser.run({ lineUserId: 'U123' }, { auth: null }),
      'permission-denied'
    );
  });
});

describe('unlinkLiffUser — input validation', () => {
  beforeEach(() => resetStubs());

  it('throws invalid-argument when lineUserId is missing from data', async () => {
    await expectHttpsError(
      unlinkLiffUser.run({}, adminContext()),
      'invalid-argument'
    );
  });

  it('throws invalid-argument when lineUserId is an empty string', async () => {
    await expectHttpsError(
      unlinkLiffUser.run({ lineUserId: '' }, adminContext()),
      'invalid-argument'
    );
  });

  it('throws invalid-argument when lineUserId is not a string', async () => {
    await expectHttpsError(
      unlinkLiffUser.run({ lineUserId: 12345 }, adminContext()),
      'invalid-argument'
    );
  });

  it('throws invalid-argument when data is null', async () => {
    await expectHttpsError(
      unlinkLiffUser.run(null, adminContext()),
      'invalid-argument'
    );
  });
});

describe('unlinkLiffUser — liffUsers pre-condition', () => {
  beforeEach(() => resetStubs());

  it('throws not-found when liffUsers doc does not exist', async () => {
    // stubState.docs has no entry for liffUsers/U999
    await expectHttpsError(
      unlinkLiffUser.run({ lineUserId: 'U999' }, adminContext()),
      'not-found'
    );
  });
});

describe('unlinkLiffUser — success: with building, room, and a people doc', () => {
  const LINE_USER_ID = 'U123';
  const BUILDING = 'rooms';
  const ROOM = '15';
  const LEGACY_UID = 'anon-legacy-uid';

  beforeEach(() => {
    resetStubs();

    // liffUsers doc with building + room
    stubState.docs[`liffUsers/${LINE_USER_ID}`] = {
      building: BUILDING,
      room: ROOM,
      status: 'approved',
    };

    // tenants/{building}/list/{room} doc with a linkedAuthUid
    stubState.docs[`tenants/${BUILDING}/list/${ROOM}`] = {
      name: 'สมชาย สิบห้า',
      linkedAuthUid: LEGACY_UID,
      linkedAt: '__ts__',
    };

    // people query returns one doc that also carries linkedAuthUid
    stubState.peopleQueryDocs = [
      {
        path: `people/TENANT_T_15`,
        data: {
          lineUserId: LINE_USER_ID,
          linkedAuthUid: LEGACY_UID,
          lineDisplayName: 'สมชาย',
        },
      },
    ];
  });

  it('returns the expected success shape', async () => {
    const result = await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    assert.equal(result.success, true);
    assert.equal(result.lineUserId, LINE_USER_ID);
    assert.equal(result.building, BUILDING);
    assert.equal(result.room, ROOM);
    assert.equal(result.peopleCleared, 1);
    // deterministic UID + legacy UID → 2 uids cleared
    assert.equal(result.uidsCleared, 2);
  });

  it('includes a batch update that soft-deletes the liffUsers doc (status=unlinked)', () => {
    return unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext()).then(() => {
      const liffUpdate = captured.batchOps.find(
        (o) => o.op === 'update' && o.path === `liffUsers/${LINE_USER_ID}`
      );
      assert.ok(liffUpdate, 'expected batch.update on liffUsers doc');
      assert.equal(liffUpdate.data.status, 'unlinked');
      assert.equal(liffUpdate.data.unlinkedAt, '__ts__');
      assert.equal(liffUpdate.data.unlinkedBy, 'admin-uid');
    });
  });

  it('includes a batch update that clears linkedAuthUid and linkedAt from the tenant doc', async () => {
    await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    const tenantUpdate = captured.batchOps.find(
      (o) => o.op === 'update' && o.path === `tenants/${BUILDING}/list/${ROOM}`
    );
    assert.ok(tenantUpdate, 'expected batch.update on tenant doc');
    assert.equal(tenantUpdate.data.linkedAuthUid, '__delete__');
    assert.equal(tenantUpdate.data.linkedAt, '__delete__');
  });

  it('includes a batch update that clears LINE fields from the people doc', async () => {
    await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    const peopleUpdate = captured.batchOps.find(
      (o) => o.op === 'update' && o.path === 'people/TENANT_T_15'
    );
    assert.ok(peopleUpdate, 'expected batch.update on people doc');
    assert.equal(peopleUpdate.data.lineUserId, '__delete__');
    assert.equal(peopleUpdate.data.linkedAuthUid, '__delete__');
    assert.equal(peopleUpdate.data.lineDisplayName, '__delete__');
  });

  it('strips claims for the deterministic line: UID', async () => {
    await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    const deterministicUid = `line:${LINE_USER_ID}`;
    const claimCall = captured.setCustomClaims.find((c) => c.uid === deterministicUid);
    assert.ok(claimCall, `expected setCustomUserClaims called for ${deterministicUid}`);
    assert.deepEqual(claimCall.claims, {});
  });

  it('strips claims for the legacy anon UID captured from the tenant doc', async () => {
    await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    const claimCall = captured.setCustomClaims.find((c) => c.uid === LEGACY_UID);
    assert.ok(claimCall, `expected setCustomUserClaims called for legacy UID ${LEGACY_UID}`);
    assert.deepEqual(claimCall.claims, {});
  });

  it('revokes refresh tokens for both UIDs (§7-FF three-leg contract)', async () => {
    await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    const deterministicUid = `line:${LINE_USER_ID}`;
    assert.ok(
      captured.revokeRefreshTokens.includes(deterministicUid),
      `expected revokeRefreshTokens called for ${deterministicUid}`
    );
    assert.ok(
      captured.revokeRefreshTokens.includes(LEGACY_UID),
      `expected revokeRefreshTokens called for legacy UID ${LEGACY_UID}`
    );
  });

  it('does not duplicate the legacy UID when it equals the deterministic UID', async () => {
    // Edge case: legacy UID happens to equal 'line:U123' already — should only appear once
    stubState.docs[`tenants/${BUILDING}/list/${ROOM}`] = {
      linkedAuthUid: `line:${LINE_USER_ID}`,
    };
    stubState.peopleQueryDocs = [];

    const result = await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    assert.equal(result.uidsCleared, 1);
    assert.equal(
      captured.setCustomClaims.filter((c) => c.uid === `line:${LINE_USER_ID}`).length,
      1,
      'setCustomUserClaims must be called exactly once for the deterministic UID'
    );
  });

  it('survives when auth.setCustomUserClaims throws user-not-found (fire-and-forget)', async () => {
    // Per §7-FF: claim reversal errors are non-fatal
    stubState.authErrors[`line:${LINE_USER_ID}`] = 'user-not-found';
    stubState.authErrors[LEGACY_UID] = 'user-not-found';

    const result = await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    assert.equal(result.success, true, 'call must succeed even if auth ops fail');
  });
});

describe('unlinkLiffUser — success: no building or room (no tenant/people links)', () => {
  const LINE_USER_ID = 'Uorphan';

  beforeEach(() => {
    resetStubs();

    // liffUsers doc with no building/room (never fully linked to a room)
    stubState.docs[`liffUsers/${LINE_USER_ID}`] = {
      status: 'approved',
      // building and room deliberately absent
    };

    // people query returns empty
    stubState.peopleQueryDocs = [];
  });

  it('returns the expected success shape with nulls for building/room', async () => {
    const result = await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    assert.equal(result.success, true);
    assert.equal(result.lineUserId, LINE_USER_ID);
    assert.equal(result.building, null);
    assert.equal(result.room, null);
    assert.equal(result.peopleCleared, 0);
    assert.equal(result.uidsCleared, 1);
  });

  it('only writes ONE batch op (the liffUsers soft-delete) — no tenant or people updates', async () => {
    await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    assert.equal(
      captured.batchOps.length,
      1,
      `expected exactly 1 batch op, got ${captured.batchOps.length}: ${JSON.stringify(captured.batchOps.map((o) => o.path))}`
    );
    assert.equal(captured.batchOps[0].op, 'update');
    assert.equal(captured.batchOps[0].path, `liffUsers/${LINE_USER_ID}`);
  });

  it('still strips claims for the deterministic line: UID', async () => {
    await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    const deterministicUid = `line:${LINE_USER_ID}`;
    const claimCall = captured.setCustomClaims.find((c) => c.uid === deterministicUid);
    assert.ok(claimCall, `expected setCustomUserClaims called for ${deterministicUid}`);
    assert.deepEqual(claimCall.claims, {});
  });

  it('still revokes refresh tokens for the deterministic line: UID', async () => {
    await unlinkLiffUser.run({ lineUserId: LINE_USER_ID }, adminContext());
    assert.ok(
      captured.revokeRefreshTokens.includes(`line:${LINE_USER_ID}`),
      'expected revokeRefreshTokens for deterministic UID even with no tenant link'
    );
  });
});
