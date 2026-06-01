'use strict';

/**
 * Content-hash asset pipeline for `shared/*.js` + `accounting/*.js`.
 *
 * Pure, dependency-light helpers used by build.js (Vercel-only) so the
 * hashing / HTML-rewrite / dangling-ref verification logic is unit-testable
 * without running the in-place build against the real repo. Keeping these
 * out of build.js lets `npm run test:shared` lock the behaviour
 * (determinism, all-prefix rewrite, defer preserved, dangling = build-red).
 *
 * Why content-hash filenames: the deployed JS is served `immutable` so a
 * returning visitor never re-downloads an unchanged file. A changed file gets
 * a new hash → new URL → impossible to serve stale (strictly safer than the
 * previous `no-cache`). esbuild minify is deterministic, so an unchanged
 * source yields the same hash across deploys and the browser keeps its cache.
 *
 * Scope note: `shared/__tests__/**` is dev-only (never referenced by shipped
 * HTML) and is excluded by {@link isHashable}. `shared/bg/**` is images only.
 */

const crypto = require('crypto');

const HASH_LEN = 8;

/** Directories whose `.js` files participate in content-hashing. */
const HASHABLE_DIRS = ['shared', 'accounting'];

/**
 * 8-char hex content hash of the emitted (minified) bytes — the exact bytes
 * the browser caches, so the hash must be computed AFTER minification.
 * @param {Buffer|string} bytes
 * @returns {string}
 */
function contentHash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, HASH_LEN);
}

/**
 * `shared/foo.js` + `a1b2c3d4` → `shared/foo.a1b2c3d4.js`. Only the trailing
 * `.js` is infixed, so sub-dirs and multi-dot basenames are preserved.
 * @param {string} logicalPath repo-relative, forward-slash
 * @param {string} hash
 * @returns {string}
 */
function hashedName(logicalPath, hash) {
  return logicalPath.replace(/\.js$/, `.${hash}.js`);
}

/**
 * True for a repo-relative path that should be content-hashed:
 * under shared/ or accounting/, a `.js` file, and NOT a test file.
 * @param {string} file
 * @returns {boolean}
 */
function isHashable(file) {
  const norm = String(file).replace(/\\/g, '/');
  if (!norm.endsWith('.js')) return false;
  if (norm.includes('/__tests__/')) return false;
  return new RegExp(`^(?:${HASHABLE_DIRS.join('|')})/`).test(norm);
}

/**
 * Build `{ 'shared/X.js': 'shared/X.<hash>.js' }` for the given logical paths.
 * @param {string[]} files repo-relative paths (already filtered by {@link isHashable})
 * @param {(file: string) => Buffer|string} readBytes returns the emitted bytes for a path
 * @returns {Record<string, string>}
 */
function computeAssetManifest(files, readBytes) {
  const manifest = {};
  for (const file of files) {
    const norm = String(file).replace(/\\/g, '/');
    manifest[norm] = hashedName(norm, contentHash(readBytes(norm)));
  }
  return manifest;
}

/**
 * Build a single regex that matches a `<script src>` value pointing at a
 * hashable dir's `.js`, capturing: 1=`src="`, 2=optional `./`|`/` prefix,
 * 3=repo-relative path, 4=closing quote. The `(?<![\w-])` guard keeps it from
 * matching `data-src` / other `*-src` attributes.
 * @param {string[]} hashableDirs
 * @returns {RegExp}
 */
function _scriptSrcRegex(hashableDirs) {
  const dirAlt = hashableDirs.join('|');
  return new RegExp(
    `(?<![\\w-])(src\\s*=\\s*["'])((?:\\.\\/|\\/)?)((?:${dirAlt})\\/[^"']*?\\.js)(["'])`,
    'g'
  );
}

/**
 * Rewrite every `<script src>` that references a manifest key to its hashed
 * name, preserving the original prefix (`./`, `/`, or bare), quote style, and
 * any surrounding attributes (`defer` etc.). Load order is untouched — only
 * the filename token changes (so §7-PP defer-ordering is unaffected). A ref
 * not present in the manifest is left as-is for the verify gate to catch.
 * @param {string} html
 * @param {Record<string, string>} manifest
 * @param {string[]} [hashableDirs]
 * @returns {string}
 */
function rewriteHtmlRefs(html, manifest, hashableDirs = HASHABLE_DIRS) {
  const re = _scriptSrcRegex(hashableDirs);
  return html.replace(re, (full, lead, prefix, plainPath, close) => {
    const hashed = manifest[plainPath];
    return hashed ? `${lead}${prefix}${hashed}${close}` : full;
  });
}

/**
 * After rewriting, scan HTML for any surviving `<script src>` to a hashable
 * `.js` whose (prefix-stripped) path is NOT in the emitted set — i.e. a ref
 * that would 404. The build aborts on a non-empty result, converting a missed
 * rewrite into a red build instead of a production 404 (§7-J containment).
 * @param {Array<{file: string, html: string}>} htmlDocs
 * @param {Set<string>} emittedPaths the hashed paths actually written to disk
 * @param {string[]} [hashableDirs]
 * @returns {Array<{file: string, ref: string}>} empty = OK
 */
function findDanglingRefs(htmlDocs, emittedPaths, hashableDirs = HASHABLE_DIRS) {
  const dirAlt = hashableDirs.join('|');
  const re = new RegExp(
    `(?<![\\w-])src\\s*=\\s*["'](?:\\.\\/|\\/)?((?:${dirAlt})\\/[^"']*?\\.js)["']`,
    'g'
  );
  const problems = [];
  for (const { file, html } of htmlDocs) {
    let m;
    while ((m = re.exec(html)) !== null) {
      if (!emittedPaths.has(m[1])) problems.push({ file, ref: m[1] });
    }
  }
  return problems;
}

module.exports = {
  HASH_LEN,
  HASHABLE_DIRS,
  contentHash,
  hashedName,
  isHashable,
  computeAssetManifest,
  rewriteHtmlRefs,
  findDanglingRefs,
};
