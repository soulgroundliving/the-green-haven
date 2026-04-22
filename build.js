/**
 * Vercel build-time minifier for the static site.
 *
 * Strategy: minify whitespace + comments only — NO identifier renaming and
 * NO syntax rewriting. This is the safest possible minify pass: function
 * and variable names are preserved exactly, so cross-file calls and
 * onclick="foo()" handlers keep working with zero risk.
 *
 * Why this is enough for now:
 *  - shared/*.js is ~5400 lines just for dashboard-extra.js; comments are
 *    plentiful (long Thai explanations of business rules) — whitespace-only
 *    stripping already yields ~15–25% byte reduction.
 *  - Any identifier renaming is gated behind a Phase B once we audit every
 *    global export + eval site.
 *
 * Local dev: this script only runs on Vercel (via package.json's build
 * script). Local source files in shared/ remain readable.
 *
 * Scope: shared/**\/*.js and accounting/**\/*.js. HTML files, functions/
 * (Cloud Functions — deployed separately), tenant_app.html inline JS, and
 * CDN scripts are all left alone.
 */

const esbuild = require('esbuild');
const { glob } = require('glob');
const fs = require('fs');

// Safety: this script rewrites source files in place. That's desirable inside
// Vercel's ephemeral build checkout, but catastrophic if run locally against
// the real repo. Gate on the VERCEL env var (Vercel sets it automatically)
// or an explicit FORCE_BUILD=1 opt-in for intentional local testing.
if (!process.env.VERCEL && !process.env.FORCE_BUILD) {
  console.log('⏭️  Skipping minify (not on Vercel). Set FORCE_BUILD=1 to run locally.');
  process.exit(0);
}

(async () => {
  const files = await glob(['shared/**/*.js', 'accounting/**/*.js'], { nodir: true });
  if (files.length === 0) {
    console.error('❌ No JS files matched. Aborting build.');
    process.exit(1);
  }

  console.log(`🗜️  Minifying ${files.length} JS files (whitespace + comments only, keep names)...`);
  let totalBefore = 0;
  let totalAfter = 0;
  let failed = 0;

  for (const file of files) {
    const before = fs.statSync(file).size;
    totalBefore += before;
    try {
      await esbuild.build({
        entryPoints: [file],
        outfile: file,
        allowOverwrite: true,
        minifyWhitespace: true,
        minifySyntax: false,       // safety: no if/else → ternary rewrites
        minifyIdentifiers: false,  // safety: keep every function/var name
        legalComments: 'none',
        logLevel: 'warning',
        bundle: false,
      });
    } catch (e) {
      console.error(`❌ Failed on ${file}: ${e.message}`);
      failed++;
      continue;
    }
    const after = fs.statSync(file).size;
    totalAfter += after;
  }

  if (failed > 0) {
    console.error(`❌ Build aborted: ${failed} file(s) failed to minify`);
    process.exit(1);
  }

  const savedKB = ((totalBefore - totalAfter) / 1024).toFixed(1);
  const pct = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
  console.log(`✅ Minified ${files.length} files: ${(totalBefore / 1024).toFixed(0)}KB → ${(totalAfter / 1024).toFixed(0)}KB (saved ${savedKB}KB, -${pct}%)`);
})();
