/**
 * Unit tests for deleteChecklistInstance Cloud Function.
 *
 * Design notes:
 *   - admin.firestore() is called at MODULE LOAD TIME (singleton), so the
 *     Module._load intercept must be installed BEFORE require('../deleteChecklistInstance').
 *   - admin.storage() is called INSIDE the handler (factory, not singleton),
 *     so the storageBucketStub is wired through adminStub.storage() directly.
 *   - All test-controlled state lives in closure variables reset in beforeEach().
 *
 * Run: node --test functions/__tests__/deleteChecklistInstance.test.js
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module  = require('module');

// ── Per-test mutable state ──────────────────────────────────────────────────
// All state must be reset in beforeEach so tests cannot bleed into each other.

let instanceData       = null;   // null → doc does not exist; object → doc data
let docDeleteCalled    = false;
let storageBucketFiles = [];     // logical file descriptors for getFiles to return
let storageGetFilesThrow = false;
let storageDeleteThrow   = false;
const storageDeleteCalls = [];   // populated by each fake file's delete()

function resetStubs(overrides = {}) {
  instanceData         = overrides.instanceData         !== undefined ? overrides.instanceData : null;
  docDeleteCalled      = false;
  storageBucketFiles   = overrides.storageBucketFiles   !== undefined ? overrides.storageBucketFiles : [];
  storageGetFilesThrow = overrides.storageGetFilesThrow || false;
  storageDeleteThrow   = overrides.storageDeleteThrow   || false;
  storageDeleteCalls.length = 0;
}

// ── Captured values ─────────────────────────────────────────────────────────
let capturedGetFilesOpts = null;  // the opts object passed to bucket.getFiles()

// ── Storage bucket stub ─────────────────────────────────────────────────────
const storageBucketStub = {
  getFiles: async (opts) => {
    capturedGetFilesOpts = opts;
    if (storageGetFilesThrow) throw new Error('Storage error');
    const files = storageBucketFiles.map((descriptor) => ({
      name: descriptor,
      delete: async (_opts) => {
        if (storageDeleteThrow) throw new Error('delete failed');
        storageDeleteCalls.push(descriptor);
      },
    }));
    return [files];
  },
};

// ── Firestore singleton stub ────────────────────────────────────────────────
// Returned by admin.firestore() at MODULE LOAD TIME; reads closure vars at
// call-time so every test sees the current value of instanceData.
const fsInstance = {
  collection: (_name) => ({
    doc: (_id) => ({
      get: async () => ({
        exists: instanceData !== null,
        data:   () => instanceData || {},
      }),
      delete: async () => {
        docDeleteCalled = true;
      },
    }),
  }),
};

// ── firebase-admin stub ─────────────────────────────────────────────────────
const adminStub = {
  apps:          [{}],
  initializeApp: () => {},
  // admin.firestore() returns the singleton stub; admin.firestore.FieldValue is
  // attached as a property on the function (mirrors the real Admin SDK shape).
  firestore: Object.assign(() => fsInstance, {
    FieldValue: { serverTimestamp: () => '__ts__' },
  }),
  // admin.storage() is called INSIDE the handler on every invocation (factory).
  storage: () => ({ bucket: () => storageBucketStub }),
};

// ── Module._load intercept ──────────────────────────────────────────────────
// Must be installed BEFORE require('../deleteChecklistInstance') so top-level
// require() calls inside the CF are intercepted on the very first load.

let capturedHandler = null;
const _origLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') {
    return adminStub;
  }

  if (request === 'firebase-functions/v1') {
    const HttpsError = class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    };
    // Support: functions.region('...').https.onCall(handler)
    return {
      region: () => ({
        https: {
          HttpsError,
          onCall: (fn) => { capturedHandler = fn; return fn; },
        },
      }),
      https: { HttpsError },
    };
  }

  return _origLoad.apply(this, arguments);
};

// ── Load CF under test ──────────────────────────────────────────────────────
const cfExports = require('../deleteChecklistInstance');

// ── Teardown ────────────────────────────────────────────────────────────────
after(() => {
  Module._load = _origLoad;
});

// ── Handler reference ───────────────────────────────────────────────────────
const handler = capturedHandler || cfExports.deleteChecklistInstance;

// ── Context helpers ─────────────────────────────────────────────────────────
const adminCtx = { auth: { uid: 'admin-uid-1', token: { admin: true } } };
const noAuth   = { auth: undefined };

const VALID_DATA = { instanceId: 'INST_XYZ' };

// ── Default instance data ───────────────────────────────────────────────────
const DEFAULT_INSTANCE = { building: 'rooms', roomId: '15', type: 'move_in' };

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('deleteChecklistInstance', () => {

  // ── Auth gates ────────────────────────────────────────────────────────────

  describe('auth gates', () => {
    beforeEach(() => resetStubs());

    it('throws unauthenticated when context.auth is undefined', async () => {
      await assert.rejects(
        () => handler(VALID_DATA, noAuth),
        (err) => { assert.equal(err.code, 'unauthenticated'); return true; },
      );
    });

    it('throws permission-denied when admin token claim is not true', async () => {
      const ctx = { auth: { uid: 'uid-1', token: {} } };
      await assert.rejects(
        () => handler(VALID_DATA, ctx),
        (err) => { assert.equal(err.code, 'permission-denied'); return true; },
      );
    });
  });

  // ── Input validation ──────────────────────────────────────────────────────

  describe('input validation', () => {
    beforeEach(() => resetStubs());

    it('throws invalid-argument when instanceId is absent', async () => {
      await assert.rejects(
        () => handler({}, adminCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; },
      );
    });

    it('throws invalid-argument when instanceId is an empty string', async () => {
      await assert.rejects(
        () => handler({ instanceId: '' }, adminCtx),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; },
      );
    });
  });

  // ── Instance loading ──────────────────────────────────────────────────────

  describe('instance loading', () => {
    beforeEach(() => resetStubs());

    it('throws not-found when the checklist instance does not exist', async () => {
      // instanceData is null → doc.exists === false
      await assert.rejects(
        () => handler(VALID_DATA, adminCtx),
        (err) => { assert.equal(err.code, 'not-found'); return true; },
      );
    });
  });

  // ── Storage cleanup — prefix calculation ──────────────────────────────────

  describe('storage cleanup — prefix calculation', () => {
    beforeEach(() => {
      capturedGetFilesOpts = null;
      resetStubs({
        instanceData: DEFAULT_INSTANCE,
        storageBucketFiles: ['file-a.png'],
      });
    });

    it('calls bucket.getFiles with the correct checklists/ prefix', async () => {
      await handler(VALID_DATA, adminCtx);
      assert.ok(capturedGetFilesOpts, 'getFiles should have been called');
      assert.equal(
        capturedGetFilesOpts.prefix,
        `checklists/${DEFAULT_INSTANCE.building}/${DEFAULT_INSTANCE.roomId}/${VALID_DATA.instanceId}/`,
      );
    });
  });

  // ── Storage cleanup — file deletion ──────────────────────────────────────

  describe('storage cleanup — file deletion', () => {
    beforeEach(() => resetStubs({ instanceData: DEFAULT_INSTANCE }));

    it('reports storageFilesDeleted = 3 and calls delete on each file when 3 files exist', async () => {
      resetStubs({
        instanceData: DEFAULT_INSTANCE,
        storageBucketFiles: ['file1.png', 'file2.png', 'file3.png'],
      });
      const result = await handler(VALID_DATA, adminCtx);
      assert.equal(result.storageFilesDeleted, 3);
      assert.equal(storageDeleteCalls.length, 3);
    });

    it('reports storageFilesDeleted = 0 when getFiles returns empty array', async () => {
      resetStubs({ instanceData: DEFAULT_INSTANCE, storageBucketFiles: [] });
      const result = await handler(VALID_DATA, adminCtx);
      assert.equal(result.storageFilesDeleted, 0);
      assert.equal(storageDeleteCalls.length, 0);
    });
  });

  // ── Storage cleanup — skipped when building or roomId absent ─────────────

  describe('storage cleanup — skipped when building/roomId absent', () => {
    beforeEach(() => {
      capturedGetFilesOpts = null;
    });

    it('does not access storage and returns storageFilesDeleted = 0 when building is null', async () => {
      resetStubs({ instanceData: { building: null, roomId: '15' } });
      const result = await handler(VALID_DATA, adminCtx);
      assert.equal(result.storageFilesDeleted, 0);
      assert.equal(capturedGetFilesOpts, null, 'getFiles must NOT be called');
    });

    it('does not access storage and returns storageFilesDeleted = 0 when roomId is missing', async () => {
      resetStubs({ instanceData: { building: 'rooms' } });
      const result = await handler(VALID_DATA, adminCtx);
      assert.equal(result.storageFilesDeleted, 0);
      assert.equal(capturedGetFilesOpts, null, 'getFiles must NOT be called');
    });
  });

  // ── Storage cleanup — best-effort error handling ──────────────────────────

  describe('storage cleanup — errors are caught and do not block doc.delete', () => {
    it('getFiles throws → error is caught and ref.delete is still called', async () => {
      resetStubs({
        instanceData: DEFAULT_INSTANCE,
        storageGetFilesThrow: true,
      });
      // Should not throw despite storage error
      const result = await handler(VALID_DATA, adminCtx);
      assert.equal(docDeleteCalled, true, 'ref.delete must still be called');
      assert.equal(result.deleted, true);
    });

    it('file.delete throws → error is caught, storageFilesDeleted still reflects files.length', async () => {
      resetStubs({
        instanceData: DEFAULT_INSTANCE,
        storageBucketFiles: ['f1.png', 'f2.png'],
        storageDeleteThrow: true,
      });
      // getFiles succeeds (returns 2 files); individual delete throws
      // The CF sets storageFilesDeleted = files.length BEFORE calling delete,
      // then catches the delete error — so it should still return 2.
      const result = await handler(VALID_DATA, adminCtx);
      assert.equal(result.storageFilesDeleted, 2);
      assert.equal(docDeleteCalled, true, 'ref.delete must still be called');
    });
  });

  // ── Firestore delete ──────────────────────────────────────────────────────

  describe('Firestore delete', () => {
    beforeEach(() => resetStubs({ instanceData: DEFAULT_INSTANCE }));

    it('calls ref.delete()', async () => {
      await handler(VALID_DATA, adminCtx);
      assert.equal(docDeleteCalled, true);
    });

    it('returns { deleted: true, storageFilesDeleted: 0 } when no files exist', async () => {
      const result = await handler(VALID_DATA, adminCtx);
      assert.deepEqual(result, { deleted: true, storageFilesDeleted: 0 });
    });
  });

  // ── Complete happy path ───────────────────────────────────────────────────

  describe('happy path — complete flow', () => {
    before(() => {
      resetStubs({
        instanceData: DEFAULT_INSTANCE,
        storageBucketFiles: ['photo1.png', 'signature_tenant.png'],
      });
    });

    it('returns { deleted: true, storageFilesDeleted: 2 } for admin + valid instance + 2 files', async () => {
      const result = await handler(VALID_DATA, adminCtx);
      assert.equal(result.deleted, true);
      assert.equal(result.storageFilesDeleted, 2);
      assert.equal(docDeleteCalled, true);
      assert.equal(storageDeleteCalls.length, 2);
    });
  });

});
