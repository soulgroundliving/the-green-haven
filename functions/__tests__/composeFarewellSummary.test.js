/**
 * Unit tests for composeFarewellSummary (Meaning Layer #16-v2).
 * Run: node --test functions/__tests__/composeFarewellSummary.test.js
 *
 * The Anthropic client is MOCKED — CI never calls the real API (no key, no
 * spend, no flakiness). The test ALSO asserts the mocked client received NO
 * PII in its prompt (the cross-border PDPA guarantee, end-to-end through the CF).
 */
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state (captured by module-level singletons in the CF) ──────────────
let stubTenant = null;        // tenants/{b}/list/{r} doc data (or null = not found)
let setCalls = [];            // [{ data, options }] — ref.set() merge writes
let anthropicCalls = [];      // [{ apiKey, params }] — captured model requests
let anthropicReply = { content: [{ type: 'text', text: 'สวัสดี {{NAME}} ขอบคุณนะ' }] };
let anthropicThrows = null;   // set to an Error to simulate an API failure

function resetStubs() {
  stubTenant = { tenantId: 'TID-1', name: 'สมชาย ใจดี', phone: '081-234-5678',
    lease: { moveInDate: '2024-01-15' },
    gamification: { points: 1240, badges: [{ id: 'a' }, { id: 'b' }], dailyStreak: 17,
      marketplaceStats: { tradesCompleted: 9 } } };
  setCalls = [];
  anthropicCalls = [];
  anthropicReply = { content: [{ type: 'text', text: 'สวัสดี {{NAME}} ขอบคุณนะ' }] };
  anthropicThrows = null;
}
resetStubs();

// ── Module._load interception (before requiring the CF) ─────────────────────
const Module = require('module');
const _origLoad = Module._load;

Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const docStub = {
      get: async () => ({
        exists: stubTenant !== null,
        data: () => stubTenant,
      }),
      set: async (data, options) => { setCalls.push({ data, options }); },
    };
    const firestoreStub = () => ({
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => docStub }) }) }),
    });
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: Object.assign(firestoreStub, {
        FieldValue: { serverTimestamp: () => '__ts__' },
      }),
    };
  }

  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    const self = {
      region: () => self,
      runWith: () => self,
      https: { onCall: (fn) => fn, HttpsError },
      HttpsError,
    };
    return self;
  }

  // The Anthropic SDK is a CF-only dep that may not be installed in CI — and we
  // must never hit the real API. Stub the constructor + messages.create.
  if (id === '@anthropic-ai/sdk') {
    return class AnthropicMock {
      constructor(opts) { this._apiKey = opts && opts.apiKey; }
      get messages() {
        const apiKey = this._apiKey;
        return {
          create: async (params) => {
            anthropicCalls.push({ apiKey, params });
            if (anthropicThrows) throw anthropicThrows;
            return anthropicReply;
          },
        };
      }
    };
  }

  return _origLoad.call(this, id, parent, ...rest);
};

after(() => { Module._load = _origLoad; });

delete require.cache[require.resolve('../composeFarewellSummary.js')];
const mod = require('../composeFarewellSummary.js');
const handler = mod.composeFarewellSummary;

// ── Context helpers ─────────────────────────────────────────────────────────
const adminCtx = (uid = 'admin-uid') => ({ auth: { uid, token: { admin: true } } });
const tenantCtx = () => ({ auth: { uid: 'line:U1', token: {} } });
const noAuth = { auth: null };
const validGen = { building: 'rooms', roomId: '28' };

describe('composeFarewellSummary — auth + validation', () => {
  beforeEach(() => { resetStubs(); process.env.ANTHROPIC_API_KEY = 'test-key-abc'; });

  it('throws unauthenticated with no auth', async () => {
    await assert.rejects(() => handler(validGen, noAuth), (e) => e.code === 'unauthenticated');
  });
  it('throws permission-denied for a non-admin', async () => {
    await assert.rejects(() => handler(validGen, tenantCtx()), (e) => e.code === 'permission-denied');
  });
  it('throws invalid-argument for a bad building', async () => {
    await assert.rejects(() => handler({ building: 'amazon', roomId: '1' }, adminCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('throws invalid-argument for a bad roomId', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: 'a/b' }, adminCtx()),
      (e) => e.code === 'invalid-argument');
  });
});

