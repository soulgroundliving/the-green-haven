/**
 * Unit tests for unsendMarketplaceMessage — S3 PR 3 sender-only recall
 * with 24h window. Pure-logic tests against a stubbed Firestore.
 *
 * firebase-admin + firebase-functions are stubbed via Module._load so the
 * test runs without those packages installed (same pattern as
 * cleanupMarketplaceChat.test.js).
 *
 * Coverage:
 *   - sender + within 24h → text cleared, unsent:true, unsentAt set
 *   - sender + past 24h → failed-precondition
 *   - non-sender + within 24h → permission-denied
 *   - missing message → not-found
 *   - missing chatId / messageId → invalid-argument
 *   - no auth → unauthenticated
 *   - already unsent → idempotent { ok:true, alreadyUnsent:true }
 */
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// Stub firebase-admin + firebase-functions before requiring the CF.
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

delete require.cache[require.resolve('../unsendMarketplaceMessage.js')];
const { _unsendMessage, UNSEND_WINDOW_MS } = require('../unsendMarketplaceMessage.js');

const SENDER = 'line:Usender';
const STRANGER = 'line:Ustranger';
const CHAT_ID = 'c1';
const MSG_ID = 'm1';
const NOW = Date.parse('2026-05-25T12:00:00.000Z');
const FRESH_TS = new Date(NOW - 60 * 1000).toISOString();
const STALE_TS = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();

let storedMsg;
let writes;

function makeFirestore() {
  return {
    collection: (name) => {
      assert.equal(name, 'marketplace_chats');
      return {
        doc: (chatId) => ({
          collection: (sub) => {
            assert.equal(sub, 'messages');
            return {
              doc: (mid) => ({
                _path: `marketplace_chats/${chatId}/messages/${mid}`,
                get: async () => ({ exists: !!storedMsg, data: () => storedMsg }),
                set: async (data, opts) => {
                  writes.push({ path: `marketplace_chats/${chatId}/messages/${mid}`, data, opts });
                  storedMsg = { ...storedMsg, ...data };
                },
              }),
            };
          },
        }),
      };
    },
  };
}

beforeEach(() => { storedMsg = null; writes = []; });

describe('unsendMarketplaceMessage', () => {
  it('UNSEND_WINDOW_MS is 24h', () => {
    assert.equal(UNSEND_WINDOW_MS, 24 * 60 * 60 * 1000);
  });

  it('sender within 24h → text cleared + unsent:true + unsentAt set', async () => {
    storedMsg = { senderId: SENDER, text: 'oops typo', timestamp: FRESH_TS, isRead: false };
    const result = await _unsendMessage(makeFirestore(), {
      uid: SENDER, chatId: CHAT_ID, messageId: MSG_ID, nowMs: NOW,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].data.text, '');
    assert.equal(writes[0].data.unsent, true);
    assert.equal(writes[0].data.unsentAt, new Date(NOW).toISOString());
    assert.deepEqual(writes[0].opts, { merge: true });
  });

  it('sender past 24h → failed-precondition', async () => {
    storedMsg = { senderId: SENDER, text: 'too late', timestamp: STALE_TS };
    await assert.rejects(
      () => _unsendMessage(makeFirestore(), {
        uid: SENDER, chatId: CHAT_ID, messageId: MSG_ID, nowMs: NOW,
      }),
      (err) => err.code === 'failed-precondition' && /24h/.test(err.message),
    );
    assert.equal(writes.length, 0);
  });

  it('non-sender within 24h → permission-denied', async () => {
    storedMsg = { senderId: SENDER, text: 'not yours', timestamp: FRESH_TS };
    await assert.rejects(
      () => _unsendMessage(makeFirestore(), {
        uid: STRANGER, chatId: CHAT_ID, messageId: MSG_ID, nowMs: NOW,
      }),
      (err) => err.code === 'permission-denied',
    );
    assert.equal(writes.length, 0);
  });

  it('missing message → not-found', async () => {
    storedMsg = null;
    await assert.rejects(
      () => _unsendMessage(makeFirestore(), {
        uid: SENDER, chatId: CHAT_ID, messageId: MSG_ID, nowMs: NOW,
      }),
      (err) => err.code === 'not-found',
    );
  });

  it('missing chatId → invalid-argument', async () => {
    await assert.rejects(
      () => _unsendMessage(makeFirestore(), {
        uid: SENDER, chatId: '', messageId: MSG_ID, nowMs: NOW,
      }),
      (err) => err.code === 'invalid-argument',
    );
  });

  it('missing messageId → invalid-argument', async () => {
    await assert.rejects(
      () => _unsendMessage(makeFirestore(), {
        uid: SENDER, chatId: CHAT_ID, messageId: '', nowMs: NOW,
      }),
      (err) => err.code === 'invalid-argument',
    );
  });

  it('no auth → unauthenticated', async () => {
    await assert.rejects(
      () => _unsendMessage(makeFirestore(), {
        uid: '', chatId: CHAT_ID, messageId: MSG_ID, nowMs: NOW,
      }),
      (err) => err.code === 'unauthenticated',
    );
  });

  it('already unsent → idempotent, no new write', async () => {
    storedMsg = { senderId: SENDER, text: '', unsent: true, unsentAt: FRESH_TS, timestamp: FRESH_TS };
    const result = await _unsendMessage(makeFirestore(), {
      uid: SENDER, chatId: CHAT_ID, messageId: MSG_ID, nowMs: NOW,
    });
    assert.deepEqual(result, { ok: true, alreadyUnsent: true });
    assert.equal(writes.length, 0);
  });
});
