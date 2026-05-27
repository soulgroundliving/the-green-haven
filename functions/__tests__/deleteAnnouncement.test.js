/**
 * Unit tests for deleteAnnouncement.js
 *
 * Run: node --test functions/__tests__/deleteAnnouncement.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── stub state ────────────────────────────────────────────────────────────────
let stubAuthDecoded;
let stubDocExists;
let stubGetError;
let stubDeleteError;
let deleteCallCount;

function resetStubs() {
  stubAuthDecoded = { uid: 'admin-uid-1', email: 'admin@test.com', admin: true };
  stubDocExists   = true;
  stubGetError    = null;
  stubDeleteError = null;
  deleteCallCount = 0;
}
resetStubs();

// ── Module._load interception ─────────────────────────────────────────────────
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const docStub = {
      get: async () => {
        if (stubGetError) throw stubGetError;
        return { exists: stubDocExists };
      },
      delete: async () => {
        if (stubDeleteError) throw stubDeleteError;
        deleteCallCount++;
      },
    };
    const firestoreFn = () => ({
      collection: () => ({ doc: () => docStub }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => '__ts__' };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === './_auth') {
    return {
      requireAdmin: async (req, res) => {
        if (!stubAuthDecoded) { res.status(403).json({ error: 'Admin access required' }); return null; }
        return stubAuthDecoded;
      },
    };
  }
  if (id === 'firebase-functions/v2/https') {
    return { onRequest: (_opts, h) => h };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { _handle: handle, _validate: validate } = require('../deleteAnnouncement');

// ── helpers ───────────────────────────────────────────────────────────────────
function makeRes() {
  const r = { statusCode: null, body: null, sent: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json   = (b) => { r.body = b; r.sent = true; return r; };
  r.send   = ()  => { r.sent = true; return r; };
  return r;
}
function makeReq(body, method = 'POST') {
  return { method, body, get: () => '' };
}

// ── _validate unit tests ──────────────────────────────────────────────────────
describe('deleteAnnouncement validate()', () => {
  it('rejects non-object body', () => {
    assert.equal(validate(null).error, 'body must be a JSON object');
    assert.equal(validate('string').error, 'body must be a JSON object');
  });

  it('rejects missing id', () => {
    assert.equal(validate({}).error, 'id is required');
  });

  it('rejects blank id', () => {
    assert.equal(validate({ id: '  ' }).error, 'id is required');
  });

  it('accepts valid id', () => {
    const v = validate({ id: 'ann-abc' });
    assert.equal(v.ok, true);
    assert.equal(v.id, 'ann-abc');
  });

  it('trims id whitespace', () => {
    const v = validate({ id: '  doc1  ' });
    assert.equal(v.id, 'doc1');
  });
});

// ── handle() integration ──────────────────────────────────────────────────────
describe('deleteAnnouncement handle()', () => {
  beforeEach(() => resetStubs());

  it('deletes announcement and returns 200', async () => {
    const res = makeRes();
    await handle(makeReq({ id: 'ann1' }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.id, 'ann1');
    assert.equal(deleteCallCount, 1);
  });

  it('returns 403 for non-admin', async () => {
    stubAuthDecoded = null;
    const res = makeRes();
    await handle(makeReq({ id: 'ann1' }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(deleteCallCount, 0);
  });

  it('returns 400 for missing id', async () => {
    const res = makeRes();
    await handle(makeReq({}), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /id is required/);
    assert.equal(deleteCallCount, 0);
  });

  it('returns 400 for non-object body', async () => {
    const res = makeRes();
    await handle(makeReq(null), res);
    assert.equal(res.statusCode, 400);
    assert.equal(deleteCallCount, 0);
  });

  it('returns 404 when doc does not exist', async () => {
    stubDocExists = false;
    const res = makeRes();
    await handle(makeReq({ id: 'missing' }), res);
    assert.equal(res.statusCode, 404);
    assert.match(res.body.error, /not found/i);
    assert.equal(deleteCallCount, 0);
  });

  it('returns 405 for GET requests', async () => {
    const res = makeRes();
    await handle(makeReq({ id: 'ann1' }, 'GET'), res);
    assert.equal(res.statusCode, 405);
    assert.equal(deleteCallCount, 0);
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const res = makeRes();
    await handle(makeReq({}, 'OPTIONS'), res);
    assert.equal(res.statusCode, 204);
    assert.equal(deleteCallCount, 0);
  });

  it('returns 500 when Firestore delete throws', async () => {
    stubDeleteError = new Error('delete failed');
    const res = makeRes();
    await handle(makeReq({ id: 'ann1' }), res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /Failed to delete/);
  });

  it('returns 500 when Firestore get throws', async () => {
    stubGetError = new Error('read failed');
    const res = makeRes();
    await handle(makeReq({ id: 'ann1' }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(deleteCallCount, 0);
  });
});
