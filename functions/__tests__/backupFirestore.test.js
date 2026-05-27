/**
 * Unit tests for backupFirestore.js
 *
 * Tests runBackup() (via HTTP/scheduled handlers), ensureBackupBucket(),
 * pruneOldBackups(), tsStamp(), backupFirestoreScheduled (pubsub onRun),
 * and backupFirestore (https.onRequest).
 * All external modules are stubbed — no network or GCP required.
 *
 * Run: node --test functions/__tests__/backupFirestore.test.js
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Captured handlers ─────────────────────────────────────────────────────────

let capturedScheduledHandler = null;
let capturedHttpHandler = null;
let requireAdminStub = null;

// ── Call tracking ─────────────────────────────────────────────────────────────

const calls = {
  exportDocuments: [],
  createBucket: null,
};
const fsSetCalls = [];

// ── Operation stub (mutable state) ────────────────────────────────────────────

const operationState = {
  name: 'op/123',
  promiseShouldThrow: false,
};

const operationStub = {
  get name() { return operationState.name; },
  promise: async () => {
    if (operationState.promiseShouldThrow) throw new Error('Export failed');
  },
};

// ── Firestore Admin client stub ───────────────────────────────────────────────

const firestoreClientStub = {
  databasePath: (projectId, db) => `projects/${projectId}/databases/${db}`,
  exportDocuments: async (opts) => {
    calls.exportDocuments.push(opts);
    return [operationStub];
  },
};

const firestoreLibStub = {
  v1: {
    FirestoreAdminClient: function () { return firestoreClientStub; },
  },
};

// ── Storage stub (mutable state) ──────────────────────────────────────────────

let bucketExistsState = true;
let bucketFilesState = [];   // array of file stubs
let getFilesError = null;

const storageStub = {
  bucket: (name) => ({
    exists: async () => [bucketExistsState],
    getFiles: async (opts) => {
      if (getFilesError) throw getFilesError;
      return [bucketFilesState];
    },
  }),
  createBucket: async (name, opts) => {
    calls.createBucket = { name, opts };
  },
};

const StorageStub = function () { return storageStub; };

// ── admin.firestore() factory stub ────────────────────────────────────────────

const fsMakeInstance = () => ({
  collection: (col) => ({
    doc: (docId) => ({
      collection: (sub) => ({
        doc: (subId) => ({
          set: async (data) => {
            fsSetCalls.push({ path: `${col}/${docId}/${sub}/${subId}`, data: { ...data } });
          },
        }),
      }),
    }),
  }),
});

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(fsMakeInstance, {
    FieldValue: { serverTimestamp: () => '__ts__' },
    Timestamp: { fromMillis: (ms) => ({ _ms: ms }) },
  }),
};

// ── Module._load intercept ────────────────────────────────────────────────────

const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === '@google-cloud/firestore') return firestoreLibStub;
  if (request === '@google-cloud/storage') return { Storage: StorageStub };
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') {
    return {
      region: () => ({
        runWith: () => ({
          pubsub: {
            schedule: () => ({
              timeZone: () => ({
                onRun: (h) => {
                  capturedScheduledHandler = h;
                  return {};
                },
              }),
            }),
          },
          https: {
            onRequest: (h) => {
              capturedHttpHandler = h;
              return {};
            },
          },
        }),
      }),
    };
  }
  if (request === './_auth') {
    return {
      requireAdmin: async (req, res) => requireAdminStub(req, res),
    };
  }
  return _origLoad.call(this, request, parent, ...rest);
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(daysOld) {
  const d = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  return {
    metadata: { timeCreated: d.toISOString() },
    _deleted: false,
    delete: async function () { this._deleted = true; },
  };
}

/** Minimal Express-like res stub — all fluent methods return this. */
function makeRes() {
  const r = {
    _status: 200,
    _body: undefined,
    _ended: false,
    _headers: {},
    set(k, v) { this._headers[k] = v; return this; },
    status(code) { this._status = code; return this; },
    json(b) { this._body = b; return this; },
    send(b) { this._body = b; return this; },
    end() { this._ended = true; return this; },
  };
  return r;
}

function resetCalls() {
  calls.exportDocuments.length = 0;
  calls.createBucket = null;
  fsSetCalls.length = 0;
}

// ── Run runBackup() via the scheduled handler ─────────────────────────────────
// Returns the result (from the log call) or throws.
async function runBackupViaScheduled() {
  // The scheduled handler calls runBackup() and returns null on success.
  // We can't get the runBackup return value from it directly, but we can
  // instead drive via the HTTP handler with requireAdmin returning a decoded token.
  throw new Error('Use runBackupViaHttp() instead');
}

