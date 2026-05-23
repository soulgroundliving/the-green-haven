/**
 * Unit tests for transferTenant._moveContractStorage — the H2 Storage file
 * move helper. Covers happy path (move succeeds), skip cases (empty path,
 * non-canonical pattern, idempotent re-run, leaseId mismatch), and failure
 * surfaces (source missing → defensive return, copy throws → propagate,
 * delete throws after copy succeeds → log but return new path).
 *
 * Stubs admin.storage().bucket().file().{exists,copy,delete}; no Firestore
 * involvement (helper is pure Storage I/O).
 *
 * Run: node --test functions/__tests__/transferTenant.moveStorage.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubFiles;           // { path: { exists: boolean, copyTo?: 'newPath' } }
let copyCalls;           // [{ from, to }]
let deleteCalls;         // [path]
let copyError;           // Error to throw on next copy() call
let deleteError;         // Error to throw on next delete() call
let consoleWarnSpy;
let consoleErrorSpy;

function resetStubs() {
  stubFiles = {};
  copyCalls = [];
  deleteCalls = [];
  copyError = null;
  deleteError = null;
  consoleWarnSpy = [];
  consoleErrorSpy = [];
}
resetStubs();

// ── Module-load stub for firebase-admin ───────────────────────────────────────

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') {
    const bucket = {
      file: (path) => ({
        exists: async () => [Boolean(stubFiles[path])],
        copy: async (destFile) => {
          if (copyError) throw copyError;
          copyCalls.push({ from: path, to: destFile._path });
          stubFiles[destFile._path] = stubFiles[path];
        },
        delete: async () => {
          if (deleteError) throw deleteError;
          deleteCalls.push(path);
          delete stubFiles[path];
        },
        _path: path, // exposed so destFile.copy receiver can read it back
      }),
    };
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: () => ({
        // _moveContractStorage doesn't touch firestore; collection() should never be called
        collection: () => { throw new Error('unexpected firestore.collection call from _moveContractStorage'); },
      }),
      storage: () => ({ bucket: () => bucket }),
    };
  }
  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    return {
      region: () => ({ https: { onCall: (h) => h } }),
      https: { HttpsError },
    };
  }
  return originalLoad.apply(this, [request, parent, ...rest]);
};

// Capture console output so the "warn only" cases don't pollute test output
// AND can be asserted on.
const _origWarn  = console.warn;
const _origError = console.error;
console.warn  = (...args) => { consoleWarnSpy.push(args.join(' ')); };
console.error = (...args) => { consoleErrorSpy.push(args.join(' ')); };

const { _moveContractStorage } = require('../transferTenant');

// Restore console after import (the require above logs nothing — but be tidy
// for any later import-time side effects).
console.warn  = _origWarn;
console.error = _origError;

// Re-install spies for each test
function installSpies() {
  console.warn  = (...args) => { consoleWarnSpy.push(args.join(' ')); };
  console.error = (...args) => { consoleErrorSpy.push(args.join(' ')); };
}
function restoreConsole() {
  console.warn  = _origWarn;
  console.error = _origError;
}

describe('_moveContractStorage', () => {
  beforeEach(() => {
    resetStubs();
    installSpies();
  });

  // ── Skip / no-op paths ─────────────────────────────────────────────────────

  it('empty oldPath → returns empty string, no Storage calls', async () => {
    const result = await _moveContractStorage('', 'nest', 'N101', 'lease-1');
    restoreConsole();
    assert.equal(result, '');
    assert.equal(copyCalls.length, 0);
    assert.equal(deleteCalls.length, 0);
  });

  it('non-canonical path (gs:// URL) → returns path unchanged with warning', async () => {
    const result = await _moveContractStorage('gs://bucket/leases/legacy.pdf', 'nest', 'N101', 'lease-1');
    restoreConsole();
    assert.equal(result, 'gs://bucket/leases/legacy.pdf');
    assert.equal(copyCalls.length, 0);
    assert.equal(deleteCalls.length, 0);
    assert.ok(consoleWarnSpy.some(s => /doesn't match canonical/.test(s)));
  });

  it('non-canonical path (https URL) → returns path unchanged', async () => {
    const url = 'https://firebasestorage.googleapis.com/v0/b/x/o/leases.pdf?token=abc';
    const result = await _moveContractStorage(url, 'nest', 'N101', 'lease-1');
    restoreConsole();
    assert.equal(result, url);
    assert.equal(copyCalls.length, 0);
  });

  it('path leaseId differs from expected leaseId → returns unchanged with warning', async () => {
    const result = await _moveContractStorage(
      'leases/rooms/15/lease-OLD/contract.pdf', 'nest', 'N101', 'lease-NEW',
    );
    restoreConsole();
    assert.equal(result, 'leases/rooms/15/lease-OLD/contract.pdf');
    assert.equal(copyCalls.length, 0);
    assert.ok(consoleWarnSpy.some(s => /leaseId mismatch/.test(s)));
  });

  it('source path already equals target → no-op, returns same path', async () => {
    // Tenant transferring from rooms/15 to rooms/15 (degenerate but possible during
    // re-runs / idempotent retries)
    const result = await _moveContractStorage(
      'leases/rooms/15/lease-1/contract.pdf', 'rooms', '15', 'lease-1',
    );
    restoreConsole();
    assert.equal(result, 'leases/rooms/15/lease-1/contract.pdf');
    assert.equal(copyCalls.length, 0);
    assert.equal(deleteCalls.length, 0);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('source exists, copy + delete succeed → returns new path, both Storage calls fired', async () => {
    stubFiles['leases/rooms/15/lease-1/contract.pdf'] = { exists: true };
    const result = await _moveContractStorage(
      'leases/rooms/15/lease-1/contract.pdf', 'nest', 'N101', 'lease-1',
    );
    restoreConsole();
    assert.equal(result, 'leases/nest/N101/lease-1/contract.pdf');
    assert.deepEqual(copyCalls, [
      { from: 'leases/rooms/15/lease-1/contract.pdf', to: 'leases/nest/N101/lease-1/contract.pdf' },
    ]);
    assert.deepEqual(deleteCalls, ['leases/rooms/15/lease-1/contract.pdf']);
  });

  it('cross-building variation (rooms → nest) preserves fileName + leaseId', async () => {
    stubFiles['leases/rooms/15/lease-abc/scan_v2.pdf'] = { exists: true };
    const result = await _moveContractStorage(
      'leases/rooms/15/lease-abc/scan_v2.pdf', 'nest', 'N405', 'lease-abc',
    );
    restoreConsole();
    assert.equal(result, 'leases/nest/N405/lease-abc/scan_v2.pdf');
  });

  it('same-building room change (15 → 16) works', async () => {
    stubFiles['leases/rooms/15/lease-1/contract.pdf'] = { exists: true };
    const result = await _moveContractStorage(
      'leases/rooms/15/lease-1/contract.pdf', 'rooms', '16', 'lease-1',
    );
    restoreConsole();
    assert.equal(result, 'leases/rooms/16/lease-1/contract.pdf');
  });

  // ── Defensive: source missing ──────────────────────────────────────────────

  it('source missing in Storage → returns target path anyway (defensive), no copy/delete', async () => {
    // stubFiles is empty — file doesn't exist
    const result = await _moveContractStorage(
      'leases/rooms/15/lease-1/contract.pdf', 'nest', 'N101', 'lease-1',
    );
    restoreConsole();
    assert.equal(result, 'leases/nest/N101/lease-1/contract.pdf');
    assert.equal(copyCalls.length, 0);
    assert.equal(deleteCalls.length, 0);
    assert.ok(consoleWarnSpy.some(s => /source missing in Storage/.test(s)));
  });

  // ── Failure surfaces ───────────────────────────────────────────────────────

  it('copy throws → error propagates so caller can abort batch', async () => {
    stubFiles['leases/rooms/15/lease-1/contract.pdf'] = { exists: true };
    copyError = new Error('permission-denied');
    await assert.rejects(
      () => _moveContractStorage('leases/rooms/15/lease-1/contract.pdf', 'nest', 'N101', 'lease-1'),
      (err) => /permission-denied/.test(err.message),
    );
    restoreConsole();
    assert.equal(copyCalls.length, 0);   // copy threw, not pushed
    assert.equal(deleteCalls.length, 0); // delete not attempted
  });

  it('copy succeeds but delete throws → returns new path with error log (orphan left at old path)', async () => {
    stubFiles['leases/rooms/15/lease-1/contract.pdf'] = { exists: true };
    deleteError = new Error('storage-quota-exceeded');
    const result = await _moveContractStorage(
      'leases/rooms/15/lease-1/contract.pdf', 'nest', 'N101', 'lease-1',
    );
    restoreConsole();
    // Returns new path so tenant doc + lease doc point at the file's REAL
    // new location. Old path is now an orphan (recoverable manually or via
    // sweep CF).
    assert.equal(result, 'leases/nest/N101/lease-1/contract.pdf');
    assert.equal(copyCalls.length, 1);
    assert.equal(deleteCalls.length, 0);  // delete threw, not pushed
    assert.ok(consoleErrorSpy.some(s => /copy succeeded but delete failed/.test(s)));
  });
});
