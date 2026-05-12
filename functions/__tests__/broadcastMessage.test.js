/**
 * Integration tests for broadcastMessage.js
 *
 * Tests the admin publish flow without Firebase or auth. Mocks:
 *   - ./_auth requireAdmin (success / 403 paths)
 *   - firebase-admin.firestore() .collection().add()
 *
 * Run: node --test functions/__tests__/broadcastMessage.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── stub state ────────────────────────────────────────────────────────────────
let stubAuthDecoded;     // null → 403; object → admin
let stubAddResult;       // { id } returned by .add()
let stubAddError;        // Error to throw from .add()
let lastAddedDoc;

function resetStubs() {
  stubAuthDecoded = { uid: 'admin-uid-1', email: 'admin@test.com', admin: true };
  stubAddResult   = { id: 'BROADCAST_123' };
  stubAddError    = null;
  lastAddedDoc    = null;
}
resetStubs();

// ── Module._load interception ─────────────────────────────────────────────────
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: () => ({
        add: async (data) => {
          if (stubAddError) throw stubAddError;
          lastAddedDoc = data;
          return { id: stubAddResult.id };
        },
      }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => '__ts__' };

    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
    };
  }
  if (id === './_auth') {
    return {
      requireAdmin: async (req, res) => {
        if (!stubAuthDecoded) {
          res.status(403).json({ error: 'Admin access required' });
          return null;
        }
        return stubAuthDecoded;
      },
    };
  }
  if (id === 'firebase-functions/v2/https') {
    return { onRequest: (_opts, h) => h };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

// Load module under test AFTER stubs installed
const { _handle: handle, _validate: validate } = require('../broadcastMessage');

// ── res helper ───────────────────────────────────────────────────────────────
function makeRes() {
  const r = {
    statusCode: null,
    body: null,
    sent: false,
    status(c) { r.statusCode = c; return r; },
    json(b)   { r.body = b; r.sent = true; return r; },
    send()    { r.sent = true; return r; },
  };
  return r;
}

function makeReq(body, method = 'POST') {
  return { method, body, get: () => '' };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('broadcastMessage CF', () => {
  beforeEach(() => resetStubs());

  it('publishes a valid broadcast and returns id', async () => {
    const res = makeRes();
    await handle(makeReq({
      title: 'ค่าน้ำเดือนนี้',
      body: 'ค่าน้ำส่วนกลางขึ้น 10 บาทต่อยูนิต เริ่ม 1 มิ.ย.',
      building: 'rooms',
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.id, 'BROADCAST_123');
    assert.equal(lastAddedDoc.title, 'ค่าน้ำเดือนนี้');
    assert.equal(lastAddedDoc.audience, 'rooms');
    assert.equal(lastAddedDoc.status, 'published');
    assert.equal(lastAddedDoc.sender.uid, 'admin-uid-1');
    assert.equal(lastAddedDoc.sender.email, 'admin@test.com');
    assert.equal(lastAddedDoc.sentAt, '__ts__');
  });

  it('rejects non-admin with 403', async () => {
    stubAuthDecoded = null;
    const res = makeRes();
    await handle(makeReq({ title: 'X', body: 'Y', building: 'all' }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(lastAddedDoc, null);
  });

  it('rejects missing title with 400', async () => {
    const res = makeRes();
    await handle(makeReq({ body: 'no title here', building: 'all' }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /title is required/);
  });

  it('rejects title > 80 chars with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      title: 'x'.repeat(81),
      body: 'fine',
      building: 'all',
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /title exceeds/);
  });

  it('rejects body > 500 chars with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      title: 'ok',
      body: 'x'.repeat(501),
      building: 'all',
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /body exceeds/);
  });

  it('rejects invalid building value with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      title: 'ok',
      body: 'fine',
      building: 'marketplace',
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /building must be one of/);
  });

  it('trims whitespace from title and body', async () => {
    const res = makeRes();
    await handle(makeReq({
      title: '   trimmed title   ',
      body:  '\n\n trimmed body \n',
      building: 'nest',
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(lastAddedDoc.title, 'trimmed title');
    assert.equal(lastAddedDoc.body, 'trimmed body');
  });

  it('returns 500 when Firestore write fails', async () => {
    stubAddError = new Error('firestore unavailable');
    const res = makeRes();
    await handle(makeReq({ title: 'ok', body: 'fine', building: 'all' }), res);

    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /Failed to publish/);
    assert.equal(res.body.detail, 'firestore unavailable');
  });

  it('rejects non-POST methods', async () => {
    const res = makeRes();
    await handle(makeReq({}, 'GET'), res);
    assert.equal(res.statusCode, 405);
  });

  it('OPTIONS request returns 204', async () => {
    const res = makeRes();
    await handle(makeReq({}, 'OPTIONS'), res);
    assert.equal(res.statusCode, 204);
  });
});

describe('broadcastMessage.validate (pure)', () => {
  it('null body returns generic error', () => {
    assert.match(validate(null), /body must be/);
  });

  it('empty title returns title required', () => {
    assert.match(validate({ title: '   ', body: 'x', building: 'all' }), /title is required/);
  });

  it('valid input returns null', () => {
    assert.equal(validate({ title: 'a', body: 'b', building: 'all' }), null);
    assert.equal(validate({ title: 'a', body: 'b', building: 'rooms' }), null);
    assert.equal(validate({ title: 'a', body: 'b', building: 'nest' }), null);
  });
});
