/**
 * Unit tests for archiveSlipLogs.js
 *
 * Covers ensureBigQueryTable, runArchive (row mapping, numeric-amount handling,
 * BQ-before-Firestore safety), the scheduled handler, and the HTTP handler
 * (OPTIONS / non-POST / requireAdmin gate / happy path / 500 error).
 *
 * Run: node --test functions/__tests__/archiveSlipLogs.test.js
 */
'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    datasetExists: true,
    tableExists: true,
    snapshotDocs: [],          // array of { id, data }
    snapshotEmpty: false,
    bqInsertError: null,
    batchCommitError: null,
    requireAdminResult: { uid: 'admin-uid' },  // null → gate rejects
    ...overrides,
  };
  captured = {
    createDatasetCalls: [],    // DATASET_ID strings
    createTableCalls: [],      // TABLE_ID strings
    bqInsertRows: null,        // rows passed to table.insert()
    batchDeleteRefs: [],       // refs passed to batch.delete()
    batchCommitted: false,
    statusCodes: [],           // res.status() calls
    jsonBodies: [],            // res.json() calls
    sentBodies: [],            // res.send() calls
  };
}
resetStubs();

// ── BigQuery stub ─────────────────────────────────────────────────────────────

const bqTableStub = {
  exists: async () => [stubState.tableExists],
  insert: async (rows) => {
    if (stubState.bqInsertError) throw stubState.bqInsertError;
    captured.bqInsertRows = rows;
  },
};

const bqDatasetStub = {
  exists: async () => [stubState.datasetExists],
  table: (_tableId) => bqTableStub,
  createTable: async (tableId, _opts) => {
    captured.createTableCalls.push(tableId);
  },
};

const bqStub = {
  dataset: (_datasetId) => bqDatasetStub,
  createDataset: async (datasetId, _opts) => {
    captured.createDatasetCalls.push(datasetId);
  },
};

const BigQueryStub = function () { return bqStub; };

// ── Firestore stub ────────────────────────────────────────────────────────────

function makeDoc(id, data) {
  return {
    id,
    data: () => data,
    ref: { _id: id },
  };
}

const batchStub = {
  delete: (ref) => { captured.batchDeleteRefs.push(ref._id); },
  commit: async () => {
    if (stubState.batchCommitError) throw stubState.batchCommitError;
    captured.batchCommitted = true;
  },
};

const fsInstance = {
  collection: (_name) => {
    const q = {
      where: () => q,
      orderBy: () => q,
      limit: () => q,
      get: async () => {
        const docs = stubState.snapshotDocs.map(d => makeDoc(d.id, d.data));
        const empty = stubState.snapshotEmpty || docs.length === 0;
        return { empty, docs, size: docs.length };
      },
    };
    return q;
  },
  batch: () => batchStub,
};

// ── firebase-admin stub ───────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => fsInstance, {
    Timestamp: {
      fromMillis: (ms) => ({ _ms: ms }),
    },
    FieldValue: {
      serverTimestamp: () => ({ _type: 'serverTimestamp' }),
    },
  }),
};

// ── _auth stub ────────────────────────────────────────────────────────────────

let requireAdminStub = async (_req, _res) => stubState.requireAdminResult;

// ── firebase-functions/v1 stub ────────────────────────────────────────────────

let capturedScheduledHandler = null;
let capturedHttpHandler = null;

const functionsStub = {
  region: (_r) => ({
    runWith: (_opts) => ({
      pubsub: {
        schedule: (_cron) => ({
          timeZone: (_tz) => ({
            onRun: (handler) => {
              capturedScheduledHandler = handler;
              return {};
            },
          }),
        }),
      },
      https: {
        onRequest: (handler) => {
          capturedHttpHandler = handler;
          return {};
        },
      },
    }),
  }),
};

// ── Module._load intercept ────────────────────────────────────────────────────
// Must run BEFORE requiring the CF so module-level singletons get stubs.

const _origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === '@google-cloud/bigquery') return { BigQuery: BigQueryStub };
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') return functionsStub;
  if (request === './_auth') return { requireAdmin: (req, res) => requireAdminStub(req, res) };
  return _origLoad.call(this, request, parent, ...rest);
};

// ── Load CF ───────────────────────────────────────────────────────────────────

