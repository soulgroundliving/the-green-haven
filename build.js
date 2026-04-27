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
const { execSync } = require('child_process');

// Safety: this script rewrites source files in place. That's desirable inside
// Vercel's ephemeral build checkout, but catastrophic if run locally against
// the real repo. Gate on the VERCEL env var (Vercel sets it automatically)
// or an explicit FORCE_BUILD=1 opt-in for intentional local testing.
if (!process.env.VERCEL && !process.env.FORCE_BUILD) {
  console.log('⏭️  Skipping minify (not on Vercel). Set FORCE_BUILD=1 to run locally.');
  process.exit(0);
}

(async () => {
  // Auto-version the service worker cache from the git commit SHA. Vercel
  // exposes the SHA via VERCEL_GIT_COMMIT_SHA at build time; fall back to
  // `git rev-parse --short HEAD` for FORCE_BUILD local runs. Without this,
  // every shared/*.js change required a manual bump of CACHE_VERSION in
  // service-worker.js — easy to forget, leaving users on stale cache.
  try {
    const sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)
      || execSync('git rev-parse --short HEAD').toString().trim();
    if (sha) {
      const swPath = 'service-worker.js';
      const today = new Date().toISOString().slice(0, 10);
      const newVersion = `v3-${today}-${sha}`;
      const sw = fs.readFileSync(swPath, 'utf8');
      const replaced = sw.replace(
        /const CACHE_VERSION = '[^']+';/,
        `const CACHE_VERSION = '${newVersion}';`
      );
      if (replaced !== sw) {
        fs.writeFileSync(swPath, replaced);
        console.log(`🔖 SW cache version → ${newVersion}\n`);
      } else {
        console.warn('⚠️  CACHE_VERSION line not matched in service-worker.js — skipped\n');
      }
    }
  } catch (e) {
    console.warn(`⚠️  SW auto-version skipped: ${e.message}\n`);
  }

  // Phase 4E Tailwind migration: compile shared/tailwind.input.css → shared/tailwind.css
  // so tenant_app.html can link a tiny pre-built stylesheet instead of pulling the
  // ~200KB Tailwind JIT runtime from cdn.tailwindcss.com on every page load.
  // Runs BEFORE the JS minify loop so the generated CSS ships in the same deploy.
  try {
    console.log('🎨 Building Tailwind CSS...');
    execSync('npx tailwindcss -i shared/tailwind.input.css -o shared/tailwind.css --minify', { stdio: 'inherit' });
    const tailwindKB = (fs.statSync('shared/tailwind.css').size / 1024).toFixed(1);
    console.log(`   shared/tailwind.css = ${tailwindKB}KB\n`);
  } catch (e) {
    console.error('❌ Tailwind build failed:', e.message);
    process.exit(1);
  }

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
        minifySyntax: true,        // Phase B.1: ?: rewrites, dead-code elim, etc.
        minifyIdentifiers: false,  // safety: keep every function/var name (Phase B.2 would need bundling)
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
