#!/usr/bin/env node
/**
 * Migrate repeated inline style attributes to CSS classes in dashboard.html.
 * Same approach as migrate-ta-inline-styles.js:
 *   A) element has class="EXISTING" + style="TARGET" → append class, remove style
 *   B) element has style="TARGET" + class="EXISTING" → append class, remove style
 *   C) standalone style="TARGET" (no class attr)     → replace with class="CLS"
 *
 * CSS classes defined in shared/components.css (dash-* prefix).
 * Run: node tools/migrate-dashboard-inline-styles.js
 */
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'dashboard.html');
let html   = fs.readFileSync(FILE, 'utf8');
const orig = html;

// [exact style attr value (with quotes), replacement class name]
const MIGRATIONS = [
  // ── Pointer ───────────────────────────────────────────────────────────────
  ['style="cursor:pointer;"',
   'dash-cur-ptr'],

  // ── Form labels ───────────────────────────────────────────────────────────
  ['style="display:block;margin-bottom:.5rem;font-weight:600;font-size:.9rem;"',
   'dash-form-label'],
  ['style="display:block;margin-bottom:.4rem;font-size:.88rem;font-weight:600;"',
   'dash-field-label'],

  // ── Sub-text note ─────────────────────────────────────────────────────────
  ['style="font-size:.9rem;color:var(--text-muted);"',
   'dash-note'],

  // ── Form inputs ───────────────────────────────────────────────────────────
  ['style="width:100%;padding:.65rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;margin-bottom:.85rem;"',
   'dash-form-input'],
  ['style="width: 100%; padding: 0.7rem; border: 1px solid var(--border); border-radius: 6px; font-family: var(--font-brand);"',
   'dash-brand-input'],
  ['style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.88rem;"',
   'dash-input-sm'],

  // ── Font size ─────────────────────────────────────────────────────────────
  ['style="font-size:1.3rem;"',
   'dash-text-lg'],

  // ── Spacing ───────────────────────────────────────────────────────────────
  ['style="margin-bottom:1.5rem;"',
   'dash-mb-6'],
  ['style="margin-bottom: 1.5rem;"',
   'dash-mb-6'],
  ['style="margin-bottom:2rem;"',
   'dash-mb-8'],

  // ── Typography ────────────────────────────────────────────────────────────
  ['style="font-weight:700;margin-bottom:.5rem;"',
   'dash-label-bold'],
  ['style="font-weight: 700; color: var(--green-dark);"',
   'dash-title-green'],

  // ── Colors ────────────────────────────────────────────────────────────────
  ['style="color:var(--accent-dark);"',
   'dash-color-accent'],
  ['style="color:var(--red-dark);"',
   'dash-color-red'],

  // ── Sizing ────────────────────────────────────────────────────────────────
  ['style="min-height:60px;"',
   'dash-min-h-60'],
  ['style="min-height:120px;"',
   'dash-min-h-120'],

  // ── Layout ────────────────────────────────────────────────────────────────
  ['style="display:flex;gap:.5rem;"',
   'dash-flex-gap-sm'],
  ['style="display:flex;align-items:center;gap:8px;padding:10px;border:1.5px solid #e0e0e0;border-radius:6px;cursor:pointer;"',
   'dash-option-row'],

  // ── Border + background ───────────────────────────────────────────────────
  ['style="border-color:var(--border);background:var(--card);"',
   'dash-border-card'],

  // ── Submit button ─────────────────────────────────────────────────────────
  ['style="margin-top:.5rem;padding:8px 20px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--font-brand);font-weight:600;"',
   'dash-btn-submit'],

  // ── Skeleton lines ────────────────────────────────────────────────────────
  ['style="height:1.5rem;width:65%;margin-bottom:.35rem;"',
   'dash-skel-lg'],
  ['style="height:1.1rem;width:50%;margin-bottom:.5rem;"',
   'dash-skel-md'],
  ['style="height:.75rem;width:40%;"',
   'dash-skel-sm'],

  // ── Pass 2: 2× patterns + existing u-* remaps ─────────────────────────────
  // Map to existing u-* classes (no new CSS needed)
  ['style="overflow-x:auto;"',                      'u-scroll-x'],
  ['style="overflow-x: auto;"',                     'u-scroll-x'],
  ['style="color:var(--text-muted);"',              'u-color-muted'],
  ['style="color:var(--green-dark);"',              'u-color-green-dk'],
  ['style="margin:0;"',                             'u-m0'],
  // margin-bottom 2rem (with space after colon — already caught 3× without space in pass 1)
  ['style="margin-bottom: 2rem;"',                  'dash-mb-8'],
  // New dash-* classes
  ['style="margin-top:2rem;"',                      'dash-mt-8'],
  ['style="min-height: 200px;"',                    'dash-min-h-200'],
  ['style="font-size:.9rem;font-weight:600;"',      'dash-note-600'],
  ['style="font-size:.75rem;color:var(--text-muted);margin-top:4px;"',
   'dash-caption'],
  ['style="font-size:.82rem;color:var(--text-muted);margin-bottom:1rem;"',
   'dash-footnote'],
  ['style="font-size:.7rem;color:var(--text-muted);margin-top:2px;"',
   'dash-micro'],
  ['style="font-size:.78rem;color:var(--text-muted);"',
   'dash-note-78'],
  ['style="opacity:.85;font-size:.85rem;"',         'dash-sub-dim'],
  ['style="font-weight:700;font-size:.92rem;"',     'dash-bold-92'],
  ['style="display:flex;align-items:center;gap:8px;"',
   'dash-flex-ac-8'],
  ['style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;"',
   'dash-tags-row'],
  ['style="text-align: center; padding: 20px; color: var(--text-muted);"',
   'dash-empty-msg'],
  ['style="height:.65rem;width:35%;border-radius:3px;margin-bottom:1rem;"',
   'dash-skel-xs'],
  ['style="background:#fff9c4;border-left:4px solid #fbc02d;border-radius:6px;padding:8px 12px;font-size:.83rem;"',
   'dash-warn-note'],
  ['style="display:flex;flex-direction:column;gap:.35rem;"',
   'dash-col-gap-xs'],
  ['style="padding:4px 10px;background:#fff;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-family:var(--font-brand);"',
   'dash-btn-outline'],
  ['style="font-size:2rem;font-weight:800;color:var(--green);"',
   'dash-kpi-green'],
  ['style="font-size:1.4rem;font-weight:800;color:var(--accent);"',
   'dash-kpi-accent'],
  ['style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;margin-bottom:.85rem;"',
   'dash-form-input-6'],
];

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let total = 0;

