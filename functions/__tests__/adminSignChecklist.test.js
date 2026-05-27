/**
 * Unit tests for adminSignChecklist Cloud Function.
 *
 * Design notes:
 *   - admin.firestore() is called at MODULE LOAD TIME (singleton), so the
 *     Module._load intercept must be installed BEFORE require('../adminSignChecklist').
 *   - All test-controlled state lives in `stubState` / `captured` closure
 *     variables that are reset in beforeEach() via resetStubs().
 *   - global.fetch is overridden to capture LINE push calls.
 *   - _lineRetry is intercepted via Module._load to capture enqueueLineRetry calls.
 *
 * Run: node --test functions/__tests__/adminSignChecklist.test.js
 */

'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ─────────────────────────────────────────────────────────────────
// All test-controlled mutable state lives here. resetStubs() is called in every
// beforeEach so tests cannot bleed into each other.

let stubState = {};
let captured  = {};

function resetStubs(overrides = {}) {
  stubState = {
    instanceExists: true,
    instanceData: {
      status:   'submitted',
      building: 'rooms',
      roomId:   '15',
      type:     'move_in',
    },
    updateError:          null,
    liffUsersEmpty:       false,
    liffUsersDocs:        [{ id: 'Utenant1' }],
    liffUsersQueryError:  null,
    fetchOk:              true,
    fetchStatus:          200,
    fetchResponseText:    'LINE error body',
    fetchNetworkError:    null,
    ...overrides,
  };
  captured = {
    updateCalls:        [],   // array of payload objects passed to ref.update()
    fetchCalls:         [],   // array of { url, opts }
    lineRetryEnqueues:  [],   // array of payloads passed to enqueueLineRetry()
  };
}

resetStubs();   // initialise before anything else runs

// ── FieldValue sentinels ───────────────────────────────────────────────────────
const serverTimestampSentinel = { _type: 'serverTimestamp' };
const FieldValue = {
  serverTimestamp: () => serverTimestampSentinel,
};

// ── Firestore stub (returned as the module-load-time singleton) ────────────────
// The CF calls `admin.firestore()` once at the top of the module and stores the
// result. Every subsequent call to `firestore.collection(...)` uses this object,
// so it must be the SAME reference returned by `adminStub.firestore()`.

const firestoreStub = {
  collection: (name) => {
    if (name === 'checklistInstances') {
      return {
        doc: (_id) => ({
          get: async () => ({
            exists: stubState.instanceExists,
            data:   () => stubState.instanceData,
          }),
          update: async (payload) => {
            if (stubState.updateError) throw stubState.updateError;
            captured.updateCalls.push(payload);
          },
        }),
      };
    }

    if (name === 'liffUsers') {
      // Build a chainable .where().where().where().get() stub.
      const terminal = {
        get: async () => {
          if (stubState.liffUsersQueryError) throw stubState.liffUsersQueryError;
          return {
            empty: stubState.liffUsersEmpty,
            docs:  stubState.liffUsersDocs,
          };
        },
      };
      const chainable = { where: () => chainable, get: terminal.get };
      return { where: () => chainable };
    }

    return {};
  },
};

// ── firebase-admin stub ────────────────────────────────────────────────────────
// Must be defined before Module._load intercept because _load references it.

const adminStub = {
  apps:          [{}],
  initializeApp: () => {},
  // `admin.firestore()` → returns the singleton stub object.
  // `admin.firestore.FieldValue` → the sentinel factory (accessed as a property
  // on the function itself, which is how the real Admin SDK exposes it).
  firestore: Object.assign(() => firestoreStub, { FieldValue }),
};

// ── Module._load intercept ─────────────────────────────────────────────────────
// Install BEFORE require('../adminSignChecklist') so that all top-level
// require() calls inside the CF (firebase-admin, firebase-functions/v1) are
// intercepted at that first require time.

let capturedCallHandler = null;

