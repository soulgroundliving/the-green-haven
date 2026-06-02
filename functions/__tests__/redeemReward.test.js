/**
 * Unit tests for redeemReward — tenant auth gate via _authSoT.
 * Focused on §7-Z hardening of the tenant branch (line 117+).
 * Player branch (line 40-114) uses tok.tenantId match — already protected.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tenantDocs;
let peopleDocs;
let rewardDocs;
let redemptionWrites;
let tenantUpdates;
let ledgerWrites;        // pointsLedger rows appended via appendPointsLedger
let rateLimitCalled;

function resetStubs() {
  tenantDocs = {};
  peopleDocs = {};
  rewardDocs = {};
  redemptionWrites = [];
  tenantUpdates = [];
  ledgerWrites = [];
  rateLimitCalled = false;
}
resetStubs();

const SERVER_TS = '__SERVER_TS__';

function tenantDocRef(building, roomId) {
  const key = `${building}/${roomId}`;
  return {
    _kind: 'tenant', _key: key,
    get: async () => ({ exists: key in tenantDocs, data: () => tenantDocs[key] }),
    collection: () => ({
      doc: () => ({ _kind: 'redemption', id: 'R_' + Math.random().toString(36).slice(2, 8) }),
      where: () => ({ _kind: 'redemption-query' }),
    }),
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
          return {
            doc: (id) => ({
              get: async () => ({
                exists: id in peopleDocs,
                data: () => peopleDocs[id],
              }),
            }),
          };
        }
        if (name === 'rewards') {
          return {
            doc: (id) => ({
              _kind: 'reward', _id: id,
              get: async () => ({ exists: id in rewardDocs, data: () => rewardDocs[id] }),
            }),
          };
        }
        if (name === 'pointsLedger') {
          return { doc: (id) => ({ _kind: 'ledger', _ledgerKey: id }) };
        }
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (refOrQuery) => {
            if (refOrQuery?._kind === 'reward') {
              return { exists: refOrQuery._id in rewardDocs, data: () => rewardDocs[refOrQuery._id] };
            }
            if (refOrQuery?._kind === 'tenant') {
              return { exists: refOrQuery._key in tenantDocs, data: () => tenantDocs[refOrQuery._key] };
            }
            if (refOrQuery?._kind === 'redemption-query') {
              return { forEach: () => {} }; // no prior redemptions
            }
            throw new Error('unexpected tx.get ref: ' + JSON.stringify(refOrQuery));
          },
          set: async (ref, payload) => {
            if (ref && ref._kind === 'ledger') { ledgerWrites.push({ key: ref._ledgerKey, payload }); return; }
            redemptionWrites.push({ id: ref.id, payload });
          },
          update: async (ref, patch) => { tenantUpdates.push({ key: ref._key, patch }); },
        };
        return fn(tx);
      },
    });
    firestoreFn.FieldValue = {
      serverTimestamp: () => SERVER_TS,
      increment: (n) => ({ __increment: n }),
    };
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
  if (id === './_rateLimit') {
    return { checkRateLimit: async () => { rateLimitCalled = true; } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { redeemReward: handler } = require('../redeemReward');

function ctx({ uid = 'line:U1', admin = false, room = '', building = '', tenantId = '', role = '' } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  if (role) token.role = role;
  return { auth: { uid, token } };
}

function seedTenant(building, roomId, points = 100, extra = {}) {
  tenantDocs[`${building}/${roomId}`] = {
    name: `Tenant ${roomId}`,
    gamification: { points },
    ...extra,
  };
}

function seedReward(id, cost = 10) {
  rewardDocs[id] = { name: `Reward ${id}`, cost, active: true };
}

describe('redeemReward — tenant branch auth gate', () => {
  beforeEach(resetStubs);

  it('Path 1 claim match → redeem succeeds', async () => {
    seedTenant('rooms', '15', 100);
    seedReward('rw-1', 10);
    const r = await handler(
      { building: 'rooms', roomId: '15', rewardId: 'rw-1' },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.success, true);
    assert.equal(r.pointsAfter, 90);
    assert.equal(redemptionWrites.length, 1);
    // pointsLedger row written in the same tx (signed negative for a redeem)
    assert.equal(ledgerWrites.length, 1);
    assert.equal(ledgerWrites[0].payload.source, 'redeem');
    assert.equal(ledgerWrites[0].payload.points, -10);
    assert.equal(ledgerWrites[0].payload.balanceAfter, 90);
  });

  it('Path 2a uid-sot: claims drifted, linkedAuthUid matches → redeem succeeds', async () => {
    seedTenant('rooms', '15', 100, {
      linkedAuthUid: 'line:Utenant15',
      tenantId: 't-15',
    });
    seedReward('rw-1', 10);
    const r = await handler(
      { building: 'rooms', roomId: '15', rewardId: 'rw-1' },
      ctx({ uid: 'line:Utenant15' /* no room/building claims */ }),
    );
    assert.equal(r.success, true);
  });

  it('claim drift + no SoT match → permission-denied', async () => {
    seedTenant('rooms', '15', 100, {
      linkedAuthUid: 'line:Ureal',
      tenantId: 't-real',
    });
    seedReward('rw-1', 10);
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', rewardId: 'rw-1' },
        ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' }),
      ),
      (e) => e.code === 'permission-denied',
    );
  });

  it('admin bypass → redeem succeeds with no room claims', async () => {
    seedTenant('rooms', '15', 100);
    seedReward('rw-1', 10);
    const r = await handler(
      { building: 'rooms', roomId: '15', rewardId: 'rw-1' },
      ctx({ uid: 'admin@x', admin: true }),
    );
    assert.equal(r.success, true);
  });

  it('player branch (role=player) is unaffected — uses tok.tenantId match', async () => {
    // Player auth check at line 48 throws permission-denied if tenantId mismatch.
    await assert.rejects(
      () => handler(
        { tenantId: 't-victim', rewardId: 'rw-1' },
        ctx({ uid: 'line:Uattacker', role: 'player', tenantId: 't-attacker' }),
      ),
      (e) => e.code === 'permission-denied' && /own account/.test(e.message),
    );
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', rewardId: 'rw-1' },
        { auth: null },
      ),
      (e) => e.code === 'unauthenticated',
    );
  });

  it('invalid building → invalid-argument before auth check', async () => {
    await assert.rejects(
      () => handler(
        { building: 'unknown', roomId: '15', rewardId: 'rw-1' },
        ctx({ room: '15', building: 'unknown' }),
      ),
      (e) => e.code === 'invalid-argument',
    );
  });
});
