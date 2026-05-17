/**
 * Integration tests for publishAnnouncement.js
 *
 * Mirrors broadcastMessage.test.js stub pattern (Module._load interception
 * for firebase-admin + _auth) — no Firebase emulator needed.
 *
 * Run: node --test functions/__tests__/publishAnnouncement.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let stubAuthDecoded;
let stubAddResult;
let stubAddError;
let lastAddedDoc;
let lastAddedCollection;

function resetStubs() {
  stubAuthDecoded     = { uid: 'admin-uid-1', email: 'admin@test.com', admin: true };
  stubAddResult       = { id: 'ANN_123' };
  stubAddError        = null;
  lastAddedDoc        = null;
  lastAddedCollection = null;
}
resetStubs();

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => ({
        add: async (data) => {
          if (stubAddError) throw stubAddError;
          lastAddedCollection = name;
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

const { _handle: handle, _validate: validate } = require('../publishAnnouncement');

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

// ── handler tests ─────────────────────────────────────────────────────────────

describe('publishAnnouncement CF — handle()', () => {
  beforeEach(() => resetStubs());

  it('publishes a valid notice and returns id + type', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'notice',
      title: 'ค่าน้ำเดือนนี้',
      body:  'ค่าน้ำส่วนกลางขึ้น 10 บาท/ยูนิต เริ่ม 1 มิ.ย.',
      audience: 'rooms',
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.id, 'ANN_123');
    assert.equal(res.body.type, 'notice');
    assert.equal(lastAddedCollection, 'announcements');
    assert.equal(lastAddedDoc.type, 'notice');
    assert.equal(lastAddedDoc.title, 'ค่าน้ำเดือนนี้');
    assert.equal(lastAddedDoc.audience, 'rooms');
    assert.equal(lastAddedDoc.status, 'published');
    assert.equal(lastAddedDoc.sender.uid, 'admin-uid-1');
    assert.equal(lastAddedDoc.sender.email, 'admin@test.com');
    assert.equal(lastAddedDoc.sentAt, '__ts__');
    // notice doesn't write event/banner fields
    assert.equal(lastAddedDoc.eventDate, undefined);
    assert.equal(lastAddedDoc.location, undefined);
    assert.equal(lastAddedDoc.expiresAt, undefined);
  });

  it('publishes an event with eventDate + location + photoUrl', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'event',
      title: 'งานสงกรานต์',
      body:  'มาเล่นน้ำกันที่ลานกลาง',
      audience: 'all',
      eventDate: '2026-04-13T10:00:00+07:00',
      location:  'ลานกลางอาคาร',
      photoUrl:  'https://example.com/songkran.jpg',
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.type, 'event');
    assert.ok(lastAddedDoc.eventDate instanceof Date);
    assert.equal(lastAddedDoc.location, 'ลานกลางอาคาร');
    assert.equal(lastAddedDoc.photoUrl, 'https://example.com/songkran.jpg');
  });

  it('publishes a banner with expiresAt', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'banner',
      title: 'ปิดน้ำชั่วคราว',
      body:  'จะปิดน้ำ 14:00-16:00 เพื่อตรวจสอบระบบ',
      audience: 'rooms',
      expiresAt: '2026-05-20T16:00:00+07:00',
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.type, 'banner');
    assert.ok(lastAddedDoc.expiresAt instanceof Date);
  });

  it('publishes a banner WITHOUT expiresAt (optional field)', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'banner',
      title: 'ประกาศทั่วไป',
      body:  'แจ้งให้ทราบ',
      audience: 'all',
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(lastAddedDoc.expiresAt, undefined);
  });

  it('rejects non-admin with 403', async () => {
    stubAuthDecoded = null;
    const res = makeRes();
    await handle(makeReq({
      type: 'notice', title: 'X', body: 'Y', audience: 'all',
    }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(lastAddedDoc, null);
  });

  it('rejects unknown type with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'invalid', title: 'ok', body: 'fine', audience: 'all',
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /type must be one of/);
  });

  it('rejects missing type with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      title: 'ok', body: 'fine', audience: 'all',
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /type must be one of/);
  });

  it('rejects event missing eventDate with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'event', title: 'ok', body: 'fine', audience: 'all',
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /eventDate is required/);
  });

  it('rejects invalid eventDate string with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'event', title: 'ok', body: 'fine', audience: 'all',
      eventDate: 'not-a-date',
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /eventDate is not a valid ISO/);
  });

  it('rejects title > 80 chars with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'notice', title: 'x'.repeat(81), body: 'fine', audience: 'all',
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /title exceeds/);
  });

  it('rejects body > 1000 chars with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'notice', title: 'ok', body: 'x'.repeat(1001), audience: 'all',
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /body exceeds/);
  });

  it('accepts body up to 1000 chars (broadcastMessage was 500 — bumped for events)', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'notice', title: 'ok', body: 'x'.repeat(1000), audience: 'all',
    }), res);

    assert.equal(res.statusCode, 200);
  });

  it('rejects event location > 200 chars with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'event', title: 'ok', body: 'fine', audience: 'all',
      eventDate: '2026-04-13T10:00:00Z',
      location: 'x'.repeat(201),
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /location exceeds/);
  });

  it('rejects invalid audience value with 400', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'notice', title: 'ok', body: 'fine', audience: 'marketplace',
    }), res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /audience must be one of/);
  });

  it('trims whitespace from title, body, location', async () => {
    const res = makeRes();
    await handle(makeReq({
      type: 'event',
      title: '   trimmed title   ',
      body:  '\n\n trimmed body \n',
      audience: 'nest',
      eventDate: '2026-04-13T10:00:00Z',
      location: '   ลานกลาง   ',
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(lastAddedDoc.title, 'trimmed title');
    assert.equal(lastAddedDoc.body, 'trimmed body');
    assert.equal(lastAddedDoc.location, 'ลานกลาง');
  });

  it('returns 500 when Firestore write fails', async () => {
    stubAddError = new Error('firestore unavailable');
    const res = makeRes();
    await handle(makeReq({
      type: 'notice', title: 'ok', body: 'fine', audience: 'all',
    }), res);

    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /Failed to publish announcement/);
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

// ── pure validate() tests ────────────────────────────────────────────────────

describe('publishAnnouncement.validate (pure)', () => {
  it('null body returns generic error', () => {
    const r = validate(null);
    assert.match(r.error, /body must be/);
  });

  it('empty title returns title required', () => {
    const r = validate({ type: 'notice', title: '   ', body: 'x', audience: 'all' });
    assert.match(r.error, /title is required/);
  });

  it('valid notice returns ok', () => {
    const r = validate({ type: 'notice', title: 'a', body: 'b', audience: 'all' });
    assert.equal(r.ok, true);
    assert.equal(r.normalized.type, 'notice');
    assert.deepEqual(r.normalized.extra, {});
  });

  it('valid event normalizes eventDate to Date', () => {
    const r = validate({
      type: 'event', title: 'a', body: 'b', audience: 'all',
      eventDate: '2026-04-13T10:00:00Z',
    });
    assert.equal(r.ok, true);
    assert.ok(r.normalized.extra.eventDate instanceof Date);
  });

  it('event normalizes empty optional fields to absent', () => {
    const r = validate({
      type: 'event', title: 'a', body: 'b', audience: 'all',
      eventDate: '2026-04-13T10:00:00Z',
      location: '',
      photoUrl: '',
    });
    assert.equal(r.ok, true);
    assert.equal(r.normalized.extra.location, undefined);
    assert.equal(r.normalized.extra.photoUrl, undefined);
  });

  it('banner without expiresAt is valid (optional)', () => {
    const r = validate({ type: 'banner', title: 'a', body: 'b', audience: 'all' });
    assert.equal(r.ok, true);
    assert.equal(r.normalized.extra.expiresAt, undefined);
  });
});