describe('composeFarewellSummary — generate (draft) path', () => {
  beforeEach(() => { resetStubs(); process.env.ANTHROPIC_API_KEY = 'test-key-abc'; });

  it('returns a DRAFT and writes NOTHING (§7-I)', async () => {
    const res = await handler(validGen, adminCtx());
    assert.equal(res.model, 'claude-haiku-4-5');
    assert.equal(setCalls.length, 0, 'generate must not write to Firestore');
    // Name templated in LOCALLY after the prose returns.
    assert.equal(res.draft, 'สวัสดี สมชาย ใจดี ขอบคุณนะ');
  });

  it('passes ONLY the API key + anonymized stats to the model — NO PII crosses the border', async () => {
    await handler(validGen, adminCtx());
    assert.equal(anthropicCalls.length, 1);
    const call = anthropicCalls[0];
    assert.equal(call.apiKey, 'test-key-abc');
    assert.equal(call.params.model, 'claude-haiku-4-5');
    assert.equal(call.params.max_tokens, 400);
    // The user content + system prompt must contain none of the PII.
    const payload = JSON.stringify(call.params.messages) + call.params.system;
    for (const pii of ['สมชาย ใจดี', '081-234-5678', 'TID-1', '2024-01-15', 'rooms', '28']) {
      assert.ok(!payload.includes(pii), `model payload leaked PII: "${pii}"`);
    }
  });

  it('throws failed-precondition when the secret is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await assert.rejects(() => handler(validGen, adminCtx()), (e) => e.code === 'failed-precondition');
    assert.equal(anthropicCalls.length, 0, 'must not call the model without a key');
  });

  it('throws not-found for a vacant/missing room', async () => {
    stubTenant = null;
    await assert.rejects(() => handler(validGen, adminCtx()), (e) => e.code === 'not-found');
  });

  it('maps an Anthropic failure to a clean internal error', async () => {
    anthropicThrows = new Error('429 rate limit');
    await assert.rejects(() => handler(validGen, adminCtx()), (e) => e.code === 'internal');
    assert.equal(setCalls.length, 0);
  });

  it('throws internal when the model returns empty prose', async () => {
    anthropicReply = { content: [{ type: 'text', text: '   ' }] };
    await assert.rejects(() => handler(validGen, adminCtx()), (e) => e.code === 'internal');
  });

  it('still produces a draft when the tenant has no name (neutral fallback)', async () => {
    stubTenant = { tenantId: 'TID-2', lease: {}, gamification: { points: 10 } };
    anthropicReply = { content: [{ type: 'text', text: 'ขอบคุณ {{NAME}}' }] };
    const res = await handler(validGen, adminCtx());
    assert.equal(res.draft, 'ขอบคุณ คุณ');
  });
});

describe('composeFarewellSummary — publish (confirm) path', () => {
  beforeEach(() => { resetStubs(); process.env.ANTHROPIC_API_KEY = 'test-key-abc'; });

  it('writes farewellSummary{status:published} with merge, no model call', async () => {
    const res = await handler(
      { ...validGen, publish: true, text: 'ขอบคุณ สมชาย สำหรับทุกช่วงเวลา 🌿' }, adminCtx());
    assert.deepEqual(res, { published: true, model: 'claude-haiku-4-5' });
    assert.equal(anthropicCalls.length, 0, 'publish must not call the model');
    assert.equal(setCalls.length, 1);
    const { data, options } = setCalls[0];
    assert.equal(options.merge, true);
    assert.equal(data.farewellSummary.status, 'published');
    assert.equal(data.farewellSummary.text, 'ขอบคุณ สมชาย สำหรับทุกช่วงเวลา 🌿');
    assert.equal(data.farewellSummary.model, 'claude-haiku-4-5');
    assert.equal(data.farewellSummary.generatedBy, 'admin-uid');
    assert.equal(data.farewellSummary.generatedAt, '__ts__');
  });

  it('throws invalid-argument when publishing empty text', async () => {
    await assert.rejects(() => handler({ ...validGen, publish: true, text: '  ' }, adminCtx()),
      (e) => e.code === 'invalid-argument');
    assert.equal(setCalls.length, 0);
  });

  it('throws failed-precondition when publishing onto a vacant room', async () => {
    stubTenant = { tenantId: '' }; // vacant
    await assert.rejects(() => handler({ ...validGen, publish: true, text: 'hi' }, adminCtx()),
      (e) => e.code === 'failed-precondition');
    assert.equal(setCalls.length, 0);
  });

  it('does not require the API key on the publish path', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await handler({ ...validGen, publish: true, text: 'ขอบคุณนะ' }, adminCtx());
    assert.equal(res.published, true);
  });
});
