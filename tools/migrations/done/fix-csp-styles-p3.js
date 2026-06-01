/**
 * fix-csp-styles-p3.js — Phase 3 targeted replacements for remaining
 * .style.color / .style.background / .style.cssText / .style.display-read patterns.
 *
 * Run: node tools/fix-csp-styles-p3.js [--dry-run]
 */
const fs   = require('fs');
const path = require('path');
const DRY  = process.argv.includes('--dry-run');
const SHARED = path.join(__dirname, '../shared');

const PATCHES = [

  // ══════════════════════════════════════════════════════════════
  // dashboard-content-features.js
  // ══════════════════════════════════════════════════════════════
  { file: 'dashboard-content-features.js', patches: [

    [`toast.style.cssText = 'position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';`,
     `toast.className = 'u-toast';`],

    [`note.style.cssText='background:#e3f2fd;border-radius:8px;padding:10px 12px;font-size:.82rem;color:#1565c0;margin-bottom:12px;';`,
     `note.className = 'u-note-blue';`],
  ]},

  // ══════════════════════════════════════════════════════════════
  // dashboard-payment-verify.js
  // ══════════════════════════════════════════════════════════════
  { file: 'dashboard-payment-verify.js', patches: [

    [`modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;';`,
     `modal.className = 'u-modal-overlay';`],
  ]},

  // ══════════════════════════════════════════════════════════════
  // dashboard-meter-import.js  (replace 5-state color logic → CSS class map)
  // ══════════════════════════════════════════════════════════════
  { file: 'dashboard-meter-import.js', patches: [

    [`  let bgColor = 'var(--accent-light)';
  let borderColor = 'var(--accent)';

  if (type === 'success') {
    bgColor = '#e8f5e9';
    borderColor = '#2e7d32';
  } else if (type === 'error') {
    bgColor = '#ffebee';
    borderColor = '#c62828';
  } else if (type === 'warning') {
    bgColor = '#fff3e0';
    borderColor = '#e65100';
  } else if (type === 'info') {
    bgColor = '#e3f2fd';
    borderColor = '#1565c0';
  }

  const msgDiv = document.createElement('div');
  msgDiv.style.cssText = \`background:\${bgColor};border-left:4px solid \${borderColor};padding:1rem;border-radius:4px;color:var(--text);\`;`,
     `  const _cssMap = { success: 'u-msg-ok', error: 'u-msg-err', warning: 'u-msg-warn', info: 'u-msg-info' };

  const msgDiv = document.createElement('div');
  msgDiv.className = _cssMap[type] || 'u-msg-default';`],
  ]},

  // ══════════════════════════════════════════════════════════════
  // dashboard-requests-admin.js  (status colors + photo modal)
  // ══════════════════════════════════════════════════════════════
  { file: 'dashboard-requests-admin.js', patches: [

    // Status el — 3 states
    [`    statusEl.style.color = 'var(--green-dark)';`,
     `    statusEl.classList.remove('u-color-amber','u-color-muted'); statusEl.classList.add('u-color-green-dk');`],

    [`    statusEl.style.color = '#b45309';`,
     `    statusEl.classList.remove('u-color-green-dk','u-color-muted'); statusEl.classList.add('u-color-amber');`],

    [`    statusEl.style.color = 'var(--text-muted)';`,
     `    statusEl.classList.remove('u-color-green-dk','u-color-amber'); statusEl.classList.add('u-color-muted');`],

    // Toggle button — danger vs green
    [`      toggleBtn.style.background = '#c62828';`,
     `      toggleBtn.classList.remove('u-btn-green'); toggleBtn.classList.add('u-btn-red');`],

    [`      toggleBtn.style.background = 'var(--green-dark)';`,
     `      toggleBtn.classList.remove('u-btn-red'); toggleBtn.classList.add('u-btn-green');`],

    // Photo slip viewer modal
    [`modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';`,
     `modal.className = 'u-modal-overlay u-photo-overlay';`],

    [`img.style.cssText = 'max-width:100%;max-height:90vh;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';`,
     `img.className = 'u-photo-img';`],
  ]},

  // ══════════════════════════════════════════════════════════════
  // dashboard-bill.js  (inline span with style= and event handlers)
  // ══════════════════════════════════════════════════════════════
  { file: 'dashboard-bill.js', patches: [

    [`return\`<span onclick="showPayDetail('\${r.id}')" title="คลิกดูรายละเอียด / แก้ไข" style="padding:3px 10px;border-radius:20px;font-size:.76rem;font-weight:700;background:#e8f5e9;color:var(--green-dark);border:1px solid #a5d6a7;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='#c8e6c9'" onmouseout="this.style.background='#e8f5e9'">✅ \${r.id}</span>\``,
     `return\`<span onclick="showPayDetail('\${r.id}')" title="คลิกดูรายละเอียด / แก้ไข" class="u-bill-paid-badge">✅ \${r.id}</span>\``],

    [`return\`<span onclick="selectRoomForBill('\${r.id}')" title="คลิกเพื่อออกบิล" style="padding:3px 10px;border-radius:20px;font-size:.76rem;font-weight:600;background:#fff3e0;color:#e65100;border:1px solid #ffcc80;cursor:pointer;">⏳ \${r.id}</span>\``,
     `return\`<span onclick="selectRoomForBill('\${r.id}')" title="คลิกเพื่อออกบิล" class="u-bill-pending-badge">⏳ \${r.id}</span>\``],
  ]},

  // ══════════════════════════════════════════════════════════════
  // dashboard-property.js  (filter-btn / filter-btn-nest / view-btn)
  // ══════════════════════════════════════════════════════════════
  { file: 'dashboard-property.js', patches: [

    // filter-btn inactive (appears for both rooms and nest — same string)
    [`    btn.style.background = 'white';
    btn.style.color = btn.style.borderColor;`,
     `    // CSS .filter-btn handles inactive state`],

    // filter-btn active (rooms)
    [`  activeBtn.style.background = activeBtn.style.borderColor || 'var(--green-dark)';
  activeBtn.style.color = 'white';`,
     `  // CSS .filter-btn.active handles active state`],

    // view-btn (rooms): remove bg+color writes, keep border
    [`  buttons.forEach(b=>b.classList.remove('active'));
  buttons.forEach(b=>b.style.background='none');
  buttons.forEach(b=>b.style.color='var(--text)');
  buttons.forEach(b=>b.style.border='1.5px solid var(--border)');

  btn.classList.add('active');
  btn.style.background='var(--green-pale)';
  btn.style.color='var(--green-dark)';
  btn.style.border='1.5px solid var(--green)';`,
     `  buttons.forEach(b=>b.classList.remove('active'));
  buttons.forEach(b=>b.style.border='1.5px solid var(--border)');

  btn.classList.add('active');
  btn.style.border='1.5px solid var(--green)';`],

    // view-btn (Nest): remove bg+color writes, keep border
    [`  buttons.forEach(b => {
    b.classList.remove('active');
    b.style.background = 'none';
    b.style.color = 'var(--text)';
    b.style.border = '1.5px solid var(--border)';
  });

  btn.classList.add('active');
  btn.style.background = '#e3f2fd';
  btn.style.color = '#1565c0';
  btn.style.border = '1.5px solid #2196f3';`,
     `  buttons.forEach(b => {
    b.classList.remove('active');
    b.style.border = '1.5px solid var(--border)';
  });

  btn.classList.add('active');
  btn.style.border = '1.5px solid var(--green)';`],
  ]},

  // ══════════════════════════════════════════════════════════════
  // dashboard-main.js  (people-mgmt tab + batchModal display check)
  // ══════════════════════════════════════════════════════════════
  { file: 'dashboard-main.js', patches: [

    // People tab — inactive: replace style.color + style.borderBottomColor with classList
    [`    button.style.color = '#999';
    button.style.borderBottomColor = 'transparent';`,
     `    button.classList.remove('active');`],

    // People tab — active: replace style.borderBottomColor with classList.add
    [`    // CSS .people-mgmt-tab.active handles active state
    btn.style.borderBottomColor = 'var(--green)';`,
     `    btn.classList.add('active');`],

    // batchModal display read → classList
    [`if (batchModal && batchModal.style.display === 'flex') {`,
     `if (batchModal && !batchModal.classList.contains('u-hidden')) {`],
  ]},

  // ══════════════════════════════════════════════════════════════
  // dashboard-tenant-modal.js
  // ══════════════════════════════════════════════════════════════
  { file: 'dashboard-tenant-modal.js', patches: [

    // Display read → classList
    [`if (tenantModal && tenantModal.style.display !== 'none' && currentEditRoomId === roomId) {`,
     `if (tenantModal && !tenantModal.classList.contains('u-hidden') && currentEditRoomId === roomId) {`],

    // previewBtn cssText
    [`previewBtn.style.cssText = 'margin-left:8px;padding:6px 12px;background:#1976d2;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-size:0.8rem;font-family:\\'Sarabun\\',sans-serif;';`,
     `previewBtn.className = 'u-btn-preview';`],

    // Section display read → classList
    [`  if (section.style.display !== 'none') { section.classList.add('u-hidden'); return; }`,
     `  if (!section.classList.contains('u-hidden')) { section.classList.add('u-hidden'); return; }`],
  ]},

  // ══════════════════════════════════════════════════════════════
  // dashboard-tenant-page.js
  // ══════════════════════════════════════════════════════════════
  { file: 'dashboard-tenant-page.js', patches: [

    // Filter-btn-tenant: remove inline style writes (classList.toggle already there)
    [`    b.style.background=i===0?'var(--green-dark)':'white';
    b.style.color=i===0?'white':b.style.borderColor||'#666';`,
     `    // CSS .filter-btn-tenant.active handles active state`],

    // page-tenant display read
    [`if(document.getElementById('page-tenant')?.style.display!=='none'){`,
     `if(!document.getElementById('page-tenant')?.classList.contains('u-hidden')){`],

    // page-property display read
    [`if(document.getElementById('page-property')?.style.display!=='none'){`,
     `if(!document.getElementById('page-property')?.classList.contains('u-hidden')){`],

    // property-nest-section display read
    [`const nestVisible = document.getElementById('property-nest-section')?.style.display!=='none';`,
     `const nestVisible = !document.getElementById('property-nest-section')?.classList.contains('u-hidden');`],
  ]},

  // ══════════════════════════════════════════════════════════════
  // dashboard-extra.js  (simple single-line replacements only)
  // ══════════════════════════════════════════════════════════════
  { file: 'dashboard-extra.js', patches: [

    // Connection dot
    [`    dot.style.background = '#00cc00';`,
     `    dot.classList.remove('u-dot-offline'); dot.classList.add('u-dot-online');`],

    [`    dot.style.background = '#cc0000';`,
     `    dot.classList.remove('u-dot-online'); dot.classList.add('u-dot-offline');`],

    // Lease request filter buttons
    [`    b.style.background = '#eee'; b.style.color = '#333';`,
     `    b.classList.remove('active');`],

    [`  if (btn) { btn.style.background = 'var(--green-dark)'; btn.style.color = 'white'; }`,
     `  if (btn) { btn.classList.add('active'); }`],

    // Edit-tenant modal title
    [`  title.style.cssText = 'font-weight:700;font-size:1.1rem;margin-bottom:1.5rem;';`,
     `  title.className = 'u-modal-title';`],

    // errorEl inline styles
    [`      errorEl.classList.remove('u-hidden');
      errorEl.textContent = errorMsg;
      errorEl.style.color = '#d32f2f';
      errorEl.style.fontSize = '0.85rem';
      errorEl.style.marginTop = '4px';`,
     `      errorEl.classList.remove('u-hidden');
      errorEl.classList.add('u-error-text');
      errorEl.textContent = errorMsg;`],

    // Gamification tab buttons
    [`  document.querySelectorAll('#page-gamification button').forEach(b => b.style.color = 'var(--text-muted)');
  document.querySelectorAll('#page-gamification button').forEach(b => b.style.borderBottom = '3px solid transparent');
  btn.style.color = '#2d8653';
  btn.style.borderBottom = '3px solid #2d8653';`,
     `  document.querySelectorAll('#page-gamification button').forEach(b => b.classList.remove('u-gamification-tab-active'));
  document.querySelectorAll('#page-gamification button').forEach(b => b.classList.add('u-gamification-tab'));
  btn.classList.add('u-gamification-tab-active');`],

    // Expense table note cell
    [`const tdNote = document.createElement('td'); tdNote.style.fontSize = '.8rem'; tdNote.style.color = 'var(--text-muted)'; tdNote.textContent = esc(r.note); tr.appendChild(tdNote);`,
     `const tdNote = document.createElement('td'); tdNote.className = 'u-text-sm u-color-muted'; tdNote.textContent = esc(r.note); tr.appendChild(tdNote);`],

    // Expense edit / delete buttons
    [`editBtn.textContent = 'Edit'; editBtn.style.cssText = 'padding:4px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:4px;cursor:pointer;margin-right:4px;font-family:Sarabun,sans-serif;font-size:.8rem;';`,
     `editBtn.textContent = 'Edit'; editBtn.className = 'u-btn-tbl-edit';`],

    [`delBtn.textContent = 'Delete'; delBtn.style.cssText = 'padding:4px 10px;background:#ffebee;color:#c62828;border:1px solid #c62828;border-radius:4px;cursor:pointer;font-family:Sarabun,sans-serif;font-size:.8rem;';`,
     `delBtn.textContent = 'Delete'; delBtn.className = 'u-btn-tbl-del';`],

    // Historical data migrate button
    [`    btn.style.cssText = 'background:#1565c0;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:.78rem;font-weight:700;cursor:pointer;margin-left:8px;font-family:inherit;';`,
     `    btn.className = 'u-btn-upload';`],

    // billingContent display read
    [`  if (billingContent && billingContent.style.display !== 'none') {`,
     `  if (billingContent && !billingContent.classList.contains('u-hidden')) {`],

    // toggleAddEventForm display read (broken after phase 1)
    [`  if (form.style.display !== 'none') {`,
     `  if (!form.classList.contains('u-hidden')) {`],

    // toggleAddProviderForm: fix broken toggle+focus logic
    [`  form.classList.toggle('u-hidden', !(form.style.display === 'none'));
  if (form.style.display === 'block') {
    document.getElementById('providerType').focus();
  }`,
     `  form.classList.toggle('u-hidden');
  if (!form.classList.contains('u-hidden')) {
    document.getElementById('providerType').focus();
  }`],

    // toggleAddDocForm: fix broken toggle+focus logic
    [`  form.classList.toggle('u-hidden', !(form.style.display === 'none'));
  if (form.style.display === 'block') {
    document.getElementById('docTitle').focus();
  }`,
     `  form.classList.toggle('u-hidden');
  if (!form.classList.contains('u-hidden')) {
    document.getElementById('docTitle').focus();
  }`],
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
    if (oldStr === newStr) continue;
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
