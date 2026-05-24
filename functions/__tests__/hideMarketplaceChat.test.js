/**
 * Unit tests for hideMarketplaceChat — S3 PR 3 one-sided "delete" of a
 * marketplace chat. Pure-logic tests against a stubbed Firestore.
 *
 * firebase-admin + firebase-functions are stubbed via Module._load so the
 * test runs without those packages installed (same pattern as
 * cleanupMarketplaceChat.test.js).
 *
 * Coverage:
 *   - participant → hiddenBy.{uid} written, opts {merge:true}
 *   - non-participant → permission-denied
 *   - missing chat → not-found
 *   - missing chatId → invalid-argument
 *   - no auth → unauthenticated
 */
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: () => ({}),
    };
  }
  if (id === 'firebase-functions/v2/https') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    return {
      HttpsError,
      onCall: (opts, h) => (typeof opts === 'function' ? opts : h),
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};
after(() => { Module._load = _origLoad; });

delete require.cache[require.resolve('../hideMarketplaceChat.js')];
const { _hideChat } = require('../hideMarketplaceChat.js');

const PARTICIPANT = 'line:Up1';
const OTHER = 'line:Up2';
const STRANGER = 'line:Ustranger';
const CHAT_ID = 'c1';
const NOW = Date.parse('2026-05-25T12:00:00.000Z');

let storedChat;
let writes;

function makeFirestore() {
  return {
    collection: (name) => {
      assert.equal(name, 'marketplace_chats');
      return {
        doc: (chatId) => ({
          get: async () => ({ exists: !!storedChat, data: () => storedChat }),
          set: async (data, opts) => {
            writes.push({ path: `marketplace_chats/${chatId}`, data, opts });
          },
        }),
      };
    },
  };
}

beforeEach(() => { storedChat = null; writes = []; });

describe('hideMarketplaceChat', () => {
  it('participant → hiddenBy.{uid} written, merge:true', async () => {
    storedChat = { participants: [PARTICIPANT, OTHER] };
    const result = await _hideChat(makeFirestore(), {
      uid: PARTICIPANT, chatId: CHAT_ID, nowMs: NOW,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].data, {
      hiddenBy: { [PARTICIPANT]: new Date(NOW).toISOString() },
    });
    assert.deepEqual(writes[0].opts, { merge: true });
  });

  it('non-participant → permission-denied', async () => {
    storedChat = { participants: [PARTICIPANT, OTHER] };
    await assert.rejects(
      () => _hideChat(makeFirestore(), {
        uid: STRANGER, chatId: CHAT_ID, nowMs: NOW,
      }),
      (err) => err.code === 'permission-denied',
    );
    assert.equal(writes.length, 0);
  });

  it('missing chat doc → not-found', async () => {
    storedChat = null;
    await assert.rejects(
      () => _hideChat(makeFirestore(), {
        uid: PARTICIPANT, chatId: CHAT_ID, nowMs: NOW,
      }),
      (err) => err.code === 'not-found',
    );
  });

  it('missing chatId → invalid-argument', async () => {
    await assert.rejects(
      () => _hideChat(makeFirestore(), {
        uid: PARTICIPANT, chatId: '', nowMs: NOW,
      }),
      (err) => err.code === 'invalid-argument',
    );
  });

  it('no auth → unauthenticated', async () => {
    await assert.rejects(
      () => _hideChat(makeFirestore(), {
        uid: '', chatId: CHAT_ID, nowMs: NOW,
      }),
      (err) => err.code === 'unauthenticated',
    );
  });
});
