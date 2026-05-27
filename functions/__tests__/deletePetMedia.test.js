/**
 * Unit tests for deletePetMedia — admin-only pet media delete (Firestore + Storage).
 * Run: node --test functions/__tests__/deletePetMedia.test.js
 */
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────
let getValidBuildingsResult;
let deletePetStorageResult;
let deletePetStorageShouldThrow;
let fsDocDeleted;
let fsDocShouldThrow;
let capturedDeletePetStorageArgs;

function resetStubs() {
  getValidBuildingsResult   = new Set(['rooms', 'nest']);
  deletePetStorageResult    = { deletedCount: 3, errors: [] };
  deletePetStorageShouldThrow = null;
  fsDocDeleted              = false;
  fsDocShouldThrow          = null;
  capturedDeletePetStorageArgs = null;
}
resetStubs();

// ── Module interception (must happen BEFORE require('../deletePetMedia')) ──
const Module    = require('module');
const _origLoad = Module._load;

Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const fsInstance = {
      doc: (_path) => ({
        delete: async () => {
          if (fsDocShouldThrow) throw fsDocShouldThrow;
          fsDocDeleted = true;
        },
      }),
    };
    const firestoreFn = Object.assign(() => fsInstance, {
      FieldValue: {
        serverTimestamp: () => '__ST__',
        delete:          () => '__DEL__',
      },
      Timestamp: { fromMillis: (ms) => ms },
    });
    return {
      apps:          [{}],
      initializeApp: () => {},
      firestore:     firestoreFn,
    };
  }

  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    }
    return {
      region: () => ({ https: { onCall: (h) => h } }),
      https:  { HttpsError },
    };
  }

  if (id === './buildingRegistry') {
    return {
      getValidBuildings: async () => getValidBuildingsResult,
      getAllBuildings:    async () => Array.from(getValidBuildingsResult),
    };
  }

  if (id === './_petStorage') {
    return {
      deletePetStorageForPet: async (building, roomId, petId, opts) => {
        capturedDeletePetStorageArgs = { building, roomId, petId, opts };
        if (deletePetStorageShouldThrow) throw deletePetStorageShouldThrow;
        return deletePetStorageResult;
      },
    };
  }

  return _origLoad.call(this, id, parent, ...rest);
};

after(() => { Module._load = _origLoad; });

// Require AFTER stubs are registered.
const { deletePetMedia: handler } = require('../deletePetMedia');

// ── Context helpers ───────────────────────────────────────────────────────────
const adminCtx = { auth: { uid: 'admin1', token: { admin: true, email: 'a@t.com' } } };

function tenantCtx(uid = 'tenant1') {
  return { auth: { uid, token: { admin: false, email: `${uid}@t.com` } } };
}

