/**
 * Unit tests for _foodImage — the optional-photo helper for the Food sharing feed
 * (Meaning Layer #4). Covers the pure validators/decoders + the Admin-SDK upload
 * (path + tokenised URL shape) + the prefix-delete cleanup. Storage is stubbed via
 * Module._load (no real bucket).
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

let state;
function reset() {
  state = { saved: [], deleted: [], files: [], getFilesError: null, bucketName: 'gh-test.appspot.com' };
}
reset();

const bucket = {
  get name() { return state.bucketName; },
  file: (p) => ({
    save: async (buf, opts) => { state.saved.push({ path: p, buf, opts }); },
    delete: async () => { state.deleted.push(p); },
  }),
  getFiles: async () => {
    if (state.getFilesError) throw state.getFilesError;
    return [state.files.map((name) => ({ name, delete: async () => { state.deleted.push(name); } }))];
  },
};

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    return { apps: [{}], initializeApp: () => {}, storage: () => ({ bucket: () => bucket }) };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const fi = require('../_foodImage');

after(() => { Module._load = _origLoad; });

describe('_foodImage — pure validators', () => {
  it('normalizeImageContentType: known types pass (case-insensitive), unknown → null', () => {
    assert.equal(fi.normalizeImageContentType('image/jpeg'), 'image/jpeg');
    assert.equal(fi.normalizeImageContentType('IMAGE/JPEG'), 'image/jpeg');
    assert.equal(fi.normalizeImageContentType('image/png'), 'image/png');
    assert.equal(fi.normalizeImageContentType('image/webp'), 'image/webp');
    assert.equal(fi.normalizeImageContentType('image/gif'), null);
    assert.equal(fi.normalizeImageContentType('application/pdf'), null);
    assert.equal(fi.normalizeImageContentType(''), null);
    assert.equal(fi.normalizeImageContentType(null), null);
  });

  it('imageExtForType maps to the right extension', () => {
    assert.equal(fi.imageExtForType('image/jpeg'), 'jpg');
    assert.equal(fi.imageExtForType('image/png'), 'png');
    assert.equal(fi.imageExtForType('image/webp'), 'webp');
    assert.equal(fi.imageExtForType('image/gif'), null);
  });

  it('stripDataUrlPrefix removes a data: prefix but leaves bare base64 (§7-EEE)', () => {
    assert.equal(fi.stripDataUrlPrefix('data:image/jpeg;base64,QUJD'), 'QUJD');
    assert.equal(fi.stripDataUrlPrefix('QUJD'), 'QUJD');
    assert.equal(fi.stripDataUrlPrefix(''), '');
    assert.equal(fi.stripDataUrlPrefix(null), '');
  });

  it('decodeImageBuffer decodes valid base64 (both bare + data URL) and rejects empty', () => {
    const b1 = fi.decodeImageBuffer(Buffer.from('hello').toString('base64'));
    assert.ok(Buffer.isBuffer(b1));
    assert.equal(b1.toString(), 'hello');
    const b2 = fi.decodeImageBuffer('data:image/jpeg;base64,' + Buffer.from('hi').toString('base64'));
    assert.equal(b2.toString(), 'hi');
    assert.equal(fi.decodeImageBuffer(''), null);
    assert.equal(fi.decodeImageBuffer('   '), null);
    assert.equal(fi.decodeImageBuffer(null), null);
  });
});

describe('_foodImage — uploadFoodImage', () => {
  beforeEach(reset);

  it('saves under foodShares/{id}/photo_1.{ext} (default index) and builds a tokenised https URL', async () => {
    const buf = Buffer.from('JPEGBYTES');
    const { imageUrl, imagePath } = await fi.uploadFoodImage('share-1', buf, 'image/jpeg');
    assert.equal(imagePath, 'foodShares/share-1/photo_1.jpg');
    assert.equal(state.saved.length, 1);
    assert.equal(state.saved[0].path, 'foodShares/share-1/photo_1.jpg');
    assert.equal(state.saved[0].opts.contentType, 'image/jpeg');
    assert.equal(state.saved[0].opts.resumable, false);
    const token = state.saved[0].opts.metadata.metadata.firebaseStorageDownloadTokens;
    assert.ok(token && token.length >= 8, 'a download token was set in metadata');
    assert.ok(
      imageUrl.startsWith('https://firebasestorage.googleapis.com/v0/b/gh-test.appspot.com/o/'),
      'points at our bucket',
    );
    assert.ok(imageUrl.includes(encodeURIComponent('foodShares/share-1/photo_1.jpg')), 'encodes the path');
    assert.ok(imageUrl.includes('alt=media&token=' + token), 'URL carries the same token');
  });

  it('uses the index for the filename (multi-photo shares)', async () => {
    await fi.uploadFoodImage('s9', Buffer.from('x'), 'image/jpeg', 3);
    assert.equal(state.saved[0].path, 'foodShares/s9/photo_3.jpg');
  });

  it('uses the right extension for png/webp', async () => {
    await fi.uploadFoodImage('s2', Buffer.from('x'), 'image/png');
    assert.equal(state.saved[0].path, 'foodShares/s2/photo_1.png');
    reset();
    await fi.uploadFoodImage('s3', Buffer.from('x'), 'image/webp', 2);
    assert.equal(state.saved[0].path, 'foodShares/s3/photo_2.webp');
  });

  it('exposes MAX_IMAGES = 5', () => {
    assert.equal(fi.MAX_IMAGES, 5);
  });

  it('throws on unsupported type / empty buffer / missing id', async () => {
    await assert.rejects(() => fi.uploadFoodImage('s', Buffer.from('x'), 'image/gif'), /unsupported/);
    await assert.rejects(() => fi.uploadFoodImage('s', Buffer.alloc(0), 'image/jpeg'), /empty/);
    await assert.rejects(() => fi.uploadFoodImage('', Buffer.from('x'), 'image/jpeg'), /shareId/);
    assert.equal(state.saved.length, 0);
  });
});

describe('_foodImage — deleteFoodImagesForShare', () => {
  beforeEach(reset);

  it('deletes every file under foodShares/{id}/ and returns the count', async () => {
    state.files = ['foodShares/share-9/photo.jpg'];
    const n = await fi.deleteFoodImagesForShare('share-9');
    assert.equal(n, 1);
    assert.deepEqual(state.deleted, ['foodShares/share-9/photo.jpg']);
  });

  it('returns 0 when there are no files and never throws on getFiles error', async () => {
    assert.equal(await fi.deleteFoodImagesForShare('none'), 0);
    state.getFilesError = new Error('IAM blip');
    assert.equal(await fi.deleteFoodImagesForShare('boom'), 0);
    assert.equal(await fi.deleteFoodImagesForShare(''), 0);
  });
});
