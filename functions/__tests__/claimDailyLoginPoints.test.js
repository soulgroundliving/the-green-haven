/**
 * Unit tests for claimDailyLoginPoints — tenant auth gate via _authSoT.
 * Covers §7-Z hardening: tenants whose room/building claims drifted after
 * ID-token refresh can still claim daily points via SoT fallback.
 *
 * Player branch (people/{tenantId}) was already protected via tok.tenantId
 * claim match — not the focus here.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tenantDocs;          // keyed by `${building}/${roomId}`
let lastTenantUpdate;

function resetStubs() {
  tenantDocs = {};
  lastTenantUpdate = null;
}
resetStubs();

const SERVER_TS = '__SERVER_TS__';

function tenantDocRef(building, roomId) {
  const key = `${building}/${roomId}`;
  return {
    _key: key,
    get: async () => ({ exists: key in tenantDocs, data: () => tenantDocs[key] }),
  };
}

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'tenants') {
          return {
            doc: (building) => ({
              collection: () => ({
                doc: (roomId) => tenantDocRef(building, roomId),
              }),
            }),
          };
        }
        if (name === 'people') {
          return { doc: () => ({ get: async () => ({ exists: false, data: () => null }) }) };
        }
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => ({
            exists: ref._key in tenantDocs,
            data: () => tenantDocs[ref._key],
          }),
          update: async (ref, patch) => { lastTenantUpdate = { key: ref._key, patch }; },
        };
        return fn(tx);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
    };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    return {
      region: () => ({ https: { onCall: (h) => h } }),
      https: { HttpsError },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { claimDailyLoginPoints: handler } = require('../claimDailyLoginPoints');

function ctx({ uid = 'line:U1', admin = false, room = '', building = '', tenantId = '', managedBuildings = null, role = '' } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  if (managedBuildings) token.managedBuildings = managedBuildings;
  if (role) token.role = role;
  return { auth: { uid, token } };
}

function seedTenant(building, roomId, fields) {
  tenantDocs[`${building}/${roomId}`] = { gamification: {}, ...fields };
}

describe('claimDailyLoginPoints — auth gate', () => {
  beforeEach(resetStubs);

  it('Path 1 claim match → claims points', async () => {
    seedTenant('rooms', '15', { name: 'Tenant 15' });
    const r = await handler(
      { building: 'rooms', roomId: '15' },
      ctx({ room: '15', building: 'rooms', tenantId: 't-15' }),
    );
    assert.equal(r.success, true);
    assert.equal(r.reward, 1);
    assert.equal(r.streak, 1);
  });

  it('Path 2a uid-sot: claims drifted but linkedAuthUid matches → claims succeed', async () => {
    seedTenant('rooms', '15', {
      linkedAuthUid: 'line:Utenant15',
      tenantId: 't-15',
      name: 'Tenant 15',
    });
    const r = await handler(
      { building: 'rooms', roomId: '15' },
      ctx({ uid: 'line:Utenant15' /* no room/building claims */ }),
    );
    assert.equal(r.success, true);
  });

  it('Path 1b tenantId-sot: claims drifted but tenantId matches doc → claims succeed', async () => {
    seedTenant('rooms', '15', {
      linkedAuthUid: 'line:Uold',
      tenantId: 't-15',
      name: 'Tenant 15',
    });
    const r = await handler(
      { building: 'rooms', roomId: '15' },
      ctx({ uid: 'anon-rotated', tenantId: 't-15' }),
    );
    assert.equal(r.success, true);
  });

  it('claim drift + wrong uid + wrong tenantId → permission-denied', async () => {
    seedTenant('rooms', '15', {
      linkedAuthUid: 'line:Ureal',
      tenantId: 't-real',
      name: 'Real',
    });
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15' },
        ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' /* no room claim */ }),
      ),
      (e) => e.code === 'permission-denied',
    );
  });

  it('admin bypass → claims succeed even with no room claims', async () => {
    seedTenant('rooms', '15', { name: 'Tenant 15' });
    const r = await handler(
      { building: 'rooms', roomId: '15' },
      ctx({ uid: 'admin@x', admin: true }),
    );
    assert.equal(r.success, true);
  });

  it('invalid building → invalid-argument before auth check', async () => {
    await assert.rejects(
      () => handler(
        { building: 'unknown', roomId: '15' },
        ctx({ room: '15', building: 'unknown' }),
      ),
      (e) => e.code === 'invalid-argument',
    );
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '15' }, { auth: null }),
      (e) => e.code === 'unauthenticated',
    );
  });

  it('player path (role=player + tenantId) is unchanged — auth via tok.tenantId match', async () => {
    // Player path reads people/{tenantId}, which our mock returns not-found.
    // We only need to verify the player gate doesn't run through the tenant
    // assertTenantAccess (which would throw permission-denied for missing tenant doc).
    await assert.rejects(
      () => handler(
        { tenantId: 't-player' },
        ctx({ uid: 'line:Uplayer', role: 'player', tenantId: 't-player' }),
      ),
      (e) => e.code === 'not-found',
    );
  });
});