const VALID_DATA = { building: 'rooms', roomId: '15', petId: 'pet-abc_123' };

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('deletePetMedia', () => {
  beforeEach(resetStubs);

  // 1. No auth at all
  it('throws unauthenticated when context.auth is absent', async () => {
    await assert.rejects(
      () => handler(VALID_DATA, { auth: null }),
      (e) => e.code === 'unauthenticated',
    );
  });

  // 2. Auth present but uid is falsy
  it('throws unauthenticated when uid is empty string', async () => {
    await assert.rejects(
      () => handler(VALID_DATA, { auth: { uid: '', token: { admin: true } } }),
      (e) => e.code === 'unauthenticated',
    );
  });

  // 3. Authenticated but admin !== true
  it('throws permission-denied when caller is not admin', async () => {
    await assert.rejects(
      () => handler(VALID_DATA, tenantCtx()),
      (e) => e.code === 'permission-denied',
    );
  });

  // 4. Missing building
  it('throws invalid-argument when building is missing', async () => {
    await assert.rejects(
      () => handler({ roomId: '15', petId: 'abc' }, adminCtx),
      (e) => e.code === 'invalid-argument' && /building/i.test(e.message),
    );
  });

  // 5. Invalid building — not in validBuildings Set
  it('throws invalid-argument when building is not in valid set (amazon)', async () => {
    await assert.rejects(
      () => handler({ building: 'amazon', roomId: '15', petId: 'abc' }, adminCtx),
      (e) => e.code === 'invalid-argument' && /building/i.test(e.message),
    );
  });

  // 6. Missing roomId
  it('throws invalid-argument when roomId is missing', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', petId: 'abc' }, adminCtx),
      (e) => e.code === 'invalid-argument' && /roomId/i.test(e.message),
    );
  });

  // 7. roomId too long (21 chars)
  it('throws invalid-argument when roomId exceeds 20 characters', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: 'a'.repeat(21), petId: 'abc' }, adminCtx),
      (e) => e.code === 'invalid-argument' && /roomId/i.test(e.message),
    );
  });

  // 8. roomId with illegal special chars
  it('throws invalid-argument when roomId contains @ character', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: 'room@15', petId: 'abc' }, adminCtx),
      (e) => e.code === 'invalid-argument' && /roomId/i.test(e.message),
    );
  });

  // 9. Missing petId
  it('throws invalid-argument when petId is missing', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '15' }, adminCtx),
      (e) => e.code === 'invalid-argument' && /petId/i.test(e.message),
    );
  });

  // 10. petId too long (65 chars)
  it('throws invalid-argument when petId exceeds 64 characters', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '15', petId: 'a'.repeat(65) }, adminCtx),
      (e) => e.code === 'invalid-argument' && /petId/i.test(e.message),
    );
  });

  // 11. petId with illegal char (#)
  it('throws invalid-argument when petId contains # character', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '15', petId: 'pet#bad' }, adminCtx),
      (e) => e.code === 'invalid-argument' && /petId/i.test(e.message),
    );
  });

  // 12. Firestore doc.delete throws → error swallowed, function succeeds
  it('swallows Firestore delete error and continues to Storage cleanup', async () => {
    fsDocShouldThrow = new Error('permission-denied from Firestore');
    const result = await handler(VALID_DATA, adminCtx);
    assert.equal(result.success, true);
    assert.equal(result.storageDeleted, 3);
    assert.equal(result.storageErrors, 0);
  });

  // 13. deletePetStorageForPet returns { deletedCount: 3, errors: [] }
  it('returns storageDeleted=3 and storageErrors=0 when storage deletes succeed', async () => {
    deletePetStorageResult = { deletedCount: 3, errors: [] };
    const result = await handler(VALID_DATA, adminCtx);
    assert.equal(result.storageDeleted, 3);
    assert.equal(result.storageErrors, 0);
  });

  // 14. deletePetStorageForPet returns { deletedCount: 0, errors: ['err1', 'err2'] }
  it('returns storageDeleted=0 and storageErrors=2 when storage has errors', async () => {
    deletePetStorageResult = { deletedCount: 0, errors: ['err1', 'err2'] };
    const result = await handler(VALID_DATA, adminCtx);
    assert.equal(result.storageDeleted, 0);
    assert.equal(result.storageErrors, 2);
  });

  // 15. deletePetStorageForPet throws → rethrows as HttpsError 'internal'
  it('rethrows Storage cleanup failure as HttpsError internal', async () => {
    deletePetStorageShouldThrow = new Error('Storage exploded');
    await assert.rejects(
      () => handler(VALID_DATA, adminCtx),
      (e) => e.code === 'internal' && /Storage cleanup failed/i.test(e.message),
    );
  });

  // 16. Successful call → correct shape returned
  it('returns { success: true, building, roomId, petId, storageDeleted, storageErrors }', async () => {
    deletePetStorageResult = { deletedCount: 5, errors: [] };
    const result = await handler(VALID_DATA, adminCtx);
    assert.deepEqual(result, {
      success:        true,
      building:       'rooms',
      roomId:         '15',
      petId:          'pet-abc_123',
      storageDeleted: 5,
      storageErrors:  0,
    });
  });

  // 17. callerEmail from context.auth.token.email is included in opts reason
  it('passes callerEmail in deletePetStorageForPet reason opts', async () => {
    const ctx = { auth: { uid: 'admin1', token: { admin: true, email: 'boss@green.com' } } };
    await handler(VALID_DATA, ctx);
    assert.ok(capturedDeletePetStorageArgs, 'deletePetStorageForPet was called');
    assert.ok(
      capturedDeletePetStorageArgs.opts.reason.includes('boss@green.com'),
      `reason should include caller email; got: ${capturedDeletePetStorageArgs.opts.reason}`,
    );
  });

  // 18. Valid Thai roomId passes regex → success
  it('accepts a valid Thai roomId and returns success', async () => {
    const result = await handler(
      { building: 'rooms', roomId: 'ห้อง15', petId: 'pet-001' },
      adminCtx,
    );
    assert.equal(result.success, true);
    assert.equal(result.roomId, 'ห้อง15');
  });
});
