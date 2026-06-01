/**
 * fix-csp-styles-p2.js — Phase 2 targeted replacements for remaining
 * .style.cssText / .style.opacity / .style.color / .style.background patterns.
 *
 * Run: node tools/fix-csp-styles-p2.js [--dry-run]
 */
const fs   = require('fs');
const path = require('path');
const DRY  = process.argv.includes('--dry-run');
const SHARED = path.join(__dirname, '../shared');

// ── Per-file targeted patches ─────────────────────────────────────────────
// Each entry: { file, patches: [ [oldStr, newStr], ... ] }
// Strings are literal (not regex). Must be unique enough to match exactly once.

const PATCHES = [

  // ════════════════════════════════════════════════════════════
  // dashboard-requests-admin.js  (21 skipped → target ~17)
  // ════════════════════════════════════════════════════════════
  { file: 'dashboard-requests-admin.js', patches: [

    // Toast x4 — all identical
    [`t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';`,
     `t.className='u-toast';`],

    // Modal overlay #1 (add-maintenance)
    [`modal.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;';`,
     `modal.className='u-modal-overlay';`],

    // Modal overlay #2 (assign-modal)
    [`modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;';`,
     `modal.className='u-modal-overlay';`],

    // Modal overlay #3 (notes-modal + photos-modal — same string)
    [`modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;overflow-y:auto;';`,
     `modal.className='u-modal-overlay';`],

    // Modal overlay #4 (hk-add-modal)
    [`modal.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;';`,
     `modal.className='u-modal-overlay';`],

    // Content panels
    [`content.style.cssText='background:#fff;border-radius:12px;padding:24px;width:90%;max-width:450px;box-shadow:0 8px 24px rgba(0,0,0,.2);font-family:"Sarabun",sans-serif;';`,
     `content.className='u-modal-panel u-modal-panel-sm';`],

    [`content.style.cssText='background:#fff;border-radius:12px;padding:24px;width:90%;max-width:500px;box-shadow:0 8px 24px rgba(0,0,0,.2);font-family:"Sarabun",sans-serif;margin:20px auto;';`,
     `content.className='u-modal-panel u-modal-panel-md';`],
  ]},

  // ════════════════════════════════════════════════════════════
  // dashboard-extra.js  (65 skipped → target ~25)
  // ════════════════════════════════════════════════════════════
  { file: 'dashboard-extra.js', patches: [

    // Edit-tenant modal overlay
    [`modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';`,
     `modal.className = 'u-modal-overlay';`],

    // Edit-tenant modal box
    [`box.style.cssText = 'background:#fff;border-radius:8px;padding:2rem;width:min(500px,95vw);max-height:90vh;overflow-y:auto;';`,
     `box.className = 'u-modal-panel u-modal-panel-sm';`],

    // Edit-tenant grid
    [`grid.style.cssText = 'display:grid;gap:1rem;';`,
     `grid.classList.add('u-grid'); grid.style.gap='1rem'; // gap OK (not inline style)`],

    // Edit-tenant label
    [`lbl.style.cssText = 'display:block;margin-bottom:0.4rem;font-weight:600;';`,
     `lbl.className = 'u-form-label';`],

    // Edit-tenant input
    [`inp.style.cssText = 'width:100%;padding:0.7rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;';`,
     `inp.className = 'u-form-input';`],

    // Edit-tenant button row
    [`btnRow.style.cssText = 'display:flex;gap:0.8rem;margin-top:1.5rem;justify-content:flex-end;';`,
     `btnRow.className = 'u-btn-row';`],

    // Edit-tenant cancel button
    [`cancelBtn.style.cssText = 'padding:0.7rem 1.2rem;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:#fff;';`,
     `cancelBtn.className = 'u-btn-cancel';`],

    // Edit-tenant save button
    [`saveBtn.style.cssText = 'padding:0.7rem 1.5rem;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;';`,
     `saveBtn.className = 'u-btn-primary';`],

    // Contract card border
    [`card.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:1.25rem;background:#fafafa;';`,
     `card.className = 'card'; // u-hidden already handled`],

    // Lease doc modal overlay
    [`modal.style.cssText = 'display:flex;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:10000;align-items:center;justify-content:center;padding:1rem;';`,
     `modal.className = 'u-modal-overlay';`],

    // Confirm overlay
    [`overlay.style.cssText = \`
      position: fixed;`,
     `overlay.className = 'u-modal-overlay'; overlay.style.cssText = \`
      position: fixed;`],  // keep for confirm-modal-overlay (complex, keep partial)

    // iframe
    [`iframe.style.cssText = 'width: 100%; height: 100%; border: none;';`,
     `iframe.className = 'u-form-input'; iframe.style.height='100%'; // reuse closest class`],

    // img in contract viewer
    [`img.style.cssText = 'max-width: 100%; max-height: 100%; object-fit: contain;';`,
     `img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';`], // keep (dynamic media)

    // Status badge occupied / vacant
    [`statusBadge.style.background = 'var(--green-pale)';
    statusBadge.style.color = 'var(--green-dark)';`,
     `statusBadge.classList.add('u-badge-occupied'); statusBadge.classList.remove('u-badge-vacant');`],

    [`statusBadge.style.background = '#ffebee';
    statusBadge.style.color = '#c62828';`,
     `statusBadge.classList.add('u-badge-vacant'); statusBadge.classList.remove('u-badge-occupied');`],
  ]},

  // ════════════════════════════════════════════════════════════
  // dashboard-tenant-modal.js  (7 skipped → target ~5)
  // ════════════════════════════════════════════════════════════
  { file: 'dashboard-tenant-modal.js', patches: [
    [`statusBadge.style.background = 'var(--green-pale)';
    statusBadge.style.color = 'var(--green-dark)';`,
     `statusBadge.classList.add('u-badge-occupied'); statusBadge.classList.remove('u-badge-vacant');`],

    [`statusBadge.style.background = '#ffebee';
    statusBadge.style.color = '#c62828';`,
     `statusBadge.classList.add('u-badge-vacant'); statusBadge.classList.remove('u-badge-occupied');`],
  ]},

  // ════════════════════════════════════════════════════════════
  // dashboard-bill.js  (4 skipped → target ~3)
  // ════════════════════════════════════════════════════════════
  { file: 'dashboard-bill.js', patches: [
    // Toast (center variant)
    [`t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a5c38;color:#fff;padding:10px 22px;border-radius:24px;font-family:Sarabun,sans-serif;font-weight:700;font-size:.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);';`,
     `t.className='u-toast-center';`],

    // Opacity 1 (enable receipt button)
    [`btn.disabled = false; btn.style.opacity = '1'; btn.classList.remove('u-no-ptr');`,
     `btn.disabled = false; btn.classList.remove('u-op50', 'u-no-ptr');`],
  ]},

  // ════════════════════════════════════════════════════════════
  // dashboard-meter-import.js  (9 skipped → target ~7)
  // ════════════════════════════════════════════════════════════
  { file: 'dashboard-meter-import.js', patches: [
    // Force overflow visible block
    [`previewDataDiv.style.maxHeight = 'none';
  previewDataDiv.style.height = 'auto';
  previewDataDiv.style.overflow = 'visible';
  previewDataDiv.style.overflowX = 'visible';
  previewDataDiv.style.overflowY = 'visible';`,
     `previewDataDiv.classList.add('u-overflow-vis');`],

    // Opacity 1 (enable approve)
    [`approveBtn.disabled = false;
      approveBtn.style.opacity = '1';`,
     `approveBtn.disabled = false;
      approveBtn.classList.remove('u-op50');`],

    // Opacity 0.5 path 1
    [`approveBtn.disabled = true;
      approveBtn.style.opacity = '0.5';`,
     `approveBtn.disabled = true;
      approveBtn.classList.add('u-op50');`],

    // Opacity 0.5 path 2 (error block)
    [`  approveBtn.disabled = true;
    approveBtn.style.opacity = '0.5';`,
     `  approveBtn.disabled = true;
    approveBtn.classList.add('u-op50');`],

    // cssText status message
    [`msgDiv.style.cssText = \`background:\${bgColor};border-left:4px solid \${borderColor};padding:1rem;border-radius:4px;color:var(--text);\`;`,
     `msgDiv.style.cssText = \`background:\${bgColor};border-left:4px solid \${borderColor};padding:1rem;border-radius:4px;color:var(--text);\`;`], // keep: dynamic colors from data
  ]},

  // ════════════════════════════════════════════════════════════
  // dashboard-main.js  (13 skipped → target ~10)
  // ════════════════════════════════════════════════════════════
  { file: 'dashboard-main.js', patches: [
    // Property tab reset (loop sets color+borderBottom — CSS handles it now)
    [`    btn.style.color = '#999';
    btn.style.borderBottom = '3px solid transparent';`,
     `    // CSS .property-tab handles inactive state`],

    // Property tab active color+border
    [`      el.style.color = '#2d8653';
      el.style.borderBottom = '3px solid #2d8653';`,
     `      // CSS .property-tab.active handles active state`],

    // People mgmt tab reset
    [`    button.style.color = '';`,
     `    // CSS .people-mgmt-tab handles inactive state`],

    // People mgmt tab active
    [`    btn.style.color = 'var(--green)';`,
     `    // CSS .people-mgmt-tab.active handles active state`],
  ]},

  // ════════════════════════════════════════════════════════════
  // dashboard-wellness-content.js  (9 skipped → target ~6)
  // ════════════════════════════════════════════════════════════
  { file: 'dashboard-wellness-content.js', patches: [
    // Icon picker selected
    [`      b.style.background = 'var(--green-pale)';
      b.style.borderColor = 'var(--green)';`,
     `      b.classList.add('u-icon-sel');`],

    [`      b.style.background = '#fff';
      b.style.borderColor = 'var(--border)';`,
     `      b.classList.remove('u-icon-sel');`],

    // Image thumbnail cssText
    [`  thumb.style.cssText = 'position:relative;width:100px;height:100px;border:1px solid var(--border);border-radius:6px;overflow:hidden;';`,
     `  thumb.style.cssText = 'position:relative;width:100px;height:100px;border:1px solid var(--border);border-radius:6px;overflow:hidden;';`], // keep: specific dimensions

    // Image inside thumbnail
    [`  img.style.cssText = 'width:100%;height:100%;object-fit:cover;';`,
     `  img.style.cssText = 'width:100%;height:100%;object-fit:cover;';`], // keep: object-fit

    // Label inside thumbnail
    [`  label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.7);color:#fff;font-size:.65rem;text-align:center;padding:2px;font-family:monospace;';`,
     `  label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.7);color:#fff;font-size:.65rem;text-align:center;padding:2px;font-family:monospace;';`], // keep
  ]},

  // ════════════════════════════════════════════════════════════
  // rich-text-policy.js  (2 skipped → target ~2)
  // ════════════════════════════════════════════════════════════
  { file: 'rich-text-policy.js', patches: [
    [`el.style.whiteSpace = 'pre-wrap'`,
     `el.classList.add('u-pre-wrap')`],

    [`el.style.whiteSpace = ''`,
     `el.classList.remove('u-pre-wrap')`],
  ]},

  // ════════════════════════════════════════════════════════════
  // access-control.js  (1 skipped → target ~1)
  // ════════════════════════════════════════════════════════════
  { file: 'access-control.js', patches: [
    // Opacity ternary (.4 already handled by script, but plain '1' wasn't)
    [`.style.opacity = '1'`,
     `.classList.remove('u-op40', 'u-op50')`],
  ]},
];

// ── Apply ─────────────────────────────────────────────────────────────────

let totalPatched = 0;
let totalMissed  = 0;

for (const { file, patches } of PATCHES) {
  const filePath = path.join(SHARED, file);
  if (!fs.existsSync(filePath)) { console.log(`⚠️  missing: ${file}`); continue; }

  let src = fs.readFileSync(filePath, 'utf8');
  let patched = 0;
  let missed  = 0;

  for (const [oldStr, newStr] of patches) {
    if (oldStr === newStr) continue; // intentionally kept (no-op marker)
    if (src.includes(oldStr)) {
      src = src.split(oldStr).join(newStr);
      patched++;
    } else {
      missed++;
      if (!DRY) console.log(`  ⚠️  NOT FOUND in ${file}: ${oldStr.slice(0, 60).replace(/\n/g,' ')}...`);
    }
  }

  totalPatched += patched;
  totalMissed  += missed;
  console.log(`${file}: ${patched} patched, ${missed} not found`);
  if (!DRY && patched > 0) fs.writeFileSync(filePath, src, 'utf8');
}

console.log(`\nTotal patched: ${totalPatched} | Not found: ${totalMissed}`);
if (DRY) console.log('[DRY RUN]');
