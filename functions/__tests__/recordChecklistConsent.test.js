/**
 * Unit tests for recordChecklistConsent — auth gate via _authSoT helper
 * (6-path model: admin / manager / claim / tenantId-sot / uid-sot) +
 * resolveTenantClaims fallback for §7-Z claim-strip recovery.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tenantDocs;
let peopleDocs;
let consentWrites;   // captured payload to consents collection
let consentWriteErr;

function resetStubs() {
  tenantDocs = {};
  peopleDocs = {};
  consentWrites = [];
  consentWriteErr = null;
}
resetStubs();

const SERVER_TS_SENTINEL = '__SERVER_TS__';

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
                }),
              }),
            }),
          };
        }
        if (name === 'people') {
          return {
            doc: (tenantId) => ({
              get: async () => ({
                exists: tenantId in peopleDocs,
                data: () => peopleDocs[tenantId],
              }),
            }),
          };
        }
        if (name === 'consents') {
          return {
            doc: (id) => ({
              set: async (payload, opts) => {
                if (consentWriteErr) throw consentWriteErr;
                consentWrites.push({ id, payload, opts });
              },
            }),
          };
        }
        throw new Error('unexpected collection: ' + name);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS_SENTINEL };
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

const { recordChecklistConsent: handler } = require('../recordChecklistConsent');

function ctx({ uid = 'line:U1', admin = false, room = '', building = '', tenantId = '', managedBuildings = null } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  if (managedBuildings) token.managedBuildings = managedBuildings;
  return { auth: { uid, token } };
}

describe('recordChecklistConsent', () => {
  beforeEach(resetStubs);

  it('Path 1 claim match → records consent', async () => {
    const r = await handler({ purpose: 'checklist_v1' }, ctx({ room: '15', building: 'rooms', tenantId: 't-15' }));
    assert.equal(r.recorded, true);
    assert.equal(consentWrites.length, 1);
    assert.equal(consentWrites[0].id, 't-15_checklist_v1');
    assert.equal(consentWrites[0].payload.room, '15');
    assert.equal(consentWrites[0].payload.building, 'rooms');
    assert.equal(consentWrites[0].payload.purpose, 'checklist_v1');
  });

  it('Path 2a uid-sot: claims stripped but linkedAuthUid matches → resolves via people doc + SoT', async () => {
    peopleDocs['t-15'] = { building: 'rooms', room: '15' };
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Utenant15', tenantId: 't-15' };
    const r = await handler(
      { purpose: 'checklist_v1' },
      ctx({ uid: 'line:Utenant15', tenantId: 't-15' /* no room/building claims */ }),
    );
    assert.equal(r.recorded, true);
    assert.equal(consentWrites[0].payload.room, '15');
  });

  it('no claims + no people doc → permission-denied (can\'t resolve)', async () => {
    await assert.rejects(
      () => handler({ purpose: 'checklist_v1' }, ctx({ uid: 'line:U' })),
      (e) => e.code === 'permission-denied' && /Unable to resolve/.test(e.message),
    );
  });

  it('people-doc fallback but tenant doc disagrees → permission-denied (SoT defense-in-depth)', async () => {
    // people doc says t-attacker lives in rooms/15, but tenant doc for rooms/15
    // has a different linkedAuthUid + tenantId — assertTenantAccess denies.
    peopleDocs['t-attacker'] = { building: 'rooms', room: '15' };
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Uvictim', tenantId: 't-victim' };
    await assert.rejects(
      () => handler(
        { purpose: 'checklist_v1' },
        ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' /* no room/building claims */ }),
      ),
      (e) => e.code === 'permission-denied' && /Tenant SoT check failed/.test(e.message),
    );
  });

  it('admin bypass → records using room/building from claims', async () => {
    // Admins can record consent for any room if they pass room/building in claims
    // (rare but supported via tok.room/building if admin has them; otherwise resolveTenantClaims
    //  returns empty + people-doc lookup fails, which is fine — admin would generally not
    //  call this CF themselves)
    const r = await handler(
      { purpose: 'checklist_v1' },
      ctx({ admin: true, room: '15', building: 'rooms', tenantId: 't-admin' }),
    );
    assert.equal(r.recorded, true);
  });

  it('unauthenticated → unauthenticated error', async () => {
    await assert.rejects(
      () => handler({ purpose: 'checklist_v1' }, { auth: null }),
      (e) => e.code === 'unauthenticated',
    );
  });

  it('invalid purpose → invalid-argument', async () => {
    await assert.rejects(
      () => handler(
        { purpose: 'unknown_purpose' },
        ctx({ room: '15', building: 'rooms', tenantId: 't-15' }),
      ),
      (e) => e.code === 'invalid-argument',
    );
  });
});
