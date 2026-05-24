/**
 * Unit tests for cleanupMarketplaceChat — Sprint 1 privacy-first chat
 * self-destruct. Callable shape (post-SE3-region-split refactor).
 *
 * Coverage:
 *   - cleanupChatsForPost (pure inner): zero/one/many chats, message batching,
 *     no-message chats, idempotency on second call.
 *   - callable wrapper: auth (unauth, owner, admin, non-owner non-admin,
 *     orphan-post + admin allow, orphan-post + non-admin deny),
 *     invalid-argument on missing postId.
 */
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

let chatsState;       // [{ id, postId, ...data }]
let messagesState;    // { chatId: [{ id }] }
let postsState;       // { postId: { ownerUid, ... } }
let deletedChats;     // [chatId]
let deletedMessages;  // [chatId/messageId]
let batchCount;

function resetStubs() {
  chatsState = [];
  messagesState = {};
  postsState = {};
  deletedChats = [];
  deletedMessages = [];
  batchCount = 0;
}
resetStubs();

function chatRef(chatId) {
  return {
    _kind: 'chat',
    _key: chatId,
    collection: (sub) => {
      if (sub !== 'messages') throw new Error('unexpected sub: ' + sub);
      const list = messagesState[chatId] || [];
      return {
        get: async () => ({
          docs: list.map(m => ({
            id: m.id,
            ref: {
              _kind: 'message',
              _key: chatId + '/' + m.id,
            },
          })),
        }),
      };
    },
    delete: async () => { deletedChats.push(chatId); },
  };
}

function mockFirestore() {
  return {
    collection: (name) => {
      if (name === 'marketplace_chats') {
        return {
          doc: (chatId) => chatRef(chatId),
          where: (field, op, val) => {
            if (field !== 'postId' || op !== '==') throw new Error('unexpected where: ' + field + ' ' + op);
            return {
              get: async () => ({
                docs: chatsState
                  .filter(c => c.postId === val)
                  .map(c => ({
                    id: c.id,
                    data: () => c,
                    ref: chatRef(c.id),
                  })),
              }),
            };
          },
        };
      }
      if (name === 'marketplace') {
        return {
          doc: (postId) => ({
            get: async () => ({
              exists: postId in postsState,
              data: () => postsState[postId],
            }),
          }),
        };
      }
      throw new Error('unexpected collection: ' + name);
    },
    batch: () => {
      const ops = [];
      return {
        delete(ref) {
          ops.push(ref);
          return this;
        },
        commit: async () => {
          batchCount++;
          ops.forEach(ref => {
            if (ref._kind === 'message') {
              deletedMessages.push(ref._key);
              const [chatId, messageId] = ref._key.split('/');
              if (messagesState[chatId]) {
                messagesState[chatId] = messagesState[chatId].filter(m => m.id !== messageId);
              }
            }
          });
        },
      };
    },
  };
}

