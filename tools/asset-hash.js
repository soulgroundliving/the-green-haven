'use strict';

/**
 * Content-hash asset pipeline for `shared/*.js` + `accounting/*.js` (via
 * `<script src>`) AND `shared/*.css` (via `<link href>`).
 *
 * Pure, dependency-light helpers used by build.js (Vercel-only) so the
 * hashing / HTML-rewrite / dangling-ref verification logic is unit-testable
 * without running the in-place build against the real repo. Keeping these
 * out of build.js lets `npm run test:shared` lock the behaviour
 * (determinism, all-prefix rewrite, defer preserved, dangling = build-red).
 *
 * Why content-hash filenames: the deployed asset is served `immutable` so a
 * returning visitor never re-downloads an unchanged file. A changed file gets
 * a new hash → new URL → impossible to serve stale (strictly safer than the
 * previous `no-cache`). For CSS this also closes §7-MM: the old stable
 * `shared/components.css` URL let the SW cache-first serve last deploy's CSS
 * until a SW activation purge (the "close+reopen LIFF twice" friction); a
 * hashed URL changes on every content change so the page fetches fresh
 * immediately. esbuild minify (JS) and Tailwind --minify (CSS) are
 * deterministic, so unchanged source yields the same hash across deploys and
 * the browser keeps its cache.
 *
 * Scope note: `shared/__tests__/**` is dev-only (never referenced by shipped
 * HTML) and is excluded by {@link isHashable}. `shared/bg/**` is images only.
 * `*.input.css` (Tailwind SOURCE — compiled to `tailwind.css`, never linked)
 * is also excluded. CSS files carry no `@import`/relative `url()` cross-refs,
 * so renaming a file never breaks a sibling stylesheet.
 */

const crypto = require('crypto');

const HASH_LEN = 8;

/** Directories whose `.js`/`.css` files participate in content-hashing. */
const HASHABLE_DIRS = ['shared', 'accounting'];

/** Extensions that participate in content-hashing (script + stylesheet). */
const HASHABLE_EXTS = ['js', 'css'];

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
 * `shared/foo.js` + `a1b2c3d4` → `shared/foo.a1b2c3d4.js` (and likewise
 * `shared/brand.css` → `shared/brand.a1b2c3d4.css`). Only the trailing
 * `.js`/`.css` is infixed, so sub-dirs and multi-dot basenames are preserved.
 * @param {string} logicalPath repo-relative, forward-slash
 * @param {string} hash
 * @returns {string}
 */
function hashedName(logicalPath, hash) {
  return logicalPath.replace(new RegExp(`\\.(${HASHABLE_EXTS.join('|')})$`), `.${hash}.$1`);
}

/**
 * True for a repo-relative path that should be content-hashed:
 * under shared/ or accounting/, a `.js` or `.css` file, NOT a test file,
 * and NOT a Tailwind `*.input.css` source (that is compiled to `tailwind.css`
 * and never linked, so hashing it would be dead weight + a confusing artifact).
 * @param {string} file
 * @returns {boolean}
 */
function isHashable(file) {
  const norm = String(file).replace(/\\/g, '/');
  if (!new RegExp(`\\.(${HASHABLE_EXTS.join('|')})$`).test(norm)) return false;
  if (norm.includes('/__tests__/')) return false;
  if (norm.endsWith('.input.css')) return false;
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
 * The two ref kinds this pipeline rewrites: `<script src=…js>` and
 * `<link href=…css>`. `[attr, ext]` pairs kept in one place so the rewrite
 * and the dangling-scan stay in lockstep.
 */
const REF_KINDS = [['src', 'js'], ['href', 'css']];

/**
 * Build a regex matching an `attr="…/<dir>/path.ext"` value, capturing:
 * 1=`attr="`, 2=optional `./`|`/` prefix, 3=repo-relative path, 4=closing
 * quote. The `(?<![\w-])` guard keeps it from matching `data-src`/`data-href`
 * and other `*-src`/`*-href` attributes.
 * @param {string[]} hashableDirs
 * @param {string} attr `src` or `href`
 * @param {string} ext `js` or `css`
 * @returns {RegExp}
 */
function _refRegex(hashableDirs, attr, ext) {
  const dirAlt = hashableDirs.join('|');
  return new RegExp(
    `(?<![\\w-])(${attr}\\s*=\\s*["'])((?:\\.\\/|\\/)?)((?:${dirAlt})\\/[^"']*?\\.${ext})(["'])`,
    'g'
  );
}

/**
 * Rewrite every `<script src>` (.js) and `<link href>` (.css) that references
 * a manifest key to its hashed name, preserving the original prefix (`./`,
 * `/`, or bare), quote style, and any surrounding attributes (`defer`/`rel`
 * etc.). Load order is untouched — only the filename token changes (so §7-PP
 * defer-ordering is unaffected). A ref not present in the manifest is left
 * as-is for the verify gate to catch. Cross-origin refs (FontAwesome CDN etc.)
 * never match — the path must start with a hashable dir.
 * @param {string} html
 * @param {Record<string, string>} manifest
 * @param {string[]} [hashableDirs]
 * @returns {string}
 */
function rewriteHtmlRefs(html, manifest, hashableDirs = HASHABLE_DIRS) {
  let out = html;
  for (const [attr, ext] of REF_KINDS) {
    const re = _refRegex(hashableDirs, attr, ext);
    out = out.replace(re, (full, lead, prefix, plainPath, close) => {
      const hashed = manifest[plainPath];
      return hashed ? `${lead}${prefix}${hashed}${close}` : full;
    });
  }
  return out;
}

/**
 * After rewriting, scan HTML for any surviving `<script src>` (.js) or
 * `<link href>` (.css) to a hashable asset whose (prefix-stripped) path is NOT
 * in the emitted set — i.e. a ref that would 404. The build aborts on a
 * non-empty result, converting a missed rewrite into a red build instead of a
 * production 404 (§7-J containment).
 * @param {Array<{file: string, html: string}>} htmlDocs
 * @param {Set<string>} emittedPaths the hashed paths actually written to disk
 * @param {string[]} [hashableDirs]
 * @returns {Array<{file: string, ref: string}>} empty = OK
 */
function findDanglingRefs(htmlDocs, emittedPaths, hashableDirs = HASHABLE_DIRS) {
  const dirAlt = hashableDirs.join('|');
  const res = REF_KINDS.map(([attr, ext]) => new RegExp(
    `(?<![\\w-])${attr}\\s*=\\s*["'](?:\\.\\/|\\/)?((?:${dirAlt})\\/[^"']*?\\.${ext})["']`,
    'g'
  ));
  const problems = [];
  for (const { file, html } of htmlDocs) {
    for (const re of res) {
      let m;
      while ((m = re.exec(html)) !== null) {
        if (!emittedPaths.has(m[1])) problems.push({ file, ref: m[1] });
      }
    }
  }
  return problems;
}

module.exports = {
  HASH_LEN,
  HASHABLE_DIRS,
  HASHABLE_EXTS,
  contentHash,
  hashedName,
  isHashable,
  computeAssetManifest,
  rewriteHtmlRefs,
  findDanglingRefs,
};
