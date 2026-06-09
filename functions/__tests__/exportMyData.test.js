/**
 * Unit tests for exportMyData — DSR export auth gate via _authSoT.
 * Verifies the §7-Z hardening: claim-stripped tenants can still export
 * their data via people-doc fallback + SoT crosscheck.
 *
 * Full payload composition (lease lookup, RTDB reads, etc.) is covered by
 * integration testing; here we focus on the auth gate change.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tenantDocs;     // keyed by `${building}/${roomId}`
let peopleDocs;     // keyed by tenantId
let leaseDocs;      // keyed by `${building}/${leaseId}`
let liffUserDocs;   // keyed by lineUserId
let collectionGroupResults;
let rtdbValues;     // keyed by full path
let trustScoreDocs; // keyed by tenantId
let petsDocs;       // keyed by `${building}/${roomId}` → [{ id, data() }]

function resetStubs() {
  tenantDocs = {};
  peopleDocs = {};
  leaseDocs = {};
  liffUserDocs = {};
  collectionGroupResults = { checklistInstances: [], consents: [] };
  rtdbValues = {};
  trustScoreDocs = {};
  petsDocs = {};
}
resetStubs();

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
                doc: (roomId) => ({
                  get: async () => {
                    const key = `${building}/${roomId}`;
                    return { exists: key in tenantDocs, data: () => tenantDocs[key] };
                  },
                  // pets subcollection (exportMyData #9 — tenants/{b}/list/{r}/pets)
                  collection: () => ({
                    get: async () => ({ docs: petsDocs[`${building}/${roomId}`] || [] }),
                  }),
                }),
              }),
            }),
          };
        }
        if (name === 'people') {
          return {
            doc: (id) => ({
              get: async () => ({ exists: id in peopleDocs, data: () => peopleDocs[id] }),
            }),
          };
        }
        if (name === 'leases') {
          return {
            doc: (building) => ({
              collection: () => ({
                doc: (leaseId) => ({
                  get: async () => {
                    const key = `${building}/${leaseId}`;
                    return { exists: key in leaseDocs, data: () => leaseDocs[key] };
                  },
                }),
              }),
            }),
          };
        }
        if (name === 'liffUsers') {
          return {
            doc: (id) => ({
              get: async () => ({ exists: id in liffUserDocs, data: () => liffUserDocs[id] }),
            }),
          };
        }
        if (name === 'checklistInstances') {
          return {
            where: () => ({
              where: function () { return this; },
              get: async () => ({ docs: collectionGroupResults.checklistInstances }),
            }),
          };
        }
        if (name === 'consents') {
          return {
            where: () => ({
              get: async () => ({ docs: collectionGroupResults.consents }),
            }),
          };
        }
        if (name === 'trustScores') {
          return {
            doc: (id) => ({
              get: async () => ({ exists: id in trustScoreDocs, data: () => trustScoreDocs[id] }),
            }),
          };
        }
        throw new Error('unexpected collection: ' + name);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => '__SERVER_TS__' };
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
      database: () => ({
        ref: (p) => ({
          toString: () => p,
          once: async () => ({ val: () => rtdbValues[p] || null }),
        }),
      }),
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

const { exportMyData: handler } = require('../exportMyData');

function ctx({ uid = 'line:U1', admin = false, room = '', building = '', tenantId = '', managedBuildings = null } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  if (managedBuildings) token.managedBuildings = managedBuildings;
  return { auth: { uid, token } };
}

describe('exportMyData — auth gate', () => {
  beforeEach(resetStubs);

  it('Path 1 claim match → export succeeds with resolved building/room', async () => {
    tenantDocs['rooms/15'] = { name: 'T15', tenantId: 't-15' };
    const r = await handler({}, ctx({ room: '15', building: 'rooms', tenantId: 't-15' }));
    assert.equal(r.subject.room, '15');
    assert.equal(r.subject.building, 'rooms');
    assert.equal(r.subject.tenantId, 't-15');
    assert.deepEqual(r.tenant, { name: 'T15', tenantId: 't-15' });
  });

  it('Path 2a uid-sot: claims stripped, people doc resolves, SoT verifies → export succeeds', async () => {
    peopleDocs['t-15'] = { building: 'rooms', room: '15', name: 'T15 People' };
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Utenant15', tenantId: 't-15', name: 'T15' };
    const r = await handler(
      {},
      ctx({ uid: 'line:Utenant15', tenantId: 't-15' /* no room/building claims */ }),
    );
    assert.equal(r.subject.building, 'rooms');
    assert.equal(r.subject.room, '15');
  });

  it('claims stripped + no people doc → permission-denied', async () => {
    await assert.rejects(
      () => handler({}, ctx({ uid: 'line:Uorphan' /* nothing */ })),
      (e) => e.code === 'permission-denied' && /Unable to resolve/.test(e.message),
    );
  });

  it('people-doc says X but tenant doc disagrees → permission-denied (SoT defense)', async () => {
    peopleDocs['t-attacker'] = { building: 'rooms', room: '15' };
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Uvictim', tenantId: 't-victim' };
    await assert.rejects(
      () => handler(
        {},
        ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' }),
      ),
      (e) => e.code === 'permission-denied' && /Tenant SoT check failed/.test(e.message),
    );
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(
      () => handler({}, { auth: null }),
      (e) => e.code === 'unauthenticated',
    );
  });

  it('includes the tenant\'s trustScore (reputation) in the DSR export — PDPA §30 derived data', async () => {
    tenantDocs['rooms/15'] = { name: 'T15', tenantId: 't-15' };
    trustScoreDocs['t-15'] = { reputation: 72, provisional: false, factors: { tenureScore: 50 } };
    const r = await handler({}, ctx({ room: '15', building: 'rooms', tenantId: 't-15' }));
    assert.deepEqual(r.trustScore, { reputation: 72, provisional: false, factors: { tenureScore: 50 } });
  });

  it('trustScore is null when the tenant has no reputation doc yet', async () => {
    tenantDocs['rooms/15'] = { name: 'T15', tenantId: 't-15' };
    const r = await handler({}, ctx({ room: '15', building: 'rooms', tenantId: 't-15' }));
    assert.equal(r.trustScore, null);
  });

  it('includes the tenant\'s pets + healthLog timeline in the DSR export (#9)', async () => {
    tenantDocs['rooms/15'] = { name: 'T15', tenantId: 't-15' };
    petsDocs['rooms/15'] = [
      { id: 'p1', data: () => ({
        name: 'มะลิ', type: '🐶',
        healthLog: [{ id: 'ph_1', type: 'vet', date: '2026-06-10', title: 'ตรวจสุขภาพประจำปี', weightKg: 5.2 }],
      }) },
    ];
    const r = await handler({}, ctx({ room: '15', building: 'rooms', tenantId: 't-15' }));
    assert.equal(r.pets.length, 1);
    assert.equal(r.pets[0].id, 'p1');
    assert.equal(r.pets[0].name, 'มะลิ');
    assert.equal(r.pets[0].healthLog[0].title, 'ตรวจสุขภาพประจำปี');
    assert.equal(r.pets[0].healthLog[0].weightKg, 5.2);
  });

  it('pets is an empty array when the tenant has none', async () => {
    tenantDocs['rooms/15'] = { name: 'T15', tenantId: 't-15' };
    const r = await handler({}, ctx({ room: '15', building: 'rooms', tenantId: 't-15' }));
    assert.deepEqual(r.pets, []);
  });

  it('export payload sanitises liffIdToken from liffUser', async () => {
    tenantDocs['rooms/15'] = { name: 'T15', tenantId: 't-15' };
    liffUserDocs['U_LINE_ABC'] = {
      role: 'tenant',
      liffIdToken: 'SECRET_TOKEN_DO_NOT_LEAK',
      otherField: 'visible',
    };
    const r = await handler(
      {},
      ctx({ uid: 'line:U_LINE_ABC', room: '15', building: 'rooms', tenantId: 't-15' }),
    );
    assert.equal(r.liffUser.otherField, 'visible');
    assert.equal(r.liffUser.liffIdToken, undefined,
      'liffIdToken must be stripped from the export response');
  });
});
