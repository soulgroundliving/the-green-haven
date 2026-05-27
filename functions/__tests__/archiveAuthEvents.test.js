/**
 * Unit tests for archiveAuthEvents.js
 *
 * Stubs: @google-cloud/bigquery, firebase-admin, firebase-functions/v1, ./_auth
 *
 * Run: node --test functions/__tests__/archiveAuthEvents.test.js
 */

'use strict';

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let bqState;
let fsState;
let batchDeleteRefs;
let batchCommitCalled;
let requireAdminStub;
let capturedScheduledHandler;
let capturedHttpHandler;

function resetStubs() {
  bqState = {
    datasetExists: true,
    tableExists: true,
    insertRows: [],
    insertShouldThrow: false,
    createDatasetCalled: false,
    createTableCalled: false,
    createTableOpts: null,
  };
  fsState = {
    docs: [],
  };
  batchDeleteRefs = [];
  batchCommitCalled = false;
  requireAdminStub = async (_req, _res) => ({ uid: 'admin-uid' });
}

resetStubs();

// ── BigQuery stub ─────────────────────────────────────────────────────────────

const bqTableStub = {
  exists: async () => [bqState.tableExists],
  insert: async (rows) => {
    if (bqState.insertShouldThrow) throw new Error('BQ insert failed');
    bqState.insertRows = rows;
  },
};

const bqDatasetStub = {
  exists: async () => [bqState.datasetExists],
  createTable: async (id, opts) => {
    bqState.createTableCalled = true;
    bqState.createTableOpts = opts;
  },
  table: (_tableId) => bqTableStub,
};

const bqStub = {
  dataset: (_id) => bqDatasetStub,
  createDataset: async (_id, _opts) => {
    bqState.createDatasetCalled = true;
  },
};

function BigQueryStub() {
  return bqStub;
}

// ── Firestore stub ────────────────────────────────────────────────────────────

function makeFirestoreInstance() {
  const fsQueryStub = {
    where: () => fsQueryStub,
    orderBy: () => fsQueryStub,
    limit: () => ({
      get: async () => {
        const docs = fsState.docs.map((d) => ({
          id: d.id,
          data: () => d.data,
          ref: {
            _id: d.id,
          },
        }));
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
        };
      },
    }),
  };

  return {
    collection: (_name) => fsQueryStub,
    batch: () => ({
      delete: (ref) => {
        batchDeleteRefs.push(ref._id);
      },
      commit: async () => {
        batchCommitCalled = true;
      },
    }),
  };
}

// ── Admin stub ────────────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(
    () => makeFirestoreInstance(),
    {
      Timestamp: {
        fromMillis: (ms) => ({ _ms: ms, toMillis: () => ms }),
      },
      FieldValue: {
        serverTimestamp: () => '__ts__',
      },
    }
  ),
};

// ── Module._load interception ─────────────────────────────────────────────────

const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === '@google-cloud/bigquery') {
    return { BigQuery: BigQueryStub };
  }
  if (request === 'firebase-admin') {
    return adminStub;
  }
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

// ── Require CF after stubs installed ─────────────────────────────────────────
// NOTE: Module._load is intentionally NOT restored here.
// archiveAuthEvents.js lazily requires './_auth' inside the HTTP handler at
// call time.  _auth.js does `require('firebase-admin')` at its own top level,
// so the interceptor must remain active for the entire test run.
// It is restored in the `after()` hook once all tests have finished.

delete require.cache[require.resolve('../archiveAuthEvents.js')];
require('../archiveAuthEvents.js');

// ── Request / response helpers ────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return { method: 'POST', body: {}, ...overrides };
}

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    _headers: {},
    set(key, val) {
      this._headers[key] = val;
      return this;
    },
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
    },
    send(body) {
      this._body = body;
    },
  };
  return res;
}

// ── Helper to build a Firestore-like Timestamp doc ───────────────────────────