/** Run runBackup() via the HTTP handler. Returns the parsed body. */
async function runBackupViaHttp() {
  requireAdminStub = () => ({ uid: 'admin' });
  const req = { method: 'POST' };
  const res = makeRes();
  await capturedHttpHandler(req, res);
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('backupFirestore', () => {
  before(() => {
    process.env.GCLOUD_PROJECT = 'test-project';
    require('../backupFirestore');
  });

  after(() => {
    Module._load = _origLoad;
    delete require.cache[require.resolve('../backupFirestore')];
  });

  beforeEach(() => {
    resetCalls();
    operationState.name = 'op/123';
    operationState.promiseShouldThrow = false;
    bucketExistsState = true;
    bucketFilesState = [];
    getFilesError = null;
    requireAdminStub = () => ({ uid: 'admin' });
  });

  // ── ensureBackupBucket ──────────────────────────────────────────────────────

  describe('ensureBackupBucket', () => {
    it('bucket exists — no createBucket call', async () => {
      bucketExistsState = true;
      await runBackupViaHttp();
      assert.equal(calls.createBucket, null, 'createBucket should not be called when bucket exists');
    });

    it('bucket does not exist — createBucket called with correct name', async () => {
      bucketExistsState = false;
      await runBackupViaHttp();
      assert.ok(calls.createBucket, 'createBucket should have been called');
      assert.equal(calls.createBucket.name, 'test-project-firestore-backups');
    });

    it('bucket does not exist — createBucket called with correct location', async () => {
      bucketExistsState = false;
      await runBackupViaHttp();
      assert.ok(calls.createBucket, 'createBucket should have been called');
      assert.equal(calls.createBucket.opts.location, 'asia-southeast3');
    });

    it('returns BACKUP_BUCKET — outputUriPrefix references correct bucket', async () => {
      bucketExistsState = true;
      const res = await runBackupViaHttp();
      assert.ok(
        res._body.outputUriPrefix.startsWith('gs://test-project-firestore-backups/'),
        `outputUriPrefix should reference the correct bucket, got: ${res._body.outputUriPrefix}`
      );
    });
  });

  // ── runBackup — PROJECT_ID missing ─────────────────────────────────────────

  describe('runBackup — PROJECT_ID missing', () => {
    it('throws (500) when GCLOUD_PROJECT and GCP_PROJECT are both unset', async () => {
      // PROJECT_ID is module-level const — captured at require() time.
      // We can't unset it after the module is loaded. Instead we verify
      // the guard by checking the module loads it from the env at startup.
      // The behaviour when both vars are absent at load-time:
      //   if (!PROJECT_ID) throw new Error('GCLOUD_PROJECT / GCP_PROJECT env not set')
      // We test this indirectly: delete both env vars, clear require cache,
      // re-require to get a fresh module instance, then run backup.
      const savedG = process.env.GCLOUD_PROJECT;
      const savedGCP = process.env.GCP_PROJECT;
      delete process.env.GCLOUD_PROJECT;
      delete process.env.GCP_PROJECT;
      delete require.cache[require.resolve('../backupFirestore')];

      let freshHttp = null;
      const origOnRequest = null;
      // Temporarily replace the http handler capture
      let tempHttp = null;
      const prevLoad = Module._load;
      Module._load = function (request, parent, ...rest) {
        if (request === 'firebase-functions/v1') {
          return {
            region: () => ({
              runWith: () => ({
                pubsub: {
                  schedule: () => ({
                    timeZone: () => ({
                      onRun: (h) => { return {}; },
                    }),
                  }),
                },
                https: {
                  onRequest: (h) => {
                    tempHttp = h;
                    return {};
                  },
                },
              }),
            }),
          };
        }
        return prevLoad.call(this, request, parent, ...rest);
      };
      require('../backupFirestore');
      Module._load = prevLoad;

      try {
        requireAdminStub = () => ({ uid: 'admin' });
        const req = { method: 'POST' };
        const res = makeRes();
        await tempHttp(req, res);
        assert.equal(res._status, 500, 'Should respond 500 when PROJECT_ID is missing');
        assert.ok(
          res._body.error &&
          (res._body.error.includes('GCLOUD_PROJECT') || res._body.error.includes('GCP_PROJECT')),
          `Expected env-var error message, got: ${JSON.stringify(res._body)}`
        );
      } finally {
        process.env.GCLOUD_PROJECT = savedG;
        if (savedGCP !== undefined) process.env.GCP_PROJECT = savedGCP;
        delete require.cache[require.resolve('../backupFirestore')];
        resetCalls();
      }
    });
  });

  // ── runBackup — happy path ──────────────────────────────────────────────────

  describe('runBackup — happy path', () => {
    it('calls exportDocuments with correct databaseName', async () => {
      await runBackupViaHttp();
      assert.equal(calls.exportDocuments.length, 1);
      assert.equal(
        calls.exportDocuments[0].name,
        'projects/test-project/databases/(default)'
      );
    });

    it('outputUriPrefix starts with gs://test-project-firestore-backups/firestore-backups/', async () => {
      const res = await runBackupViaHttp();
      assert.equal(res._status, 200);
      assert.ok(
        res._body.outputUriPrefix.startsWith('gs://test-project-firestore-backups/firestore-backups/'),
        `got: ${res._body.outputUriPrefix}`
      );
    });

    it('writeBackupStatus writes queued status to system/backups/state/latest', async () => {
      await runBackupViaHttp();
      const queuedLatest = fsSetCalls.find(
        (c) => c.path === 'system/backups/state/latest' && c.data.status === 'queued'
      );
      assert.ok(queuedLatest, 'Should have written queued status to state/latest');
    });

    it('writeBackupStatus writes queued status to system/backups/history/<stamp>', async () => {
      await runBackupViaHttp();
      const queuedHistory = fsSetCalls.find(
        (c) => c.path.startsWith('system/backups/history/') && c.data.status === 'queued'
      );
      assert.ok(queuedHistory, 'Should have written queued status to history/<stamp>');
    });

    it('writeBackupStatus writes success status to state/latest after operation.promise()', async () => {
      await runBackupViaHttp();
      const successLatest = fsSetCalls.find(
        (c) => c.path === 'system/backups/state/latest' && c.data.status === 'success'
      );
      assert.ok(successLatest, 'Should have written success status to state/latest');
    });

    it('returns { success:true, stamp, outputUriPrefix, operationName, status:success }', async () => {
      const res = await runBackupViaHttp();
      assert.equal(res._status, 200);
      assert.equal(res._body.success, true);
      assert.ok(res._body.stamp, 'stamp should be present');
      assert.ok(res._body.outputUriPrefix, 'outputUriPrefix should be present');
      assert.ok(res._body.operationName, 'operationName should be present');
      assert.equal(res._body.status, 'success');
    });

    it('returns durationMs as a non-negative number', async () => {
      const res = await runBackupViaHttp();
      assert.ok(
        typeof res._body.durationMs === 'number' && res._body.durationMs >= 0,
        `durationMs should be >= 0, got ${res._body.durationMs}`
      );
    });

    it('returns pruned object with scanned and deleted fields', async () => {
      const res = await runBackupViaHttp();
      assert.ok(res._body.pruned !== undefined, 'pruned should be present');
      assert.ok(typeof res._body.pruned.scanned === 'number', 'pruned.scanned should be a number');
      assert.ok(typeof res._body.pruned.deleted === 'number', 'pruned.deleted should be a number');
    });
  });

  // ── runBackup — export fails ────────────────────────────────────────────────

  describe('runBackup — export fails (operation.promise throws)', () => {
    beforeEach(() => {
      operationState.promiseShouldThrow = true;
    });

    it('writeBackupStatus called with status failed', async () => {
      await runBackupViaHttp();
      const failedCall = fsSetCalls.find((c) => c.data.status === 'failed');
      assert.ok(failedCall, 'Should have written failed status');
    });

    it('writeBackupStatus includes error field when failed', async () => {
      await runBackupViaHttp();
      const failedCall = fsSetCalls.find((c) => c.data.status === 'failed');
      assert.ok(failedCall, 'failed status call should exist');
      assert.ok(
        failedCall.data.error !== undefined && failedCall.data.error !== null,
        'error field should be set on failed status'
      );
    });

    it('HTTP handler responds 500 when export fails', async () => {
      const res = await runBackupViaHttp();
      assert.equal(res._status, 500);
    });

    it('error message contains Firestore export failed', async () => {
      const res = await runBackupViaHttp();
      assert.ok(
        res._body.error &&
        (res._body.error.toLowerCase().includes('firestore export failed') ||
          res._body.error.toLowerCase().includes('export failed')),
        `Unexpected error: ${res._body.error}`
      );
    });

    it('pruneOldBackups still runs even when export fails', async () => {
      const file = makeFile(40); // older than 30-day retention
      bucketFilesState = [file];
      await runBackupViaHttp();
      assert.ok(file._deleted, 'Old file should have been deleted even after failed export');
    });
  });

  // ── pruneOldBackups ─────────────────────────────────────────────────────────

  describe('pruneOldBackups', () => {
    it('no files — returns { scanned: 0, deleted: 0 }', async () => {
      bucketFilesState = [];
      const res = await runBackupViaHttp();
      assert.equal(res._body.pruned.scanned, 0);
      assert.equal(res._body.pruned.deleted, 0);
    });

    it('all files recent — scanned=N, deleted=0', async () => {
      bucketFilesState = [makeFile(1), makeFile(5), makeFile(10)];
      const res = await runBackupViaHttp();
      assert.equal(res._body.pruned.scanned, 3);
      assert.equal(res._body.pruned.deleted, 0);
    });

    it('files older than 30 days — delete called, deleted=N', async () => {
      const old1 = makeFile(31);
      const old2 = makeFile(45);
      const recent = makeFile(1);
      bucketFilesState = [old1, old2, recent];
      const res = await runBackupViaHttp();
      assert.equal(res._body.pruned.scanned, 3);
      assert.equal(res._body.pruned.deleted, 2);
      assert.ok(old1._deleted, 'old1 should be deleted');
      assert.ok(old2._deleted, 'old2 should be deleted');
      assert.ok(!recent._deleted, 'recent file should not be deleted');
    });

    it('getFiles error — runBackup still succeeds, pruning swallowed', async () => {
      getFilesError = new Error('storage error');
      // pruneOldBackups swallows errors internally; runBackup should still return 200
      const res = await runBackupViaHttp();
      assert.equal(res._status, 200, 'runBackup should succeed even when getFiles throws');
      assert.equal(res._body.success, true);
    });
  });

  // ── tsStamp ─────────────────────────────────────────────────────────────────

  describe('tsStamp (via stamp in runBackup result)', () => {
    it('stamp matches YYYY-MM-DD_HHmmss format', async () => {
      const res = await runBackupViaHttp();
      assert.match(
        res._body.stamp,
        /^\d{4}-\d{2}-\d{2}_\d{6}$/,
        `stamp "${res._body.stamp}" should match YYYY-MM-DD_HHmmss`
      );
    });
  });

  // ── backupFirestoreScheduled ────────────────────────────────────────────────

  describe('backupFirestoreScheduled', () => {
    it('handler is captured at module load', () => {
      assert.ok(
        typeof capturedScheduledHandler === 'function',
        'scheduled handler should be a function'
      );
    });

    it('happy path — returns null', async () => {
      const result = await capturedScheduledHandler({});
      assert.equal(result, null);
    });

    it('propagates throw when runBackup fails', async () => {
      operationState.promiseShouldThrow = true;
      await assert.rejects(
        () => capturedScheduledHandler({}),
        (err) => {
          assert.ok(
            err.message.toLowerCase().includes('export failed'),
            `Unexpected error: ${err.message}`
          );
          return true;
        }
      );
    });
  });

  // ── backupFirestore HTTP handler ────────────────────────────────────────────

  describe('backupFirestore HTTP handler', () => {
    it('handler is captured at module load', () => {
      assert.ok(
        typeof capturedHttpHandler === 'function',
        'HTTP handler should be a function'
      );
    });

    it('OPTIONS request — responds 204', async () => {
      const req = { method: 'OPTIONS' };
      const res = makeRes();
      await capturedHttpHandler(req, res);
      assert.equal(res._status, 204);
    });

    it('GET request — responds 405', async () => {
      const req = { method: 'GET' };
      const res = makeRes();
      await capturedHttpHandler(req, res);
      assert.equal(res._status, 405);
    });

    it('requireAdmin returns null (blocked) — no backup runs', async () => {
      requireAdminStub = (_req, res) => {
        res.status(403).json({ error: 'Forbidden' });
        return null; // null signals "handled by requireAdmin, caller should return"
      };
      const req = { method: 'POST' };
      const res = makeRes();
      await capturedHttpHandler(req, res);
      assert.equal(res._status, 403);
      assert.equal(calls.exportDocuments.length, 0, 'exportDocuments should not be called');
    });

    it('POST happy path — responds 200 with { success: true, ...result }', async () => {
      requireAdminStub = () => ({ uid: 'admin' });
      const req = { method: 'POST' };
      const res = makeRes();
      await capturedHttpHandler(req, res);
      assert.equal(res._status, 200);
      assert.equal(res._body.success, true);
      assert.ok(res._body.stamp, 'body.stamp should be present');
      assert.equal(res._body.status, 'success');
    });

    it('POST error — responds 500', async () => {
      requireAdminStub = () => ({ uid: 'admin' });
      operationState.promiseShouldThrow = true;
      const req = { method: 'POST' };
      const res = makeRes();
      await capturedHttpHandler(req, res);
      assert.equal(res._status, 500);
    });
  });
});
