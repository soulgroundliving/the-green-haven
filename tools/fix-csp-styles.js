/**
 * fix-csp-styles.js — replace JS element.style.xxx assignments with
 * classList-based equivalents so the page works under strict style-src CSP.
 *
 * Run:  node tools/fix-csp-styles.js           (apply)
 *       node tools/fix-csp-styles.js --dry-run  (preview only)
 *
 * Strategy:
 *   .style.display = 'none'        → .classList.add('u-hidden')
 *   .style.display = ''            → .classList.remove('u-hidden')
 *   .style.display = 'block'       → .classList.remove('u-hidden')
 *   .style.display = 'flex'        → .classList.add('u-flex'); .classList.remove('u-hidden')
 *   .style.display = 'grid'        → .classList.add('u-grid'); .classList.remove('u-hidden')
 *   .style.display = 'inline-block'→ .classList.add('u-iblock'); .classList.remove('u-hidden')
 *
 * Ternaries (none/'' and none/block are the most common):
 *   .style.display = cond ? 'none' : ''      → .classList.toggle('u-hidden', !!(cond))
 *   .style.display = cond ? '' : 'none'      → .classList.toggle('u-hidden', !(cond))
 *   .style.display = cond ? 'block' : 'none' → .classList.toggle('u-hidden', !(cond))
 *   .style.display = cond ? 'none' : 'block' → .classList.toggle('u-hidden', !!(cond))
 *   .style.display = cond ? 'flex' : 'none'  → inline expand (needs both classes)
 *   .style.display = cond ? 'none' : 'flex'  → inline expand
 *   .style.display = cond ? 'grid' : 'none'  → inline expand
 *   .style.display = cond ? 'none' : 'grid'  → inline expand
 *
 * Opacity / cursor ternaries:
 *   .style.opacity = cond ? '.4' : ''        → .classList.toggle('u-op40', !!(cond))
 *   .style.cursor = cond ? 'not-allowed' : 'pointer' → .classList.toggle('u-no-ptr', !!(cond))
 *
 * Skipped (leave as-is, logged):
 *   .style.cssText, .style.color, .style.background, .style.width, etc.
 */

const fs   = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry-run');
const SHARED = path.join(__dirname, '../shared');

// Files to process (all shared JS except read-only / generated)
const FILES = fs.readdirSync(SHARED)
  .filter(f => f.endsWith('.js'))
  .map(f => path.join(SHARED, f));

// ── Regex helpers ─────────────────────────────────────────────────────────

// Matches a "simple" element expression ending right before .style.display
// Captures everything up to but not including .style.display
// Note: we match on the suffix only so we don't need to capture the element
// for simple display-value replacements.

