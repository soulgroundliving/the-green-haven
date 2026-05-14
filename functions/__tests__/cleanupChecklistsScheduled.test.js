/**
 * Unit tests for cleanupChecklistsScheduled — PDPA retention sweep.
 * Verifies the two cutoff rules (signed>2yr, orphan>5yr) and storage cleanup.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let stubDocs;          // { signedQuery: [...], orphanQuery: [...] }
let storageDeletes;    // prefix → number of files
let docDeleteCalls;    // instanceIds deleted

function resetStubs() {
  stubDocs = { signedQuery: [], orphanQuery: [] };
  storageDeletes = {};
  docDeleteCalls = [];
}
resetStubs();

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    // Track which query branch is being built up
    let activeBranch = null;
    const _doc = (id, data) => ({
      id,
      data: () => data,
      ref: {
        delete: async () => { docDeleteCalls.push(id); },
      },
    });
    const _bucket = {
      getFiles: async ({ prefix }) => {
        const count = storageDeletes[prefix] ?? 0;
        const files = Array.from({ length: count }, (_, i) => ({
          name: `${prefix}f${i}.png`,
          delete: async () => {},
        }));
        return [files];
      },
    };
    const firestoreFn = () => ({
      collection: (name) => {
        if (name !== 'checklistInstances') throw new Error('unexpected: ' + name);
        const q = {
          _where: [],
          where: function (field, op, val) {
            this._where.push({ field, op, val });
            // Decide branch from the field signature
            if (field === 'status') activeBranch = 'signed';
            else if (field === 'createdAt' && this._where.length === 1) activeBranch = 'orphan';
            return this;
          },
          limit: function () { return this; },
          get: async function () {
            const items = activeBranch === 'signed'
              ? stubDocs.signedQuery
              : stubDocs.orphanQuery;
            return {
              empty: items.length === 0,
              docs: items.map(it => _doc(it.id, it)),
            };
          },
        };
        return q;
      },
    });
    firestoreFn.Timestamp = {
      fromMillis: (ms) => ({ _ms: ms, toMillis: () => ms }),
    };
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
      storage: () => ({ bucket: () => _bucket }),
    };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    const region = () => ({
      pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (h) => h }) }) },
      https:  { onCall: (h) => h },
    });
    return { region, https: { HttpsError } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { _run, SIGNED_RETENTION_MS, ORPHAN_RETENTION_MS } =
  require('../cleanupChecklistsScheduled');

describe('cleanupChecklistsScheduled — retention sweep', () => {
  beforeEach(resetStubs);

  it('retention constants are 2y / 5y', () => {
    assert.equal(SIGNED_RETENTION_MS, 2 * 365 * 24 * 60 * 60 * 1000);
    assert.equal(ORPHAN_RETENTION_MS, 5 * 365 * 24 * 60 * 60 * 1000);
  });

  it('deletes signed instances older than 2 years (doc + storage files)', async () => {
    stubDocs.signedQuery = [
      { id: 'inst-1', building: 'rooms', roomId: '15', status: 'admin_signed' },
      { id: 'inst-2', building: 'nest',  roomId: 'N101', status: 'admin_signed' },
    ];
    storageDeletes['checklists/rooms/15/inst-1/'] = 3;       // 3 files
    storageDeletes['checklists/nest/N101/inst-2/']  = 2;
    const result = await _run();
    assert.equal(result.deletedDocs, 2);
    assert.equal(result.deletedFiles, 5);
    assert.deepEqual(docDeleteCalls, ['inst-1', 'inst-2']);
    assert.equal(result.errors.length, 0);
  });

  it('deletes orphan instances older than 5 years (any status, including pending)', async () => {
    stubDocs.orphanQuery = [
      { id: 'old-pending', building: 'rooms', roomId: '13', status: 'pending' },
    ];
    storageDeletes['checklists/rooms/13/old-pending/'] = 1;
    const result = await _run();
    assert.equal(result.deletedDocs, 1);
    assert.equal(result.deletedFiles, 1);
    assert.deepEqual(docDeleteCalls, ['old-pending']);
  });

  it('empty queries → no deletions, no errors', async () => {
    const result = await _run();
    assert.equal(result.deletedDocs, 0);
    assert.equal(result.deletedFiles, 0);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(docDeleteCalls, []);
  });

  it('handles instance missing building/roomId — skips storage but still deletes doc', async () => {
    stubDocs.signedQuery = [
      { id: 'incomplete', status: 'admin_signed' }, // no building/roomId
    ];
    const result = await _run();
    assert.equal(result.deletedDocs, 1);
    assert.equal(result.deletedFiles, 0);
    assert.deepEqual(docDeleteCalls, ['incomplete']);
  });
});
