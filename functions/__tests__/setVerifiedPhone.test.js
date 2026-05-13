/**
 * Unit tests for setVerifiedPhone.js — focused on Tier 3F dynamic-registry
 * validation behavior. Mocks firebase-admin, firebase-functions/v1, and
 * ./buildingRegistry. Runs the onCall handler directly.
 *
 * Run: node --test functions/__tests__/setVerifiedPhone.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let stubValidBuildings;
let stubTenantDocs;
let updateCalls;

function resetStubs() {
  stubValidBuildings = new Set(['rooms', 'nest']);
  stubTenantDocs = {};
  updateCalls = [];
}
resetStubs();

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (top) => ({
        doc: (b) => ({
          collection: (sub) => ({
            doc: (r) => {
              const path = `${top}/${b}/${sub}/${r}`;
              return {
                get: async () => {
                  const data = stubTenantDocs[path];
                  return { exists: data !== undefined, data: () => data };
                },
                update: async (patch) => { updateCalls.push({ path, patch }); },
              };
            },
            limit: () => ({ get: async () => ({ docs: [] }) }),
          }),
        }),
      }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => '__ts__' };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    return {
      region: () => ({
        https: {
          onCall: (handler) => handler,
        },
      }),
      https: { HttpsError },
    };
  }
  if (id === './buildingRegistry') {
    return {
      getValidBuildings: async () => new Set(stubValidBuildings),
      getAllBuildings: async () => Array.from(stubValidBuildings),
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { setVerifiedPhone: handler } = require('../setVerifiedPhone');

function makeContext({ phone = '+66812345678', uid = 'phone-uid-1' } = {}) {
  return {
    auth: {
      uid,
      token: {
        firebase: { sign_in_provider: 'phone' },
        phone_number: phone,
      },
    },
  };
}

describe('setVerifiedPhone — dynamic building validation', () => {
  beforeEach(resetStubs);

  it('accepts canonical building "rooms"', async () => {
    stubTenantDocs['tenants/rooms/list/15'] = { linkedAuthUid: 'old-anon-1', phone: '' };
    const res = await handler(
      { oldAnonUid: 'old-anon-1', building: 'rooms', room: '15', phone: '0812345678' },
      makeContext()
    );
    assert.deepEqual(res, { ok: true });
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].path, 'tenants/rooms/list/15');
  });

  it('accepts new building from registry (e.g. "test_b2")', async () => {
    stubValidBuildings.add('test_b2');
    stubTenantDocs['tenants/test_b2/list/101'] = { linkedAuthUid: 'old-anon-2', phone: '' };
    const res = await handler(
      { oldAnonUid: 'old-anon-2', building: 'test_b2', room: '101', phone: '0812345678' },
      makeContext()
    );
    assert.deepEqual(res, { ok: true });
    assert.equal(updateCalls[0].path, 'tenants/test_b2/list/101');
  });

  it('rejects building not in registry', async () => {
    await assert.rejects(
      () => handler(
        { oldAnonUid: 'x', building: 'unknown_b', room: '1', phone: '0812345678' },
        makeContext()
      ),
      (err) => err.code === 'invalid-argument' && /must be one of/.test(err.message)
    );
  });

  it('falls back to legacy "RentRoom" path when canonical "rooms" doc missing', async () => {
    stubTenantDocs['tenants/RentRoom/list/15'] = { linkedAuthUid: 'old-anon-3', phone: '' };
    const res = await handler(
      { oldAnonUid: 'old-anon-3', building: 'rooms', room: '15', phone: '0812345678' },
      makeContext()
    );
    assert.deepEqual(res, { ok: true });
    assert.equal(updateCalls[0].path, 'tenants/RentRoom/list/15');
  });

  it('does NOT use legacy fallback for new buildings', async () => {
    stubValidBuildings.add('test_b2');
    // No doc at test_b2 path, and no legacy alias should exist
    await assert.rejects(
      () => handler(
        { oldAnonUid: 'x', building: 'test_b2', room: '999', phone: '0812345678' },
        makeContext()
      ),
      (err) => err.code === 'not-found'
    );
  });
});
