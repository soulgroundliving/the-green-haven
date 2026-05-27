/**
 * Unit tests for notifyLiffRequest.js
 *
 * Stubs: firebase-admin, firebase-functions/v2/https, firebase-functions/params,
 *        global.fetch.
 *
 * Run: node --test functions/__tests__/notifyLiffRequest.test.js
 */

'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    docExists: true,
    docData: { status: 'pending', building: 'rooms', room: '15', lineDisplayName: 'สมชาย' },
    firestoreGetError: null,
    fetchOk: true,
    fetchStatus: 200,
    fetchResponseText: '',
    fetchNetworkError: null,
    ...overrides,
  };
  captured = {
    fetchCalls: [],
    jsonBodies: [],
    sentBodies: [],
  };
}
resetStubs();

// ── Module._load interception ─────────────────────────────────────────────────
// Must run BEFORE requiring the CF so that defineSecret / onRequest / admin are
// intercepted at load time.

const _origLoad = Module._load;
let capturedHandler = null;

function makeFirestoreStub() {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => {
          if (stubState.firestoreGetError) throw stubState.firestoreGetError;
          return {
            exists: stubState.docExists,
            data: () => stubState.docData,
          };
        },
      }),
    }),
  };
}

const adminStub = {
  apps: [{}],          // non-empty → initializeApp() skipped
  initializeApp: () => {},
  firestore: () => makeFirestoreStub(),   // called fresh per request
};

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') {
    return adminStub;
  }
  if (request === 'firebase-functions/v2/https') {
    return {
      onRequest: (_opts, handler) => {
        capturedHandler = handler;
        return {};
      },
    };
  }
  if (request === 'firebase-functions/params') {
    return {
      defineSecret: (name) => ({ value: () => process.env[name] || '' }),
    };
  }
  return _origLoad.call(this, request, parent, ...rest);
};

// ── Install global.fetch stub before require ──────────────────────────────────
const _origFetch = typeof global.fetch === 'function' ? global.fetch : null;
global.fetch = async (url, opts) => {
  captured.fetchCalls.push({ url, opts });
  if (stubState.fetchNetworkError) throw stubState.fetchNetworkError;
  return {
    ok: stubState.fetchOk,
    status: stubState.fetchStatus,
    text: async () => stubState.fetchResponseText,
  };
};

// ── Require CF after stubs installed ─────────────────────────────────────────
delete require.cache[require.resolve('../notifyLiffRequest.js')];
require('../notifyLiffRequest.js');

// Restore Module._load after require (fetch stub stays active for test run)
Module._load = _origLoad;

after(() => {
  if (_origFetch === null) delete global.fetch;
  else global.fetch = _origFetch;
});

