/**
 * Unit tests for notifyLiffStatusChange.js
 *
 * Covers: method guard (OPTIONS/GET/PUT/DELETE), body validation,
 * cold-start guard (no token), approved/rejected happy paths,
 * fetch body/header assertions, LINE API failure (best-effort 200),
 * network error (500), and call-count checks.
 *
 * Run: node --test functions/__tests__/notifyLiffStatusChange.test.js
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

// ── Module._load intercept (must happen BEFORE require('../notifyLiffStatusChange')) ──

let capturedHandler;

const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') {
    return {
      apps: [{}],
      initializeApp: () => {},
    };
  }
  if (request === 'firebase-functions/v2/https') {
    return {
      onRequest: (opts, handler) => {
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
  return _origLoad.apply(this, arguments);
};

// Load the CF under test — capturedHandler is set as a side-effect.
delete require.cache[require.resolve('../notifyLiffStatusChange.js')];
require('../notifyLiffStatusChange.js');

// Restore Module._load so other modules are unaffected.
Module._load = _origLoad;

// ── global.fetch stub ─────────────────────────────────────────────────────────

const _origFetch = typeof global.fetch === 'function' ? global.fetch : undefined;

global.fetch = async (url, opts) => {
  captured.fetchCalls.push({ url, opts });
  if (stubState.fetchNetworkError) throw stubState.fetchNetworkError;
  return {
    ok: stubState.fetchOk,
    status: stubState.fetchStatus,
    text: async () => stubState.fetchResponseText,
  };
};

after(() => {
  if (_origFetch === undefined) delete global.fetch;
  else global.fetch = _origFetch;
});

// ── Request / response helpers ────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    body: { lineUserId: 'Uabc123', status: 'approved' },
    ...overrides,
  };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => {
    res._status = code;
    return res;
  };
  res.json = (body) => {
    res._body = body;
    captured.jsonBodies.push(body);
  };
  res.send = (body) => {
    res._body = body;
    captured.sentBodies.push(body);
  };
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('notifyLiffStatusChange', () => {

  beforeEach(() => {
    resetStubs();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  });

  // ── Method guard ─────────────────────────────────────────────────────────────

  describe('method guard', () => {
    it('OPTIONS → 204 + empty send', async () => {
      const req = makeReq({ method: 'OPTIONS' });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 204);
      assert.equal(captured.sentBodies[0], '');
    });

    it('GET → 405 with error message', async () => {
      const req = makeReq({ method: 'GET' });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 405);
      assert.ok(res._body && res._body.error, 'error field present');
    });

    it('PUT → 405', async () => {
      const req = makeReq({ method: 'PUT' });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 405);
    });

    it('DELETE → 405', async () => {
      const req = makeReq({ method: 'DELETE' });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 405);
    });
  });

  // ── Body validation ───────────────────────────────────────────────────────────

  describe('body validation', () => {
    it('missing lineUserId → 400', async () => {
      const req = makeReq({ body: { status: 'approved' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 400);
      assert.ok(res._body.error, 'error field present');
    });

    it('missing status → 400', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 400);
      assert.ok(res._body.error, 'error field present');
    });

    it('both fields missing (empty body) → 400', async () => {
      const req = makeReq({ body: {} });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 400);
    });

    it('status "pending" → 400 with "status must be approved or rejected"', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'pending' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 400);
      assert.match(res._body.error, /status must be approved or rejected/);
    });

    it('status "unknown" → 400', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'unknown' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 400);
    });
  });

  // ── Cold-start guard (no token) ───────────────────────────────────────────────

  describe('cold-start guard', () => {
    it('missing LINE_CHANNEL_ACCESS_TOKEN → 200 { ok:false, skipped:true, reason:"no token" }', async () => {
      delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
      const req = makeReq();
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 200);
      assert.deepEqual(res._body, { ok: false, skipped: true, reason: 'no token' });
    });

    it('when token is not set, fetch is NOT called', async () => {
      delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
      const req = makeReq();
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(captured.fetchCalls.length, 0);
    });
  });

  // ── Approved path ─────────────────────────────────────────────────────────────

  describe('approved path', () => {
    it('approved + LINE ok → 200 { ok: true }', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'approved' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 200);
      assert.deepEqual(res._body, { ok: true });
    });

    it('approved: fetch body contains lineUserId as "to"', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'approved' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(captured.fetchCalls.length, 1);
      const body = JSON.parse(captured.fetchCalls[0].opts.body);
      assert.equal(body.to, 'Uabc123');
    });

    it('approved: fetch body messages text contains 🎉', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'approved' } });
      const res = makeRes();
      await capturedHandler(req, res);
      const body = JSON.parse(captured.fetchCalls[0].opts.body);
      assert.ok(
        body.messages && body.messages[0] && body.messages[0].text.includes('🎉'),
        `Expected 🎉 in message text, got: ${body.messages && body.messages[0] && body.messages[0].text}`
      );
    });

    it('approved: Authorization header is "Bearer tok"', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'approved' } });
      const res = makeRes();
      await capturedHandler(req, res);
      const headers = captured.fetchCalls[0].opts.headers;
      assert.equal(headers.Authorization, 'Bearer tok');
    });

    it('when token is set, fetch IS called exactly once', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'approved' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(captured.fetchCalls.length, 1);
    });
  });

  // ── Rejected path ─────────────────────────────────────────────────────────────

  describe('rejected path', () => {
    it('rejected + LINE ok → 200 { ok: true }', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'rejected' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 200);
      assert.deepEqual(res._body, { ok: true });
    });

    it('rejected without reason: message text contains default reason', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'rejected' } });
      const res = makeRes();
      await capturedHandler(req, res);
      const body = JSON.parse(captured.fetchCalls[0].opts.body);
      const text = body.messages[0].text;
      assert.ok(
        text.includes('ข้อมูลไม่ตรงกับสัญญาเช่า กรุณาติดต่อเจ้าของ'),
        `Expected default reason in text, got: ${text}`
      );
    });

    it('rejected with custom reason: message text contains custom reason', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'rejected', reason: 'เหตุผลพิเศษ' } });
      const res = makeRes();
      await capturedHandler(req, res);
      const body = JSON.parse(captured.fetchCalls[0].opts.body);
      const text = body.messages[0].text;
      assert.ok(
        text.includes('เหตุผลพิเศษ'),
        `Expected custom reason in text, got: ${text}`
      );
    });

    it('rejected: message text contains ❌', async () => {
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'rejected' } });
      const res = makeRes();
      await capturedHandler(req, res);
      const body = JSON.parse(captured.fetchCalls[0].opts.body);
      const text = body.messages[0].text;
      assert.ok(text.includes('❌'), `Expected ❌ in rejected text, got: ${text}`);
    });
  });

  // ── LINE API failure (best-effort 200) ────────────────────────────────────────

  describe('LINE API failure', () => {
    it('LINE returns 429 → still 200 { ok:false, lineStatus:429, error: "..." }', async () => {
      stubState.fetchOk = false;
      stubState.fetchStatus = 429;
      stubState.fetchResponseText = 'Too Many Requests';
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'approved' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 200);
      assert.equal(res._body.ok, false);
      assert.equal(res._body.lineStatus, 429);
      assert.ok(typeof res._body.error === 'string', 'error field is a string');
    });

    it('LINE returns 401 → still 200 { ok:false, lineStatus:401 }', async () => {
      stubState.fetchOk = false;
      stubState.fetchStatus = 401;
      stubState.fetchResponseText = 'Unauthorized';
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'approved' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 200);
      assert.equal(res._body.ok, false);
      assert.equal(res._body.lineStatus, 401);
    });
  });

  // ── Network error ─────────────────────────────────────────────────────────────

  describe('network error', () => {
    it('fetch throws → 500 { error: "..." }', async () => {
      stubState.fetchNetworkError = new Error('ECONNRESET');
      const req = makeReq({ body: { lineUserId: 'Uabc123', status: 'approved' } });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 500);
      assert.ok(res._body && res._body.error, 'error field present');
    });
  });
});