let archiveSlipLogsScheduled;
let archiveSlipLogs;

before(() => {
  const mod = require('../archiveSlipLogs');
  archiveSlipLogsScheduled = mod.archiveSlipLogsScheduled;
  archiveSlipLogs = mod.archiveSlipLogs;
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureBigQueryTable
// ─────────────────────────────────────────────────────────────────────────────

describe('ensureBigQueryTable — all exist', () => {
  beforeEach(() => resetStubs({ datasetExists: true, tableExists: true }));

  it('does not create dataset or table when both exist', async () => {
    // Trigger via runArchive (empty snapshot keeps it lightweight)
    stubState.snapshotEmpty = true;
    await capturedScheduledHandler({});
    assert.equal(captured.createDatasetCalls.length, 0);
    assert.equal(captured.createTableCalls.length, 0);
  });
});

describe('ensureBigQueryTable — dataset missing', () => {
  beforeEach(() => resetStubs({ datasetExists: false, tableExists: true }));

  it('calls createDataset with DATASET_ID when dataset is absent', async () => {
    stubState.snapshotEmpty = true;
    await capturedScheduledHandler({});
    assert.equal(captured.createDatasetCalls.length, 1);
    assert.equal(captured.createDatasetCalls[0], 'audit_archive');
    assert.equal(captured.createTableCalls.length, 0);
  });
});

describe('ensureBigQueryTable — table missing', () => {
  beforeEach(() => resetStubs({ datasetExists: true, tableExists: false }));

  it('calls createTable with TABLE_ID = "slip_verification" when table is absent', async () => {
    stubState.snapshotEmpty = true;
    await capturedScheduledHandler({});
    assert.equal(captured.createTableCalls.length, 1);
    assert.equal(captured.createTableCalls[0], 'slip_verification');
    assert.equal(captured.createDatasetCalls.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runArchive — empty snapshot
// ─────────────────────────────────────────────────────────────────────────────

describe('runArchive — empty snapshot', () => {
  beforeEach(() => resetStubs({ snapshotEmpty: true }));

  it('returns { scanned:0, inserted:0, deleted:0 } when no docs are old enough', async () => {
    const result = await capturedScheduledHandler({});
    // scheduled handler returns null, but we verify via HTTP for shape
  });

  it('does not call BQ insert when snapshot is empty', async () => {
    stubState.snapshotEmpty = true;
    // drive via HTTP handler for return-value access
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);
    const body = res._jsonBody();
    assert.equal(body.scanned, 0);
    assert.equal(body.inserted, 0);
    assert.equal(body.deleted, 0);
    assert.equal(captured.bqInsertRows, null);
    assert.equal(captured.batchCommitted, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runArchive — docs present, row mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('runArchive — full row mapping', () => {
  const tsDate = new Date('2024-01-15T10:00:00.000Z');

  beforeEach(() => {
    resetStubs({
      snapshotDocs: [
        {
          id: 'slip-001',
          data: {
            status: 'verified',
            building: 'rooms',
            room: '15',
            userId: 'user-abc',
            expectedAmount: 3500,
            verifiedAmount: 3500,
            transactionId: 'TXN123',
            slipSender: 'Bank A',
            slipDate: '2024-01-15',
            error: null,
            timestamp: { toDate: () => tsDate },
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0',
          },
        },
      ],
    });
  });

  it('maps all 15 fields correctly for a fully-populated doc', async () => {
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    assert.ok(captured.bqInsertRows, 'BQ insert must be called');
    assert.equal(captured.bqInsertRows.length, 1);
    const row = captured.bqInsertRows[0];

    assert.equal(row.docId, 'slip-001');
    assert.equal(row.status, 'verified');
    assert.equal(row.building, 'rooms');
    assert.equal(row.room, '15');
    assert.equal(row.userId, 'user-abc');
    assert.equal(row.expectedAmount, 3500);
    assert.equal(row.verifiedAmount, 3500);
    assert.equal(row.transactionId, 'TXN123');
    assert.equal(row.slipSender, 'Bank A');
    assert.equal(row.slipDate, '2024-01-15');
    assert.equal(row.error, null);
    assert.equal(row.timestamp, tsDate.toISOString());
    assert.equal(row.ipAddress, '192.168.1.1');
    assert.equal(row.userAgent, 'Mozilla/5.0');
    assert.ok(typeof row.archivedAt === 'string', 'archivedAt must be a string');
  });

  it('expectedAmount: numeric 0 maps to 0 (not null)', async () => {
    stubState.snapshotDocs[0].data.expectedAmount = 0;
    stubState.snapshotDocs[0].data.verifiedAmount = 0;
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    const row = captured.bqInsertRows[0];
    assert.equal(row.expectedAmount, 0);
    assert.equal(row.verifiedAmount, 0);
  });

  it('expectedAmount: undefined maps to null (not 0)', async () => {
    delete stubState.snapshotDocs[0].data.expectedAmount;
    delete stubState.snapshotDocs[0].data.verifiedAmount;
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    const row = captured.bqInsertRows[0];
    assert.equal(row.expectedAmount, null);
    assert.equal(row.verifiedAmount, null);
  });

  it('expectedAmount: string "3500" maps to null (type check, not truthy)', async () => {
    stubState.snapshotDocs[0].data.expectedAmount = '3500';
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    const row = captured.bqInsertRows[0];
    assert.equal(row.expectedAmount, null);
  });

  it('timestamp: uses toDate() when available', async () => {
    const specificDate = new Date('2023-06-01T08:30:00.000Z');
    stubState.snapshotDocs[0].data.timestamp = { toDate: () => specificDate };
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    const row = captured.bqInsertRows[0];
    assert.equal(row.timestamp, specificDate.toISOString());
  });

  it('timestamp: falls back to new Date(rawValue) when toDate is absent', async () => {
    const rawIso = '2023-06-01T08:30:00.000Z';
    stubState.snapshotDocs[0].data.timestamp = rawIso;
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    const row = captured.bqInsertRows[0];
    assert.equal(row.timestamp, new Date(rawIso).toISOString());
  });

  it('calls batch.commit after BQ insert and returns correct counts', async () => {
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    assert.equal(captured.batchCommitted, true);
    assert.deepEqual(captured.batchDeleteRefs, ['slip-001']);
    const body = res._jsonBody();
    assert.equal(body.scanned, 1);
    assert.equal(body.inserted, 1);
    assert.equal(body.deleted, 1);
  });
});

describe('runArchive — multiple docs', () => {
  beforeEach(() => {
    resetStubs({
      snapshotDocs: [
        {
          id: 'slip-A',
          data: {
            status: 'failed',
            expectedAmount: 1000,
            verifiedAmount: null,
            timestamp: { toDate: () => new Date('2024-01-01T00:00:00.000Z') },
          },
        },
        {
          id: 'slip-B',
          data: {
            status: 'verified',
            expectedAmount: 2000,
            verifiedAmount: 2000,
            timestamp: { toDate: () => new Date('2024-01-02T00:00:00.000Z') },
          },
        },
      ],
    });
  });

  it('inserts rows for all docs and deletes all refs', async () => {
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    assert.equal(captured.bqInsertRows.length, 2);
    assert.deepEqual(captured.batchDeleteRefs.sort(), ['slip-A', 'slip-B']);
    const body = res._jsonBody();
    assert.equal(body.scanned, 2);
    assert.equal(body.inserted, 2);
    assert.equal(body.deleted, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runArchive — BQ insert fails → Firestore batch NOT called
// ─────────────────────────────────────────────────────────────────────────────

describe('runArchive — BQ insert failure', () => {
  beforeEach(() => {
    resetStubs({
      snapshotDocs: [
        {
          id: 'slip-X',
          data: {
            status: 'verified',
            expectedAmount: 500,
            verifiedAmount: 500,
            timestamp: { toDate: () => new Date() },
          },
        },
      ],
      bqInsertError: new Error('BQ quota exceeded'),
    });
  });

  it('does not call batch.commit when BQ insert throws', async () => {
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    assert.equal(captured.batchCommitted, false);
    assert.equal(captured.batchDeleteRefs.length, 0);
  });

  it('returns 500 with error message when BQ insert throws', async () => {
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    assert.equal(res._status(), 500);
    assert.equal(res._jsonBody().error, 'BQ quota exceeded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// archiveSlipLogsScheduled
// ─────────────────────────────────────────────────────────────────────────────

describe('archiveSlipLogsScheduled', () => {
  beforeEach(() => resetStubs({ snapshotEmpty: true }));

  it('is a function (captured scheduled handler)', () => {
    assert.ok(typeof capturedScheduledHandler === 'function');
  });

  it('returns null on success', async () => {
    const result = await capturedScheduledHandler({});
    assert.equal(result, null);
  });

  it('re-throws when runArchive throws', async () => {
    stubState.bqInsertError = new Error('scheduled BQ failure');
    stubState.snapshotDocs = [
      {
        id: 'slip-err',
        data: {
          status: 'verified',
          expectedAmount: 100,
          verifiedAmount: 100,
          timestamp: { toDate: () => new Date() },
        },
      },
    ];
    stubState.snapshotEmpty = false;
    await assert.rejects(
      () => capturedScheduledHandler({}),
      /scheduled BQ failure/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// archiveSlipLogs HTTP handler
// ─────────────────────────────────────────────────────────────────────────────

describe('archiveSlipLogs HTTP — OPTIONS preflight', () => {
  beforeEach(() => resetStubs({ snapshotEmpty: true }));

  it('returns 204 for OPTIONS', async () => {
    const req = makeReq('OPTIONS');
    const res = makeRes();
    await capturedHttpHandler(req, res);
    assert.equal(res._status(), 204);
  });
});

describe('archiveSlipLogs HTTP — non-POST method', () => {
  beforeEach(() => resetStubs({ snapshotEmpty: true }));

  it('returns 405 for GET', async () => {
    const req = makeReq('GET');
    const res = makeRes();
    await capturedHttpHandler(req, res);
    assert.equal(res._status(), 405);
    assert.ok(res._jsonBody().error);
  });

  it('returns 405 for PUT', async () => {
    const req = makeReq('PUT');
    const res = makeRes();
    await capturedHttpHandler(req, res);
    assert.equal(res._status(), 405);
  });
});

describe('archiveSlipLogs HTTP — requireAdmin gate', () => {
  beforeEach(() => resetStubs({ snapshotEmpty: true, requireAdminResult: null }));

  it('does not call runArchive when requireAdmin returns null', async () => {
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    // No BQ insert, no batch commit — archive never ran
    assert.equal(captured.bqInsertRows, null);
    assert.equal(captured.batchCommitted, false);
  });
});

describe('archiveSlipLogs HTTP — POST happy path', () => {
  beforeEach(() => {
    resetStubs({
      snapshotDocs: [
        {
          id: 'slip-happy',
          data: {
            status: 'verified',
            expectedAmount: 1200,
            verifiedAmount: 1200,
            timestamp: { toDate: () => new Date('2024-03-01T12:00:00.000Z') },
          },
        },
      ],
    });
  });

  it('returns { success: true, scanned, inserted, deleted } on POST', async () => {
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    assert.equal(res._status(), 200);
    const body = res._jsonBody();
    assert.equal(body.success, true);
    assert.equal(body.scanned, 1);
    assert.equal(body.inserted, 1);
    assert.equal(body.deleted, 1);
  });
});

describe('archiveSlipLogs HTTP — POST error path', () => {
  beforeEach(() => {
    resetStubs({
      snapshotDocs: [
        {
          id: 'slip-fail',
          data: {
            status: 'verified',
            expectedAmount: 999,
            verifiedAmount: 999,
            timestamp: { toDate: () => new Date() },
          },
        },
      ],
      bqInsertError: new Error('http BQ error'),
    });
  });

  it('returns 500 with error message on unhandled exception', async () => {
    const req = makeReq('POST');
    const res = makeRes();
    await capturedHttpHandler(req, res);

    assert.equal(res._status(), 500);
    assert.equal(res._jsonBody().error, 'http BQ error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — minimal req/res mocks
// ─────────────────────────────────────────────────────────────────────────────

function makeReq(method) {
  return {
    method,
    headers: { authorization: 'Bearer test-token' },
    body: {},
  };
}

function makeRes() {
  let _statusCode = 200;
  let _json = null;
  let _sent = null;

  const res = {
    set: () => res,
    status: (code) => {
      _statusCode = code;
      return res;
    },
    json: (body) => {
      _json = body;
      return res;
    },
    send: (body) => {
      _sent = body;
      return res;
    },
    _status: () => _statusCode,
    _jsonBody: () => _json,
    _sentBody: () => _sent,
  };
  return res;
}
