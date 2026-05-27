/**
 * Unit tests for updateAnnouncement.js
 *
 * Run: node --test functions/__tests__/updateAnnouncement.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── stub state ────────────────────────────────────────────────────────────────
let stubAuthDecoded;
let stubDocExists;
let stubGetError;
let stubUpdateError;
let lastUpdatedData;

function resetStubs() {
  stubAuthDecoded  = { uid: 'admin-uid-1', email: 'admin@test.com', admin: true };
  stubDocExists    = true;
  stubGetError     = null;
  stubUpdateError  = null;
  lastUpdatedData  = null;
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
      update: async (data) => {
        if (stubUpdateError) throw stubUpdateError;
        lastUpdatedData = data;
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

const { _handle: handle, _validate: validate } = require('../updateAnnouncement');

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

// ── _validate unit tests ───────────────────────────────────────────────────────
describe('updateAnnouncement validate()', () => {
  it('rejects missing id', () => {
    assert.equal(validate({ title: 'ok' }).error, 'id is required');
  });

  it('rejects empty id string', () => {
    assert.equal(validate({ id: '  ' }).error, 'id is required');
  });

  it('rejects no update fields', () => {
    assert.equal(validate({ id: 'abc' }).error, 'at least one field to update is required');
  });

  it('rejects blank title', () => {
    assert.match(validate({ id: 'abc', title: '   ' }).error, /title cannot be empty/);
  });

  it('rejects title > 80 chars', () => {
    assert.match(validate({ id: 'abc', title: 'x'.repeat(81) }).error, /title exceeds/);
  });

  it('rejects blank body', () => {
    assert.match(validate({ id: 'abc', body: '' }).error, /body cannot be empty/);
  });

  it('rejects body > 1000 chars', () => {
    assert.match(validate({ id: 'abc', body: 'x'.repeat(1001) }).error, /body exceeds/);
  });

  it('rejects invalid audience', () => {
    assert.match(validate({ id: 'abc', audience: 'vip' }).error, /audience must be one of/);
  });

  it('rejects non-ISO eventDate', () => {
    assert.match(validate({ id: 'abc', eventDate: 'not-a-date' }).error, /not a valid ISO/);
  });

  it('rejects location > 200 chars', () => {
    assert.match(validate({ id: 'abc', location: 'x'.repeat(201) }).error, /location exceeds/);
  });

  it('accepts valid minimal payload (title only)', () => {
    const v = validate({ id: 'abc', title: 'New Title' });
    assert.equal(v.ok, true);
    assert.equal(v.id, 'abc');
    assert.deepEqual(v.updates, { title: 'New Title' });
  });

  it('trims id and title', () => {
    const v = validate({ id: '  doc1  ', title: '  hello  ' });
    assert.equal(v.id, 'doc1');
    assert.equal(v.updates.title, 'hello');
  });

  it('accepts all optional fields together', () => {
    const v = validate({
      id: 'doc1',
      title: 'T',
      body: 'B',
      audience: 'nest',
      eventDate: '2026-07-01T10:00:00Z',
      location: 'Lobby',
      expiresAt: '2026-07-31T00:00:00Z',
    });
    assert.equal(v.ok, true);
    assert.equal(v.updates.audience, 'nest');
    assert.ok(v.updates.eventDate instanceof Date);
    assert.ok(v.updates.expiresAt instanceof Date);
  });

  it('clears eventDate when empty string', () => {
    const v = validate({ id: 'doc1', title: 'T', eventDate: '' });
    assert.equal(v.ok, true);
    assert.equal(v.updates.eventDate, undefined);
  });
});

// ── handle() integration ──────────────────────────────────────────────────────
describe('updateAnnouncement handle()', () => {
  beforeEach(() => resetStubs());

  it('updates announcement and returns 200', async () => {
    const res = makeRes();
    await handle(makeReq({ id: 'ann1', title: 'Updated Title', audience: 'all' }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.id, 'ann1');
    assert.equal(lastUpdatedData.title, 'Updated Title');
    assert.equal(lastUpdatedData.audience, 'all');
    assert.equal(lastUpdatedData.updatedAt, '__ts__');
    assert.equal(lastUpdatedData.updatedBy.uid, 'admin-uid-1');
    assert.equal(lastUpdatedData.updatedBy.email, 'admin@test.com');
  });

  it('returns 403 for non-admin', async () => {
    stubAuthDecoded = null;
    const res = makeRes();
    await handle(makeReq({ id: 'ann1', title: 'X' }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(lastUpdatedData, null);
  });

  it('returns 400 for missing id', async () => {
    const res = makeRes();
    await handle(makeReq({ title: 'X' }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /id is required/);
  });

  it('returns 400 when no update fields supplied', async () => {
    const res = makeRes();
    await handle(makeReq({ id: 'ann1' }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /at least one field/);
  });

  it('returns 404 when doc does not exist', async () => {
    stubDocExists = false;
    const res = makeRes();
    await handle(makeReq({ id: 'missing-id', title: 'T' }), res);
    assert.equal(res.statusCode, 404);
    assert.match(res.body.error, /not found/i);
  });

  it('returns 405 for GET requests', async () => {
    const res = makeRes();
    await handle(makeReq({ id: 'ann1', title: 'T' }, 'GET'), res);
    assert.equal(res.statusCode, 405);
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const res = makeRes();
    await handle(makeReq({}, 'OPTIONS'), res);
    assert.equal(res.statusCode, 204);
  });

  it('returns 500 when Firestore update throws', async () => {
    stubUpdateError = new Error('write failed');
    const res = makeRes();
    await handle(makeReq({ id: 'ann1', title: 'T' }), res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /Failed to update/);
  });

  it('returns 500 when Firestore get throws', async () => {
    stubGetError = new Error('read failed');
    const res = makeRes();
    await handle(makeReq({ id: 'ann1', title: 'T' }), res);
    assert.equal(res.statusCode, 500);
  });

  it('does not include type/sender/sentAt in update payload', async () => {
    const res = makeRes();
    await handle(makeReq({ id: 'ann1', title: 'Only title' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(lastUpdatedData.type,    undefined);
    assert.equal(lastUpdatedData.sender,  undefined);
    assert.equal(lastUpdatedData.sentAt,  undefined);
  });
});