const _origLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') {
    return adminStub;
  }

  if (request === 'firebase-functions/v1') {
    const HttpsError = class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    };
    // Support the chain: functions.region('...').runWith({...}).https.onCall(fn)
    const runWithProxy = {
      https: {
        HttpsError,
        onCall: (fn) => { capturedCallHandler = fn; return fn; },
      },
    };
    const regionProxy = {
      runWith: () => runWithProxy,
    };
    return {
      region:  () => regionProxy,
      https:   { HttpsError },
    };
  }

  // _lineRetry is required INSIDE _notifyTenantAdminSigned (lazy require), so it
  // may be loaded with any parent path. Match both the bare name and any absolute
  // path that ends with /_lineRetry or /_lineRetry.js.
  if (
    request === './_lineRetry' ||
    request.replace(/\\/g, '/').endsWith('/_lineRetry') ||
    request.replace(/\\/g, '/').endsWith('/_lineRetry.js')
  ) {
    return {
      enqueueLineRetry: async (payload) => {
        captured.lineRetryEnqueues.push(payload);
      },
    };
  }

  return _origLoad.apply(this, arguments);
};

// ── Load CF under test ─────────────────────────────────────────────────────────
// Require AFTER stubs are in place. The module-level `admin.firestore()` call
// executes here and receives `firestoreStub`.

const cfExports = require('../adminSignChecklist');

// Restore Module._load after the module cache is populated — subsequent lazy
// requires of _lineRetry still go through the intercept because it was installed
// before the require above and will remain active for this file's lifetime.
// (We intentionally do NOT restore it here so lazy _lineRetry loads are caught.)

// ── global.fetch stub ──────────────────────────────────────────────────────────
const _origFetch = typeof global.fetch === 'function' ? global.fetch : null;

global.fetch = async (url, opts) => {
  captured.fetchCalls.push({ url, opts });
  if (stubState.fetchNetworkError) throw stubState.fetchNetworkError;
  return {
    ok:     stubState.fetchOk,
    status: stubState.fetchStatus,
    text:   async () => stubState.fetchResponseText,
  };
};

after(() => {
  Module._load = _origLoad;
  if (_origFetch === null) delete global.fetch;
  else global.fetch = _origFetch;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});

// ── Handler reference ──────────────────────────────────────────────────────────
// The CF exports `{ adminSignChecklist: handlerFn }` where handlerFn is the
// async function passed to onCall(). capturedCallHandler is set by the intercept.
const handler = capturedCallHandler || cfExports.adminSignChecklist;

// ── Context helpers ────────────────────────────────────────────────────────────

function makeContext(overrides = {}) {
  return {
    auth: {
      uid:   'admin-uid-1',
      token: { admin: true },
    },
    ...overrides,
  };
}

const adminCtx = makeContext();
const noAuth   = { auth: undefined };

// ── Valid data shorthand ───────────────────────────────────────────────────────