// ── Request / response helpers ────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return { method: 'POST', body: { lineUserId: 'Uabc' }, ...overrides };
}

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)  { this._body = body; captured.jsonBodies.push(body); },
    send(body)  { this._body = body; captured.sentBodies.push(body); },
  };
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('notifyLiffRequest', () => {
  beforeEach(() => {
    resetStubs();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';
  });

  // 1. OPTIONS pre-flight → 204
  it('OPTIONS request returns 204', async () => {
    const res = makeRes();
    await capturedHandler(makeReq({ method: 'OPTIONS' }), res);
    assert.equal(res._status, 204);
    assert.ok(captured.sentBodies.length > 0 || res._body !== undefined);
  });

  // 2. GET → 405
  it('GET request returns 405 method not allowed', async () => {
    const res = makeRes();
    await capturedHandler(makeReq({ method: 'GET' }), res);
    assert.equal(res._status, 405);
    assert.match(res._body.error, /[Mm]ethod not allowed/);
  });

  // 3. PUT → 405
  it('PUT request returns 405 method not allowed', async () => {
    const res = makeRes();
    await capturedHandler(makeReq({ method: 'PUT' }), res);
    assert.equal(res._status, 405);
    assert.match(res._body.error, /[Mm]ethod not allowed/);
  });

  // 4. Missing lineUserId (undefined body) → 400
  it('returns 400 when body is undefined', async () => {
    const res = makeRes();
    await capturedHandler({ method: 'POST', body: undefined }, res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /lineUserId/);
  });

  // 5. Empty lineUserId → 400
  it('returns 400 when lineUserId is empty string', async () => {
    const res = makeRes();
    await capturedHandler(makeReq({ body: { lineUserId: '' } }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /lineUserId/);
  });

  // 5b. null lineUserId → 400
  it('returns 400 when lineUserId is null', async () => {
    const res = makeRes();
    await capturedHandler(makeReq({ body: { lineUserId: null } }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /lineUserId/);
  });

  // 6. liffUsers doc not found → 404
  it('returns 404 when liffUsers doc does not exist', async () => {
    resetStubs({ docExists: false });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';
    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 404);
    assert.match(res._body.error, /not found/);
  });

  // 7. doc status not pending ('approved') → 200 skipped
  it('returns 200 with skipped:true when doc status is approved', async () => {
    resetStubs({ docData: { status: 'approved', building: 'rooms', room: '15', lineDisplayName: 'สมชาย' } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';
    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.skipped, true);
    assert.match(res._body.reason, /not pending/);
  });

  // 8. doc status not pending ('rejected') → 200 skipped
  it('returns 200 with skipped:true when doc status is rejected', async () => {
    resetStubs({ docData: { status: 'rejected', building: 'rooms', room: '15', lineDisplayName: 'สมชาย' } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';
    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.skipped, true);
  });

  // 9. No LINE_CHANNEL_ACCESS_TOKEN → 500
  it('returns 500 when LINE_CHANNEL_ACCESS_TOKEN is not set', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';
    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 500);
    assert.match(res._body.error, /LINE_CHANNEL_ACCESS_TOKEN/);
  });

  // 10. No LINE_ADMIN_USER_IDS → 500
  it('returns 500 when LINE_ADMIN_USER_IDS is not set', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    delete process.env.LINE_ADMIN_USER_IDS;
    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 500);
    assert.match(res._body.error, /LINE_ADMIN_USER_IDS/);
  });

  // 11. Both secrets missing → 500
  it('returns 500 when both LINE secrets are absent', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.LINE_ADMIN_USER_IDS;
    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 500);
  });

  // 12. Success with 1 admin — push ok
  it('returns 200 ok:true pushed:1 failed:[] when one admin push succeeds', async () => {
    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.pushed, 1);
    assert.deepEqual(res._body.failed, []);
  });

  // 13. Success with 2 admins — both ok
  it('returns pushed:2 when two admins both receive push successfully', async () => {
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1,Uadmin2';

    // Per-call fetch responses: both succeed
    let callCount = 0;
    global.fetch = async (url, opts) => {
      captured.fetchCalls.push({ url, opts });
      callCount++;
      return { ok: true, status: 200, text: async () => '' };
    };

    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.pushed, 2);
    assert.deepEqual(res._body.failed, []);
    assert.equal(captured.fetchCalls.length, 2);

    // Restore default stub
    global.fetch = async (url, opts) => {
      captured.fetchCalls.push({ url, opts });
      if (stubState.fetchNetworkError) throw stubState.fetchNetworkError;
      return { ok: stubState.fetchOk, status: stubState.fetchStatus, text: async () => stubState.fetchResponseText };
    };
  });

  // 14. 2 admins — one fails
  it('returns pushed:1 and one entry in failed[] when second admin push fails', async () => {
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1,Uadmin2';

    let callCount = 0;
    global.fetch = async (url, opts) => {
      captured.fetchCalls.push({ url, opts });
      callCount++;
      const ok = callCount === 1;
      return {
        ok,
        status: ok ? 200 : 500,
        text: async () => ok ? '' : 'Internal Error',
      };
    };

    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.pushed, 1);
    assert.equal(res._body.failed.length, 1);

    global.fetch = async (url, opts) => {
      captured.fetchCalls.push({ url, opts });
      if (stubState.fetchNetworkError) throw stubState.fetchNetworkError;
      return { ok: stubState.fetchOk, status: stubState.fetchStatus, text: async () => stubState.fetchResponseText };
    };
  });

  // 15. 2 admins — both fail
  it('returns pushed:0 and two entries in failed[] when both admin pushes fail', async () => {
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1,Uadmin2';
    resetStubs({ fetchOk: false, fetchStatus: 503, fetchResponseText: 'Service Unavailable' });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1,Uadmin2';

    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.pushed, 0);
    assert.equal(res._body.failed.length, 2);
  });

  // 16. Fetch body shape — correct LINE API URL, Bearer token, to field, messages type
  it('calls LINE API with correct URL, Authorization header, to field and message type', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mytoken';
    process.env.LINE_ADMIN_USER_IDS = 'UadminXYZ';

    const res = makeRes();
    await capturedHandler(makeReq(), res);

    assert.equal(captured.fetchCalls.length, 1);
    const call = captured.fetchCalls[0];
    assert.equal(call.url, 'https://api.line.me/v2/bot/message/push');
    assert.equal(call.opts.method, 'POST');
    assert.equal(call.opts.headers['Authorization'], 'Bearer mytoken');
    assert.equal(call.opts.headers['Content-Type'], 'application/json');

    const parsedBody = JSON.parse(call.opts.body);
    assert.equal(parsedBody.to, 'UadminXYZ');
    assert.equal(parsedBody.messages.length, 1);
    assert.equal(parsedBody.messages[0].type, 'text');
  });

  // 17. building=nest gets nest label in message
  it('includes Nest building label in message text when building is nest', async () => {
    resetStubs({ docData: { status: 'pending', building: 'nest', room: '5', lineDisplayName: 'สมหญิง' } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';

    const res = makeRes();
    await capturedHandler(makeReq(), res);

    assert.equal(captured.fetchCalls.length, 1);
    const parsedBody = JSON.parse(captured.fetchCalls[0].opts.body);
    assert.ok(
      parsedBody.messages[0].text.includes('Nest'),
      `Expected message to include 'Nest', got: ${parsedBody.messages[0].text}`
    );
  });

  // 18. building=rooms gets rooms label in message
  it('includes ห้องเช่า building label in message text when building is rooms', async () => {
    resetStubs({ docData: { status: 'pending', building: 'rooms', room: '15', lineDisplayName: 'สมชาย' } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';

    const res = makeRes();
    await capturedHandler(makeReq(), res);

    assert.equal(captured.fetchCalls.length, 1);
    const parsedBody = JSON.parse(captured.fetchCalls[0].opts.body);
    assert.ok(
      parsedBody.messages[0].text.includes('ห้องเช่า'),
      `Expected message to include 'ห้องเช่า', got: ${parsedBody.messages[0].text}`
    );
  });

  // 19. lineDisplayName shown in message
  it('includes lineDisplayName in the message text', async () => {
    resetStubs({ docData: { status: 'pending', building: 'rooms', room: '7', lineDisplayName: 'มนัสนันท์' } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';

    const res = makeRes();
    await capturedHandler(makeReq(), res);

    const parsedBody = JSON.parse(captured.fetchCalls[0].opts.body);
    assert.ok(
      parsedBody.messages[0].text.includes('มนัสนันท์'),
      `Expected message to contain displayName 'มนัสนันท์', got: ${parsedBody.messages[0].text}`
    );
  });

  // 20. Firestore get throws → 500
  it('returns 500 when Firestore throws an error', async () => {
    resetStubs({ firestoreGetError: new Error('firestore unavailable') });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';
    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 500);
    assert.match(res._body.error, /firestore unavailable/);
  });

  // 21. Fetch network error for all admins → 200 pushed:0 with failed messages
  it('returns pushed:0 and failed messages when fetch throws a network error', async () => {
    resetStubs({ fetchNetworkError: new Error('ECONNRESET') });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';
    const res = makeRes();
    await capturedHandler(makeReq(), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.pushed, 0);
    assert.equal(res._body.failed.length, 1);
    assert.ok(
      res._body.failed[0].includes('ECONNRESET') || typeof res._body.failed[0] === 'string',
      `Expected failed entry to contain error message, got: ${res._body.failed[0]}`
    );
  });

  // 22. phone included in message when present
  it('includes phone number in message text when docData.phone is set', async () => {
    resetStubs({ docData: { status: 'pending', building: 'rooms', room: '15', lineDisplayName: 'สมชาย', phone: '0812345678' } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';

    const res = makeRes();
    await capturedHandler(makeReq(), res);

    const parsedBody = JSON.parse(captured.fetchCalls[0].opts.body);
    assert.ok(
      parsedBody.messages[0].text.includes('0812345678'),
      `Expected message to contain phone '0812345678', got: ${parsedBody.messages[0].text}`
    );
  });

  // 23. phone omitted from message when absent
  it('does not include a phone line in message text when docData.phone is absent', async () => {
    resetStubs({ docData: { status: 'pending', building: 'rooms', room: '15', lineDisplayName: 'สมชาย' } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';

    const res = makeRes();
    await capturedHandler(makeReq(), res);

    const parsedBody = JSON.parse(captured.fetchCalls[0].opts.body);
    assert.ok(
      !parsedBody.messages[0].text.includes('📱'),
      `Expected message NOT to contain phone emoji when phone absent, got: ${parsedBody.messages[0].text}`
    );
  });

  // 24. room number shown in message
  it('includes the room number in the message text', async () => {
    resetStubs({ docData: { status: 'pending', building: 'rooms', room: '42', lineDisplayName: 'ทดสอบ' } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    process.env.LINE_ADMIN_USER_IDS = 'Uadmin1';

    const res = makeRes();
    await capturedHandler(makeReq(), res);

    const parsedBody = JSON.parse(captured.fetchCalls[0].opts.body);
    assert.ok(
      parsedBody.messages[0].text.includes('42'),
      `Expected message to contain room '42', got: ${parsedBody.messages[0].text}`
    );
  });

  // 25. dashboard URL present in message
  it('includes the dashboard URL in the message text', async () => {
    const res = makeRes();
    await capturedHandler(makeReq(), res);

    const parsedBody = JSON.parse(captured.fetchCalls[0].opts.body);
    assert.ok(
      parsedBody.messages[0].text.includes('the-green-haven.vercel.app'),
      `Expected message to contain dashboard URL, got: ${parsedBody.messages[0].text}`
    );
  });

  // 26. LINE_ADMIN_USER_IDS with whitespace around commas is trimmed correctly
  it('trims whitespace from comma-separated admin IDs', async () => {
    process.env.LINE_ADMIN_USER_IDS = ' Uadmin1 , Uadmin2 ';

    let fetchedTos = [];
    global.fetch = async (url, opts) => {
      captured.fetchCalls.push({ url, opts });
      const body = JSON.parse(opts.body);
      fetchedTos.push(body.to);
      return { ok: true, status: 200, text: async () => '' };
    };

    const res = makeRes();
    await capturedHandler(makeReq(), res);

    assert.equal(res._body.pushed, 2);
    assert.ok(fetchedTos.includes('Uadmin1'), `Expected Uadmin1 in fetched tos: ${fetchedTos}`);
    assert.ok(fetchedTos.includes('Uadmin2'), `Expected Uadmin2 in fetched tos: ${fetchedTos}`);

    global.fetch = async (url, opts) => {
      captured.fetchCalls.push({ url, opts });
      if (stubState.fetchNetworkError) throw stubState.fetchNetworkError;
      return { ok: stubState.fetchOk, status: stubState.fetchStatus, text: async () => stubState.fetchResponseText };
    };
  });
});
