/**
 * dashboard-helpers-admin.js — admin read-only monitor for the Helper board
 * (Meaning Layer #2). Lives on the Gamification → "น้ำใจ" tab.
 *
 * Read-only: every state transition is a tenant action (post/accept/complete).
 * The one admin power here is moderation — cancel an abusive/stale request via
 * the cancelHelpRequest callable (admin path → cancelledBy:'admin', §7-I explicit
 * click). Reads all requests across buildings (rule: admin reads any helpRequest).
 *
 * Top-level function declarations (NOT an IIFE) so the dashboard tab-switcher +
 * event hub reach loadHelpersAdmin / cancelHelperRequest by bareword global
 * lookup (§7-QQ/CC). Listener is window-attached for cross-script teardown.
 */

// §7-CC: window-attached so cleanupAdminListeners can tear it down cross-script.
window._helpersAdminUnsub = null;
let _helpersAdminCache = [];

const HELP_STATUS_LABEL = {
  open: '🟡 รอรับ', accepted: '🔵 กำลังช่วย', done: '✅ เสร็จ', cancelled: '⚪ ยกเลิก',
};
const HELP_CAT_LABEL = {
  lifting: 'ยกของ', errand: 'ธุระ', petcare: 'สัตว์เลี้ยง', tech: 'อุปกรณ์', other: 'อื่น ๆ',
};

function _hEsc(s) { return String(s == null ? '' : s); }
function _hWho(building, room) { return building && room ? ((building === 'nest' ? 'Nest ' : 'ห้อง ') + room) : '—'; }
function _hStars(n) { const s = Math.max(0, Math.min(5, Number(n) || 0)); return s ? '⭐'.repeat(s) : '—'; }
function _hMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const n = Date.parse(ts); return Number.isFinite(n) ? n : 0;
}
function _hWhen(ts) {
  const ms = _hMs(ts);
  if (!ms) return '—';
  try { return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }); }
  catch (_) { return '—'; }
}

function loadHelpersAdmin() {
  if (window._helpersAdminUnsub) return; // idempotent
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  window._helpersAdminUnsub = fs.onSnapshot(fs.collection(db, 'helpRequests'), snap => {
    _helpersAdminCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => _hMs(b.createdAt) - _hMs(a.createdAt));
    renderHelpersAdminTable();
  }, err => {
    console.warn('[helpers-admin] onSnapshot failed:', err);
    const t = document.getElementById('helpersAdminTable');
    if (t) t.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#b00020;padding:20px;">โหลดไม่สำเร็จ: ${_hEsc(err.message)}</td></tr>`;
  });
}

function renderHelpersAdminTable() {
  const tbody = document.getElementById('helpersAdminTable');
  const countEl = document.getElementById('helpersActiveCount');
  if (countEl) {
    const active = _helpersAdminCache.filter(r => r.status === 'open' || r.status === 'accepted').length;
    countEl.textContent = String(active);
  }
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!_helpersAdminCache.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted);">ยังไม่มีคำขอช่วยเหลือ</td>';
    tbody.appendChild(tr);
    return;
  }
  _helpersAdminCache.forEach(r => {
    const tr = document.createElement('tr');
    const td = (txt, mut) => { const c = document.createElement('td'); c.textContent = txt; if (mut) { c.style.fontSize = '.82rem'; c.style.color = 'var(--text-muted)'; } return c; };
    tr.appendChild(td(_hWho(r.building, r.room)));
    const titleTd = td(_hEsc(r.title));
    if (r.category && HELP_CAT_LABEL[r.category]) {
      const tag = document.createElement('div');
      tag.style.cssText = 'font-size:.74rem;color:var(--text-muted);';
      tag.textContent = HELP_CAT_LABEL[r.category];
      titleTd.appendChild(tag);
    }
    tr.appendChild(titleTd);
    tr.appendChild(td(r.helperUid ? _hWho(r.helperBuilding, r.helperRoom) : '—', true));
    const stTd = document.createElement('td');
    stTd.style.cssText = 'font-size:.82rem;font-weight:600;';
    stTd.textContent = HELP_STATUS_LABEL[r.status] || r.status || '—';
    tr.appendChild(stTd);
    tr.appendChild(td(_hStars(r.rating), true));
    tr.appendChild(td(_hWhen(r.createdAt), true));
    const actTd = document.createElement('td');
    if (r.status === 'open' || r.status === 'accepted') {
      const cancel = document.createElement('button');
      cancel.textContent = 'ยกเลิก';
      cancel.className = 'u-btn-tbl-del';
      cancel.addEventListener('click', () => cancelHelperRequest(r.id, r.title, cancel));
      actTd.appendChild(cancel);
    } else {
      actTd.textContent = '—';
    }
    tr.appendChild(actTd);
    tbody.appendChild(tr);
  });
}

// §7-I: explicit admin tap → cancelHelpRequest callable (admin path).
async function cancelHelperRequest(requestId, title, btn) {
  const ok = await window.ghConfirm(`ยกเลิกคำขอ "${_hEsc(title)}"? ผู้ขอและผู้ช่วยจะเห็นว่าคำขอถูกปิด`, { danger: true });
  if (!ok) return;
  const fn = window.firebase?.functions?.httpsCallable?.('cancelHelpRequest');
  if (!fn) { window.ghAlert('Firebase functions ยังไม่พร้อม', { title: 'ขัดข้อง' }); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    await fn({ requestId });
    if (typeof showToast === 'function') showToast('ยกเลิกคำขอแล้ว', 'success');
    // The onSnapshot table auto-refreshes (status → cancelled).
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'ยกเลิก'; }
    window.ghAlert('ยกเลิกไม่สำเร็จ: ' + (e.message || e), { title: 'ขัดข้อง' });
  }
}

// Cross-script exports (tab-switcher + per-row handlers reach these).
if (typeof window !== 'undefined') {
  window.loadHelpersAdmin = loadHelpersAdmin;
  window.cancelHelperRequest = cancelHelperRequest;
}