const VALID_DATA = {
  instanceId:         'INST_ABC',
  adminSignaturePath: 'checklists/rooms/15/INST_ABC/signature_admin.png',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('adminSignChecklist', () => {

  // ── Auth gates ───────────────────────────────────────────────────────────────

  describe('auth gates', () => {
    beforeEach(() => resetStubs());

    it('throws unauthenticated when context.auth is undefined', async () => {
      await assert.rejects(
        () => handler(VALID_DATA, noAuth),
        (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
      );
    });

    it('throws unauthenticated when auth.uid is null', async () => {
      const ctx = { auth: { uid: null, token: { admin: true } } };
      await assert.rejects(
        () => handler(VALID_DATA, ctx),
        (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
      );
    });

    it('throws permission-denied when admin token claim is not true', async () => {
      const ctx = makeContext({ auth: { uid: 'uid-1', token: {} } });
      await assert.rejects(
        () => handler(VALID_DATA, ctx),
        (err) => { assert.equal(err.code, 'permission-denied'); return true; }
      );
    });

    it('throws permission-denied when admin claim is explicitly false', async () => {
      const ctx = makeContext({ auth: { uid: 'uid-1', token: { admin: false } } });
      await assert.rejects(
        () => handler(VALID_DATA, ctx),
        (err) => { assert.equal(err.code, 'permission-denied'); return true; }
      );
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────────

  describe('input validation', () => {
    beforeEach(() => resetStubs());

    it('throws invalid-argument when instanceId is absent', async () => {
      const { instanceId: _omit, ...rest } = VALID_DATA;
      await assert.rejects(
        () => handler(rest, adminCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when instanceId is an empty string (falsy)', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, instanceId: '' }, adminCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when instanceId is a number, not a string', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, instanceId: 123 }, adminCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when adminSignaturePath is absent', async () => {
      const { adminSignaturePath: _omit, ...rest } = VALID_DATA;
      await assert.rejects(
        () => handler(rest, adminCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when adminSignaturePath is an empty string', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, adminSignaturePath: '' }, adminCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when adminSignaturePath is a number', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, adminSignaturePath: 42 }, adminCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });
  });

  // ── Instance loading ─────────────────────────────────────────────────────────

  describe('instance loading', () => {
    beforeEach(() => resetStubs());

    it('throws not-found when the checklist instance does not exist', async () => {
      resetStubs({ instanceExists: false });
      await assert.rejects(
        () => handler(VALID_DATA, adminCtx),
        (err) => { assert.equal(err.code, 'not-found'); return true; }
      );
    });

    it('throws failed-precondition when instance status is draft', async () => {
      resetStubs({ instanceData: { ...stubState.instanceData, status: 'draft' } });
      await assert.rejects(
        () => handler(VALID_DATA, adminCtx),
        (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
      );
    });

    it('throws failed-precondition when instance status is already admin_signed', async () => {
      resetStubs({ instanceData: { ...stubState.instanceData, status: 'admin_signed' } });
      await assert.rejects(
        () => handler(VALID_DATA, adminCtx),
        (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
      );
    });
  });

  // ── Success path — update payload ────────────────────────────────────────────

  describe('success — update payload', () => {
    beforeEach(() => {
      resetStubs();
      delete process.env.LINE_CHANNEL_ACCESS_TOKEN; // keep notify silent
    });

    it('calls ref.update with the correct set of fields', async () => {
      const res = await handler(VALID_DATA, adminCtx);
      assert.equal(res.signed, true);
      assert.equal(captured.updateCalls.length, 1);
      const payload = captured.updateCalls[0];
      assert.equal(payload.adminSignaturePath, VALID_DATA.adminSignaturePath);
      assert.equal(payload.adminSignedBy, adminCtx.auth.uid);
      assert.equal(payload.status, 'admin_signed');
      assert.deepEqual(payload.adminSignedAt, serverTimestampSentinel);
      assert.deepEqual(payload.updatedAt, serverTimestampSentinel);
    });

    it('truncates adminSignaturePath to 500 characters when longer', async () => {
      const longPath = 'x'.repeat(600);
      const res = await handler({ ...VALID_DATA, adminSignaturePath: longPath }, adminCtx);
      assert.equal(res.signed, true);
      assert.equal(captured.updateCalls[0].adminSignaturePath.length, 500);
    });
  });

  // ── Notify — no LINE token ───────────────────────────────────────────────────

  describe('notify — no LINE token', () => {
    beforeEach(() => {
      resetStubs();
      delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    });

    it('returns { signed: true, notified: 0 } when LINE token is absent', async () => {
      const res = await handler(VALID_DATA, adminCtx);
      assert.equal(res.signed, true);
      assert.equal(res.notified, 0);
    });
  });

  // ── Notify — no approved liffUsers ───────────────────────────────────────────

  describe('notify — no approved liffUsers', () => {
    beforeEach(() => {
      resetStubs({ liffUsersEmpty: true, liffUsersDocs: [] });
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    });

    it('returns notified=0 and does not call fetch when liffUsers query is empty', async () => {
      const res = await handler(VALID_DATA, adminCtx);
      assert.equal(res.notified, 0);
      assert.equal(captured.fetchCalls.length, 0);
    });
  });

  // ── Notify — missing building / roomId on instance ───────────────────────────

  describe('notify — missing building or roomId on instance', () => {
    beforeEach(() => {
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    });

    it('returns notified=0 when instance has no building field', async () => {
      resetStubs({
        instanceData: { status: 'submitted', roomId: '15', type: 'move_in' },
      });
      const res = await handler(VALID_DATA, adminCtx);
      assert.equal(res.notified, 0);
      assert.equal(captured.fetchCalls.length, 0);
    });

    it('returns notified=0 when instance has no roomId field', async () => {
      resetStubs({
        instanceData: { status: 'submitted', building: 'rooms', type: 'move_in' },
      });
      const res = await handler(VALID_DATA, adminCtx);
      assert.equal(res.notified, 0);
      assert.equal(captured.fetchCalls.length, 0);
    });
  });

  // ── Notify — successful LINE push ────────────────────────────────────────────

  describe('notify — successful LINE push', () => {
    beforeEach(() => {
      resetStubs({ fetchOk: true });
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    });

    it('returns notified=1 and calls fetch once when one liffUser exists', async () => {
      resetStubs({ liffUsersDocs: [{ id: 'Utenant1' }], fetchOk: true });
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';

      const res = await handler(VALID_DATA, adminCtx);
      assert.equal(res.signed, true);
      assert.equal(res.notified, 1);
      assert.equal(captured.fetchCalls.length, 1);
      assert.equal(captured.fetchCalls[0].url, 'https://api.line.me/v2/bot/message/push');
    });

    it('returns notified=2 and calls fetch twice when two liffUsers exist', async () => {
      resetStubs({
        liffUsersDocs: [{ id: 'Utenant1' }, { id: 'Utenant2' }],
        fetchOk:       true,
      });
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';

      const res = await handler(VALID_DATA, adminCtx);
      assert.equal(res.notified, 2);
      assert.equal(captured.fetchCalls.length, 2);
    });
  });

  // ── Notify — LINE push failure → enqueueLineRetry ────────────────────────────

  describe('notify — LINE push failure triggers enqueueLineRetry', () => {
    beforeEach(() => {
      resetStubs({
        liffUsersDocs: [{ id: 'Utenant1' }],
        fetchOk:       false,
        fetchStatus:   429,
      });
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    });

    it('returns notified=0 when LINE returns a non-ok status', async () => {
      const res = await handler(VALID_DATA, adminCtx);
      assert.equal(res.notified, 0);
    });

    it('calls enqueueLineRetry once on LINE push failure', async () => {
      await handler(VALID_DATA, adminCtx);
      assert.equal(captured.lineRetryEnqueues.length, 1);
    });

    it('enqueueLineRetry payload contains correct idempotencyKey', async () => {
      await handler(VALID_DATA, adminCtx);
      const enqueue = captured.lineRetryEnqueues[0];
      const expectedKey = `checklist-signed-${VALID_DATA.instanceId}-Utenant1`;
      assert.equal(enqueue.idempotencyKey, expectedKey);
    });

    it('enqueueLineRetry payload contains lineUserId, message, and context', async () => {
      await handler(VALID_DATA, adminCtx);
      const enqueue = captured.lineRetryEnqueues[0];
      assert.equal(enqueue.lineUserId, 'Utenant1');
      assert.ok(enqueue.message, 'message field should be present');
      assert.ok(enqueue.context, 'context field should be present');
      assert.equal(enqueue.context.source, 'adminSignChecklist');
    });
  });

  // ── Notify — liffUsers query error ───────────────────────────────────────────

  describe('notify — liffUsers query error', () => {
    beforeEach(() => {
      resetStubs({ liffUsersQueryError: new Error('permission-denied') });
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    });

    it('returns { signed: true, notified: 0 } when liffUsers query throws', async () => {
      const res = await handler(VALID_DATA, adminCtx);
      assert.equal(res.signed, true);
      assert.equal(res.notified, 0);
      assert.equal(captured.fetchCalls.length, 0);
    });
  });

  // ── Update error propagation ──────────────────────────────────────────────────

  describe('update error propagation', () => {
    beforeEach(() => {
      resetStubs({ updateError: new Error('Firestore unavailable') });
      delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    });

    it('propagates Firestore update errors as a plain Error (not wrapped in HttpsError)', async () => {
      await assert.rejects(
        () => handler(VALID_DATA, adminCtx),
        (err) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, 'Firestore unavailable');
          return true;
        }
      );
    });
  });
});
