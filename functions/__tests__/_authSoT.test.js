/**
 * Unit tests for _authSoT — shared SoT crosscheck helpers.
 * Covers the 5 auth paths (admin / manager / claim / tenantId-sot / uid-sot)
 * + resolveTenantClaims (claim → people-doc → none).
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { assertTenantAccess, resolveTenantClaims } = require('../_authSoT');

class HttpsError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}

let tenantDocs;   // keyed by `${building}/${roomId}`
let peopleDocs;   // keyed by tenantId
let leaseDocs;    // keyed by `${building}/${leaseId}` — Path 1c lookups
let tenantReadThrows;
let peopleReadThrows;
let leaseReadThrows;

function resetStubs() {
  tenantDocs = {};
  peopleDocs = {};
  leaseDocs = {};
  tenantReadThrows = null;
  peopleReadThrows = null;
  leaseReadThrows = null;
}
resetStubs();

const firestoreStub = {
  collection(name) {
    if (name === 'tenants') {
      return {
        doc: (building) => ({
          collection: (sub) => {
            if (sub !== 'list') throw new Error('unexpected subcollection: ' + sub);
            return {
              doc: (roomId) => ({
                get: async () => {
                  if (tenantReadThrows) throw tenantReadThrows;
                  const key = `${building}/${roomId}`;
                  return {
                    exists: key in tenantDocs,
                    data: () => tenantDocs[key],
                  };
                },
              }),
            };
          },
        }),
      };
    }
    if (name === 'leases') {
      return {
        doc: (building) => ({
          collection: (sub) => {
            if (sub !== 'list') throw new Error('unexpected subcollection: ' + sub);
            return {
              doc: (leaseId) => ({
                get: async () => {
                  if (leaseReadThrows) throw leaseReadThrows;
                  const key = `${building}/${leaseId}`;
                  return {
                    exists: key in leaseDocs,
                    data: () => leaseDocs[key],
                  };
                },
              }),
            };
          },
        }),
      };
    }
    if (name === 'people') {
      return {
        doc: (tenantId) => ({
          get: async () => {
            if (peopleReadThrows) throw peopleReadThrows;
            return {
              exists: tenantId in peopleDocs,
              data: () => peopleDocs[tenantId],
            };
          },
        }),
      };
    }
    throw new Error('unexpected collection: ' + name);
  },
};

function ctx({ uid = 'line:Ucaller', admin = false, room = '', building = '', tenantId = '', managedBuildings = null } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  if (managedBuildings) token.managedBuildings = managedBuildings;
  return { auth: { uid, token } };
}

describe('assertTenantAccess', () => {
  beforeEach(resetStubs);

  it('Path 0 admin → ok with viaPath=admin, no Firestore read', async () => {
    const r = await assertTenantAccess({
      building: 'rooms', roomId: '15',
      context: ctx({ admin: true }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.viaPath, 'admin');
    assert.equal(r.tenantData, null);
  });

  it('Path 0b managedBuildings → ok with viaPath=manager', async () => {
    const r = await assertTenantAccess({
      building: 'rooms', roomId: '15',
      context: ctx({ uid: 'line:Umgr', managedBuildings: ['rooms', 'nest'] }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.viaPath, 'manager');
  });

  it('Path 0b managedBuildings for OTHER building → falls through to claim/SoT', async () => {
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        context: ctx({ uid: 'line:Umgr', managedBuildings: ['nest'] }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'permission-denied',
    );
  });

  it('Path 1 claim match → ok with viaPath=claim, no Firestore read', async () => {
    const r = await assertTenantAccess({
      building: 'rooms', roomId: '15',
      context: ctx({ room: '15', building: 'rooms' }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.viaPath, 'claim');
    assert.equal(r.tenantData, null);
  });

  it('Path 2a uid-sot match → ok, returns tenantData', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Utenant', tenantId: 't-15' };
    const r = await assertTenantAccess({
      building: 'rooms', roomId: '15',
      context: ctx({ uid: 'line:Utenant' /* no room/building claims */ }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.viaPath, 'uid-sot');
    assert.deepEqual(r.tenantData, { linkedAuthUid: 'line:Utenant', tenantId: 't-15' });
  });

  it('Path 1b tenantId-sot match → ok', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:UoldUid', tenantId: 't-15' };
    const r = await assertTenantAccess({
      building: 'rooms', roomId: '15',
      context: ctx({ uid: 'anon-rotated', tenantId: 't-15' }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.viaPath, 'tenantId-sot');
  });

  // ─── Path 1c: lease-doc-sot ─────────────────────────────────────────────
  // Closes transferTenant Storage-path-frozen bug. After variation-mode move
  // rooms/15 → nest/N101: tenants/rooms/list/15 is cleared (Paths 1b/2a fail
  // there), but the lease doc moved to leases/nest/list/{leaseId} with the
  // same tenantId. Caller (getLeaseDocUrl) passes leaseId from the frozen
  // path; we find the lease at its new home and accept on tenantId match.

  it('Path 1c lease-doc-sot — lease moved to OTHER building, tenantId match → ok', async () => {
    // tenants/rooms/list/15 cleared (post-transfer state)
    tenantDocs['rooms/15'] = { linkedAuthUid: '', tenantId: '' };
    // lease moved to leases/nest/list/CONTRACT_42
    leaseDocs['nest/CONTRACT_42'] = { tenantId: 't-15', building: 'nest', roomId: 'N101' };
    const r = await assertTenantAccess({
      building: 'rooms', roomId: '15',
      leaseId: 'CONTRACT_42', leaseBuildings: ['rooms', 'nest'],
      context: ctx({ uid: 'line:Utenant15', tenantId: 't-15' }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.viaPath, 'lease-doc-sot');
    assert.equal(r.leaseData.tenantId, 't-15');
    assert.equal(r.leaseData.building, 'nest');
  });

  it('Path 1c — lease still at original building (no transfer) → also works', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: '', tenantId: '' }; // hypothetical cleared
    leaseDocs['rooms/CONTRACT_42'] = { tenantId: 't-15', building: 'rooms', roomId: '15' };
    const r = await assertTenantAccess({
      building: 'rooms', roomId: '15',
      leaseId: 'CONTRACT_42', leaseBuildings: ['rooms', 'nest'],
      context: ctx({ uid: 'line:Utenant15', tenantId: 't-15' }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.viaPath, 'lease-doc-sot');
  });

  it('Path 1c — leaseId provided but no lease exists anywhere → falls through to throw', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: '', tenantId: '' };
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        leaseId: 'CONTRACT_NOTFOUND', leaseBuildings: ['rooms', 'nest'],
        context: ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'permission-denied',
    );
  });

  it('Path 1c — lease found but tenantId mismatch → falls through to throw', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: '', tenantId: '' };
    leaseDocs['nest/CONTRACT_42'] = { tenantId: 't-OTHER', building: 'nest', roomId: 'N101' };
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        leaseId: 'CONTRACT_42', leaseBuildings: ['rooms', 'nest'],
        context: ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'permission-denied',
    );
  });

  it('Path 1c — no leaseId → skipped entirely (back-compat)', async () => {
    // Pre-patch CFs that don't pass leaseId still get the original 5-path behaviour
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Ureal', tenantId: 't-real' };
    leaseDocs['nest/CONTRACT_42'] = { tenantId: 't-attacker', building: 'nest' };
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        // no leaseId / leaseBuildings — old call shape
        context: ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'permission-denied',
    );
  });

  it('Path 1c — leaseId but empty leaseBuildings → skipped (caller config error, fail closed)', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: '', tenantId: '' };
    leaseDocs['nest/CONTRACT_42'] = { tenantId: 't-15' };
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        leaseId: 'CONTRACT_42', leaseBuildings: [],
        context: ctx({ uid: 'line:Utenant15', tenantId: 't-15' }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'permission-denied',
    );
  });

  it('Path 1c — lease read throws → swallowed, continues iteration, falls through if no match', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: '', tenantId: '' };
    leaseReadThrows = new Error('Firestore unavailable');
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        leaseId: 'CONTRACT_42', leaseBuildings: ['rooms', 'nest'],
        context: ctx({ uid: 'line:Utenant15', tenantId: 't-15' }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'permission-denied',
    );
  });

  it('Path 1c — no tokTenantId → skipped (can\'t verify ownership without claim)', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: '', tenantId: '' };
    leaseDocs['nest/CONTRACT_42'] = { tenantId: 't-15' };
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        leaseId: 'CONTRACT_42', leaseBuildings: ['rooms', 'nest'],
        // no tenantId claim on caller — Path 1c gate requires it
        context: ctx({ uid: 'line:Utenant15' }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'permission-denied',
    );
  });

  it('no match → permission-denied with diagnostic shape', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Ureal', tenantId: 't-real' };
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        context: ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) =>
        e.code === 'permission-denied' &&
        /Tenant SoT check failed/.test(e.message) &&
        /linkedAuthUid=line:/.test(e.message) &&
        /caller.uid=line:/.test(e.message) &&
        /tokTenantId=present/.test(e.message),
    );
  });

  it('tenant doc missing → permission-denied with relink hint', async () => {
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        context: ctx({ uid: 'line:Utenant' }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'permission-denied' && /relink request/.test(e.message),
    );
  });

  it('tenant doc read throws → permission-denied (no leak)', async () => {
    tenantReadThrows = new Error('Firestore unavailable');
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        context: ctx({ uid: 'line:Utenant' }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'permission-denied' && /tenant doc lookup failed/.test(e.message),
    );
  });

  it('unauthenticated → throws unauthenticated', async () => {
    await assert.rejects(
      () => assertTenantAccess({
        building: 'rooms', roomId: '15',
        context: { auth: null },
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'unauthenticated',
    );
  });

  it('missing building or roomId → invalid-argument', async () => {
    await assert.rejects(
      () => assertTenantAccess({
        building: '', roomId: '15',
        context: ctx({ admin: true }),
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'invalid-argument',
    );
  });

  it('uid-sot beats stale room claim — caller has wrong room claim AND linkedAuthUid match', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Utenant15', tenantId: 't-15' };
    const r = await assertTenantAccess({
      building: 'rooms', roomId: '15',
      context: ctx({ uid: 'line:Utenant15', room: '14', building: 'rooms' /* stale */ }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.viaPath, 'uid-sot');
  });
});

describe('resolveTenantClaims', () => {
  beforeEach(resetStubs);

  it('claim path: room + building present → resolvedVia=claim', async () => {
    const r = await resolveTenantClaims({
      context: ctx({ room: '15', building: 'rooms' }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.resolvedVia, 'claim');
    assert.equal(r.building, 'rooms');
    assert.equal(r.roomId, '15');
  });

  it('people-doc path: canonical currentBuilding/currentRoom (real shape — #2 regression)', async () => {
    // Real people docs store currentBuilding/currentRoom (transferTenant writer),
    // NOT a bare building/room. Pre-#2 this returned 'none' → §7-Z fallback dead.
    peopleDocs['t-15'] = { currentBuilding: 'rooms', currentRoom: '15', name: 'Tenant 15' };
    const r = await resolveTenantClaims({
      context: ctx({ uid: 'line:U15', tenantId: 't-15' }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.resolvedVia, 'people-doc');
    assert.equal(r.building, 'rooms');
    assert.equal(r.roomId, '15');
  });

  it('people-doc path: activeBuilding/activeRoom fallback', async () => {
    peopleDocs['t-15'] = { activeBuilding: 'nest', activeRoom: 'N101' };
    const r = await resolveTenantClaims({
      context: ctx({ uid: 'line:U', tenantId: 't-15' }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.resolvedVia, 'people-doc');
    assert.equal(r.building, 'nest');
    assert.equal(r.roomId, 'N101');
  });

  it('people-doc path: legacy bare building/roomId still accepted (back-compat)', async () => {
    peopleDocs['t-15'] = { building: 'nest', roomId: 'N101' };
    const r = await resolveTenantClaims({
      context: ctx({ uid: 'line:U', tenantId: 't-15' }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.resolvedVia, 'people-doc');
    assert.equal(r.building, 'nest');
    assert.equal(r.roomId, 'N101');
  });

  it('none path: no claims and no people doc', async () => {
    const r = await resolveTenantClaims({
      context: ctx({ uid: 'line:U' }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.resolvedVia, 'none');
    assert.equal(r.building, '');
    assert.equal(r.roomId, '');
  });

  it('people-doc throws → falls through to none (no leak)', async () => {
    peopleReadThrows = new Error('boom');
    const r = await resolveTenantClaims({
      context: ctx({ uid: 'line:U', tenantId: 't-15' }),
      firestore: firestoreStub, HttpsError,
    });
    assert.equal(r.resolvedVia, 'none');
  });

  it('unauthenticated → throws', async () => {
    await assert.rejects(
      () => resolveTenantClaims({
        context: { auth: null },
        firestore: firestoreStub, HttpsError,
      }),
      (e) => e.code === 'unauthenticated',
    );
  });
});