function makeDoc(id, overrides = {}) {
  const base = {
    maskedEmail: 'u***@ex.com',
    ua: 'Mozilla/5.0',
    errorCode: 'auth/wrong-password',
    ts: { toDate: () => new Date('2025-01-01T00:00:00Z') },
  };
  return { id, data: { ...base, ...overrides } };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('archiveAuthEvents', () => {
  before(() => {
    assert.ok(capturedScheduledHandler, 'scheduled handler should be captured at load time');
    assert.ok(capturedHttpHandler, 'http handler should be captured at load time');
  });

  // Restore Module._load after all tests; it must stay active during the run
  // because archiveAuthEvents.js lazily requires './_auth' (which in turn
  // requires 'firebase-admin') at HTTP handler call time.
  after(() => {
    Module._load = _origLoad;
  });

  beforeEach(resetStubs);

  // ── ensureBigQueryTable ───────────────────────────────────────────────────

  describe('ensureBigQueryTable — dataset and table exist', () => {
    it('does not call createDataset when dataset already exists', async () => {
      fsState.docs = [makeDoc('d1')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(bqState.createDatasetCalled, false);
    });

    it('does not call createTable when table already exists', async () => {
      fsState.docs = [makeDoc('d1')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(bqState.createTableCalled, false);
    });
  });

  describe('ensureBigQueryTable — dataset missing', () => {
    it('calls createDataset when dataset does not exist', async () => {
      bqState.datasetExists = false;
      fsState.docs = [makeDoc('d1')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(bqState.createDatasetCalled, true);
    });
  });

  describe('ensureBigQueryTable — table missing', () => {
    it('calls createTable with schema and timePartitioning when table does not exist', async () => {
      bqState.tableExists = false;
      fsState.docs = [makeDoc('d1')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(bqState.createTableCalled, true);
      assert.ok(bqState.createTableOpts, 'createTable should receive options');
      assert.ok(bqState.createTableOpts.schema, 'createTable options should include schema');
      assert.ok(bqState.createTableOpts.timePartitioning, 'createTable options should include timePartitioning');
    });
  });

  // ── runArchive — empty collection ─────────────────────────────────────────

  describe('runArchive — empty collection', () => {
    it('returns scanned:0, inserted:0, deleted:0 when snapshot is empty', async () => {
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(res._status, 200);
      assert.equal(res._body.scanned, 0);
      assert.equal(res._body.inserted, 0);
      assert.equal(res._body.deleted, 0);
    });

    it('does not call BQ insert when snapshot is empty', async () => {
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.deepEqual(bqState.insertRows, []);
    });

    it('does not call batch.delete when snapshot is empty', async () => {
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.deepEqual(batchDeleteRefs, []);
    });

    it('does not call batch.commit when snapshot is empty', async () => {
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(batchCommitCalled, false);
    });
  });

  // ── runArchive — docs present ─────────────────────────────────────────────

  describe('runArchive — docs present', () => {
    it('maps a single doc to a row with correct fields', async () => {
      const tsDate = new Date('2025-01-15T10:00:00Z');
      fsState.docs = [
        {
          id: 'evt-001',
          data: {
            maskedEmail: 'te***@test.com',
            ua: 'Chrome/120',
            errorCode: 'auth/too-many-requests',
            ts: { toDate: () => tsDate },
          },
        },
      ];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(bqState.insertRows.length, 1);
      const row = bqState.insertRows[0];
      assert.equal(row.docId, 'evt-001');
      assert.equal(row.maskedEmail, 'te***@test.com');
      assert.equal(row.ua, 'Chrome/120');
      assert.equal(row.errorCode, 'auth/too-many-requests');
      assert.equal(row.ts, tsDate.toISOString());
      assert.ok(row.archivedAt, 'archivedAt should be set');
    });

    it('uses ts.toDate() when the ts field has a toDate method', async () => {
      const tsDate = new Date('2024-06-01T00:00:00Z');
      fsState.docs = [
        {
          id: 'ts-method-doc',
          data: {
            ts: { toDate: () => tsDate },
          },
        },
      ];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(bqState.insertRows[0].ts, tsDate.toISOString());
    });

    it('falls back to new Date(data.ts) when ts has no toDate method', async () => {
      const tsString = '2024-03-20T08:30:00.000Z';
      fsState.docs = [
        {
          id: 'raw-ts-doc',
          data: {
            ts: tsString,
          },
        },
      ];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(bqState.insertRows[0].ts, new Date(tsString).toISOString());
    });

    it('sets missing maskedEmail, ua, errorCode fields to null in the row', async () => {
      fsState.docs = [
        {
          id: 'sparse-doc',
          data: {
            ts: { toDate: () => new Date('2025-02-01T00:00:00Z') },
          },
        },
      ];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      const row = bqState.insertRows[0];
      assert.equal(row.maskedEmail, null);
      assert.equal(row.ua, null);
      assert.equal(row.errorCode, null);
    });

    it('calls BQ insert with all mapped rows', async () => {
      fsState.docs = [makeDoc('a'), makeDoc('b'), makeDoc('c')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(bqState.insertRows.length, 3);
    });

    it('calls batch.delete for each doc ref', async () => {
      fsState.docs = [makeDoc('doc-x'), makeDoc('doc-y')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.deepEqual(batchDeleteRefs.sort(), ['doc-x', 'doc-y'].sort());
    });

    it('calls batch.commit after all deletes', async () => {
      fsState.docs = [makeDoc('d1')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(batchCommitCalled, true);
    });

    it('returns scanned, inserted, deleted equal to the number of docs', async () => {
      fsState.docs = [makeDoc('e1'), makeDoc('e2'), makeDoc('e3')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(res._body.scanned, 3);
      assert.equal(res._body.inserted, 3);
      assert.equal(res._body.deleted, 3);
    });
  });

  // ── runArchive — BQ insert failure ───────────────────────────────────────

  describe('runArchive — BigQuery insert throws', () => {
    it('does NOT call batch.commit when BQ insert throws', async () => {
      bqState.insertShouldThrow = true;
      fsState.docs = [makeDoc('fail-doc')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(batchCommitCalled, false);
    });

    it('does NOT call batch.delete when BQ insert throws', async () => {
      bqState.insertShouldThrow = true;
      fsState.docs = [makeDoc('fail-doc')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.deepEqual(batchDeleteRefs, []);
    });

    it('returns 500 with error message when BQ insert throws', async () => {
      bqState.insertShouldThrow = true;
      fsState.docs = [makeDoc('fail-doc')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(res._status, 500);
      assert.match(res._body.error, /BQ insert failed/);
    });
  });

  // ── archiveAuthEventsScheduled ────────────────────────────────────────────

  describe('archiveAuthEventsScheduled', () => {
    it('scheduled handler is captured at module load', () => {
      assert.equal(typeof capturedScheduledHandler, 'function');
    });

    it('returns null on success (empty collection)', async () => {
      const result = await capturedScheduledHandler({});
      assert.equal(result, null);
    });

    it('returns null and runs archive when docs are present', async () => {
      fsState.docs = [makeDoc('sched-doc')];
      const result = await capturedScheduledHandler({});
      assert.equal(result, null);
      assert.equal(bqState.insertRows.length, 1);
    });

    it('throws when runArchive fails (BQ insert error)', async () => {
      bqState.insertShouldThrow = true;
      fsState.docs = [makeDoc('sched-fail')];
      await assert.rejects(
        () => capturedScheduledHandler({}),
        /BQ insert failed/
      );
    });
  });

  // ── archiveAuthEvents HTTP ────────────────────────────────────────────────

  describe('archiveAuthEvents HTTP handler', () => {
    it('OPTIONS request returns 204', async () => {
      const res = makeRes();
      await capturedHttpHandler(makeReq({ method: 'OPTIONS' }), res);
      assert.equal(res._status, 204);
    });

    it('GET request returns 405', async () => {
      const res = makeRes();
      await capturedHttpHandler(makeReq({ method: 'GET' }), res);
      assert.equal(res._status, 405);
      assert.ok(res._body && res._body.error, 'should return an error body');
    });

    it('PUT request returns 405', async () => {
      const res = makeRes();
      await capturedHttpHandler(makeReq({ method: 'PUT' }), res);
      assert.equal(res._status, 405);
    });

    it('returns without running archive when requireAdmin returns null (falsy)', async () => {
      requireAdminStub = async (_req, res) => {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
      };
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      // Archive should not have run: no BQ insert, no batch commit
      assert.deepEqual(bqState.insertRows, []);
      assert.equal(batchCommitCalled, false);
    });

    it('POST happy path returns success:true with scanned, inserted, deleted', async () => {
      fsState.docs = [makeDoc('http-doc-1'), makeDoc('http-doc-2')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(res._status, 200);
      assert.equal(res._body.success, true);
      assert.equal(res._body.scanned, 2);
      assert.equal(res._body.inserted, 2);
      assert.equal(res._body.deleted, 2);
    });

    it('POST with empty collection returns success:true with zeros', async () => {
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(res._status, 200);
      assert.equal(res._body.success, true);
      assert.equal(res._body.scanned, 0);
      assert.equal(res._body.inserted, 0);
      assert.equal(res._body.deleted, 0);
    });

    it('POST returns 500 when runArchive throws', async () => {
      bqState.insertShouldThrow = true;
      fsState.docs = [makeDoc('http-fail-doc')];
      const res = makeRes();
      await capturedHttpHandler(makeReq(), res);
      assert.equal(res._status, 500);
      assert.ok(res._body && res._body.error, 'should return an error body');
      assert.match(res._body.error, /BQ insert failed/);
    });
  });
});
