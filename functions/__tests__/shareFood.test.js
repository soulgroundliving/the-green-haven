/**
 * Unit tests for shareFood — a tenant posts leftover food. Covers: server-set
 * sharerUid (anti-spoof), available status, server-computed future expiresAt,
 * portions/category, auth + rate-limit guards.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let added, rateLimitCalls, updated, uploads, deletes, uploadShouldThrow;

function reset() { added = []; rateLimitCalls = []; updated = []; uploads = []; deletes = []; uploadShouldThrow = false; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'foodShares') {
          return { add: async (doc) => {
            added.push(doc);
            const id2 = `share-${added.length}`;
            return { id: id2, update: async (patch) => { updated.push({ id: id2, patch }); } };
          } };
        }
        throw new Error('unexpected collection: ' + name);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    firestoreFn.Timestamp = { fromMillis: (ms) => ({ _ms: ms, toMillis: () => ms }) };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    const chain = { runWith: () => chain, https: { onCall: (h) => h } };
    return { region: () => chain, https: { HttpsError } };
  }
  if (id === './_rateLimit') {
    return { checkRateLimit: async (uid, action, max, win) => { rateLimitCalls.push([uid, action, max, win]); } };
  }
  if (id === './_foodImage') {
    const TYPES = { 'image/jpeg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp' };
    return {
      MAX_IMAGE_BYTES: 1024,   // small ceiling so the oversize branch is testable without a 4MB buffer
      normalizeImageContentType: (ct) => TYPES[String(ct == null ? '' : ct).toLowerCase().trim()] || null,
      decodeImageBuffer: (b64) => {
        const s = String(b64 == null ? '' : b64);
        const raw = (s.indexOf('base64,') >= 0 ? s.slice(s.indexOf('base64,') + 7) : s).trim();
        if (!raw) return null;
        const buf = Buffer.from(raw, 'base64');
        return buf && buf.length ? buf : null;
      },
      uploadFoodImage: async (shareId, buf, ct) => {
        uploads.push({ shareId, ct, len: buf.length });
        if (uploadShouldThrow) throw new Error('storage down');
        return { imageUrl: `https://fake/${shareId}`, imagePath: `foodShares/${shareId}/photo.jpg` };
      },
      deleteFoodImagesForShare: async (shareId) => { deletes.push(shareId); return 1; },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { shareFood: handler } = require('../shareFood');

after(() => { Module._load = _origLoad; });

function tenantCtx(room = '101', building = 'rooms', uid = 'line:Utenant') {
  return { auth: { uid, token: { room, building } } };
}

describe('shareFood — create', () => {
  beforeEach(reset);

  it('creates an available share with the server-set sharerUid + a future expiresAt', async () => {
    const r = await handler(
      { building: 'rooms', roomId: '101', title: '  ข้าวกล่อง 2 กล่อง  ', detail: 'มารับได้เลย', category: 'meal', portions: 2, expiresInHours: 6, sharerName: 'สมชาย', sharerUid: 'line:Uattacker' },
      tenantCtx(),
    );
    assert.equal(r.success, true);
    assert.equal(r.shareId, 'share-1');
    assert.ok(r.expiresAt > Date.now(), 'expiresAt is in the future');
    const doc = added[0];
    assert.equal(doc.sharerUid, 'line:Utenant', 'sharerUid from auth, not the spoofed field');
    assert.equal(doc.status, 'available');
    assert.equal(doc.title, 'ข้าวกล่อง 2 กล่อง', 'trimmed');
    assert.equal(doc.category, 'meal');
    assert.equal(doc.portions, 2);
    assert.equal(doc.sharerTenantId, 'rooms_101');
    assert.equal(doc.sharerName, 'สมชาย');
    assert.equal(doc.claimerUid, null);
    assert.ok(doc.expiresAt && typeof doc.expiresAt.toMillis === 'function', 'expiresAt is a Timestamp');
    assert.deepEqual(rateLimitCalls[0], ['line:Utenant', 'shareFood', 5, 86400]);
  });

  it('defaults: no category/portions, canonical building, fallback name, 24h expiry', async () => {
    await handler({ building: 'NEST', roomId: 'N12', title: 'ผลไม้รวม' }, tenantCtx('N12', 'nest'));
    assert.equal(added[0].building, 'nest');
    assert.equal(added[0].sharerName, 'ห้อง N12');
    assert.equal(added[0].category, null);
    assert.equal(added[0].portions, null);
    const ms = added[0].expiresAt.toMillis();
    assert.ok(ms > Date.now() + 23 * 3600 * 1000 && ms < Date.now() + 25 * 3600 * 1000, '~24h default expiry');
  });
});

describe('shareFood — guards', () => {
  beforeEach(reset);

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', title: 'x' }, { auth: null }),
      (e) => e.code === 'unauthenticated');
  });
  it('missing building/roomId → invalid-argument', async () => {
    await assert.rejects(() => handler({ title: 'x' }, tenantCtx()), (e) => e.code === 'invalid-argument');
  });
  it('blank title → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', title: '   ' }, tenantCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('unknown building → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'amazon', roomId: '1', title: 'x' }, tenantCtx('1', 'amazon')),
      (e) => e.code === 'invalid-argument');
  });
  it('bad category → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', title: 'x', category: 'tool' }, tenantCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('claim mismatch (wrong room) → permission-denied', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '999', title: 'x' }, tenantCtx('101', 'rooms')),
      (e) => e.code === 'permission-denied' || e.code === 'internal',
    );
  });
});

describe('shareFood — optional photo', () => {
  beforeEach(reset);

  const b64 = (bytes) => Buffer.alloc(bytes, 0x41).toString('base64');

  it('uploads the photo and writes the URL back to the doc (created null-first)', async () => {
    const r = await handler(
      { building: 'rooms', roomId: '101', title: 'ข้าวกล่อง', photoBase64: b64(50), photoContentType: 'image/jpeg' },
      tenantCtx(),
    );
    assert.equal(r.success, true);
    assert.equal(r.hasImage, true);
    assert.equal(added[0].imageUrl, null, 'doc created with null imageUrl first');
    assert.equal(added[0].imagePath, null);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].shareId, 'share-1');
    assert.equal(updated.length, 1);
    assert.equal(updated[0].patch.imageUrl, 'https://fake/share-1');
    assert.equal(updated[0].patch.imagePath, 'foodShares/share-1/photo.jpg');
  });

  it('rejects an unsupported image type BEFORE creating the doc', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '101', title: 'x', photoBase64: b64(50), photoContentType: 'image/gif' }, tenantCtx()),
      (e) => e.code === 'invalid-argument',
    );
    assert.equal(added.length, 0, 'no doc on bad photo type');
    assert.equal(uploads.length, 0);
  });

  it('rejects an oversized photo BEFORE creating the doc', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '101', title: 'x', photoBase64: b64(2048), photoContentType: 'image/jpeg' }, tenantCtx()),
      (e) => e.code === 'invalid-argument',
    );
    assert.equal(added.length, 0);
    assert.equal(uploads.length, 0);
  });

  it('still posts (text-only) when the upload fails — photo is best-effort', async () => {
    uploadShouldThrow = true;
    const r = await handler(
      { building: 'rooms', roomId: '101', title: 'ผลไม้', photoBase64: b64(50), photoContentType: 'image/jpeg' },
      tenantCtx(),
    );
    assert.equal(r.success, true);
    assert.equal(r.hasImage, false, 'photo failed but the share posted');
    assert.equal(added.length, 1);
    assert.equal(uploads.length, 1);
    assert.equal(updated.length, 0, 'no URL written back');
  });

  it('no photo → no upload, hasImage false', async () => {
    const r = await handler({ building: 'rooms', roomId: '101', title: 'ขนมปัง' }, tenantCtx());
    assert.equal(r.hasImage, false);
    assert.equal(uploads.length, 0);
    assert.equal(updated.length, 0);
  });
});