function applyRules(src) {
  let out = src;
  let count = 0;

  function rep(re, fn) {
    out = out.replace(re, (...args) => {
      count++;
      return fn(...args);
    });
  }

  // ── TERNARY PATTERNS (must run before simple patterns) ─────────────────

  // cond ? 'flex' : 'none'   — CSS must already define display:flex on this element
  rep(/\.style\.display\s*=\s*(.+?)\s*\?\s*'flex'\s*:\s*'none'/g,
    (_, cond) => `.classList.toggle('u-hidden', !(${cond.trim()}))`);

  // cond ? 'none' : 'flex'
  rep(/\.style\.display\s*=\s*(.+?)\s*\?\s*'none'\s*:\s*'flex'/g,
    (_, cond) => `.classList.toggle('u-hidden', !!(${cond.trim()}))`);

  // cond ? 'grid' : 'none'   — CSS must already define display:grid
  rep(/\.style\.display\s*=\s*(.+?)\s*\?\s*'grid'\s*:\s*'none'/g,
    (_, cond) => `.classList.toggle('u-hidden', !(${cond.trim()}))`);

  // cond ? 'none' : 'grid'
  rep(/\.style\.display\s*=\s*(.+?)\s*\?\s*'none'\s*:\s*'grid'/g,
    (_, cond) => `.classList.toggle('u-hidden', !!(${cond.trim()}))`);

  // cond ? 'inline-block' : 'none'
  rep(/\.style\.display\s*=\s*(.+?)\s*\?\s*'inline-block'\s*:\s*'none'/g,
    (_, cond) => `.classList.toggle('u-hidden', !(${cond.trim()}))`);

  // cond ? 'none' : 'inline-block'
  rep(/\.style\.display\s*=\s*(.+?)\s*\?\s*'none'\s*:\s*'inline-block'/g,
    (_, cond) => `.classList.toggle('u-hidden', !!(${cond.trim()}))`)

  // cond ? 'block' : 'none'  — block is CSS default, toggle u-hidden is sufficient
  rep(/\.style\.display\s*=\s*(.+?)\s*\?\s*'block'\s*:\s*'none'/g,
    (_, cond) => `.classList.toggle('u-hidden', !(${cond.trim()}))`);

  // cond ? 'none' : 'block'
  rep(/\.style\.display\s*=\s*(.+?)\s*\?\s*'none'\s*:\s*'block'/g,
    (_, cond) => `.classList.toggle('u-hidden', !!(${cond.trim()}))`);

  // cond ? '' : 'none'   — '' restores CSS default
  rep(/\.style\.display\s*=\s*(.+?)\s*\?\s*''\s*:\s*'none'/g,
    (_, cond) => `.classList.toggle('u-hidden', !(${cond.trim()}))`);

  // cond ? 'none' : ''
  rep(/\.style\.display\s*=\s*(.+?)\s*\?\s*'none'\s*:\s*''/g,
    (_, cond) => `.classList.toggle('u-hidden', !!(${cond.trim()}))`);

  // ── SIMPLE ASSIGNMENTS ──────────────────────────────────────────────────

  rep(/\.style\.display\s*=\s*'none'/g,         () => `.classList.add('u-hidden')`);
  rep(/\.style\.display\s*=\s*"none"/g,         () => `.classList.add('u-hidden')`);
  rep(/\.style\.display\s*=\s*'block'/g,        () => `.classList.remove('u-hidden')`);
  rep(/\.style\.display\s*=\s*"block"/g,        () => `.classList.remove('u-hidden')`);
  rep(/\.style\.display\s*=\s*'flex'/g,         () => `.classList.remove('u-hidden'); /*flex*/`);
  rep(/\.style\.display\s*=\s*"flex"/g,         () => `.classList.remove('u-hidden'); /*flex*/`);
  rep(/\.style\.display\s*=\s*'grid'/g,         () => `.classList.remove('u-hidden'); /*grid*/`);
  rep(/\.style\.display\s*=\s*"grid"/g,         () => `.classList.remove('u-hidden'); /*grid*/`);
  rep(/\.style\.display\s*=\s*'inline-block'/g, () => `.classList.add('u-iblock'); /*iblock*/`);
  rep(/\.style\.display\s*=\s*"inline-block"/g, () => `.classList.add('u-iblock'); /*iblock*/`);
  rep(/\.style\.display\s*=\s*'inline'/g,       () => `.classList.add('u-inline'); /*inline*/`);
  rep(/\.style\.display\s*=\s*''/g,             () => `.classList.remove('u-hidden')`);
  rep(/\.style\.display\s*=\s*""/g,             () => `.classList.remove('u-hidden')`);

  // ── OPACITY ternaries ───────────────────────────────────────────────────

  // cond ? '.4' : ''  or  cond ? '0.4' : ''
  rep(/\.style\.opacity\s*=\s*(.+?)\s*\?\s*['"]\.?4['"]\s*:\s*['"]{2}/g,
    (_, cond) => `.classList.toggle('u-op40', !!(${cond.trim()}))`);

  // cond ? '' : '.4'
  rep(/\.style\.opacity\s*=\s*(.+?)\s*\?\s*['"]{2}\s*:\s*['"]\.?4['"]/g,
    (_, cond) => `.classList.toggle('u-op40', !(${cond.trim()}))`);

  // simple opacity
  rep(/\.style\.opacity\s*=\s*['"]\.?4['"]/g, () => `.classList.add('u-op40')`);
  rep(/\.style\.opacity\s*=\s*['"]{2}/g,       () => `.classList.remove('u-op40')`);

  // ── CURSOR ternaries ────────────────────────────────────────────────────

  // cond ? 'not-allowed' : 'pointer'
  rep(/\.style\.cursor\s*=\s*(.+?)\s*\?\s*'not-allowed'\s*:\s*'pointer'/g,
    (_, cond) => `.classList.toggle('u-no-ptr', !!(${cond.trim()}))`);

  // simple cursor
  rep(/\.style\.cursor\s*=\s*'not-allowed'/g, () => `.classList.add('u-no-ptr')`);
  rep(/\.style\.cursor\s*=\s*'pointer'/g,     () => `.classList.remove('u-no-ptr')`);

  return { out, count };
}

// ── Scan for skipped .style. assignments ──────────────────────────────────

const SKIP_PATTERN = /\.style\.\w+\s*=/g;

// ── Main ──────────────────────────────────────────────────────────────────

let totalChanged = 0;
let totalSkipped = 0;

for (const file of FILES) {
  const src = fs.readFileSync(file, 'utf8');
  const { out, count } = applyRules(src);

  // Count remaining .style. assignments (those we didn't touch)
  const remaining = (out.match(SKIP_PATTERN) || []);
  const skipped   = remaining.filter(m => !m.includes('.style.setProperty'));

  totalChanged += count;
  totalSkipped += skipped.length;

  const name = path.basename(file);

  if (count === 0 && skipped.length === 0) continue;

  console.log(`\n${name}:`);
  if (count)          console.log(`  ✅ replaced: ${count}`);
  if (skipped.length) console.log(`  ⚠️  skipped (manual): ${skipped.length}`, skipped.slice(0, 5).join(', '));

  if (!DRY && src !== out) {
    fs.writeFileSync(file, out, 'utf8');
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Total replaced: ${totalChanged}`);
console.log(`Total skipped:  ${totalSkipped}  (color/width/height/cssText etc.)`);
if (DRY) console.log('\n[DRY RUN — no files written]');
else      console.log('\n[Files updated]');
