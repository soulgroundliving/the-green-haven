/**
 * Unit tests for renewLease — S1 scope (auth + validation only).
 *
 * S2 will add renewal-mode happy-path + edge tests; S3 adds extension mode.
 * S1 validates that:
 *   - missing/non-admin auth is rejected with the right HttpsError code
 *   - bad input is rejected with 'invalid-argument'
 *   - the mode parameter defaults to 'renewal' and rejects invalid values
 *   - newEndDate must be parseable AND strictly in the future
 *   - good input gets past validation and hits the 'unimplemented' guard
 *     (proves the validator approves the payload — full state writes pending)
 *
 * Run: node --test functions/__tests__/renewLease.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── firebase-admin stub ───────────────────────────────────────────────────────
// Only buildingRegistry reads Firestore (the 'buildings' collection). All
// other Firestore access happens in S2/S3 branches we don't reach here. The
// stub returns an empty snapshot so the registry falls back to STATIC_FALLBACK
// = ['rooms', 'nest'].

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: () => ({
    collection: () => ({
      get: async () => ({ forEach: (_fn) => {} }),
    }),
  }),
};

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  return originalLoad.apply(this, arguments);
};

const { renewLease, _validateInput } = require('../renewLease');

// ── Helpers ───────────────────────────────────────────────────────────────────

function adminContext() {
  return { auth: { uid: 'admin-uid', token: { admin: true, email: 'admin@test' } } };
}

function tenantContext() {
  return { auth: { uid: 'tenant-uid', token: { admin: false } } };
}

function futureDate(daysAhead = 365) {
  return new Date(Date.now() + daysAhead * 86400 * 1000).toISOString();
}

function pastDate(daysAgo = 1) {
  return new Date(Date.now() - daysAgo * 86400 * 1000).toISOString();
}

const goodInput = () => ({
  building: 'rooms',
  roomId: '15',
  newEndDate: futureDate(365),
  mode: 'renewal',
});

async function expectHttpsError(promise, code) {
  let caught;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, `expected HttpsError with code='${code}', got success`);
  assert.equal(caught.code, code,
    `expected code='${code}', got '${caught.code}' (message: ${caught.message})`);
  return caught;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('renewLease — S1 (auth + validation)', () => {

  describe('Auth gates', () => {
    it('rejects unauthenticated callers', async () => {
      await expectHttpsError(
        renewLease.run(goodInput(), { auth: null }),
        'unauthenticated'
      );
    });

    it('rejects callers without admin claim', async () => {
      await expectHttpsError(
        renewLease.run(goodInput(), tenantContext()),
        'permission-denied'
      );
    });
  });

  describe('Input validation', () => {
    it('rejects invalid building', async () => {
      const data = { ...goodInput(), building: 'not-a-building' };
      await expectHttpsError(renewLease.run(data, adminContext()), 'invalid-argument');
    });

    it('rejects non-string or malformed roomId', async () => {
      // Reject empty string
      await expectHttpsError(
        renewLease.run({ ...goodInput(), roomId: '' }, adminContext()),
        'invalid-argument'
      );
      // Reject special characters
      await expectHttpsError(
        renewLease.run({ ...goodInput(), roomId: 'room#1' }, adminContext()),
        'invalid-argument'
      );
      // Reject > 20 chars
      await expectHttpsError(
        renewLease.run({ ...goodInput(), roomId: 'a'.repeat(21) }, adminContext()),
        'invalid-argument'
      );
    });

    it('rejects unknown mode', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), mode: 'novation' }, adminContext()),
        'invalid-argument'
      );
    });

    it('rejects missing or unparseable newEndDate', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newEndDate: undefined }, adminContext()),
        'invalid-argument'
      );
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newEndDate: 'not-a-date' }, adminContext()),
        'invalid-argument'
      );
    });

    it('rejects newEndDate in the past or now', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newEndDate: pastDate(1) }, adminContext()),
        'invalid-argument'
      );
    });

    it('rejects newRentAmount <= 0 when provided', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newRentAmount: 0 }, adminContext()),
        'invalid-argument'
      );
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newRentAmount: -100 }, adminContext()),
        'invalid-argument'
      );
    });

    it('rejects newDeposit < 0 when provided', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newDeposit: -1 }, adminContext()),
        'invalid-argument'
      );
    });

    it('rejects non-string contractDocument / contractFileName / notes', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), contractDocument: 123 }, adminContext()),
        'invalid-argument'
      );
      await expectHttpsError(
        renewLease.run({ ...goodInput(), contractFileName: {} }, adminContext()),
        'invalid-argument'
      );
      await expectHttpsError(
        renewLease.run({ ...goodInput(), notes: [] }, adminContext()),
        'invalid-argument'
      );
    });
  });

  describe('Validation passes → hits unimplemented guard', () => {
    it('default mode is renewal', async () => {
      const data = { ...goodInput() };
      delete data.mode; // omit to test default
      await expectHttpsError(renewLease.run(data, adminContext()), 'unimplemented');
    });

    it('renewal mode passes validation with minimal payload', async () => {
      await expectHttpsError(renewLease.run(goodInput(), adminContext()), 'unimplemented');
    });

    it('extension mode passes validation with minimal payload', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), mode: 'extension' }, adminContext()),
        'unimplemented'
      );
    });

    it('renewal mode with optional fields passes validation', async () => {
      const data = {
        ...goodInput(),
        newRentAmount: 5500,
        newDeposit: 11000,
        contractDocument: 'gs://bucket/leases/abc.pdf',
        contractFileName: 'lease_2026.pdf',
        notes: 'rent +500 effective renewal',
      };
      await expectHttpsError(renewLease.run(data, adminContext()), 'unimplemented');
    });
  });

  describe('_validateInput direct (white-box)', () => {
    it('normalises mode to "renewal" when omitted', async () => {
      const data = goodInput();
      delete data.mode;
      const result = await _validateInput(data);
      assert.equal(result.mode, 'renewal');
    });

    it('parses newEndDate ISO string to Date instance', async () => {
      const iso = futureDate(180);
      const result = await _validateInput({ ...goodInput(), newEndDate: iso });
      assert.ok(result.newEndDate instanceof Date);
      assert.equal(result.newEndDate.toISOString(), iso);
    });

    it('coerces numeric strings for rent + deposit', async () => {
      const result = await _validateInput({
        ...goodInput(),
        newRentAmount: '5500',
        newDeposit: '11000',
      });
      assert.equal(result.newRentAmount, 5500);
      assert.equal(result.newDeposit, 11000);
    });

    it('defaults optional strings to empty when omitted', async () => {
      const result = await _validateInput(goodInput());
      assert.equal(result.contractDocument, '');
      assert.equal(result.contractFileName, '');
      assert.equal(result.notes, '');
    });
  });
});
