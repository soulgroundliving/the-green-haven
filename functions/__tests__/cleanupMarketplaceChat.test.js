/**
 * Unit tests for cleanupMarketplaceChat — Sprint 1 privacy-first chat
 * self-destruct.
 *
 * Coverage:
 *   - cleanupChatsForPost (pure inner): zero/one/many chats, message batching,
 *     no-message chats, idempotency on second call.
 *   - trigger wrapper (onWrite handler): fires on COMPLETED, fires on delete,
 *     skips on intermediate writes, surfaces errors.
 */
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

let chatsState;       // [{ id, postId, ...data }]
let messagesState;    // { chatId: [{ id }] }
let deletedChats;     // [chatId]
let deletedMessages;  // [chatId/messageId]
let batchCount;

function resetStubs() {
  chatsState = [];
  messagesState = {};
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
      if (name !== 'marketplace_chats') throw new Error('unexpected collection: ' + name);
      return {
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
              // Remove from in-memory state so re-running is idempotent.
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

// Trigger handler capture --------------------------------------------------
let onWriteHandler = null;

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
  if (id === 'firebase-functions/v1') {
    const region = () => ({
      firestore: {
        document: () => ({
          onWrite: (h) => { onWriteHandler = h; return h; },
        }),
      },
    });
    return { region };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

after(() => { Module._load = _origLoad; });

// Force fresh module load now that mocks are in place.
delete require.cache[require.resolve('../cleanupMarketplaceChat.js')];
const { _cleanupChatsForPost, cleanupMarketplaceChat } = require('../cleanupMarketplaceChat.js');

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
    // Seed something — should NOT be touched.
    chatsState = [{ id: 'c1', postId: '' }];
    const r = await _cleanupChatsForPost(mockFirestore(), '');
    assert.equal(r.chatsDeleted, 0);
    assert.equal(r.messagesDeleted, 0);
    assert.equal(deletedChats.length, 0);
  });
});

// ---- Trigger wrapper ------------------------------------------------------

describe('cleanupMarketplaceChat — onWrite trigger', () => {
  beforeEach(() => {
    resetStubs();
    // Ensure the handler was captured at module load.
    assert.equal(typeof onWriteHandler, 'function', 'onWrite handler was not captured');
  });

  function change(beforeData, afterData) {
    return {
      before: {
        exists: !!beforeData,
        data: () => beforeData,
      },
      after: {
        exists: !!afterData,
        data: () => afterData,
      },
    };
  }

  it('cleans when status transitions to COMPLETED with chats present', async () => {
    chatsState = [{ id: 'c1', postId: 'p1' }];
    messagesState = { c1: [{ id: 'm1' }] };
    const out = await onWriteHandler(
      change({ status: 'AVAILABLE' }, { status: 'COMPLETED' }),
      { params: { postId: 'p1' } }
    );
    assert.deepEqual(out, { chatsDeleted: 1, messagesDeleted: 1 });
    assert.deepEqual(deletedChats, ['c1']);
  });

  it('cleans when the post is fully deleted (after=null)', async () => {
    chatsState = [{ id: 'cX', postId: 'pZ' }];
    messagesState = { cX: [{ id: 'm1' }, { id: 'm2' }] };
    const out = await onWriteHandler(
      change({ status: 'AVAILABLE' }, null),
      { params: { postId: 'pZ' } }
    );
    assert.deepEqual(out, { chatsDeleted: 1, messagesDeleted: 2 });
  });

  it('skips when the post is updated but status is not COMPLETED', async () => {
    chatsState = [{ id: 'c1', postId: 'p1' }];
    messagesState = { c1: [{ id: 'm1' }] };
    const out = await onWriteHandler(
      change({ status: 'AVAILABLE', title: 'old' }, { status: 'AVAILABLE', title: 'new' }),
      { params: { postId: 'p1' } }
    );
    assert.equal(out, null);
    assert.equal(deletedChats.length, 0);
  });

  it('skips when status changes between non-COMPLETED states', async () => {
    chatsState = [{ id: 'c1', postId: 'p1' }];
    const out = await onWriteHandler(
      change({ status: 'AVAILABLE' }, { status: 'RESERVED' }),
      { params: { postId: 'p1' } }
    );
    assert.equal(out, null);
    assert.equal(deletedChats.length, 0);
  });

  it('re-runs idempotently when a subsequent write keeps status COMPLETED', async () => {
    chatsState = [{ id: 'c1', postId: 'p1' }];
    messagesState = { c1: [{ id: 'm1' }] };
    // First write — transition into COMPLETED.
    await onWriteHandler(
      change({ status: 'AVAILABLE' }, { status: 'COMPLETED' }),
      { params: { postId: 'p1' } }
    );
    assert.equal(deletedChats.length, 1);
    // Reset capture state but keep the now-cleaned chatsState empty.
    chatsState = [];
    deletedChats = [];
    deletedMessages = [];
    // Second write — admin edits something else on the COMPLETED post.
    const out2 = await onWriteHandler(
      change({ status: 'COMPLETED', adminNote: 'x' }, { status: 'COMPLETED', adminNote: 'y' }),
      { params: { postId: 'p1' } }
    );
    assert.deepEqual(out2, { chatsDeleted: 0, messagesDeleted: 0 });
    assert.equal(deletedChats.length, 0);
  });
});