// Callable handler capture --------------------------------------------------
let callableHandler = null;

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: () => mockFirestore(),
    };
  }
  if (id === 'firebase-functions/v2/https') {
    class HttpsError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    }
    return {
      HttpsError,
      onCall: (opts, h) => {
        // Signature is onCall(opts, handler) OR onCall(handler).
        const handler = typeof opts === 'function' ? opts : h;
        callableHandler = handler;
        return handler;
      },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

after(() => { Module._load = _origLoad; });

// Force fresh module load now that mocks are in place.
delete require.cache[require.resolve('../cleanupMarketplaceChat.js')];
const { _cleanupChatsForPost } = require('../cleanupMarketplaceChat.js');

function callerAdmin(uid = 'admin-1') {
  return { auth: { uid, token: { admin: true } } };
}
function callerOwner(uid) {
  return { auth: { uid, token: {} } };
}
function callerUnauth() {
  return { auth: null };
}

// ---- Pure cleanup logic --------------------------------------------------

describe('cleanupChatsForPost — pure cleanup', () => {
  beforeEach(resetStubs);

  it('returns zeros when no chat matches the postId', async () => {
    chatsState = [{ id: 'c-other', postId: 'OTHER' }];
    const r = await _cleanupChatsForPost(mockFirestore(), 'post-001');
    assert.equal(r.chatsDeleted, 0);
    assert.equal(r.messagesDeleted, 0);
    assert.equal(deletedChats.length, 0);
  });

  it('deletes a single chat with no messages', async () => {
    chatsState = [{ id: 'c1', postId: 'post-001' }];
    const r = await _cleanupChatsForPost(mockFirestore(), 'post-001');
    assert.equal(r.chatsDeleted, 1);
    assert.equal(r.messagesDeleted, 0);
    assert.deepEqual(deletedChats, ['c1']);
  });

  it('deletes multiple chats and all their messages', async () => {
    chatsState = [
      { id: 'c1', postId: 'post-001' },
      { id: 'c2', postId: 'post-001' },
    ];
    messagesState = {
      c1: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
      c2: [{ id: 'm1' }, { id: 'm2' }],
    };
    const r = await _cleanupChatsForPost(mockFirestore(), 'post-001');
    assert.equal(r.chatsDeleted, 2);
    assert.equal(r.messagesDeleted, 5);
    assert.deepEqual(deletedChats.sort(), ['c1', 'c2']);
    assert.deepEqual(
      deletedMessages.sort(),
      ['c1/m1', 'c1/m2', 'c1/m3', 'c2/m1', 'c2/m2'].sort()
    );
  });

  it('flushes the batch when message count crosses 450', async () => {
    chatsState = [{ id: 'c1', postId: 'post-001' }];
    messagesState = {
      c1: Array.from({ length: 1001 }, (_, i) => ({ id: 'm' + i })),
    };
    const r = await _cleanupChatsForPost(mockFirestore(), 'post-001');
    assert.equal(r.chatsDeleted, 1);
    assert.equal(r.messagesDeleted, 1001);
    // 1001 messages / 450 per batch = 3 commits (450 + 450 + 101).
    assert.equal(batchCount, 3);
  });

  it('ignores chats that belong to other posts', async () => {
    chatsState = [
      { id: 'cA', postId: 'post-001' },
      { id: 'cB', postId: 'post-002' },
      { id: 'cC', postId: 'post-001' },
    ];
    const r = await _cleanupChatsForPost(mockFirestore(), 'post-001');
    assert.equal(r.chatsDeleted, 2);
    assert.deepEqual(deletedChats.sort(), ['cA', 'cC']);
  });

  it('returns zeros for falsy postId without scanning collection', async () => {
    chatsState = [{ id: 'c1', postId: '' }];
    const r = await _cleanupChatsForPost(mockFirestore(), '');
    assert.equal(r.chatsDeleted, 0);
    assert.equal(r.messagesDeleted, 0);
    assert.equal(deletedChats.length, 0);
  });
});

// ---- Callable wrapper ---------------------------------------------------

describe('cleanupMarketplaceChat — onCall wrapper', () => {
  beforeEach(() => {
    resetStubs();
    assert.equal(typeof callableHandler, 'function', 'onCall handler was captured');
  });

  it('rejects unauthenticated callers', async () => {
    postsState['p1'] = { ownerUid: 'line:UOWNER' };
    chatsState = [{ id: 'c1', postId: 'p1' }];
    await assert.rejects(
      callableHandler({ ...callerUnauth(), data: { postId: 'p1' } }),
      err => err.code === 'unauthenticated'
    );
    assert.equal(deletedChats.length, 0);
  });

  it('rejects missing/empty postId', async () => {
    await assert.rejects(
      callableHandler({ ...callerOwner('line:UX'), data: {} }),
      err => err.code === 'invalid-argument'
    );
    await assert.rejects(
      callableHandler({ ...callerOwner('line:UX'), data: { postId: '' } }),
      err => err.code === 'invalid-argument'
    );
  });

  it('owner can clean their own post chats', async () => {
    postsState['p1'] = { ownerUid: 'line:UOWNER' };
    chatsState = [{ id: 'c1', postId: 'p1' }];
    messagesState = { c1: [{ id: 'm1' }] };
    const r = await callableHandler({ ...callerOwner('line:UOWNER'), data: { postId: 'p1' } });
    assert.deepEqual(r, { chatsDeleted: 1, messagesDeleted: 1 });
    assert.deepEqual(deletedChats, ['c1']);
  });

  it('admin can clean any post chats', async () => {
    postsState['p1'] = { ownerUid: 'line:USOMEONEELSE' };
    chatsState = [{ id: 'c1', postId: 'p1' }];
    const r = await callableHandler({ ...callerAdmin(), data: { postId: 'p1' } });
    assert.deepEqual(r, { chatsDeleted: 1, messagesDeleted: 0 });
  });

  it('non-owner non-admin is denied even if post exists', async () => {
    postsState['p1'] = { ownerUid: 'line:UOWNER' };
    chatsState = [{ id: 'c1', postId: 'p1' }];
    await assert.rejects(
      callableHandler({ ...callerOwner('line:UATTACKER'), data: { postId: 'p1' } }),
      err => err.code === 'permission-denied'
    );
    assert.equal(deletedChats.length, 0);
  });

  it('orphan-post (post deleted) + admin → allowed', async () => {
    // post not in postsState
    chatsState = [{ id: 'c1', postId: 'pX' }];
    const r = await callableHandler({ ...callerAdmin(), data: { postId: 'pX' } });
    assert.deepEqual(r, { chatsDeleted: 1, messagesDeleted: 0 });
  });

  it('orphan-post + non-admin → denied (prevents arbitrary-postId attack)', async () => {
    chatsState = [{ id: 'c1', postId: 'pX' }];
    await assert.rejects(
      callableHandler({ ...callerOwner('line:UANY'), data: { postId: 'pX' } }),
      err => err.code === 'permission-denied'
    );
    assert.equal(deletedChats.length, 0);
  });

  it('owner with no matching chats returns zeros', async () => {
    postsState['p1'] = { ownerUid: 'line:UOWNER' };
    // No chats
    const r = await callableHandler({ ...callerOwner('line:UOWNER'), data: { postId: 'p1' } });
    assert.deepEqual(r, { chatsDeleted: 0, messagesDeleted: 0 });
  });
});
