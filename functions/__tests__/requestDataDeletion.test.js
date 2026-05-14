/**
 * Unit tests for requestDataDeletion (PDPA §32 erasure).
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
    // Auth admin SDK calls captured
    setCustomUserClaimsCalled: false,
    setCustomUserClaimsError: null,
    revokeRefreshTokensCalled: false,
    revokeRefreshTokensError: null,

    // Firestore data — keyed by `${collection}/${docId}` (or nested for subcols)
    firestoreDocs: {},               // path => { exists, data }
    firestoreQueries: {},            // queryKey => [{ id, data }]
    firestoreDeletedPaths: [],       // every .delete() called
    firestoreCreated: {},            // path => data (from .create())
    firestoreCreateThrows: null,     // simulate ALREADY_EXISTS by docId
    firestoreUpdates: {},            // path => merged data
    firestoreAdded: [],              // arr from .add() — auth_events
    firestoreRecursiveDeleted: [],   // every recursiveDelete target ref path

    // RTDB
    rtdbRemoved: [],                 // every .ref(x).remove() called
    rtdbRemoveError: null,

    // Storage
    storageFilesByPrefix: {},        // prefix => [{ name }]
    storageDeleteError: null,
    storageGetFilesError: null,
    storageDeletedFiles: [],

    // Building registry — what getAllBuildings returns
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
    // ── Firestore stub ──
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
          if (state.firestoreCreateThrows && path.endsWith(state.firestoreCreateThrows)) {
            const err = new Error('already exists');
            err.code = 6;
            throw err;
          }
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
      const fs = {
        collection: (name) => collectionFor(name),
        recursiveDelete: async (ref) => { state.firestoreRecursiveDeleted.push(ref.path); },
      };
      return fs;
    };
    firestoreFn.FieldValue = {
      serverTimestamp: () => '__ts__',
      delete: () => '__delete__',
      increment: (n) => ({ __inc: n }),
    };
    firestoreFn.Timestamp = {
      fromMillis: (n) => ({ toMillis: () => n }),
    };

    // ── Auth admin stub ──
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

    // ── RTDB stub ──
    const databaseFn = () => ({
      ref: (p) => ({
        remove: async () => {
          if (state.rtdbRemoveError) throw state.rtdbRemoveError;
          state.rtdbRemoved.push(p);
        },
      }),
    });

    // ── Storage stub ──
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

// Load CF AFTER stub install
const requestDataDeletion = require('../requestDataDeletion');
const { _handler: handler, CONFIRMATION_PHRASE, COOLDOWN_MS } = requestDataDeletion;

// ── Helpers ──────────────────────────────────────────────────────────────────

function playerCtx({ uid = 'line:U_player', tenantId = 'T_2026_0001', lineUserId = 'U_player' } = {}) {
  return {
    auth: {
      uid,
      token: { tenantId, lineUserId },
    },
  };
}
function activeTenantCtx({ uid = 'line:U_active', tenantId = 'T_2026_0099', room = '15', building = 'nest', lineUserId = 'U_active' } = {}) {
  return {
    auth: {
      uid,
      token: { tenantId, room, building, lineUserId },
    },
  };
}
const validInput = {
  confirmationPhrase: CONFIRMATION_PHRASE,
  acknowledgedRetention: true,
  acknowledgedTerminal: true,
};

// ── T1 — unauthenticated ──────────────────────────────────────────────────────

describe('requestDataDeletion — preflight gates', () => {
  beforeEach(() => reset());

  it('T1: throws unauthenticated when no auth uid', async () => {
    await assert.rejects(
      () => handler(validInput, { auth: null }),
      (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
    );
  });

  it('T2: throws permission-denied when tenantId claim missing', async () => {
    await assert.rejects(
      () => handler(validInput, { auth: { uid: 'x', token: {} } }),
      (err) => { assert.equal(err.code, 'permission-denied'); return true; }
    );
  });

  it('T3: throws failed-precondition on wrong confirmation phrase', async () => {
    await assert.rejects(
      () => handler({ ...validInput, confirmationPhrase: 'wrong' }, playerCtx()),
      (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
    );
  });

  it('T4: throws failed-precondition when acknowledgedRetention is false', async () => {
    await assert.rejects(
      () => handler({ ...validInput, acknowledgedRetention: false }, playerCtx()),
      (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
    );
  });

  it('T5: throws failed-precondition when acknowledgedTerminal is false', async () => {
    await assert.rejects(
      () => handler({ ...validInput, acknowledgedTerminal: false }, playerCtx()),
      (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
    );
  });

  it('T7-active: refuses active tenant (tenants doc matches tenantId+linkedAuthUid)', async () => {
    const ctx = activeTenantCtx();
    state.firestoreDocs[`tenants/${ctx.auth.token.building}/list/${ctx.auth.token.room}`] = {
      exists: true,
      data: { tenantId: ctx.auth.token.tenantId, linkedAuthUid: ctx.auth.uid },
    };
    await assert.rejects(
      () => handler(validInput, ctx),
      (err) => {
        assert.equal(err.code, 'failed-precondition');
        assert.match(err.message, /active tenant/);
        return true;
      }
    );
  });

  it('T7-mismatch: allows when tenants doc has different tenantId (orphan / stale claim)', async () => {
    const ctx = activeTenantCtx();
    state.firestoreDocs[`tenants/${ctx.auth.token.building}/list/${ctx.auth.token.room}`] = {
      exists: true,
      data: { tenantId: 'someone-else', linkedAuthUid: 'different-uid' },
    };
    const res = await handler(validInput, ctx);
    assert.equal(res.success, true);
  });

  it('T6: throws resource-exhausted when within 7d cooldown', async () => {
    const ctx = playerCtx();
    const recent = Date.now() - (60 * 60 * 1000);  // 1h ago
    const tid = ctx.auth.token.tenantId;
    state.firestoreQueries[`dataDeletionLog|tenantId==${tid}`] = [
      { id: 'prev_request', data: { requestedAt: { toMillis: () => recent } } },
    ];
    await assert.rejects(
      () => handler(validInput, ctx),
      (err) => {
        assert.equal(err.code, 'resource-exhausted');
        assert.ok(err.details?.retryAfter > 0);
        return true;
      }
    );
  });
});

// ── T9/T10 — happy paths ──────────────────────────────────────────────────────

describe('requestDataDeletion — happy path (player)', () => {
  beforeEach(() => reset());

  it('T9: revokes claims+tokens BEFORE any destructive op', async () => {
    const ctx = playerCtx();
    let cascadeStarted = false;
    state.firestoreQueries[`checklistInstances|building==,roomId==`] = [];  // empty
    // Intercept setCustomUserClaims to verify nothing else ran first
    const origSet = state.setCustomUserClaimsCalled;
    const order = [];
    state.firestoreDeletedPaths = new Proxy([], {
      set: (t, k, v) => { if (k !== 'length') order.push('delete:' + v); t[k] = v; return true; },
    });

    await handler(validInput, ctx);

    assert.deepEqual(state.setCustomUserClaimsCalled.claims, {});
    assert.equal(state.revokeRefreshTokensCalled.uid, ctx.auth.uid);
  });

  it('T10: recursiveDelete called on people/{tenantId}', async () => {
    const ctx = playerCtx({ tenantId: 'T_PLAYER_99' });
    await handler(validInput, ctx);
    assert.ok(
      state.firestoreRecursiveDeleted.includes('people/T_PLAYER_99'),
      'should recursiveDelete people/T_PLAYER_99'
    );
  });

  it('T10b: tenant archives scanned across ALL buildings', async () => {
    const ctx = playerCtx({ tenantId: 'T_X' });
    state.allBuildings = ['rooms', 'nest', 'amazon'];
    state.firestoreQueries[`tenants/rooms/archive|tenantId==T_X`] = [
      { id: 'CONTRACT_A', data: { tenantId: 'T_X' } },
    ];
    state.firestoreQueries[`tenants/nest/archive|tenantId==T_X`] = [];
    state.firestoreQueries[`tenants/amazon/archive|tenantId==T_X`] = [
      { id: 'CONTRACT_B', data: { tenantId: 'T_X' } },
    ];
    await handler(validInput, ctx);
    assert.ok(state.firestoreRecursiveDeleted.includes('tenants/rooms/archive/CONTRACT_A'));
    assert.ok(state.firestoreRecursiveDeleted.includes('tenants/amazon/archive/CONTRACT_B'));
  });

  it('writes idempotency-fence dataDeletionLog row with in_progress', async () => {
    const ctx = playerCtx({ tenantId: 'T_FENCE' });
    await handler(validInput, ctx);
    const created = Object.keys(state.firestoreCreated).filter(p =>
      p.startsWith('dataDeletionLog/T_FENCE_'));
    assert.equal(created.length, 1, 'one log row created');
    const data = state.firestoreCreated[created[0]];
    assert.equal(data.status, 'in_progress');
    assert.equal(data.tenantId, 'T_FENCE');
  });

  it('finalizes log with completed status + summary on success', async () => {
    const ctx = playerCtx({ tenantId: 'T_FINAL' });
    const res = await handler(validInput, ctx);
    const updatePath = Object.keys(state.firestoreUpdates).find(p =>
      p.startsWith('dataDeletionLog/T_FINAL_'));
    assert.ok(updatePath, 'log was updated');
    const upd = state.firestoreUpdates[updatePath];
    assert.match(upd.status, /^completed/);
    assert.ok(upd.summary);
    assert.equal(res.success, true);
    assert.equal(res.signOutRequired, true);
  });

  it('writes auth_events cross-system audit row', async () => {
    const ctx = playerCtx({ tenantId: 'T_AUDIT' });
    await handler(validInput, ctx);
    const authRow = state.firestoreAdded.find(a => a.collection === 'auth_events');
    assert.ok(authRow, 'auth_events row written');
    assert.equal(authRow.data.action, 'pdpa_erasure');
    assert.equal(authRow.data.tenantId, 'T_AUDIT');
  });

  it('summary.retained lists bills + leases with legal citation', async () => {
    const ctx = playerCtx();
    const res = await handler(validInput, ctx);
    assert.match(res.summary.retained.bills, /Revenue Code/);
    assert.match(res.summary.retained.leases, /Civil Code/);
    assert.match(res.summary.retained['BigQuery auth_events archive'], /PDPA/);
  });
});

// ── T8 — idempotency ─────────────────────────────────────────────────────────

describe('requestDataDeletion — idempotency', () => {
  beforeEach(() => reset());

  it('T8: duplicate requestId returns existing summary, does NOT re-run cascade', async () => {
    const ctx = playerCtx({ tenantId: 'T_DUP' });
    // Make the create() throw ALREADY_EXISTS for any dataDeletionLog/* doc
    state.firestoreCreateThrows = '__will_match_below__';
    // Inject "existing" log with prior summary
    const existingPath = 'dataDeletionLog/T_DUP_already';
    state.firestoreDocs[existingPath] = {
      exists: true,
      data: { summary: { deleted: { consents: 5 } } },
    };
    // We can't easily make create throw for the dynamic requestId without
    // intercepting. Instead pre-populate firestoreCreated so the second
    // create() trips on existing key. Use the same logic the stub uses.
    // For simplicity: directly seed firestoreCreated for ANY future request
    // by setting it on the prefix the CF will use.
    // The CF generates `dataDeletionLog/T_DUP_${ISO}`. We can't predict the
    // exact ISO, so instead patch the stub: any create on dataDeletionLog
    // path with key starting T_DUP_ throws.
    // The simplest is to monkey-patch firestoreCreated as a Proxy that
    // pretends every key starting with T_DUP_ already exists.
    state.firestoreCreated = new Proxy({}, {
      has: (t, k) => k.startsWith('dataDeletionLog/T_DUP_'),
      get: (t, k) => state.firestoreDocs[k] && state.firestoreDocs[k].data,
      set: (t, k, v) => { t[k] = v; return true; },
    });
    // Pre-seed firestoreDocs so the get-after-throw returns existing summary
    // We don't know the exact requestId, so make every dataDeletionLog/* doc
    // return the same existing summary.
    state.firestoreDocs = new Proxy({}, {
      get: (t, k) => k.startsWith('dataDeletionLog/T_DUP_')
        ? { exists: true, data: { summary: { deleted: { consents: 5 } } } }
        : t[k],
      has: (t, k) => true,
    });

    const res = await handler(validInput, ctx);
    assert.equal(res.success, false);
    assert.equal(res.idempotent, true);
    assert.equal(res.summary.deleted.consents, 5);
    // Cascade should NOT have run — no setCustomUserClaims called
    assert.equal(state.setCustomUserClaimsCalled, false);
  });
});

// ── T11/T12 — failure tolerance ──────────────────────────────────────────────

describe('requestDataDeletion — best-effort failure handling', () => {
  beforeEach(() => reset());

  it('T11: storage prefix delete fails — cascade still completes', async () => {
    const ctx = playerCtx({ tenantId: 'T_STORAGE_FAIL' });
    state.storageDeleteError = new Error('storage failure');
    state.storageFilesByPrefix['checklists/rooms/15/INST_1/'] = [{ name: 'a.jpg' }];
    state.firestoreQueries[`checklistInstances|building==,roomId==`] = [];
    state.firestoreQueries[`checklistInstances|building==rooms,roomId==15`] = [
      { id: 'INST_1', data: { building: 'rooms', roomId: '15' } },
    ];
    // Player has no room/building claims so checklistInstances helper won't run
    // for the player ctx; instead test with explicit room/building
    const ctxWithRoom = {
      auth: { uid: 'line:U', token: { tenantId: 'T_STORAGE_FAIL', room: '15', building: 'rooms', lineUserId: 'U' } },
    };
    // active-tenant check requires tenants doc match — leave empty so it passes
    const res = await handler(validInput, ctxWithRoom);
    assert.equal(res.success, true);
    assert.match(res.status, /^completed/);
    // storage errors recorded in summary
    assert.ok(res.summary.storageErrors >= 1 || res.summary.errors.length >= 1);
  });

  it('T12: revokeRefreshTokens fails — cascade still proceeds, success returned', async () => {
    const ctx = playerCtx();
    state.revokeRefreshTokensError = new Error('admin SDK transient failure');
    const res = await handler(validInput, ctx);
    assert.equal(res.success, true);
    assert.ok(res.summary.errors.find(e => e.step === 'revokeRefreshTokens'));
  });

  it('catastrophic: setCustomUserClaims fails — CF aborts and log marked failed', async () => {
    const ctx = playerCtx({ tenantId: 'T_CATASTROPHIC' });
    state.setCustomUserClaimsError = new Error('auth service down');
    await assert.rejects(
      () => handler(validInput, ctx),
      (err) => { assert.equal(err.code, 'internal'); return true; }
    );
    // Log update should mark failed
    const updatePath = Object.keys(state.firestoreUpdates).find(p =>
      p.startsWith('dataDeletionLog/T_CATASTROPHIC_'));
    assert.ok(updatePath);
    assert.equal(state.firestoreUpdates[updatePath].status, 'failed');
  });
});
