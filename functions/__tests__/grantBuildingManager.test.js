/**
 * Unit tests for grantBuildingManager — HTTPS callable that sets or revokes
 * the `managedBuildings` custom claim on a Firebase Auth user, scoping them
 * to one or more buildings.
 *
 * Covers: auth guard, input validation, building registry validation,
 * getUser error handling, setCustomUserClaims error handling, claim merging,
 * empty-buildings revoke path, and return-value shape.
 *
 * Run: node --test functions/__tests__/grantBuildingManager.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────
let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    // buildingRegistry stub
    validBuildings: new Set(['rooms', 'nest']),
    // admin.auth().getUser response
    getUserError: null,
    userRecord: { customClaims: {} },
    // admin.auth().setCustomUserClaims
    setClaimsError: null,
    ...overrides,
  };
  captured = {
    setClaimsCalls: [],  // { uid, claims }
    getUserCalls: [],    // uid strings
  };
}
resetStubs();

// ── firebase-admin stub ───────────────────────────────────────────────────────
// admin.auth() is a factory so each call returns a fresh object —
// this matches the real pattern where the CF calls admin.auth() inside the handler.
const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: () => ({}),   // not used directly; buildingRegistry is stubbed out
  auth: () => ({
    getUser: async (uid) => {
      captured.getUserCalls.push(uid);
      if (stubState.getUserError) throw stubState.getUserError;
      return stubState.userRecord;
    },
    setCustomUserClaims: async (uid, claims) => {
      if (stubState.setClaimsError) throw stubState.setClaimsError;
      captured.setClaimsCalls.push({ uid, claims });
    },
  }),
};

// ── Module._load intercept ────────────────────────────────────────────────────
// Must be installed BEFORE requiring grantBuildingManager because
// buildingRegistry is required at module load time.
let capturedCallHandler = null;
const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;

  if (request === 'firebase-functions/v1') {
    const HttpsError = class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    };
    return {
      region: () => ({
        https: {
          onCall: (fn) => { capturedCallHandler = fn; return fn; },
          HttpsError,
        },
      }),
      https: { HttpsError },
    };
  }

  // Stub buildingRegistry — loaded at module level by grantBuildingManager
  if (
    request === './buildingRegistry' ||
    request.replace(/\\/g, '/').endsWith('/buildingRegistry') ||
    request.replace(/\\/g, '/').endsWith('/buildingRegistry.js')
  ) {
    return {
      getValidBuildings: async () => stubState.validBuildings,
    };
  }

  return _origLoad.apply(this, arguments);
};

// Load the CF under test after stubs are installed
delete require.cache[require.resolve('../grantBuildingManager.js')];
require('../grantBuildingManager.js');

// Restore Module._load after all tests complete
after(() => { Module._load = _origLoad; });

// ── Context helpers ───────────────────────────────────────────────────────────
const adminCtx   = { auth: { uid: 'Uadmin', token: { admin: true } } };
const noAdminCtx = { auth: { uid: 'Uuser',  token: { admin: false } } };
const noAuthCtx  = { auth: null };

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('grantBuildingManager', () => {
  beforeEach(() => resetStubs());

  // ── Smoke test ──────────────────────────────────────────────────────────────
  describe('handler registration', () => {
    it('onCall handler is captured after module load', () => {
      assert.ok(
        typeof capturedCallHandler === 'function',
        'capturedCallHandler should be a function'
      );
    });
  });

  // ── Auth guard ──────────────────────────────────────────────────────────────
  describe('auth guard', () => {
    it('no auth context (auth: null) → throws permission-denied', async () => {
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 'U1', buildings: ['rooms'] }, noAuthCtx),
        e => e.code === 'permission-denied'
      );
    });

    it('token.admin is false → throws permission-denied', async () => {
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 'U1', buildings: ['rooms'] }, noAdminCtx),
        e => e.code === 'permission-denied'
      );
    });

    it('token.admin is undefined (key absent) → throws permission-denied', async () => {
      const ctx = { auth: { uid: 'Uuser', token: {} } };
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 'U1', buildings: ['rooms'] }, ctx),
        e => e.code === 'permission-denied'
      );
    });
  });

  // ── targetUid validation ────────────────────────────────────────────────────
  describe('targetUid validation', () => {
    it('missing targetUid → throws invalid-argument', async () => {
      await assert.rejects(
        () => capturedCallHandler({ buildings: ['rooms'] }, adminCtx),
        e => e.code === 'invalid-argument'
      );
    });

    it('targetUid is empty string → throws invalid-argument', async () => {
      await assert.rejects(
        () => capturedCallHandler({ targetUid: '', buildings: ['rooms'] }, adminCtx),
        e => e.code === 'invalid-argument'
      );
    });

    it('targetUid is a number (not a string) → throws invalid-argument', async () => {
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 12345, buildings: ['rooms'] }, adminCtx),
        e => e.code === 'invalid-argument'
      );
    });

    it('null data object → throws invalid-argument (no targetUid)', async () => {
      await assert.rejects(
        () => capturedCallHandler(null, adminCtx),
        e => e.code === 'invalid-argument'
      );
    });
  });

  // ── buildings validation ────────────────────────────────────────────────────
  describe('buildings validation', () => {
    it('missing buildings field → throws invalid-argument', async () => {
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 'U1' }, adminCtx),
        e => e.code === 'invalid-argument'
      );
    });

    it('buildings is a string (not an array) → throws invalid-argument', async () => {
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 'U1', buildings: 'rooms' }, adminCtx),
        e => e.code === 'invalid-argument'
      );
    });

    it('buildings is null → throws invalid-argument', async () => {
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 'U1', buildings: null }, adminCtx),
        e => e.code === 'invalid-argument'
      );
    });
  });

  // ── Building registry validation ────────────────────────────────────────────
  describe('building registry validation', () => {
    it('unknown building in list → throws invalid-argument containing the bad name', async () => {
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 'U1', buildings: ['amazon'] }, adminCtx),
        e => e.code === 'invalid-argument' && e.message.includes('amazon')
      );
    });

    it('mix of valid and invalid buildings → throws invalid-argument containing the invalid one', async () => {
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 'U1', buildings: ['rooms', 'unknown'] }, adminCtx),
        e => e.code === 'invalid-argument' && e.message.includes('unknown')
      );
    });
  });

  // ── getUser error handling ──────────────────────────────────────────────────
  describe('getUser error handling', () => {
    it('getUser throws → wraps as not-found HttpsError', async () => {
      stubState.getUserError = new Error('User not found in Firebase Auth');
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 'U_missing', buildings: ['rooms'] }, adminCtx),
        e => e.code === 'not-found'
      );
    });

    it('getUser is called with the correct targetUid', async () => {
      await capturedCallHandler({ targetUid: 'Uspecific', buildings: ['rooms'] }, adminCtx);
      assert.equal(captured.getUserCalls.length, 1);
      assert.equal(captured.getUserCalls[0], 'Uspecific');
    });
  });

  // ── setCustomUserClaims error handling ──────────────────────────────────────
  describe('setCustomUserClaims error handling', () => {
    it('setCustomUserClaims throws → error propagates out of the handler', async () => {
      stubState.setClaimsError = new Error('Firebase Auth quota exceeded');
      await assert.rejects(
        () => capturedCallHandler({ targetUid: 'U1', buildings: ['rooms'] }, adminCtx),
        e => e.message === 'Firebase Auth quota exceeded'
      );
    });
  });

  // ── Happy-path claim writes ─────────────────────────────────────────────────
  describe('happy-path claim writes', () => {
    it('valid buildings array → setCustomUserClaims called with managedBuildings set', async () => {
      await capturedCallHandler({ targetUid: 'U1', buildings: ['rooms'] }, adminCtx);
      assert.equal(captured.setClaimsCalls.length, 1);
      assert.deepEqual(captured.setClaimsCalls[0].claims.managedBuildings, ['rooms']);
    });

    it('multiple valid buildings → all present in the setCustomUserClaims call', async () => {
      await capturedCallHandler({ targetUid: 'U1', buildings: ['rooms', 'nest'] }, adminCtx);
      assert.deepEqual(
        captured.setClaimsCalls[0].claims.managedBuildings,
        ['rooms', 'nest']
      );
    });

    it('empty buildings array → managedBuildings key is deleted (undefined) in setCustomUserClaims', async () => {
      // Pre-existing claim has managedBuildings; empty array should revoke it
      stubState.userRecord = { customClaims: { managedBuildings: ['rooms'] } };
      await capturedCallHandler({ targetUid: 'U1', buildings: [] }, adminCtx);
      assert.equal(captured.setClaimsCalls.length, 1);
      assert.equal(captured.setClaimsCalls[0].claims.managedBuildings, undefined);
    });

    it('existing claims are preserved when granting buildings', async () => {
      stubState.userRecord = { customClaims: { admin: true } };
      await capturedCallHandler({ targetUid: 'U1', buildings: ['rooms'] }, adminCtx);
      const claims = captured.setClaimsCalls[0].claims;
      assert.equal(claims.admin, true);
      assert.deepEqual(claims.managedBuildings, ['rooms']);
    });

    it('existing claims preserved when revoking (empty buildings) — other claims survive', async () => {
      stubState.userRecord = { customClaims: { admin: true, managedBuildings: ['nest'] } };
      await capturedCallHandler({ targetUid: 'U1', buildings: [] }, adminCtx);
      const claims = captured.setClaimsCalls[0].claims;
      assert.equal(claims.admin, true);
      assert.equal(claims.managedBuildings, undefined);
    });

    it('setCustomUserClaims is called with the correct targetUid', async () => {
      await capturedCallHandler({ targetUid: 'Ufoo', buildings: ['rooms'] }, adminCtx);
      assert.equal(captured.setClaimsCalls[0].uid, 'Ufoo');
    });
  });

  // ── Return value shape ──────────────────────────────────────────────────────
  describe('return value shape', () => {
    it('returns { uid, managedBuildings, note } on success', async () => {
      const result = await capturedCallHandler(
        { targetUid: 'Uresult', buildings: ['rooms', 'nest'] },
        adminCtx
      );
      assert.equal(result.uid, 'Uresult');
      assert.deepEqual(result.managedBuildings, ['rooms', 'nest']);
      assert.ok(typeof result.note === 'string' && result.note.length > 0,
        'note should be a non-empty string');
    });

    it('return value managedBuildings is the empty array when buildings: []', async () => {
      const result = await capturedCallHandler(
        { targetUid: 'Urevoke', buildings: [] },
        adminCtx
      );
      assert.equal(result.uid, 'Urevoke');
      assert.deepEqual(result.managedBuildings, []);
      assert.ok(typeof result.note === 'string');
    });
  });
});
