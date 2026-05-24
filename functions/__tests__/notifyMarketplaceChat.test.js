/**
 * Unit tests for notifyMarketplaceChat — Sprint 2 LINE OA notification.
 *
 * Coverage:
 *   - pure helpers: stripLinePrefix, buildMessage (deep-link, truncation)
 *   - trigger: happy path push + lastNotifyAt write
 *   - throttle: skip when last push < 30s ago; allow when ≥ 30s ago
 *   - skip paths: missing senderId/text, missing token, chat not found,
 *     non-line: recipient uid, self-notify, blocked OA (4xx)
 *   - transient failure (5xx, network): enqueueLineRetry called
 *   - sender display name: liffUsers lookup w/ fallback
 */
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

let chatState;        // { [chatId]: data }
let liffUsersState;   // { [lineUserId]: data }
let lastSetCall;      // { chatId, patch, opts }
let pushCalls;        // [{ url, body }]
let pushReply;        // { ok, status, text } per call
let retryCalls;       // [{ ...arg }]
let onCreateHandler = null;

function resetStubs() {
  chatState = {};
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
            doc: (chatId) => ({
              get: async () => ({
                exists: chatId in chatState,
                data: () => chatState[chatId],
              }),
              set: async (patch, opts) => {
                lastSetCall = { chatId, patch, opts };
                // Apply the merge so subsequent gets see the value.
                const cur = chatState[chatId] || {};
                if (patch.lastNotifyAt && typeof patch.lastNotifyAt === 'object') {
                  cur.lastNotifyAt = { ...(cur.lastNotifyAt || {}), ...patch.lastNotifyAt };
                }
                chatState[chatId] = cur;
              },
            }),
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
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
    };
  }
  if (id === 'firebase-functions/v1') {
    const region = () => ({
      runWith: () => ({
        firestore: {
          document: () => ({
            onCreate: (h) => { onCreateHandler = h; return h; },
          }),
        },
      }),
    });
    return { region };
  }
  if (id === './_lineRetry') {
    return {
      enqueueLineRetry: async (arg) => { retryCalls.push(arg); },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

after(() => {
  Module._load = _origLoad;
  if (origFetch === null) delete global.fetch;
  else global.fetch = origFetch;
});

// Mock fetch globally — undici/fetch is what firebase-functions runtime uses.
let origFetch = typeof global.fetch === 'function' ? global.fetch : null;
global.fetch = async (url, opts) => {
  pushCalls.push({ url, body: opts?.body });
  if (typeof pushReply === 'function') return pushReply();
  return {
    ok: pushReply.ok,
    status: pushReply.status,
    text: async () => pushReply.text || '',
  };
};

// Set token before module loads so the env-check passes.
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token-xyz';

delete require.cache[require.resolve('../notifyMarketplaceChat.js')];
const mod = require('../notifyMarketplaceChat.js');
const { _stripLinePrefix, _buildMessage, _NOTIFY_THROTTLE_MS } = mod;

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

// ---- onCreate trigger ---------------------------------------------------

function fakeSnap(data) {
  return { data: () => data };
}
function ctx(chatId, messageId) {
  return { params: { chatId, messageId } };
}

describe('notifyMarketplaceChat — onCreate trigger', () => {
  beforeEach(() => {
    resetStubs();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token-xyz';
    assert.equal(typeof onCreateHandler, 'function', 'onCreate handler captured');
  });

  it('pushes a flex message to the non-sender participant on happy path', async () => {
    chatState['c1'] = {
      participants: ['line:UOWNER', 'line:UBUYER'],
      postTitle: 'Lamp',
    };
    liffUsersState['UBUYER'] = { lineDisplayName: 'Buyer-san' };
    const result = await onCreateHandler(
      fakeSnap({ senderId: 'line:UBUYER', text: 'hi' }),
      ctx('c1', 'm1')
    );
    assert.deepEqual(result, { sent: 1 });
    assert.equal(pushCalls.length, 1);
    const body = JSON.parse(pushCalls[0].body);
    assert.equal(body.to, 'UOWNER');
    assert.equal(body.messages[0].type, 'flex');
    // lastNotifyAt for the recipient should now be set.
    assert.ok(chatState['c1'].lastNotifyAt['line:UOWNER']);
  });

  it('uses fallback sender name when liffUsers lookup misses', async () => {
    chatState['c1'] = { participants: ['line:UOWNER', 'line:UBUYER'] };
    // No liffUsers entry → fallback "เพื่อนบ้าน"
    await onCreateHandler(
      fakeSnap({ senderId: 'line:UBUYER', text: 'hi' }),
      ctx('c1', 'm1')
    );
    const flex = JSON.parse(pushCalls[0].body).messages[0];
    assert.equal(flex.contents.body.contents[0].text, 'เพื่อนบ้าน');
  });

  it('skips when last-notify to this recipient was within throttle window', async () => {
    const justNow = new Date().toISOString();
    chatState['c1'] = {
      participants: ['line:UOWNER', 'line:UBUYER'],
      lastNotifyAt: { 'line:UOWNER': justNow },
    };
    const result = await onCreateHandler(
      fakeSnap({ senderId: 'line:UBUYER', text: 'hi' }),
      ctx('c1', 'm1')
    );
    assert.equal(result, null);
    assert.equal(pushCalls.length, 0);
  });

  it('allows push when last-notify is older than the throttle window', async () => {
    const old = new Date(Date.now() - _NOTIFY_THROTTLE_MS - 1000).toISOString();
    chatState['c1'] = {
      participants: ['line:UOWNER', 'line:UBUYER'],
      lastNotifyAt: { 'line:UOWNER': old },
    };
    const result = await onCreateHandler(
      fakeSnap({ senderId: 'line:UBUYER', text: 'hi' }),
      ctx('c1', 'm1')
    );
    assert.deepEqual(result, { sent: 1 });
    assert.equal(pushCalls.length, 1);
  });

  it('skips when the chat doc does not exist', async () => {
    const result = await onCreateHandler(
      fakeSnap({ senderId: 'line:UBUYER', text: 'hi' }),
      ctx('missing', 'm1')
    );
    assert.equal(result, null);
    assert.equal(pushCalls.length, 0);
  });

  it('skips when participants is not [a, b]', async () => {
    chatState['c1'] = { participants: ['line:UONLY'] };
    const result = await onCreateHandler(
      fakeSnap({ senderId: 'line:UONLY', text: 'hi' }),
      ctx('c1', 'm1')
    );
    assert.equal(result, null);
    assert.equal(pushCalls.length, 0);
  });

  it('skips when recipient uid is not line:*', async () => {
    chatState['c1'] = { participants: ['line:USENDER', 'book:UPROSPECT'] };
    const result = await onCreateHandler(
      fakeSnap({ senderId: 'line:USENDER', text: 'hi' }),
      ctx('c1', 'm1')
    );
    assert.equal(result, null);
    assert.equal(pushCalls.length, 0);
  });

  it('skips when message has no senderId or text', async () => {
    chatState['c1'] = { participants: ['line:UA', 'line:UB'] };
    assert.equal(await onCreateHandler(fakeSnap({ text: 'x' }), ctx('c1', 'm1')), null);
    assert.equal(await onCreateHandler(fakeSnap({ senderId: 'line:UA' }), ctx('c1', 'm2')), null);
    assert.equal(pushCalls.length, 0);
  });

  it('skips when LINE_CHANNEL_ACCESS_TOKEN env is missing', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    chatState['c1'] = { participants: ['line:UA', 'line:UB'] };
    const result = await onCreateHandler(
      fakeSnap({ senderId: 'line:UA', text: 'hi' }),
      ctx('c1', 'm1')
    );
    assert.equal(result, null);
    assert.equal(pushCalls.length, 0);
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token-xyz';  // restore
  });

  it('logs permanent failure on 4xx (e.g. recipient blocked OA) — no retry', async () => {
    chatState['c1'] = { participants: ['line:UA', 'line:UB'] };
    pushReply = { ok: false, status: 403, text: '{"message":"You have been blocked"}' };
    const result = await onCreateHandler(
      fakeSnap({ senderId: 'line:UA', text: 'hi' }),
      ctx('c1', 'm1')
    );
    assert.deepEqual(result, { sent: 0, permanentError: 403 });
    assert.equal(retryCalls.length, 0);
  });

  it('enqueues retry on 5xx', async () => {
    chatState['c1'] = { participants: ['line:UA', 'line:UB'] };
    pushReply = { ok: false, status: 502, text: 'Bad Gateway' };
    const result = await onCreateHandler(
      fakeSnap({ senderId: 'line:UA', text: 'hi' }),
      ctx('c1', 'm1')
    );
    assert.deepEqual(result, { sent: 0, retryEnqueued: true });
    assert.equal(retryCalls.length, 1);
    assert.equal(retryCalls[0].lineUserId, 'UB');
    assert.equal(retryCalls[0].idempotencyKey, 'chat-c1-m1');
    assert.equal(retryCalls[0].context.source, 'notifyMarketplaceChat');
  });

  it('enqueues retry on network exception', async () => {
    chatState['c1'] = { participants: ['line:UA', 'line:UB'] };
    pushReply = () => { throw new Error('ECONNRESET'); };
    const result = await onCreateHandler(
      fakeSnap({ senderId: 'line:UA', text: 'hi' }),
      ctx('c1', 'm1')
    );
    assert.deepEqual(result, { sent: 0, retryEnqueued: true });
    assert.equal(retryCalls.length, 1);
    assert.ok(retryCalls[0].error.includes('ECONNRESET'));
  });
});
