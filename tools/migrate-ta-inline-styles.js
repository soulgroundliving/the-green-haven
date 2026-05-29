#!/usr/bin/env node
/**
 * Migrate inline style attributes to CSS classes in tenant_app.html.
 * Handles two cases:
 *   A) element already has class="..." → append new class, remove style attr
 *   B) element has no class attr       → replace style="..." with class="..."
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'tenant_app.html');
let html = fs.readFileSync(FILE, 'utf8');
const original = html;

// [exact style attr value, replacement class name]
const MIGRATIONS = [
  // ── Color utilities ──────────────────────────────────────────────────────
  ['style="color:var(--primary-green);"',          'u-color-green'],
  ['style="color:#666;"',                          'u-color-muted'],
  ['style="color:#888;"',                          'u-color-sub'],
  ['style="color:#aaa;"',                          'u-color-lighter'],
  ['style="color:red;"',                           'u-color-red'],
  ['style="color:var(--accent-gold,#D4AF37);"',    'u-color-gold'],
  ['style="background: var(--bg-color);"',         'u-bg-base'],
  // ── Layout utilities ─────────────────────────────────────────────────────
  ['style="flex:1;"',                              'u-flex-1'],
  ['style="flex: 1;"',                             'u-flex-1'],
  ['style="flex:2;"',                              'u-flex-2'],
  ['style="position:relative;"',                   'u-pos-rel'],
  // ── Spacing utilities ────────────────────────────────────────────────────
  ['style="margin:0;"',                            'u-m0'],
  ['style="margin-bottom:15px;"',                  'u-mb-15'],
  ['style="margin-bottom: 15px;"',                 'u-mb-15'],
  ['style="margin-bottom: 50px;"',                 'u-mb-50'],
  ['style="margin-top:8px;"',                      'u-mt-8'],
  ['style="margin-top: 8px;"',                     'u-mt-8'],
  ['style="margin-top:10px;"',                     'u-mt-10'],
  ['style="margin-top:15px;"',                     'u-mt-15'],
  ['style="margin-top:16px;"',                     'u-mt-16'],
  ['style="padding-bottom:80px;"',                 'u-pb-nav'],
  ['style="margin:0 0 8px;"',                      'ta-mb-0-8'],
  ['style="margin:10px 0;"',                       'ta-my-10'],
  // ── Typography utilities ─────────────────────────────────────────────────
  ['style="font-weight:700;"',                     'u-bold'],
  ['style="font-size:var(--fs-md);"',              'u-fs-md'],
  ['style="font-size: var(--fs-md);"',             'u-fs-md'],
  ['style="font-size:var(--fs-lg);"',              'u-fs-lg'],
  ['style="font-size: var(--fs-lg);"',             'u-fs-lg'],
  ['style="font-size:3rem;"',                      'u-fs-3rem'],
  // ── Component classes ────────────────────────────────────────────────────
  ['style="width:44px; height:44px; background:var(--soft-green); border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer;"',
   'ta-icon-circle'],
  ['style="width:36px; height:36px; background:var(--soft-green); border-radius:50%; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;"',
   'ta-icon-circle-sm'],
  ['style="display:flex; align-items:center; gap:15px; padding-bottom: 25px;"',
   'ta-page-top'],
  ['style="margin:0; font-size: var(--fs-lg);"',  'ta-card-title'],
  ['style="margin:0; font-size:var(--fs-lg);"',   'ta-card-title'],
  ['style="display:flex; justify-content:space-between; padding:4px 0;"',
   'ta-row-split'],
  ['style="display:flex; justify-content:space-between; padding:3px 0;"',
   'ta-row-split-3'],
  ['style="display:flex; justify-content:space-between; padding:5px 0;"',
   'ta-row-split-5'],
  ['style="display:flex; justify-content:space-between; margin-bottom:10px;"',
   'ta-row-split-mb'],
  ['style="display:flex; align-items:center; gap:12px;"',
   'ta-flex-ac-12'],
  ['style="height:96px; border-radius:14px;"',    'ta-sk-img'],
  ['style="padding:10px; background:var(--soft-green); border-radius:10px; text-align:center;"',
   'ta-icon-box'],
  ['style="display:block; color:#888; font-weight:400; font-size:var(--fs-xs); margin-top:2px;"',
   'ta-sub-label'],
  ['style="font-weight:700; margin-bottom:0.3rem; color:var(--text-dark); font-size:var(--fs-md); display:block;"',
   'ta-field-label'],
  ['style="font-size: var(--fs-md); font-weight: 600;"',
   'ta-md-600'],
  ['style="font-size: var(--fs-md); font-weight: 600; color: #555;"',
   'ta-md-600-sub'],
  ['style="font-size:var(--fs-sm); color:#666;"', 'ta-sub-text'],
  ['style="font-size:1.8rem; margin-bottom:4px;"','ta-stat-val'],
  ['style="margin:6px 0; color:var(--text-muted);"',
   'ta-muted-6'],
  ['style="color:var(--text-muted); margin:0 0 8px; font-size:var(--fs-sm);"',
   'ta-sub-desc'],
  ['style="color:#aaa;font-size:var(--fs-sm);"',  'ta-lighter-sm'],
  ['style="font-weight:700; font-size:var(--fs-md); margin:0 0 4px;"',
   'ta-stat-label'],
  // ── Second-pass patterns ─────────────────────────────────────────────────
  ['style="font-size:var(--fs-md); font-weight:600;"',  'ta-md-600'],
  ['style="display:flex; gap:8px;"',                    'ta-flex-gap-8'],
  ['style="display:flex; align-items:center; gap:6px;"','ta-flex-ac-6'],
  ['style="display:grid; grid-template-columns:1fr 1fr; gap:10px;"',
   'ta-grid-2col'],
  ['style="text-align:right;"',                         'u-text-right'],
  ['style="font-size:1.5rem;"',                         'u-fs-1-5rem'],
  ['style="display:block; font-weight:700; margin-bottom:4px;"',
   'ta-block-bold'],
  ['style="display:block; margin-top:6px; padding:0 4px; font-size:var(--fs-sm); color:var(--text-muted);"',
   'ta-note-sm'],
  ['style="color:#666; font-size:var(--fs-sm);"',       'ta-color-sm'],
  ['style="width:25px; color:var(--primary-green);"',   'ta-icon-narrow'],
  ['style="text-align:center;color:#9ca3af;font-size:var(--fs-md);padding:20px;"',
   'ta-text-ctr-muted'],
  // ── Third-pass patterns ──────────────────────────────────────────────────
  ['style="padding:10px;"',                                      'u-p-10'],
  ['style="text-align:center;"',                                 'u-text-center'],
  ['style="margin-bottom:8px;"',                                 'u-mb-8'],
  ['style="margin-bottom:2px;"',                                 'u-mb-2'],
  ['style="margin-bottom:20px;"',                                'u-mb-20'],
  ['style="width:100%; padding:0.5rem; border:1px solid #ddd; border-radius:10px; margin-bottom:10px;"',
   'ta-input-full'],
  ['style="margin:0; padding-left:18px; font-size:var(--fs-sm); color:var(--text-secondary,#6b7280); line-height:1.9;"',
   'ta-list-body'],
  ['style="margin-top:15px; padding:12px 15px; border:1px solid #eee;"',
   'ta-card-border'],
  ['style="margin-top:12px;background:var(--alert);touch-action:manipulation;"',
   'ta-alert-btn'],
  ['style="height:56px; border-radius:12px;"',                  'ta-sk-card-56'],
  ['style="height:48px; border-radius:12px;"',                  'ta-sk-card-48'],
  ['style="flex:1; padding:8px; border-radius:10px; font-size:var(--fs-sm); font-weight:700; background:transparent; color:#6b7280; border:none; cursor:pointer; touch-action:manipulation;"',
   'ta-tab-btn'],
  ['style="width:44px; height:44px; background:var(--soft-green); border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; touch-action:manipulation;"',
   'ta-icon-circle-touch'],
  ['style="width:36px;height:36px;border-radius:50%;border:1px solid var(--border);background:#fff;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;"',
   'ta-avatar-circle'],
  ['style="margin-top:10px; color:var(--text-muted); font-size:var(--fs-sm);"',
   'ta-hint-text'],
  ['style="font-weight:700; font-size:1.1rem; color:#1b5e20;"', 'ta-sub-heading'],
  ['style="font-size:var(--fs-sm);font-weight:700;color:#6b7280;"',
   'ta-sm-bold-muted'],
  ['style="width:100%; padding:12px; border-radius:12px; border:1px solid #eee; margin-top:10px; font-family:inherit;"',
   'ta-input-lg'],
  ['style="width:100%; padding:10px; border-radius:10px; border:1px solid #ddd; font-family:inherit; box-sizing:border-box;"',
   'ta-input-md'],
  ['style="text-align:center; border-bottom:2px solid var(--primary-green); padding-bottom:8px; margin-bottom:10px;"',
   'ta-section-heading'],
  ['style="padding:8px; background:white; border-radius:6px; text-align:center;"',
   'ta-icon-pad'],
  ['style="padding:13px; border-radius:12px; border:1px solid #ddd; background:white; color:#666; font-family:inherit; font-weight:700; cursor:pointer;"',
   'ta-input-select'],
];

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let total = 0;

for (const [styleAttr, cls] of MIGRATIONS) {
  const e = esc(styleAttr);
  let count = 0;

  // Pass A: class="EXISTING" ... style="TARGET"  →  class="EXISTING CLS"
  // (style comes AFTER the class attr on the same tag — most common)
  html = html.replace(
    new RegExp(`(class="[^"]+)(")( [^>]*?)?` + e, 'g'),
    (m, pre, q, mid) => {
      count++;
      return `${pre} ${cls}${q}${mid || ''}`;
    }
  );

  // Pass B: style="TARGET" ... class="EXISTING"  →  class="EXISTING CLS"
  // (style comes BEFORE the class attr)
  html = html.replace(
    new RegExp(e + `( [^>]*?)?(class="[^"]+)(")`, 'g'),
    (m, mid, pre, q) => {
      count++;
      return `${mid || ''}${pre} ${cls}${q}`;
    }
  );

  // Pass C: standalone style="TARGET" (no class attr found) → class="CLS"
  const before = html;
  html = html.replace(new RegExp(e, 'g'), () => { count++; return `class="${cls}"`; });
  // subtract pass-C hits already counted in A/B from final total
  // (count was incremented in A/B, and might double-count in C if the same
  //  occurrence matched both — but passes A/B consume the match so C won't re-match)

  if (count > 0) console.log(`  ${styleAttr.slice(0, 60).padEnd(62)} → ${cls}  (${count}×)`);
  total += count;
}

const remaining = (html.match(/style="/g) || []).length;
console.log(`\nTotal replacements : ${total}`);
console.log(`Remaining style="" : ${remaining}`);

if (html !== original) {
  fs.writeFileSync(FILE, html, 'utf8');
  console.log('✅ tenant_app.html updated.');
} else {
  console.log('ℹ️  No changes made.');
}
