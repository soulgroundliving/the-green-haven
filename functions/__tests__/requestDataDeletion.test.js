/**
 * Unit tests for requestDataDeletion (PDPA §32 admin-triggered erasure).
 *
 * Run: node --test functions/__tests__/requestDataDeletion.test.js
 *
 * Stub strategy: replace firebase-admin + firebase-functions/v1 at the
 * Module._load layer (same pattern as checklist.test.js). The stub
 * supports the full surface this CF touches: Firestore (multi-collection
 * + recursiveDelete), RTDB (.ref().remove()), Storage (.bucket().getFiles()),
 * Auth admin (setCustomUserClaims, revokeRefreshTokens), buildingRegistry.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ───────────────────────────────────────────────────────────────

let state = {};

function reset(overrides = {}) {
  state = {
    setCustomUserClaimsCalled: false,
    setCustomUserClaimsError: null,
    revokeRefreshTokensCalled: false,
    revokeRefreshTokensError: null,

    firestoreDocs: {},
    firestoreQueries: {},
    firestoreDeletedPaths: [],
    firestoreCreated: {},
    firestoreUpdates: {},
    firestoreAdded: [],
    firestoreRecursiveDeleted: [],

    rtdbRemoved: [],
    rtdbRemoveError: null,

    storageFilesByPrefix: {},
    storageDeleteError: null,
    storageGetFilesError: null,
    storageDeletedFiles: [],

    allBuildings: ['rooms', 'nest'],

    ...overrides,
  };
}

reset();

// ── Module._load stub ────────────────────────────────────────────────────────

const Module = require('module');
const _origLoad = Module._load;

Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-functions/v1') {
    const HttpsError = class extends Error {
      constructor(code, msg, details) {
        super(msg); this.code = code; this.details = details;
      }
    };
    const onCall = (fn) => fn;
    const self = {
      region: () => self,
      runWith: () => self,
      https: { onCall, HttpsError },
      HttpsError,
    };
    return self;
  }

  if (id === 'firebase-admin') {
    const firestoreFn = function () {
      const refForPath = (path) => ({
        path,
        get: async () => {
          const v = state.firestoreDocs[path] || { exists: false };
          return {
            exists: v.exists,
            id: path.split('/').pop(),
            data: () => v.data || {},
          };
        },
        delete: async () => { state.firestoreDeletedPaths.push(path); },
        create: async (data) => {
          if (state.firestoreCreated[path]) {
            const err = new Error('already exists');
            err.code = 6;
            throw err;
          }
          state.firestoreCreated[path] = data;
        },
        update: async (data) => {
          state.firestoreUpdates[path] = { ...(state.firestoreUpdates[path] || {}), ...data };
        },
        collection: (sub) => collectionFor(`${path}/${sub}`),
      });
      const collectionFor = (path) => ({
        doc: (id) => refForPath(`${path}/${id}`),
        where: function (field, op, val) {
          this._wheres = (this._wheres || []).concat([{ field, op, val }]);
          return this;
        },
        orderBy: function () { return this; },
        limit: function () { return this; },
        get: async function () {
          const key = `${path}|` + (this._wheres || []).map(w => `${w.field}${w.op}${w.val}`).join(',');
          const docs = state.firestoreQueries[key] || state.firestoreQueries[path] || [];
          return {
            empty: docs.length === 0,
            size: docs.length,
            docs: docs.map(d => ({
              id: d.id,
              data: () => d.data,
              ref: refForPath(`${path}/${d.id}`),
            })),
          };
        },
        add: async (data) => {
          state.firestoreAdded.push({ collection: path, data });
          return { id: `auto_${state.firestoreAdded.length}` };
        },
      });
      return {
        collection: (name) => collectionFor(name),
        recursiveDelete: async (ref) => { state.firestoreRecursiveDeleted.push(ref.path); },
      };
    };
    firestoreFn.FieldValue = {
      serverTimestamp: () => '__ts__',
      delete: () => '__delete__',
      increment: (n) => ({ __inc: n }),
    };
    firestoreFn.Timestamp = {
      fromMillis: (n) => ({ toMillis: () => n }),
    };

    const authFn = () => ({
      setCustomUserClaims: async (uid, claims) => {
        state.setCustomUserClaimsCalled = { uid, claims };
        if (state.setCustomUserClaimsError) throw state.setCustomUserClaimsError;
      },
      revokeRefreshTokens: async (uid) => {
        state.revokeRefreshTokensCalled = { uid };
        if (state.revokeRefreshTokensError) throw state.revokeRefreshTokensError;
      },
    });

    const databaseFn = () => ({
      ref: (p) => ({
        remove: async () => {
          if (state.rtdbRemoveError) throw state.rtdbRemoveError;
          state.rtdbRemoved.push(p);
        },
      }),
    });

    const storageFn = () => ({
      bucket: () => ({
        getFiles: async ({ prefix }) => {
          if (state.storageGetFilesError) throw state.storageGetFilesError;
          const files = (state.storageFilesByPrefix[prefix] || []).map(f => ({
            name: f.name,
            delete: async () => {
              if (state.storageDeleteError) throw state.storageDeleteError;
              state.storageDeletedFiles.push(f.name);
            },
          }));
          return [files];
        },
      }),
    });

    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
      auth: authFn,
      database: databaseFn,
      storage: storageFn,
    };
  }

  if (id === './buildingRegistry') {
    return {
      getAllBuildings: async () => state.allBuildings,
      getValidBuildings: async () => new Set(state.allBuildings),
    };
  }

  return _origLoad.call(this, id, parent, ...rest);
};

const { _handler: handler, CONFIRMATION_PHRASE } = require('../requestDataDeletion');

// ── Helpers ──────────────────────────────────────────────────────────────────

function adminCtx({ uid = 'admin-uid', email = 'admin@nature-haven.test' } = {}) {
  return { auth: { uid, token: { admin: true, email } } };
}
function tenantCtx({ uid = 'line:U1', tenantId = 'T_X' } = {}) {
  return { auth: { uid, token: { tenantId } } };  // NO admin claim
}
const validInput = {
  targetTenantId: 'T_PLAYER_001',
  targetAuthUid: 'line:U_PLAYER',
  confirmationPhrase: CONFIRMATION_PHRASE,
  reason: 'tenant requested erasure via LINE chat 2026-05-15',
};

// ── Preflight gates ──────────────────────────────────────────────────────────

describe('requestDataDeletion — preflight gates', () => {
  beforeEach(() => reset());

  it('throws unauthenticated when no auth uid', async () => {
    await assert.rejects(
      () => handler(validInput, { auth: null }),
      (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
    );
  });

  it('throws permission-denied when caller is NOT admin (tenant token)', async () => {
    await assert.rejects(
      () => handler(validInput, tenantCtx()),
      (err) => {
        assert.equal(err.code, 'permission-denied');
        assert.match(err.message, /Admin claim required/);
        return true;
      }
    );
  });

  it('throws invalid-argument when targetTenantId missing', async () => {
    await assert.rejects(
      () => handler({ ...validInput, targetTenantId: '' }, adminCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws invalid-argument when targetAuthUid missing', async () => {
    await assert.rejects(
      () => handler({ ...validInput, targetAuthUid: '' }, adminCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws failed-precondition on wrong confirmation phrase', async () => {
    await assert.rejects(
      () => handler({ ...validInput, confirmationPhrase: 'wrong' }, adminCtx()),
      (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
    );
  });

  it('refuses active tenant — admin must transitionToPlayer first', async () => {
    state.firestoreDocs[`tenants/rooms/list/15`] = {
      exists: true,
      data: { tenantId: 'T_ACTIVE', linkedAuthUid: 'line:U_ACTIVE' },
    };
    await assert.rejects(
      () => handler({
        ...validInput,
        targetTenantId: 'T_ACTIVE',
        targetAuthUid: 'line:U_ACTIVE',
        targetRoom: '15',
        targetBuilding: 'rooms',
      }, adminCtx()),
      (err) => {
        assert.equal(err.code, 'failed-precondition');
        assert.match(err.message, /active tenant/);
        return true;
      }
    );
  });

  it('allows when tenants doc exists but tenantId/linkedAuthUid mismatch (already vacated)', async () => {
    state.firestoreDocs[`tenants/rooms/list/15`] = {
      exists: true,
      data: { tenantId: 'someone-else', linkedAuthUid: 'different-uid' },
    };
    const res = await handler({
      ...validInput,
      targetRoom: '15',
      targetBuilding: 'rooms',
    }, adminCtx());
    assert.equal(res.success, true);
  });

  it('throws resource-exhausted when within 7d cooldown', async () => {
    const recent = Date.now() - (60 * 60 * 1000);  // 1h ago
    state.firestoreQueries[`dataDeletionLog|tenantId==T_PLAYER_001`] = [
      { id: 'prev', data: { requestedAt: { toMillis: () => recent } } },
    ];
    await assert.rejects(
      () => handler(validInput, adminCtx()),
      (err) => {
        assert.equal(err.code, 'resource-exhausted');
        assert.ok(err.details?.retryAfter > 0);
        return true;
      }
    );
  });
});

// ── Happy path (admin erasing a player) ──────────────────────────────────────

describe('requestDataDeletion — happy admin path', () => {
  beforeEach(() => reset());

  it('revokes target claims+tokens BEFORE any destructive op', async () => {
    await handler(validInput, adminCtx());
    assert.deepEqual(state.setCustomUserClaimsCalled, {
      uid: 'line:U_PLAYER',
      claims: {},
    });
    assert.equal(state.revokeRefreshTokensCalled.uid, 'line:U_PLAYER');
  });

  it('recursiveDelete called on people/{tenantId}', async () => {
    await handler({ ...validInput, targetTenantId: 'T_RECURSE' }, adminCtx());
    assert.ok(
      state.firestoreRecursiveDeleted.includes('people/T_RECURSE'),
      'should recursiveDelete people/T_RECURSE'
    );
  });

  it('scans tenant archives across ALL buildings', async () => {
    state.allBuildings = ['rooms', 'nest', 'amazon'];
    state.firestoreQueries[`tenants/rooms/archive|tenantId==T_PLAYER_001`] = [
      { id: 'CONTRACT_A', data: { tenantId: 'T_PLAYER_001' } },
    ];
    state.firestoreQueries[`tenants/nest/archive|tenantId==T_PLAYER_001`] = [];
    state.firestoreQueries[`tenants/amazon/archive|tenantId==T_PLAYER_001`] = [
      { id: 'CONTRACT_B', data: { tenantId: 'T_PLAYER_001' } },
    ];
    await handler(validInput, adminCtx());
    assert.ok(state.firestoreRecursiveDeleted.includes('tenants/rooms/archive/CONTRACT_A'));
    assert.ok(state.firestoreRecursiveDeleted.includes('tenants/amazon/archive/CONTRACT_B'));
  });

  it('writes idempotency-fence log with initiatedBy + reason', async () => {
    await handler(validInput, adminCtx({ uid: 'super-admin', email: 'boss@nh.test' }));
    const created = Object.keys(state.firestoreCreated).filter(p =>
      p.startsWith('dataDeletionLog/T_PLAYER_001_'));
    assert.equal(created.length, 1);
    const data = state.firestoreCreated[created[0]];
    assert.equal(data.status, 'in_progress');
    assert.equal(data.tenantId, 'T_PLAYER_001');
    assert.equal(data.initiatedBy, 'super-admin');
    assert.equal(data.initiatedByEmail, 'boss@nh.test');
    assert.match(data.reason, /LINE chat/);
  });

  it('finalizes log with completed status + summary', async () => {
    const res = await handler(validInput, adminCtx());
    const updatePath = Object.keys(state.firestoreUpdates).find(p =>
      p.startsWith('dataDeletionLog/T_PLAYER_001_'));
    assert.ok(updatePath);
    const upd = state.firestoreUpdates[updatePath];
    assert.match(upd.status, /^completed/);
    assert.ok(upd.summary);
    assert.equal(res.success, true);
  });

  it('writes auth_events with admin attribution', async () => {
    await handler(validInput, adminCtx({ uid: 'admin-Z', email: 'z@nh.test' }));
    const authRow = state.firestoreAdded.find(a => a.collection === 'auth_events');
    assert.ok(authRow);
    assert.equal(authRow.data.action, 'pdpa_erasure');
    assert.equal(authRow.data.targetTenantId, 'T_PLAYER_001');
    assert.equal(authRow.data.initiatedBy, 'admin-Z');
    assert.equal(authRow.data.initiatedByEmail, 'z@nh.test');
  });

  it('summary.retained lists bills + leases + BigQuery archives with citations', async () => {
    const res = await handler(validInput, adminCtx());
    assert.match(res.summary.retained.bills, /Revenue Code/);
    assert.match(res.summary.retained.leases, /Civil Code/);
    assert.match(res.summary.retained['BigQuery auth_events archive'], /PDPA/);
  });

  it('cascades booking + KYC storage cleanup', async () => {
    state.firestoreQueries[`bookings|prospectUid==line:U_PLAYER`] = [
      { id: 'BK_1', data: { prospectUid: 'line:U_PLAYER' } },
    ];
    state.storageFilesByPrefix['bookings/BK_1/'] = [
      { name: 'bookings/BK_1/kyc/idCardFront.jpg' },
      { name: 'bookings/BK_1/kyc/idCardBack.jpg' },
    ];
    const res = await handler(validInput, adminCtx());
    assert.equal(res.summary.deleted.bookings, 1);
    assert.equal(state.storageDeletedFiles.length, 2);
  });

  it('cascades pet-social cleanup — petProfiles + petLinks (§7-DD #10)', async () => {
    state.firestoreQueries['petProfiles|ownerTenantId==T_PLAYER_001'] = [
      { id: 'p1', data: { ownerTenantId: 'T_PLAYER_001' } },
      { id: 'p2', data: { ownerTenantId: 'T_PLAYER_001' } },
    ];
    state.firestoreQueries['petLinks|requesterTenantId==T_PLAYER_001'] = [
      { id: 'p1_p9', data: {} },
    ];
    state.firestoreQueries['petLinks|recipientTenantId==T_PLAYER_001'] = [
      { id: 'p2_p7', data: {} },
    ];
    const res = await handler(validInput, adminCtx());
    assert.equal(res.summary.deleted.petProfiles, 2);
    assert.equal(res.summary.deleted.petLinks, 2);
    assert.ok(state.firestoreDeletedPaths.includes('petProfiles/p1'));
    assert.ok(state.firestoreDeletedPaths.includes('petLinks/p1_p9'));
    assert.ok(state.firestoreDeletedPaths.includes('petLinks/p2_p7'));
  });
});

// ── Idempotency ──────────────────────────────────────────────────────────────

describe('requestDataDeletion — idempotency', () => {
  beforeEach(() => reset());

  it('duplicate requestId returns existing summary, does NOT re-run cascade', async () => {
    // Pre-seed: any dataDeletionLog/T_DUP_* doc already exists (create throws)
    state.firestoreCreated = new Proxy({}, {
      has: (t, k) => k.startsWith('dataDeletionLog/T_DUP_'),
      get: (t, k) => state.firestoreDocs[k]?.data,
      set: (t, k, v) => { t[k] = v; return true; },
    });
    state.firestoreDocs = new Proxy({}, {
      get: (t, k) => k.startsWith('dataDeletionLog/T_DUP_')
        ? { exists: true, data: { summary: { deleted: { consents: 99 } } } }
        : t[k],
    });

    const res = await handler({ ...validInput, targetTenantId: 'T_DUP' }, adminCtx());
    assert.equal(res.success, false);
    assert.equal(res.idempotent, true);
    assert.equal(res.summary.deleted.consents, 99);
    // Cascade should NOT have run
    assert.equal(state.setCustomUserClaimsCalled, false);
  });
});

// ── Best-effort failure handling ─────────────────────────────────────────────

describe('requestDataDeletion — best-effort failures', () => {
  beforeEach(() => reset());

  it('storage prefix delete fails — cascade still completes', async () => {
    state.storageDeleteError = new Error('storage failure');
    state.firestoreQueries[`checklistInstances|building==rooms,roomId==15`] = [
      { id: 'INST_1', data: { building: 'rooms', roomId: '15' } },
    ];
    state.storageFilesByPrefix['checklists/rooms/15/INST_1/'] = [{ name: 'a.jpg' }];

    const res = await handler({
      ...validInput,
      targetRoom: '15',
      targetBuilding: 'rooms',
    }, adminCtx());
    assert.equal(res.success, true);
    assert.match(res.status, /^completed/);
    assert.ok(res.summary.storageErrors >= 1);
  });

  it('revokeRefreshTokens fails — cascade still proceeds, success returned', async () => {
    state.revokeRefreshTokensError = new Error('admin SDK transient');
    const res = await handler(validInput, adminCtx());
    assert.equal(res.success, true);
    assert.ok(res.summary.errors.find(e => e.step === 'revokeRefreshTokens'));
  });

  it('catastrophic: setCustomUserClaims fails — CF aborts and log marked failed', async () => {
    state.setCustomUserClaimsError = new Error('auth service down');
    await assert.rejects(
      () => handler({ ...validInput, targetTenantId: 'T_CAT' }, adminCtx()),
      (err) => { assert.equal(err.code, 'internal'); return true; }
    );
    const updatePath = Object.keys(state.firestoreUpdates).find(p =>
      p.startsWith('dataDeletionLog/T_CAT_'));
    assert.ok(updatePath);
    assert.equal(state.firestoreUpdates[updatePath].status, 'failed');
  });
});