for (const [styleAttr, cls] of MIGRATIONS) {
  const e = esc(styleAttr);
  let count = 0;

  // Pass A: class="EXISTING" ... style="TARGET" → append, remove style
  html = html.replace(
    new RegExp(`(class="[^"]+)(")( [^>]*?)?` + e, 'g'),
    (m, pre, q, mid) => { count++; return `${pre} ${cls}${q}${mid || ''}`; }
  );

  // Pass B: style="TARGET" ... class="EXISTING" → append, remove style
  html = html.replace(
    new RegExp(e + `( [^>]*?)?(class="[^"]+)(")`, 'g'),
    (m, mid, pre, q) => { count++; return `${mid || ''}${pre} ${cls}${q}`; }
  );

  // Pass C: standalone style="TARGET" → class="CLS"
  html = html.replace(new RegExp(e, 'g'), () => { count++; return `class="${cls}"`; });

  if (count > 0) console.log(`  ${styleAttr.slice(0, 62).padEnd(64)} → .${cls}  (${count}×)`);
  total += count;
}

const remaining = (html.match(/style="/g) || []).length;
console.log(`\nTotal replacements : ${total}`);
console.log(`Remaining style="" : ${remaining}`);

if (html !== orig) {
  fs.writeFileSync(FILE, html, 'utf8');
  console.log('✅ dashboard.html updated.');
} else {
  console.log('ℹ️  No changes made.');
}
