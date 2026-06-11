/**
 * Unit tests for upsertPetProfile — opt a pet into/out of the building directory
 * (Meaning Layer #10). Covers: publish copies ONLY safe fields, consent gate,
 * approval gate, opt-out deletes + unfriends, and guards. assertTenantAccess
 * passes via the claim fast-path (ctx token.room/building match the args).
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let store;
function reset() { store = {}; }
reset();

// Path-based in-memory Firestore: keys are 'col/doc/col/doc' paths.
function docRef(path) {
  return {
    _path: path,
    async get() { return { exists: path in store, data: () => store[path], ref: docRef(path) }; },
    async set(data, options) { store[path] = { ...((options && options.merge && store[path]) || {}), ...data }; },
    async delete() { delete store[path]; },
    collection(sub) { return collRef(path + '/' + sub); },
  };
}
function collRef(prefix) {
  const filters = [];
  const c = {
    doc(id) { return docRef(prefix + '/' + id); },
    where(f, _op, v) { filters.push([f, String(v)]); return c; },
    limit() { return c; },
    async get() {
      const docs = Object.entries(store)
        .filter(([p]) => p.startsWith(prefix + '/') && p.slice(prefix.length + 1).indexOf('/') === -1)
        .filter(([, d]) => filters.every(([f, v]) => String(d[f]) === v))
        .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d, ref: docRef(p) }));
      return { empty: docs.length === 0, docs };
    },
  };
  return c;
}

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({ collection: (n) => collRef(n) });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    const chain = { runWith: () => chain, https: { onCall: (h) => h } };
    return { region: () => chain, https: { HttpsError } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { upsertPetProfile: handler } = require('../upsertPetProfile');
after(() => { Module._load = _origLoad; });

function ctx(room = 'N101', building = 'nest', uid = 'line:Uowner') {
  return { auth: { uid, token: { room, building, tenantId: 'TENANT_A' } } };
}
function seedTenant() { store['tenants/nest/list/N101'] = { tenantId: 'TENANT_A', name: 'สมชาย' }; }
function seedPet(extra = {}) {
  store['tenants/nest/list/N101/pets/p1'] = {
    name: 'โกโก้', typeEmoji: '🐶', breed: 'ชิวาวา', gender: 'male', age: '2 ปี',
    photoURL: 'https://x/p.png', status: 'approved',
    // private fields that must NOT be published:
    healthLog: [{ type: 'vet' }], isVaccinated: true, vaccineBookPath: 'pets/nest/N101/p1/v.png',
    ...extra,
  };
}
function seedConsent() { store['consents/TENANT_A_pet_profile_v1'] = { purpose: 'pet_profile_v1' }; }

describe('upsertPetProfile — publish', () => {
  beforeEach(reset);

  it('publishes ONLY safe fields with owner identity; no health/vaccine leak', async () => {
    seedTenant(); seedPet(); seedConsent();
    const r = await handler({ building: 'nest', roomId: 'N101', petId: 'p1', bio: '  ขี้เล่น  ', isPublic: true }, ctx());
    assert.equal(r.success, true);
    assert.equal(r.isPublic, true);
    const prof = store['petProfiles/p1'];
    assert.ok(prof, 'profile written');
    assert.equal(prof.name, 'โกโก้');
    assert.equal(prof.typeEmoji, '🐶');
    assert.equal(prof.bio, 'ขี้เล่น');
    assert.equal(prof.ownerTenantId, 'TENANT_A');
    assert.equal(prof.ownerRoom, 'N101');
    assert.equal(prof.building, 'nest');
    assert.equal(prof.createdAt, SERVER_TS);
    for (const k of ['healthLog', 'isVaccinated', 'vaccineBookPath', 'status', 'photoPath']) {
      assert.ok(!(k in prof), `${k} must not be published`);
    }
  });

  it('blocks publish without consent → failed-precondition', async () => {
    seedTenant(); seedPet(); /* no consent */
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', petId: 'p1', isPublic: true }, ctx()),
      (e) => e.code === 'failed-precondition' && /ยินยอม/.test(e.message),
    );
    assert.ok(!store['petProfiles/p1'], 'nothing written');
  });

  it('blocks publish of an unapproved pet → failed-precondition', async () => {
    seedTenant(); seedPet({ status: 'pending' }); seedConsent();
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', petId: 'p1', isPublic: true }, ctx()),
      (e) => e.code === 'failed-precondition' && /อนุมัติ/.test(e.message),
    );
  });

  it('pet not found → not-found', async () => {
    seedTenant(); seedConsent();
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', petId: 'ghost', isPublic: true }, ctx()),
      (e) => e.code === 'not-found',
    );
  });

  it('re-publish preserves the original createdAt (not reset)', async () => {
    seedTenant(); seedPet(); seedConsent();
    await handler({ building: 'nest', roomId: 'N101', petId: 'p1', bio: 'แรก', isPublic: true }, ctx());
    store['petProfiles/p1'].createdAt = 'ORIGINAL_TS';   // simulate the first-publish stamp
    await handler({ building: 'nest', roomId: 'N101', petId: 'p1', bio: 'ใหม่', isPublic: true }, ctx());
    assert.equal(store['petProfiles/p1'].createdAt, 'ORIGINAL_TS', 'createdAt preserved');
    assert.equal(store['petProfiles/p1'].bio, 'ใหม่', 'bio updated');
  });
});

describe('upsertPetProfile — opt-out + guards', () => {
  beforeEach(reset);

  it('opt-out deletes the profile and unfriends everywhere', async () => {
    store['petProfiles/p1'] = { petId: 'p1', building: 'nest', ownerRoom: 'N101' };
    store['petLinks/p1_p2'] = { petA: 'p1', petB: 'p2' };
    store['petLinks/p0_p1'] = { petA: 'p0', petB: 'p1' };
    const r = await handler({ building: 'nest', roomId: 'N101', petId: 'p1', isPublic: false }, ctx());
    assert.equal(r.success, true);
    assert.equal(r.isPublic, false);
    assert.equal(r.removedLinks, 2);
    assert.ok(!store['petProfiles/p1']);
    assert.ok(!store['petLinks/p1_p2'] && !store['petLinks/p0_p1']);
  });

  it('opt-out of a pet in ANOTHER room → permission-denied; nothing wiped (auth-bypass guard)', async () => {
    store['petProfiles/p1'] = { petId: 'p1', building: 'nest', ownerRoom: 'N999' };  // NOT the caller's room
    store['petLinks/p1_p2'] = { petA: 'p1', petB: 'p2' };
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', petId: 'p1', isPublic: false }, ctx()),
      (e) => e.code === 'permission-denied',
    );
    assert.ok(store['petProfiles/p1'], 'profile NOT deleted');
    assert.ok(store['petLinks/p1_p2'], 'links NOT wiped');
  });

  it('opt-out is an idempotent no-op when the profile does not exist', async () => {
    const r = await handler({ building: 'nest', roomId: 'N101', petId: 'ghost', isPublic: false }, ctx());
    assert.equal(r.success, true);
    assert.equal(r.removedLinks, 0);
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ building: 'nest', roomId: 'N101', petId: 'p1', isPublic: true }, { auth: null }),
      (e) => e.code === 'unauthenticated');
  });

  it('missing petId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'nest', roomId: 'N101', isPublic: true }, ctx()),
      (e) => e.code === 'invalid-argument');
  });

  it('unknown building → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'amazon', roomId: 'N101', petId: 'p1', isPublic: true }, ctx('N101', 'amazon')),
      (e) => e.code === 'invalid-argument');
  });
});
