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
  // ── display:none (pure only — no other properties) ───────────────────────
  // Safe: JS shows these via el.style.display='block/flex' (inline beats class).
  // u-init-hide has no !important so inline style assignment always wins.
  ['style="display:none;"',   'u-init-hide'],
  ['style="display: none;"',  'u-init-hide'],
  ['style="display:none"',    'u-init-hide'],

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

  // ── Pass 3: remaining 3× patterns ────────────────────────────────────────
  ['style="display: flex; gap: 1rem;"',             'dash-flex-gap-4'],
  ['style="height:1.25rem;width:60%;border-radius:3px;"', 'dash-skel-60'],
  ['style="font-weight:600;font-size:.9rem;margin-bottom:.5rem;color:var(--text);"',
   'dash-section-label'],
  ['style="text-align:center;"',                    'u-text-center'],
  ['style="margin-bottom:1rem;"',                   'dash-mb-4'],
  ['style="background: #999;"',                     'dash-bg-gray'],
  ['style="padding: 10px 20px;"',                   'dash-p-10-20'],
  ['style="font-size:12px;color:var(--text-muted);margin-bottom:4px;"',
   'dash-caption-12'],
  ['style="display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem;margin-bottom:1.2rem;"',
   'dash-grid-3col'],
  ['style="width: 140px;"',                         'dash-w-140'],
  ['style="position:relative;display:flex;align-items:center;"', 'dash-rel-flex'],
  ['style="padding: 12px 20px; border: none; background: none; cursor: pointer; font-weight: 600; color: var(--text-muted); border-bottom: 3px solid transparent; margin-bottom: -2px;"',
   'dash-tab-btn'],
  ['style="padding:.8rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-family:var(--font-brand);font-size:.9rem;transition:all .2s;width:100%;padding-right:38px;"',
   'dash-search-field'],
  ['style="flex: 1; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);"',
   'dash-flex-input'],

  // ── Pass 4: remaining 3× patterns ────────────────────────────────────────
  ['style="margin-bottom:20px;"',                   'dash-mb-20'],
  ['style="font-size:1.2rem;font-weight:600;color:var(--ok-dark);"',
   'dash-ok-heading'],
  ['style="font-size:var(--fs-sm);color:#6b7280;margin-top:2px;"',
   'dash-deposit-label'],
  ['style="display: flex; gap: 1rem; margin-bottom: 1rem;"',
   'dash-flex-gap-4-mb'],
  ['style="font-size:0.95rem;font-weight:600;color:var(--text);margin-bottom:10px;"',
   'dash-list-title'],
  ['style="display:flex;flex-direction:column;"',   'dash-col'],
  ['style="padding:0.8rem 1.5rem;background:var(--green);color:white;border:none;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;font-family:var(--font-brand);font-size:0.9rem;"',
   'dash-btn-green'],
  ['style="margin-bottom:1.2rem;border-bottom:2px solid var(--border);padding-bottom:.5rem;"',
   'dash-tabs-bar'],

  // ── Pass 5 (final batch) ─────────────────────────────────────────────────
  ['style="height:.65rem;width:55%;margin-bottom:.5rem;border-radius:3px;"',
   'dash-skel-55'],
  ['style="font-size:.72rem;color:var(--text-muted);margin-top:4px;"',
   'dash-tiny-note'],
  ['style="font-weight:700;"',                      'u-bold'],
  ['style="font-weight: 700; margin-bottom: 1rem;"', 'dash-bold-mb-4'],
  ['style="color:var(--text-muted);text-align:center;padding:2rem;"',
   'dash-empty-center'],
  ['style="display:block;margin-bottom:0.8rem;font-weight:600;font-size:0.9rem;color:var(--text);"',
   'dash-form-label-8'],
  ['style="background: var(--green-pale); padding: 1.5rem; border-radius: var(--radius-sm); margin-bottom: 1.5rem;"',
   'dash-form-panel'],

  // ── Pass 6: modal patterns ────────────────────────────────────────────────
  ['style="position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;align-items:center;justify-content:center;padding:16px;"',
   'dash-modal-overlay'],
  ['style="position:absolute;right:8px;background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--text-muted);padding:4px;z-index:10;pointer-events:auto;transition:all .2s;"',
   'dash-modal-close-btn'],
  ['style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;"',
   'dash-row-sb-mb4'],
  ['style="padding:2rem;overflow-y:auto;flex:1;"',
   'dash-modal-body'],
  ['style="background:linear-gradient(135deg, var(--green-dark) 0%, var(--green) 100%);color:#fff;padding:1.5rem 2rem;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;"',
   'dash-modal-header-green'],
  ['style="background:#fff;max-width:560px;width:100%;max-height:90vh;overflow:auto;border-radius:16px;padding:22px;"',
   'dash-modal-box-560'],

  // ── Pass 6: inputs & selects ──────────────────────────────────────────────
  ['style="width: 100%; padding: 0.7rem; border: 1px solid var(--border); border-radius: 6px;"',
   'dash-input-base'],
  ['style="width:100%;padding:8px;border:1.5px dashed var(--border);border-radius:6px;font-family:var(--font-brand);"',
   'dash-input-dashed'],
  ['style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;font-family:monospace;font-size:.82rem;margin-bottom:.85rem;"',
   'dash-input-mono'],
  ['style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 1rem; height: 80px;"',
   'dash-textarea-sm'],
  ['style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font-brand);font-size:.8rem;"',
   'dash-input-mini'],
  ['style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-family:inherit;font-size:var(--fs-sm);"',
   'dash-select-sm'],
  ['style="padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-family:inherit;background:#fff;font-size:.95rem;"',
   'dash-select-base'],
  ['style="flex:1;min-width:200px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.95rem;"',
   'dash-flex-select'],

  // ── Pass 6: buttons ───────────────────────────────────────────────────────
  ['style="padding:0.8rem 1.5rem;background:var(--border);color:var(--text);border:none;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;font-family:var(--font-brand);font-size:0.9rem;"',
   'dash-btn-muted'],
  ['style="padding:9px 18px;border-radius:10px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-weight:500;"',
   'dash-btn-cancel'],
  ['style="padding:9px 18px;border-radius:10px;border:none;background:#dc2626;color:#fff;cursor:not-allowed;font-weight:600;opacity:.5;"',
   'dash-btn-danger-dis'],
  ['style="padding:10px 18px;background:linear-gradient(135deg,var(--ok-bright),var(--ok-dark));color:#fff;border:none;border-radius:8px;font-family:var(--font-brand);font-weight:700;cursor:pointer;"',
   'dash-btn-ok'],
  ['style="padding:10px 16px; background:var(--green-dark); color:#fff; border:none; border-radius:8px; font-family:inherit; font-weight:700; cursor:pointer; min-width:200px;"',
   'dash-btn-primary-wide'],
  ['style="padding:6px 14px;background:#eee;color:var(--text);border:none;border-radius:6px;cursor:pointer;font-family:var(--font-brand);font-size:.85rem;"',
   'dash-btn-gray'],
  ['style="flex:2;padding:.7rem;background:var(--green-dark);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;"',
   'dash-btn-flex-green'],
  ['style="flex:1;padding:.7rem;background:#fff;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-weight:600;"',
   'dash-btn-flex-white'],

  // ── Pass 6: layout helpers ────────────────────────────────────────────────
  ['style="display:flex;gap:12px;margin-bottom:1.5rem;align-items:center;flex-wrap:wrap;"',
   'dash-row-wrap-mb6'],
  ['style="display:flex;gap:10px;justify-content:flex-end;"',
   'dash-row-end-10'],
  ['style="display:flex;gap:0.8rem;flex-wrap:wrap;"',
   'dash-flex-wrap-8'],
  ['style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem;align-items:center;"',
   'dash-filter-row'],
  ['style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;color:var(--text);"',
   'dash-clickable-row'],
  ['style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;"',
   'dash-row-wrap-14'],
  ['style="flex:1; min-width:200px;"',
   'dash-flex-min-200'],
  ['style="position:absolute;top:.75rem;right:.75rem;width:32px;height:32px;border-radius:50%;background:var(--green-dark);color:#fff;border:none;cursor:pointer;font-size:.95rem;display:flex;align-items:center;justify-content:center;line-height:1;padding:0;"',
   'dash-card-btn-abs'],

  // ── Pass 6: panels & cards ────────────────────────────────────────────────
  ['style="background:white;border:1px solid var(--border);border-radius:var(--radius);padding:2rem;margin-bottom:2rem;"',
   'dash-panel-lg'],
  ['style="background:var(--green-pale);padding:1rem;border-radius:var(--radius-sm);text-align:center;"',
   'dash-green-pale-box'],
  ['style="background:var(--bg-secondary);border-radius:var(--radius-sm);padding:1rem;color:var(--text-muted);font-size:0.85rem;"',
   'dash-info-box'],
  ['style="background:var(--accent-light);border:1px solid var(--accent);border-radius:var(--radius);padding:1.5rem;margin-bottom:1.5rem;"',
   'dash-accent-panel'],
  ['style="border:2px dashed var(--green);border-radius:var(--radius);padding:2rem;text-align:center;background:var(--accent-light);cursor:pointer;transition:all 0.3s ease;"',
   'dash-drop-zone'],

  // ── Pass 6: typography ────────────────────────────────────────────────────
  ['style="margin:0;font-size:1.25rem;font-weight:700;"',
   'dash-heading-lg'],
  ['style="color:var(--text-muted);font-weight:400;font-size:.85rem;"',
   'dash-meta-text'],
  ['style="color:var(--text);margin-bottom:1rem;font-size:0.95rem;"',
   'dash-body-text'],
  ['style="color:var(--text);font-weight:600;margin-bottom:0.3rem;"',
   'dash-field-name'],
  ['style="color:var(--blue);"',
   'dash-text-blue'],
  ['style="color:#f44336;"',
   'dash-text-danger'],
  ['style="color:#6a1b9a;"',
   'dash-text-purple'],
  ['style="font-weight:700;color:#f57f17;"',
   'dash-text-amber'],
  ['style="font-size:2rem;margin-bottom:0.5rem;"',
   'dash-icon-lg'],
  ['style="font-size:.88rem; color:var(--text-muted);"',
   'dash-dim-88'],
  ['style="font-size:.77rem;margin-top:5px;"',
   'dash-hint-77'],

  // ── Pass 6: misc ──────────────────────────────────────────────────────────
  ['style="width: 100px;"',
   'dash-w-100'],
  ['style="height:200px;border-radius:8px;"',
   'dash-img-preview'],
  ['style="height:105px;"',
   'dash-h-105'],
  ['style="padding:10px;text-align:left;border-bottom:2px solid var(--border);"',
   'dash-th-cell'],
  ['style="margin:0.5rem 0 0 1.5rem;padding:0;"',
   'dash-list-indent'],
  ['style="margin-top:3px;"',
   'dash-mt-3px'],
  ['style="display:none;margin-bottom:8px;"',
   'dash-hidden-mb2'],
  ['style="display:none;background:var(--red-dark);color:white;border-radius:10px;padding:2px 8px;font-size:.72rem;margin-left:4px;"',
   'dash-badge-err'],
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
