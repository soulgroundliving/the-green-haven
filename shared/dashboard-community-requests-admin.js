/**
 * dashboard-community-requests-admin.js — admin read-only monitor for the
 * Community-requests board (Meaning Layer #3). Lives on the Gamification →
 * "ขอ-ยืมของ" tab, next to its sibling Helper-board monitor.
 *
 * Read-only: every state transition is a tenant action (post/offer/fulfill). The
 * one admin power here is moderation — cancel an abusive/stale request via the
 * cancelCommunityRequest callable (admin path → cancelledBy:'admin', §7-I explicit
 * click). Reads all requests across buildings (rule: admin reads any). This board
 * never awards points, so there is no kindness/points column.
 *
 * Top-level function declarations (NOT an IIFE) so the dashboard tab-switcher +
 * event hub reach loadCommunityRequestsAdmin / cancelCommunityRequestAdmin by
 * bareword global lookup (§7-QQ/CC). Listener is window-attached for teardown.
 */

// §7-CC: window-attached so cleanupAdminListeners can tear it down cross-script.
window._creqAdminUnsub = null;
let _creqAdminCache = [];

const CREQ_STATUS_LABEL = {
  open: '🟡 รอผู้ให้', offered: '🔵 มีผู้ให้แล้ว', fulfilled: '✅ รับแล้ว', cancelled: '⚪ ยกเลิก',
};
const CREQ_CAT_LABEL = {
  tool: 'เครื่องมือ', kitchen: 'ของใช้ครัว', household: 'ของใช้ในบ้าน', electronics: 'อุปกรณ์ไฟฟ้า', other: 'อื่น ๆ',
};
// borrow/share kind — MIRRORS shared/tenant-community-requests.js KIND_LABEL.
const CREQ_KIND_LABEL = { borrow: '🔁 ขอยืม', have: '🎁 ขอแบ่ง' };

function _creqEsc(s) { return String(s == null ? '' : s); }
function _creqWho(building, room) { return building && room ? ((building === 'nest' ? 'Nest ' : 'ห้อง ') + room) : '—'; }
function _creqMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const n = Date.parse(ts); return Number.isFinite(n) ? n : 0;
}
function _creqWhen(ts) {
  const ms = _creqMs(ts);
  if (!ms) return '—';
  try { return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }); }
  catch (_) { return '—'; }
}

function loadCommunityRequestsAdmin() {
  if (window._creqAdminUnsub) return; // idempotent
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  window._creqAdminUnsub = fs.onSnapshot(fs.collection(db, 'communityRequests'), snap => {
    _creqAdminCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => _creqMs(b.createdAt) - _creqMs(a.createdAt));
    renderCommunityRequestsAdminTable();
  }, err => {
    console.warn('[community-requests-admin] onSnapshot failed:', err);
    const t = document.getElementById('communityRequestsAdminTable');
    if (t) t.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#b00020;padding:20px;">โหลดไม่สำเร็จ: ${_creqEsc(err.message)}</td></tr>`;
  });
}

function renderCommunityRequestsAdminTable() {
  const tbody = document.getElementById('communityRequestsAdminTable');
  const countEl = document.getElementById('communityRequestsActiveCount');
  if (countEl) {
    const active = _creqAdminCache.filter(r => r.status === 'open' || r.status === 'offered').length;
    countEl.textContent = String(active);
  }
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!_creqAdminCache.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">ยังไม่มีคำขอ</td>';
    tbody.appendChild(tr);
    return;
  }
  _creqAdminCache.forEach(r => {
    const tr = document.createElement('tr');
    const td = (txt, mut) => { const c = document.createElement('td'); c.textContent = txt; if (mut) { c.style.fontSize = '.82rem'; c.style.color = 'var(--text-muted)'; } return c; };
    tr.appendChild(td(_creqWho(r.building, r.room)));
    const titleTd = td(_creqEsc(r.title));
    const meta = [];
    if (r.requestKind && CREQ_KIND_LABEL[r.requestKind]) meta.push(CREQ_KIND_LABEL[r.requestKind]);
    if (r.category && CREQ_CAT_LABEL[r.category]) meta.push(CREQ_CAT_LABEL[r.category]);
    if (meta.length) {
      const tag = document.createElement('div');
      tag.style.cssText = 'font-size:.74rem;color:var(--text-muted);';
      tag.textContent = meta.join(' · ');
      titleTd.appendChild(tag);
    }
    if (r.status === 'fulfilled' && r.thankNote) {
      const nt = document.createElement('div');
      nt.style.cssText = 'font-size:.76rem;color:var(--text-muted);font-style:italic;margin-top:2px;';
      nt.textContent = '💬 ' + _creqEsc(r.thankNote);
      titleTd.appendChild(nt);
    }
    tr.appendChild(titleTd);
    tr.appendChild(td(r.offererUid ? _creqWho(r.offererBuilding, r.offererRoom) : '—', true));
    const stTd = document.createElement('td');
    stTd.style.cssText = 'font-size:.82rem;font-weight:600;';
    stTd.textContent = CREQ_STATUS_LABEL[r.status] || r.status || '—';
    tr.appendChild(stTd);
    tr.appendChild(td(_creqWhen(r.createdAt), true));
    const actTd = document.createElement('td');
    if (r.status === 'open' || r.status === 'offered') {
      const cancel = document.createElement('button');
      cancel.textContent = 'ยกเลิก';
      cancel.className = 'u-btn-tbl-del';
      cancel.addEventListener('click', () => cancelCommunityRequestAdmin(r.id, r.title, cancel));
      actTd.appendChild(cancel);
    } else {
      actTd.textContent = '—';
    }
    tr.appendChild(actTd);
    tbody.appendChild(tr);
  });
}

// §7-I: explicit admin tap → cancelCommunityRequest callable (admin path).
async function cancelCommunityRequestAdmin(requestId, title, btn) {
  const ok = await window.ghConfirm(`ยกเลิกคำขอ "${_creqEsc(title)}"? ผู้ขอและผู้ให้จะเห็นว่าคำขอถูกปิด`, { danger: true });
  if (!ok) return;
  const fn = window.firebase?.functions?.httpsCallable?.('cancelCommunityRequest');
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
  window.loadCommunityRequestsAdmin = loadCommunityRequestsAdmin;
  window.cancelCommunityRequestAdmin = cancelCommunityRequestAdmin;
}
