'use strict';

/**
 * Unit tests for the content-hash asset pipeline (tools/asset-hash.js).
 * Pure-function gate for the build.js hashing step — proves determinism,
 * all-prefix rewrite, defer/attr preservation, and that a missed rewrite is
 * caught (→ red build, never a prod 404). Run via `npm run test:shared`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  contentHash,
  hashedName,
  isHashable,
  computeAssetManifest,
  rewriteHtmlRefs,
  findDanglingRefs,
} = require('../../tools/asset-hash.js');

// ── contentHash ──────────────────────────────────────────────────────────
test('contentHash is 8 hex chars and deterministic for identical bytes', () => {
  const a = contentHash('console.log(1)');
  const b = contentHash('console.log(1)');
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, b); // same bytes → same hash → cache survives across deploys
});

test('contentHash differs when bytes differ', () => {
  assert.notEqual(contentHash('a'), contentHash('b'));
});

test('contentHash accepts Buffer and string equivalently', () => {
  assert.equal(contentHash('xyz'), contentHash(Buffer.from('xyz')));
});

// ── hashedName ───────────────────────────────────────────────────────────
test('hashedName infixes only the trailing .js/.css, preserving dir + multi-dot', () => {
  assert.equal(hashedName('shared/foo.js', 'a1b2c3d4'), 'shared/foo.a1b2c3d4.js');
  assert.equal(hashedName('accounting/tax-export.js', 'deadbeef'), 'accounting/tax-export.deadbeef.js');
  assert.equal(hashedName('shared/a.min.js', '00112233'), 'shared/a.min.00112233.js');
  assert.equal(hashedName('shared/brand.css', 'a1b2c3d4'), 'shared/brand.a1b2c3d4.css');
  assert.equal(hashedName('shared/legal-page.css', 'deadbeef'), 'shared/legal-page.deadbeef.css');
});

// ── isHashable ───────────────────────────────────────────────────────────
test('isHashable: shared/ + accounting/ .js or .css; excludes __tests__, *.input.css, non-asset', () => {
  assert.equal(isHashable('shared/utils.js'), true);
  assert.equal(isHashable('accounting/tax-filing.js'), true);
  assert.equal(isHashable('shared/brand.css'), true);        // CSS now hashed (§7-MM fix)
  assert.equal(isHashable('shared/components.css'), true);
  assert.equal(isHashable('shared/tailwind.css'), true);     // compiled output IS linked
  assert.equal(isHashable('shared\\utils.js'), true); // Windows backslash normalised
  assert.equal(isHashable('shared\\brand.css'), true);
  assert.equal(isHashable('shared/__tests__/utils.test.js'), false); // dev-only
  assert.equal(isHashable('shared/tailwind.input.css'), false); // Tailwind SOURCE — never linked
  assert.equal(isHashable('shared/bg/nest-day.webp'), false);
  assert.equal(isHashable('functions/index.js'), false); // not a hashable dir
  assert.equal(isHashable('service-worker.js'), false);
});

// ── computeAssetManifest ─────────────────────────────────────────────────
test('computeAssetManifest maps each file to its hashed name via reader bytes', () => {
  const bytes = { 'shared/a.js': 'AAA', 'accounting/b.js': 'BBB' };
  const manifest = computeAssetManifest(Object.keys(bytes), (f) => bytes[f]);
  assert.equal(manifest['shared/a.js'], hashedName('shared/a.js', contentHash('AAA')));
  assert.equal(manifest['accounting/b.js'], hashedName('accounting/b.js', contentHash('BBB')));
});

test('computeAssetManifest normalises backslash paths', () => {
  const manifest = computeAssetManifest(['shared\\a.js'], () => 'X');
  assert.ok(manifest['shared/a.js']); // keyed forward-slash
});

// ── rewriteHtmlRefs ──────────────────────────────────────────────────────
const MANIFEST = {
  'shared/utils.js': 'shared/utils.aaaaaaaa.js',
  'shared/audit.js': 'shared/audit.bbbbbbbb.js',
  'accounting/tax-filing.js': 'accounting/tax-filing.cccccccc.js',
  'shared/brand.css': 'shared/brand.dddddddd.css',
  'shared/components.css': 'shared/components.eeeeeeee.css',
};

test('rewriteHtmlRefs handles ./, bare, and / prefixes — prefix preserved', () => {
  assert.equal(
    rewriteHtmlRefs('<script src="./shared/utils.js" defer></script>', MANIFEST),
    '<script src="./shared/utils.aaaaaaaa.js" defer></script>'
  );
  assert.equal(
    rewriteHtmlRefs('<script src="shared/utils.js"></script>', MANIFEST),
    '<script src="shared/utils.aaaaaaaa.js"></script>'
  );
  assert.equal(
    rewriteHtmlRefs('<script src="/shared/utils.js"></script>', MANIFEST),
    '<script src="/shared/utils.aaaaaaaa.js"></script>'
  );
});

test('rewriteHtmlRefs preserves defer and attribute order on both sides of src', () => {
  assert.equal(
    rewriteHtmlRefs('<script defer src="./shared/audit.js"></script>', MANIFEST),
    '<script defer src="./shared/audit.bbbbbbbb.js"></script>'
  );
});

test('rewriteHtmlRefs rewrites accounting refs too', () => {
  assert.equal(
    rewriteHtmlRefs('<script src="./accounting/tax-filing.js" defer></script>', MANIFEST),
    '<script src="./accounting/tax-filing.cccccccc.js" defer></script>'
  );
});

test('rewriteHtmlRefs rewrites every occurrence in a multi-script doc', () => {
  const html = '<script src="./shared/utils.js"></script>\n<script src="./shared/audit.js" defer></script>';
  const out = rewriteHtmlRefs(html, MANIFEST);
  assert.ok(out.includes('shared/utils.aaaaaaaa.js'));
  assert.ok(out.includes('shared/audit.bbbbbbbb.js'));
  assert.ok(!/shared\/utils\.js"/.test(out));
});

test('rewriteHtmlRefs does NOT touch data-src or unrelated attributes', () => {
  const html = '<img data-src="./shared/utils.js">'; // not a script load
  assert.equal(rewriteHtmlRefs(html, MANIFEST), html);
});

test('rewriteHtmlRefs leaves refs absent from the manifest untouched (gate will flag)', () => {
  const html = '<script src="./shared/unknown.js"></script>';
  assert.equal(rewriteHtmlRefs(html, MANIFEST), html);
});

test('rewriteHtmlRefs does not match a prefix-collision sibling', () => {
  // shared/audit.js must not rewrite inside shared/audit-log.js
  const html = '<script src="./shared/audit-log.js"></script>';
  assert.equal(rewriteHtmlRefs(html, MANIFEST), html); // audit-log not in manifest → untouched
});

// ── rewriteHtmlRefs: <link href> CSS (§7-MM cache-bust) ──────────────────
test('rewriteHtmlRefs rewrites <link href> .css with ./, bare, and / prefixes — rel preserved', () => {
  assert.equal(
    rewriteHtmlRefs('<link rel="stylesheet" href="./shared/brand.css">', MANIFEST),
    '<link rel="stylesheet" href="./shared/brand.dddddddd.css">'
  );
  assert.equal(
    rewriteHtmlRefs('<link rel="stylesheet" href="shared/brand.css">', MANIFEST),
    '<link rel="stylesheet" href="shared/brand.dddddddd.css">'
  );
  assert.equal(
    rewriteHtmlRefs('<link rel="stylesheet" href="/shared/components.css">', MANIFEST),
    '<link rel="stylesheet" href="/shared/components.eeeeeeee.css">'
  );
});

test('rewriteHtmlRefs leaves cross-origin CDN stylesheets untouched', () => {
  const html = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">';
  assert.equal(rewriteHtmlRefs(html, MANIFEST), html);
});

test('rewriteHtmlRefs does NOT touch data-href, and leaves a .css absent from the manifest', () => {
  assert.equal(rewriteHtmlRefs('<div data-href="./shared/brand.css"></div>', MANIFEST), '<div data-href="./shared/brand.css"></div>');
  assert.equal(rewriteHtmlRefs('<link href="./shared/unknown.css">', MANIFEST), '<link href="./shared/unknown.css">');
});

test('rewriteHtmlRefs handles JS + CSS refs in the same document', () => {
  const html = '<link rel="stylesheet" href="/shared/brand.css">\n<script src="./shared/utils.js" defer></script>';
  const out = rewriteHtmlRefs(html, MANIFEST);
  assert.ok(out.includes('/shared/brand.dddddddd.css'));
  assert.ok(out.includes('./shared/utils.aaaaaaaa.js'));
});

// ── findDanglingRefs (the build-red safety gate) ─────────────────────────
test('findDanglingRefs: clean when every ref is an emitted hashed path', () => {
  const emitted = new Set(Object.values(MANIFEST));
  const docs = [
    { file: 'a.html', html: '<script src="./shared/utils.aaaaaaaa.js"></script>' },
    { file: 'b.html', html: '<script src="/accounting/tax-filing.cccccccc.js"></script>' },
  ];
  assert.deepEqual(findDanglingRefs(docs, emitted), []);
});

test('findDanglingRefs: flags a surviving plain (un-rewritten) ref', () => {
  const emitted = new Set(Object.values(MANIFEST));
  const docs = [{ file: 'a.html', html: '<script src="./shared/utils.js"></script>' }];
  const problems = findDanglingRefs(docs, emitted);
  assert.equal(problems.length, 1);
  assert.deepEqual(problems[0], { file: 'a.html', ref: 'shared/utils.js' });
});

test('findDanglingRefs: flags a hashed ref with no matching emitted file', () => {
  const emitted = new Set(['shared/utils.aaaaaaaa.js']);
  const docs = [{ file: 'a.html', html: '<script src="./shared/audit.99999999.js"></script>' }];
  const problems = findDanglingRefs(docs, emitted);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].ref, 'shared/audit.99999999.js');
});

test('findDanglingRefs: flags a surviving plain (un-rewritten) <link href> .css', () => {
  const emitted = new Set(Object.values(MANIFEST));
  const docs = [{ file: 'a.html', html: '<link rel="stylesheet" href="./shared/brand.css">' }];
  const problems = findDanglingRefs(docs, emitted);
  assert.equal(problems.length, 1);
  assert.deepEqual(problems[0], { file: 'a.html', ref: 'shared/brand.css' });
});

test('findDanglingRefs: clean when CSS + JS refs are all emitted hashed paths', () => {
  const emitted = new Set(Object.values(MANIFEST));
  const docs = [{
    file: 'a.html',
    html: '<link rel="stylesheet" href="/shared/brand.dddddddd.css"><script src="./shared/utils.aaaaaaaa.js"></script>',
  }];
  assert.deepEqual(findDanglingRefs(docs, emitted), []);
});

test('end-to-end: manifest → rewrite → verify is clean (JS + CSS)', () => {
  const bytes = { 'shared/a.js': 'AAA', 'accounting/b.js': 'BBB', 'shared/brand.css': 'CCC' };
  const manifest = computeAssetManifest(Object.keys(bytes), (f) => bytes[f]);
  const srcHtml = '<link rel="stylesheet" href="/shared/brand.css">\n<script src="./shared/a.js" defer></script>\n<script src="accounting/b.js"></script>';
  const out = rewriteHtmlRefs(srcHtml, manifest);
  const emitted = new Set(Object.values(manifest));
  assert.deepEqual(findDanglingRefs([{ file: 'x.html', html: out }], emitted), []);
});
