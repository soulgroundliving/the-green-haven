/**
 * Unit tests for submitChecklist Cloud Function.
 *
 * Design notes:
 *   - admin.firestore() is called at MODULE LOAD TIME (singleton), so the
 *     Module._load intercept must be installed BEFORE require('../submitChecklist').
 *   - All test-controlled state lives in `stubState` / `captured` closure
 *     variables that are reset in beforeEach() via resetStubs().
 *
 * Run: node --test functions/__tests__/submitChecklist.test.js
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

const DEFAULT_INSTANCE_DATA = {
  tenantUid: 'u1',
  status:    'pending',
  items: [
    { id: 'item1', label: 'Check Door' },
    { id: 'item2', label: 'Check Window' },
  ],
};

function resetStubs(overrides = {}) {
  stubState = {
    instanceExists: true,
    instanceData:   { ...DEFAULT_INSTANCE_DATA },
    updateError:    null,
    ...overrides,
  };
  captured = {
    updateArgs: null,
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
            captured.updateArgs = payload;
          },
        }),
      };
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
// Install BEFORE require('../submitChecklist') so that all top-level
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
    // Support: functions.region('...').https.onCall(fn)
    const regionProxy = {
      https: {
        HttpsError,
        onCall: (fn) => { capturedCallHandler = fn; return fn; },
      },
    };
    return {
      region: () => regionProxy,
      https:  { HttpsError },
    };
  }

  return _origLoad.apply(this, arguments);
};

// ── Load CF under test ─────────────────────────────────────────────────────────
// Require AFTER stubs are in place. The module-level `admin.firestore()` call
// executes here and receives `firestoreStub`.

const cfExports = require('../submitChecklist');

after(() => {
  Module._load = _origLoad;
});

// ── Handler reference ──────────────────────────────────────────────────────────
const handler = capturedCallHandler || cfExports.submitChecklist;

// ── Context helpers ────────────────────────────────────────────────────────────

function makeContext(uid = 'u1') {
  return { auth: { uid } };
}

const validCtx = makeContext('u1');
const noAuth   = { auth: undefined };

// ── Valid data shorthand ───────────────────────────────────────────────────────

const VALID_DATA = {
  instanceId:          'INST_001',
  items:               [
    { id: 'item1', note: 'looks good', checked: true, photoPath: 'checklists/rooms/15/item1.png' },
    { id: 'item2', note: '',           checked: false, photoPath: null },
  ],
  tenantSignaturePath: 'checklists/rooms/15/INST_001/signature.png',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('submitChecklist', () => {

  // ── Auth gates ───────────────────────────────────────────────────────────────

  describe('auth gates', () => {
    beforeEach(() => resetStubs());

    it('throws unauthenticated when context.auth is null', async () => {
      await assert.rejects(
        () => handler(VALID_DATA, { auth: null }),
        (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
      );
    });

    it('throws unauthenticated when context.auth.uid is undefined', async () => {
      await assert.rejects(
        () => handler(VALID_DATA, { auth: { uid: undefined } }),
        (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
      );
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────────

  describe('input validation', () => {
    beforeEach(() => resetStubs());

    it('throws invalid-argument when instanceId is missing', async () => {
      const { instanceId: _omit, ...rest } = VALID_DATA;
      await assert.rejects(
        () => handler(rest, validCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when instanceId is a number', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, instanceId: 123 }, validCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when items is undefined', async () => {
      const { items: _omit, ...rest } = VALID_DATA;
      await assert.rejects(
        () => handler(rest, validCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when items is a plain object (not an array)', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, items: { id: 'item1' } }, validCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when tenantSignaturePath is missing', async () => {
      const { tenantSignaturePath: _omit, ...rest } = VALID_DATA;
      await assert.rejects(
        () => handler(rest, validCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when tenantSignaturePath is a number', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, tenantSignaturePath: 42 }, validCtx),
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
        () => handler(VALID_DATA, validCtx),
        (err) => { assert.equal(err.code, 'not-found'); return true; }
      );
    });
  });

  // ── Ownership ────────────────────────────────────────────────────────────────

  describe('ownership', () => {
    beforeEach(() => resetStubs());

    it('throws permission-denied when callerUid does not match instance.tenantUid', async () => {
      await assert.rejects(
        () => handler(VALID_DATA, makeContext('other-uid')),
        (err) => { assert.equal(err.code, 'permission-denied'); return true; }
      );
    });

    it('proceeds when callerUid matches instance.tenantUid', async () => {
      const res = await handler(VALID_DATA, makeContext('u1'));
      assert.equal(res.submitted, true);
    });
  });

  // ── Status check ─────────────────────────────────────────────────────────────

  describe('status check', () => {
    it('throws failed-precondition when instance status is "submitted"', async () => {
      resetStubs({ instanceData: { ...DEFAULT_INSTANCE_DATA, status: 'submitted' } });
      await assert.rejects(
        () => handler(VALID_DATA, validCtx),
        (err) => {
          assert.equal(err.code, 'failed-precondition');
          assert.ok(err.message.includes('submitted'));
          return true;
        }
      );
    });

    it('throws failed-precondition when instance status is "reviewed"', async () => {
      resetStubs({ instanceData: { ...DEFAULT_INSTANCE_DATA, status: 'reviewed' } });
      await assert.rejects(
        () => handler(VALID_DATA, validCtx),
        (err) => {
          assert.equal(err.code, 'failed-precondition');
          assert.ok(err.message.includes('reviewed'));
          return true;
        }
      );
    });

    it('proceeds when instance status is "pending"', async () => {
      resetStubs();
      const res = await handler(VALID_DATA, validCtx);
      assert.equal(res.submitted, true);
    });
  });

  // ── Item sanitization ────────────────────────────────────────────────────────

  describe('item sanitization', () => {
    beforeEach(() => resetStubs());

    it('preserves a note string from filled items', async () => {
      const items = [
        { id: 'item1', note: 'looks good', checked: true, photoPath: null },
        { id: 'item2', note: 'slightly worn', checked: false, photoPath: null },
      ];
      await handler({ ...VALID_DATA, items }, validCtx);
      const merged = captured.updateArgs.items;
      assert.equal(merged[0].note, 'looks good');
      assert.equal(merged[1].note, 'slightly worn');
    });

    it('truncates note to 500 characters when longer', async () => {
      const longNote = 'a'.repeat(600);
      const items = [{ id: 'item1', note: longNote, checked: true }];
      await handler({ ...VALID_DATA, items }, validCtx);
      assert.equal(captured.updateArgs.items[0].note.length, 500);
    });

    it('sets note to empty string when filled item note is a number', async () => {
      const items = [{ id: 'item1', note: 42, checked: true }];
      await handler({ ...VALID_DATA, items }, validCtx);
      assert.equal(captured.updateArgs.items[0].note, '');
    });

    it('sets checked: true when filled item checked is exactly true', async () => {
      const items = [{ id: 'item1', note: '', checked: true }];
      await handler({ ...VALID_DATA, items }, validCtx);
      assert.equal(captured.updateArgs.items[0].checked, true);
    });

    it('sets checked: false when filled item checked is false', async () => {
      const items = [{ id: 'item1', note: '', checked: false }];
      await handler({ ...VALID_DATA, items }, validCtx);
      assert.equal(captured.updateArgs.items[0].checked, false);
    });

    it('sets checked: false when filled item checked is undefined', async () => {
      const items = [{ id: 'item1', note: '' }];
      await handler({ ...VALID_DATA, items }, validCtx);
      assert.equal(captured.updateArgs.items[0].checked, false);
    });

    it('sets checked: false when filled item checked is null', async () => {
      const items = [{ id: 'item1', note: '', checked: null }];
      await handler({ ...VALID_DATA, items }, validCtx);
      assert.equal(captured.updateArgs.items[0].checked, false);
    });

    it('preserves photoPath string from filled items', async () => {
      const items = [{ id: 'item1', note: '', checked: false, photoPath: 'checklists/rooms/15/photo.png' }];
      await handler({ ...VALID_DATA, items }, validCtx);
      assert.equal(captured.updateArgs.items[0].photoPath, 'checklists/rooms/15/photo.png');
    });

    it('sets photoPath to null when filled item photoPath is not a string', async () => {
      const items = [{ id: 'item1', note: '', checked: false, photoPath: 123 }];
      await handler({ ...VALID_DATA, items }, validCtx);
      assert.equal(captured.updateArgs.items[0].photoPath, null);
    });

    it('does not include extra/injected fields from filled items in merged output', async () => {
      const items = [{ id: 'item1', note: 'ok', checked: true, photoPath: null, injectedField: 'evil' }];
      await handler({ ...VALID_DATA, items }, validCtx);
      const mergedItem = captured.updateArgs.items[0];
      assert.ok(!Object.prototype.hasOwnProperty.call(mergedItem, 'injectedField'));
    });

    it('sets note="", checked=false, photoPath=null for template items with no matching filled item', async () => {
      await handler({ ...VALID_DATA, items: [] }, validCtx);
      const merged = captured.updateArgs.items;
      assert.equal(merged[0].id,        'item1');
      assert.equal(merged[0].label,     'Check Door');
      assert.equal(merged[0].note,      '');
      assert.equal(merged[0].checked,   false);
      assert.equal(merged[0].photoPath, null);
    });
  });

  // ── Persist ───────────────────────────────────────────────────────────────────

  describe('persist', () => {
    beforeEach(() => resetStubs());

    it('calls ref.update with the correct set of fields', async () => {
      const items = [
        { id: 'item1', note: 'ok', checked: true, photoPath: 'path/to/photo.png' },
        { id: 'item2', note: 'fine', checked: false, photoPath: null },
      ];
      await handler({ ...VALID_DATA, items }, validCtx);

      const payload = captured.updateArgs;
      assert.ok(payload, 'ref.update must have been called');

      // merged items shape
      assert.equal(payload.items.length, 2);
      assert.deepEqual(payload.items[0], {
        id: 'item1', label: 'Check Door', note: 'ok', checked: true, photoPath: 'path/to/photo.png',
      });
      assert.deepEqual(payload.items[1], {
        id: 'item2', label: 'Check Window', note: 'fine', checked: false, photoPath: null,
      });

      // other fields
      assert.equal(payload.tenantSignaturePath, VALID_DATA.tenantSignaturePath);
      assert.equal(payload.status, 'submitted');
      assert.deepEqual(payload.submittedAt, serverTimestampSentinel);
      assert.deepEqual(payload.updatedAt,   serverTimestampSentinel);
    });

    it('truncates tenantSignaturePath to 500 characters when longer', async () => {
      const longPath = 'p'.repeat(600);
      await handler({ ...VALID_DATA, tenantSignaturePath: longPath }, validCtx);
      assert.equal(captured.updateArgs.tenantSignaturePath.length, 500);
    });

    it('returns { submitted: true }', async () => {
      const res = await handler(VALID_DATA, validCtx);
      assert.deepEqual(res, { submitted: true });
    });
  });

  // ── Update error propagation ──────────────────────────────────────────────────

  describe('update error propagation', () => {
    beforeEach(() => {
      resetStubs({ updateError: new Error('Firestore unavailable') });
    });

    it('propagates Firestore update errors', async () => {
      await assert.rejects(
        () => handler(VALID_DATA, validCtx),
        (err) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, 'Firestore unavailable');
          return true;
        }
      );
    });
  });
});
