/**
 * Unit tests for _petStorage.deletePetStorageForRoom — pet Storage cleanup helper.
 *
 * Critical asserts:
 *   1. Prefix MUST be `pets/{b}/{r}/` with trailing slash — without it,
 *      `pets/rooms/1` matches `pets/rooms/15/*` and we'd delete the wrong room.
 *   2. Per-file errors are accumulated, not thrown — caller is fire-and-forget.
 *   3. Missing building/roomId throws (programmer error — prevents whole-bucket scan).
 *   4. getFiles failure returns deletedCount=0 + error, doesn't throw.
 *
 * Run: node --test functions/__tests__/_petStorage.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Mock state — reset before each test.
let stubFilesByPrefix;     // exact-match: prefix → [{ name, deleteThrows? }]
let getFilesShouldThrow;   // boolean toggle
let actualPrefixRequested; // captures the prefix the SUT actually passed
let deleteCallsByName;     // file.name → count

function resetStubs() {
  stubFilesByPrefix = {};
  getFilesShouldThrow = false;
  actualPrefixRequested = null;
  deleteCallsByName = {};
}
resetStubs();

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const _bucket = {
      getFiles: async ({ prefix }) => {
        actualPrefixRequested = prefix;
        if (getFilesShouldThrow) {
          const err = new Error('stub getFiles failure (IAM/network)');
          throw err;
        }
        // EXACT prefix match only — replicates the real bucket behavior we want.
        // If the SUT drops the trailing slash, the test will see a prefix like
        // 'pets/rooms/1' which won't match the stub key 'pets/rooms/1/' and the
        // assertion on returned count will fail.
        const stubFiles = stubFilesByPrefix[prefix] || [];
        const files = stubFiles.map(f => ({
          name: f.name,
          delete: async () => {
            deleteCallsByName[f.name] = (deleteCallsByName[f.name] || 0) + 1;
            if (f.deleteThrows) {
              throw new Error(`stub delete failure for ${f.name}`);
            }
          },
        }));
        return [files];
      },
    };
    return {
      apps: [{}],
      initializeApp: () => {},
      storage: () => ({ bucket: () => _bucket }),
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { deletePetStorageForRoom } = require('../_petStorage');

describe('deletePetStorageForRoom — prefix discipline + per-file resilience', () => {
  beforeEach(resetStubs);

  it('uses trailing-slash prefix to avoid sibling-room match (pets/rooms/1/ ≠ pets/rooms/15)', async () => {
    stubFilesByPrefix['pets/rooms/1/'] = [
      { name: 'pets/rooms/1/abc/photo_1.png' },
    ];
    // Decoy that would match if SUT incorrectly passed prefix 'pets/rooms/1' without trailing slash
    stubFilesByPrefix['pets/rooms/15/'] = [
      { name: 'pets/rooms/15/xyz/photo_1.png' },
      { name: 'pets/rooms/15/xyz/vaccineBook_1.pdf' },
    ];

    const result = await deletePetStorageForRoom('rooms', '1');

    assert.equal(actualPrefixRequested, 'pets/rooms/1/',
      'SUT MUST request the trailing-slash prefix or sibling rooms get nuked');
    assert.equal(result.deletedCount, 1);
    assert.equal(result.totalFiles, 1);
    assert.equal(result.errors.length, 0);
    // Room 15 must NOT be touched
    assert.equal(deleteCallsByName['pets/rooms/15/xyz/photo_1.png'] || 0, 0);
    assert.equal(deleteCallsByName['pets/rooms/15/xyz/vaccineBook_1.pdf'] || 0, 0);
  });

  it('returns deletedCount=0 + empty errors when no files match', async () => {
    const result = await deletePetStorageForRoom('rooms', '99');
    assert.equal(result.deletedCount, 0);
    assert.equal(result.totalFiles, 0);
    assert.deepEqual(result.errors, []);
  });

  it('deletes all files under a room across multiple pets', async () => {
    stubFilesByPrefix['pets/nest/N101/'] = [
      { name: 'pets/nest/N101/pet-A/photo_111.png' },
      { name: 'pets/nest/N101/pet-A/vaccineBook_222.pdf' },
      { name: 'pets/nest/N101/pet-B/photo_333.png' },
    ];
    const result = await deletePetStorageForRoom('nest', 'N101');
    assert.equal(result.deletedCount, 3);
    assert.equal(result.totalFiles, 3);
    assert.equal(result.errors.length, 0);
    assert.equal(deleteCallsByName['pets/nest/N101/pet-A/photo_111.png'], 1);
    assert.equal(deleteCallsByName['pets/nest/N101/pet-A/vaccineBook_222.pdf'], 1);
    assert.equal(deleteCallsByName['pets/nest/N101/pet-B/photo_333.png'], 1);
  });

  it('accumulates per-file errors without throwing — partial success is acceptable', async () => {
    stubFilesByPrefix['pets/rooms/15/'] = [
      { name: 'pets/rooms/15/p1/photo_a.png' },
      { name: 'pets/rooms/15/p1/photo_b.png', deleteThrows: true },
      { name: 'pets/rooms/15/p1/vaccineBook.pdf' },
    ];
    const result = await deletePetStorageForRoom('rooms', '15', { reason: 'archive' });
    assert.equal(result.deletedCount, 2);
    assert.equal(result.totalFiles, 3);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].name, 'pets/rooms/15/p1/photo_b.png');
    assert.match(result.errors[0].error, /stub delete failure/);
  });

  it('survives getFiles failure (returns deletedCount=0 + error, does NOT throw)', async () => {
    getFilesShouldThrow = true;
    const result = await deletePetStorageForRoom('rooms', '15');
    assert.equal(result.deletedCount, 0);
    assert.equal(result.totalFiles, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /stub getFiles failure/);
  });

  it('throws on empty building (prevents whole-bucket scan)', async () => {
    await assert.rejects(
      () => deletePetStorageForRoom('', '15'),
      /building must be non-empty string/
    );
  });

  it('throws on missing building (prevents whole-bucket scan)', async () => {
    await assert.rejects(
      () => deletePetStorageForRoom(undefined, '15'),
      /building must be non-empty string/
    );
  });

  it('throws on empty roomId (prevents whole-building scan)', async () => {
    await assert.rejects(
      () => deletePetStorageForRoom('rooms', ''),
      /roomId must be non-empty string/
    );
  });

  it('throws on non-string building (programmer error guard)', async () => {
    await assert.rejects(
      () => deletePetStorageForRoom(123, '15'),
      /building must be non-empty string/
    );
  });

  it('accepts numeric-looking roomId as string (real rooms are "15", "N101", "Amazon")', async () => {
    stubFilesByPrefix['pets/rooms/15/'] = [
      { name: 'pets/rooms/15/p/photo.png' },
    ];
    const result = await deletePetStorageForRoom('rooms', '15');
    assert.equal(result.deletedCount, 1);
  });

  it('does NOT scan when given partial-prefix building (pets/rooms ≠ pets/rooms/1/)', async () => {
    // Adversarial input: someone passes 'rooms/1' as building (wrong) — the
    // trailing-slash construction still produces a literal `pets/rooms/1//` so
    // it can't accidentally match a real `pets/rooms/1/*` set.
    stubFilesByPrefix['pets/rooms/1/'] = [
      { name: 'pets/rooms/1/p/photo.png' },
    ];
    const result = await deletePetStorageForRoom('rooms/1', '15');
    assert.equal(result.deletedCount, 0,
      'malformed building with embedded slash must not collide with legit room prefix');
    assert.equal(actualPrefixRequested, 'pets/rooms/1/15/');
  });
});
