/**
 * Unit tests for notifyMarketplaceChat — Sprint 2 LINE OA notification.
 * Callable shape (post-SE3-region-split refactor).
 *
 * Coverage:
 *   - pure helpers: stripLinePrefix, buildMessage (deep-link, truncation)
 *   - auth gates: unauth, non-participant, sender-mismatch, missing message,
 *     missing chat, missing chatId/messageId, missing token
 *   - happy path push + lastNotifyAt write + fallback sender name
 *   - throttle accept/reject
 *   - 4xx permanent (no retry), 5xx + network → enqueueLineRetry
 */
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

let chatState;        // { [chatId]: data }
let messagesState;    // { [chatId]: { [messageId]: data } }
let liffUsersState;   // { [lineUserId]: data }
let lastSetCall;      // { chatId, patch, opts }
let pushCalls;        // [{ url, body }]
let pushReply;        // { ok, status, text } per call
let retryCalls;       // [{ ...arg }]
let callableHandler = null;

function resetStubs() {
  chatState = {};
  messagesState = {};
  liffUsersState = {};
  lastSetCall = null;
  pushCalls = [];
  pushReply = { ok: true, status: 200, text: '' };
  retryCalls = [];
}
resetStubs();

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (col) => {
        if (col === 'marketplace_chats') {
          return {
            doc: (chatId) => {
              const ref = {
                get: async () => ({
                  exists: chatId in chatState,
                  data: () => chatState[chatId],
                }),
                set: async (patch, opts) => {
                  lastSetCall = { chatId, patch, opts };
                  const cur = chatState[chatId] || {};
                  if (patch.lastNotifyAt && typeof patch.lastNotifyAt === 'object') {
                    cur.lastNotifyAt = { ...(cur.lastNotifyAt || {}), ...patch.lastNotifyAt };
                  }
                  chatState[chatId] = cur;
                },
                collection: (sub) => {
                  if (sub !== 'messages') throw new Error('unexpected sub: ' + sub);
                  return {
                    doc: (messageId) => ({
                      get: async () => ({
                        exists: !!(messagesState[chatId] && messagesState[chatId][messageId]),
                        data: () => messagesState[chatId]?.[messageId],
                      }),
                    }),
                  };
                },
              };
              return ref;
            },
          };
        }
        if (col === 'liffUsers') {
          return {
            doc: (userId) => ({
              get: async () => ({
                exists: userId in liffUsersState,
                data: () => liffUsersState[userId],
              }),
            }),
          };
        }
        throw new Error('unexpected collection: ' + col);
      },
    });
    // S3 PR 3: real firebase-admin exposes both admin.firestore() (callable)
    // AND admin.firestore.FieldValue (namespace). The stub mirrors that so
    // CFs calling FieldValue.delete() / .increment() don't crash.
    firestoreFn.FieldValue = {
      delete: () => ({ _sentinel: 'delete' }),
      increment: (n) => ({ _sentinel: 'increment', n }),
      serverTimestamp: () => ({ _sentinel: 'serverTimestamp' }),
    };
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
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
        const handler = typeof opts === 'function' ? opts : h;
        callableHandler = handler;
        return handler;
      },
    };
  }
  if (id === 'firebase-functions/params') {
    return {
      defineSecret: (name) => ({
        name,
        value: () => process.env[name] || '',
      }),
    };
  }
  if (id === './_lineRetry') {
    return {
      enqueueLineRetry: async (arg) => { retryCalls.push(arg); },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const origFetch = typeof global.fetch === 'function' ? global.fetch : null;
global.fetch = async (url, opts) => {
  pushCalls.push({ url, body: opts?.body });
  if (typeof pushReply === 'function') return pushReply();
  return {
    ok: pushReply.ok,
    status: pushReply.status,
    text: async () => pushReply.text || '',
  };
};

after(() => {
  Module._load = _origLoad;
  if (origFetch === null) delete global.fetch;
  else global.fetch = origFetch;
});

process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token-xyz';

delete require.cache[require.resolve('../notifyMarketplaceChat.js')];
const mod = require('../notifyMarketplaceChat.js');
const { _stripLinePrefix, _buildMessage, _NOTIFY_THROTTLE_MS } = mod;

function callerLine(uid) {
  return { auth: { uid, token: {} } };
}
function callerUnauth() {
  return { auth: null };
}

// ---- Pure helpers -------------------------------------------------------

describe('stripLinePrefix', () => {
  it('strips line: prefix and returns the user id', () => {
    assert.equal(_stripLinePrefix('line:Uabc123'), 'Uabc123');
  });
  it('returns null for non-line uids', () => {
    assert.equal(_stripLinePrefix('book:Uabc'), null);
    assert.equal(_stripLinePrefix('Uabc'), null);
    assert.equal(_stripLinePrefix(''), null);
    assert.equal(_stripLinePrefix(null), null);
    assert.equal(_stripLinePrefix(undefined), null);
  });
  it('returns null for line: with empty body', () => {
    assert.equal(_stripLinePrefix('line:'), null);
  });
});

describe('buildMessage', () => {
  it('embeds chat id in the deep-link uri (encoded)', () => {
    const m = _buildMessage({ chatId: 'C 1', postTitle: 'Lamp', senderName: 'A', text: 'hi' });
    const uri = m.contents.footer.contents[0].action.uri;
    assert.ok(uri.endsWith('?chat=C%201'), 'expected encoded chatId; got ' + uri);
    assert.ok(uri.includes('liff.line.me/'), 'expected LIFF link; got ' + uri);
  });
  it('truncates the post title and the preview text', () => {
    const longTitle = 'x'.repeat(120);
    const longText = 'y'.repeat(200);
    const m = _buildMessage({ chatId: 'c1', postTitle: longTitle, senderName: 'A', text: longText });
    const header = m.contents.header.contents[0].text;
    const preview = m.contents.body.contents[1].text;
    assert.ok(header.includes('…'), 'header should be truncated with …');
    assert.ok(preview.endsWith('…'), 'preview should end with …');
    assert.ok(header.length < longTitle.length, 'header should be shorter than input');
    assert.ok(preview.length < longText.length, 'preview should be shorter than input');
  });
  it('uses fallback sender name when blank', () => {
    const m = _buildMessage({ chatId: 'c1', postTitle: 'P', senderName: '', text: 'x' });
    const sender = m.contents.body.contents[0].text;
    assert.equal(sender, 'เพื่อนบ้าน');
  });
});

// ---- onCall wrapper -----------------------------------------------------

function seedHappyPath() {
  chatState['c1'] = {
    participants: ['line:UOWNER', 'line:UBUYER'],
    postTitle: 'Lamp',
  };
  messagesState['c1'] = {
    m1: { senderId: 'line:UBUYER', text: 'hi', timestamp: '2026-05-24T00:00:00Z', isRead: false },
  };
  liffUsersState['UBUYER'] = { lineDisplayName: 'Buyer-san' };
}

describe('notifyMarketplaceChat — onCall wrapper', () => {
  beforeEach(() => {
    resetStubs();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token-xyz';
    assert.equal(typeof callableHandler, 'function', 'onCall handler captured');
  });

  it('rejects unauthenticated callers', async () => {
    await assert.rejects(
      callableHandler({ ...callerUnauth(), data: { chatId: 'c1', messageId: 'm1' } }),
      err => err.code === 'unauthenticated'
    );
  });

  it('rejects missing chatId/messageId', async () => {
    await assert.rejects(
      callableHandler({ ...callerLine('line:UA'), data: {} }),
      err => err.code === 'invalid-argument'
    );
    await assert.rejects(
      callableHandler({ ...callerLine('line:UA'), data: { chatId: 'c1' } }),
      err => err.code === 'invalid-argument'
    );
  });

  it('rejects when chat does not exist', async () => {
    await assert.rejects(
      callableHandler({ ...callerLine('line:UA'), data: { chatId: 'missing', messageId: 'm1' } }),
      err => err.code === 'not-found'
    );
  });

  it('rejects non-participant callers', async () => {
    seedHappyPath();
    await assert.rejects(
      callableHandler({ ...callerLine('line:UATTACKER'), data: { chatId: 'c1', messageId: 'm1' } }),
      err => err.code === 'permission-denied'
    );
  });

  it('rejects when participants is malformed', async () => {
    chatState['c1'] = { participants: ['line:UONE'] };
    messagesState['c1'] = { m1: { senderId: 'line:UONE', text: 'x' } };
    await assert.rejects(
      callableHandler({ ...callerLine('line:UONE'), data: { chatId: 'c1', messageId: 'm1' } }),
      err => err.code === 'failed-precondition'
    );
  });

  it('rejects when message does not exist', async () => {
    seedHappyPath();
    await assert.rejects(
      callableHandler({ ...callerLine('line:UBUYER'), data: { chatId: 'c1', messageId: 'm-missing' } }),
      err => err.code === 'not-found'
    );
  });

  it('rejects when caller is not the message sender (spoofing protection)', async () => {
    seedHappyPath();
    await assert.rejects(
      callableHandler({ ...callerLine('line:UOWNER'), data: { chatId: 'c1', messageId: 'm1' } }),
      err => err.code === 'permission-denied'
    );
  });

  it('pushes a flex message to the non-sender participant on happy path', async () => {
    seedHappyPath();
    const result = await callableHandler({
      ...callerLine('line:UBUYER'),
      data: { chatId: 'c1', messageId: 'm1' },
    });
    assert.deepEqual(result, { sent: 1 });
    assert.equal(pushCalls.length, 1);
    const body = JSON.parse(pushCalls[0].body);
    assert.equal(body.to, 'UOWNER');
    assert.equal(body.messages[0].type, 'flex');
    assert.ok(chatState['c1'].lastNotifyAt['line:UOWNER']);
  });

  it('uses fallback sender name when liffUsers lookup misses', async () => {
    chatState['c1'] = { participants: ['line:UOWNER', 'line:UBUYER'] };
    messagesState['c1'] = { m1: { senderId: 'line:UBUYER', text: 'hi' } };
    // No liffUsers entry → fallback "เพื่อนบ้าน"
    await callableHandler({
      ...callerLine('line:UBUYER'),
      data: { chatId: 'c1', messageId: 'm1' },
    });
    const flex = JSON.parse(pushCalls[0].body).messages[0];
    assert.equal(flex.contents.body.contents[0].text, 'เพื่อนบ้าน');
  });

  it('skips with throttled when last-notify was within throttle window', async () => {
    seedHappyPath();
    chatState['c1'].lastNotifyAt = { 'line:UOWNER': new Date().toISOString() };
    const result = await callableHandler({
      ...callerLine('line:UBUYER'),
      data: { chatId: 'c1', messageId: 'm1' },
    });
    assert.equal(result.sent, 0);
    assert.equal(result.skip, 'throttled');
    assert.equal(pushCalls.length, 0);
  });

  it('allows push when last-notify is older than the throttle window', async () => {
    seedHappyPath();
    const old = new Date(Date.now() - _NOTIFY_THROTTLE_MS - 1000).toISOString();
    chatState['c1'].lastNotifyAt = { 'line:UOWNER': old };
    const result = await callableHandler({
      ...callerLine('line:UBUYER'),
      data: { chatId: 'c1', messageId: 'm1' },
    });
    assert.deepEqual(result, { sent: 1 });
    assert.equal(pushCalls.length, 1);
  });

  it('returns skip when message has no text', async () => {
    chatState['c1'] = { participants: ['line:UA', 'line:UB'] };
    messagesState['c1'] = { m1: { senderId: 'line:UA', text: '' } };
    const result = await callableHandler({
      ...callerLine('line:UA'),
      data: { chatId: 'c1', messageId: 'm1' },
    });
    assert.equal(result.skip, 'no_text');
    assert.equal(pushCalls.length, 0);
  });

  it('returns skip when recipient uid is not line:*', async () => {
    chatState['c1'] = { participants: ['line:UA', 'book:UPROSPECT'] };
    messagesState['c1'] = { m1: { senderId: 'line:UA', text: 'hi' } };
    const result = await callableHandler({
      ...callerLine('line:UA'),
      data: { chatId: 'c1', messageId: 'm1' },
    });
    assert.equal(result.skip, 'non_line_recipient');
    assert.equal(pushCalls.length, 0);
  });

  it('returns skip when LINE_CHANNEL_ACCESS_TOKEN env is missing', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    seedHappyPath();
    const result = await callableHandler({
      ...callerLine('line:UBUYER'),
      data: { chatId: 'c1', messageId: 'm1' },
    });
    assert.equal(result.skip, 'no_token');
    assert.equal(pushCalls.length, 0);
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token-xyz';
  });

  it('logs permanent failure on 4xx (e.g. recipient blocked OA) — no retry', async () => {
    seedHappyPath();
    pushReply = { ok: false, status: 403, text: '{"message":"You have been blocked"}' };
    const result = await callableHandler({
      ...callerLine('line:UBUYER'),
      data: { chatId: 'c1', messageId: 'm1' },
    });
    assert.deepEqual(result, { sent: 0, permanentError: 403 });
    assert.equal(retryCalls.length, 0);
  });

  it('enqueues retry on 5xx', async () => {
    seedHappyPath();
    pushReply = { ok: false, status: 502, text: 'Bad Gateway' };
    const result = await callableHandler({
      ...callerLine('line:UBUYER'),
      data: { chatId: 'c1', messageId: 'm1' },
    });
    assert.deepEqual(result, { sent: 0, retryEnqueued: true });
    assert.equal(retryCalls.length, 1);
    assert.equal(retryCalls[0].lineUserId, 'UOWNER');
    assert.equal(retryCalls[0].idempotencyKey, 'chat-c1-m1');
    assert.equal(retryCalls[0].context.source, 'notifyMarketplaceChat');
  });

  it('enqueues retry on network exception', async () => {
    seedHappyPath();
    pushReply = () => { throw new Error('ECONNRESET'); };
    const result = await callableHandler({
      ...callerLine('line:UBUYER'),
      data: { chatId: 'c1', messageId: 'm1' },
    });
    assert.deepEqual(result, { sent: 0, retryEnqueued: true });
    assert.equal(retryCalls.length, 1);
    assert.ok(retryCalls[0].error.includes('ECONNRESET'));
  });
});
