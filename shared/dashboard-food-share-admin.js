/**
 * dashboard-food-share-admin.js — admin read-only monitor for the Food sharing
 * feed (Meaning Layer #4). Lives on the Gamification → "แบ่งปันอาหาร" tab.
 *
 * Read-only: every state transition is a tenant action (share/claim). The one
 * admin power is moderation — cancel an abusive/stale AVAILABLE share via the
 * cancelFood callable (admin path → cancelledBy:'admin', §7-I explicit click).
 * Reads all shares across buildings (rule: admin reads any). Shows the points the
 * SHARER earned on claim (the only board here that awards points).
 *
 * Top-level function declarations (NOT an IIFE) so the dashboard tab-switcher +
 * event hub reach loadFoodShareAdmin / cancelFoodShareAdmin by bareword global
 * lookup (§7-QQ/CC). Listener is window-attached for teardown.
 */

window._foodShareAdminUnsub = null;
let _foodShareAdminCache = [];

const FOOD_STATUS_LABEL = {
  available: '🟢 เปิดให้', claimed: '✅ รับแล้ว', cancelled: '⚪ ยกเลิก',
};
const FOOD_CAT_LABEL = {
  meal: 'อาหารจานหลัก', snack: 'ของว่าง', fruit: 'ผลไม้',
  drink: 'เครื่องดื่ม', ingredient: 'เครื่องปรุง/วัตถุดิบ', other: 'อื่น ๆ',
};

function _foodEsc(s) { return String(s == null ? '' : s); }
function _foodWho(building, room) { return building && room ? ((building === 'nest' ? 'Nest ' : 'ห้อง ') + room) : '—'; }
function _foodMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const n = Date.parse(ts); return Number.isFinite(n) ? n : (Number.isFinite(+ts) ? +ts : 0);
}
function _foodWhen(ts) {
  const ms = _foodMs(ts);
  if (!ms) return '—';
  try { return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }); }
  catch (_) { return '—'; }
}

function loadFoodShareAdmin() {
  if (window._foodShareAdminUnsub) return; // idempotent
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  window._foodShareAdminUnsub = fs.onSnapshot(fs.collection(db, 'foodShares'), snap => {
    _foodShareAdminCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => _foodMs(b.createdAt) - _foodMs(a.createdAt));
    renderFoodShareAdminTable();
  }, err => {
    console.warn('[food-share-admin] onSnapshot failed:', err);
    const t = document.getElementById('foodShareAdminTable');
    if (t) t.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#b00020;padding:20px;">โหลดไม่สำเร็จ: ${_foodEsc(err.message)}</td></tr>`;
  });
}

function renderFoodShareAdminTable() {
  const tbody = document.getElementById('foodShareAdminTable');
  const countEl = document.getElementById('foodShareActiveCount');
  if (countEl) {
    const active = _foodShareAdminCache.filter(r => r.status === 'available').length;
    countEl.textContent = String(active);
  }
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!_foodShareAdminCache.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">ยังไม่มีการแบ่งปัน</td>';
    tbody.appendChild(tr);
    return;
  }
  _foodShareAdminCache.forEach(r => {
    const tr = document.createElement('tr');
    const td = (txt, mut) => { const c = document.createElement('td'); c.textContent = txt; if (mut) { c.style.fontSize = '.82rem'; c.style.color = 'var(--text-muted)'; } return c; };
    tr.appendChild(td(_foodWho(r.building, r.room)));
    const titleTd = td(_foodEsc(r.title) + (r.portions ? ` ×${r.portions}` : ''));
    const imgUrls = (Array.isArray(r.imageUrls) && r.imageUrls.length) ? r.imageUrls : (r.imageUrl ? [r.imageUrl] : []);
    if (imgUrls.length) {
      const thumb = document.createElement('img');
      thumb.src = imgUrls[0];            // https token URL — §7-XX safe
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.title = imgUrls.length > 1 ? `${imgUrls.length} รูป` : '';
      thumb.style.cssText = 'width:36px;height:36px;object-fit:cover;border-radius:6px;margin-right:8px;vertical-align:middle;';
      titleTd.insertBefore(thumb, titleTd.firstChild);
      if (imgUrls.length > 1) {
        const cnt = document.createElement('span');
        cnt.style.cssText = 'font-size:.7rem;color:var(--text-muted);margin-right:6px;';
        cnt.textContent = `📷${imgUrls.length}`;
        titleTd.insertBefore(cnt, thumb.nextSibling);
      }
    }
    if (r.category && FOOD_CAT_LABEL[r.category]) {
      const tag = document.createElement('div');
      tag.style.cssText = 'font-size:.74rem;color:var(--text-muted);';
      tag.textContent = FOOD_CAT_LABEL[r.category];
      titleTd.appendChild(tag);
    }
    if (r.status === 'claimed' && Number(r.sharerPointsAwarded) > 0) {
      const pr = document.createElement('div');
      pr.style.cssText = 'font-size:.76rem;color:var(--green-dark);margin-top:2px;';
      pr.textContent = `💚 +${Number(r.sharerPointsAwarded)} แต้มน้ำใจ`;
      titleTd.appendChild(pr);
    }
    tr.appendChild(titleTd);
    tr.appendChild(td(r.claimerUid ? _foodWho(r.claimerBuilding, r.claimerRoom) : '—', true));
    const stTd = document.createElement('td');
    stTd.style.cssText = 'font-size:.82rem;font-weight:600;';
    stTd.textContent = FOOD_STATUS_LABEL[r.status] || r.status || '—';
    tr.appendChild(stTd);
    tr.appendChild(td(_foodWhen(r.createdAt), true));
    const actTd = document.createElement('td');
    if (r.status === 'available') {
      const cancel = document.createElement('button');
      cancel.textContent = 'ลบ';
      cancel.className = 'u-btn-tbl-del';
      cancel.addEventListener('click', () => cancelFoodShareAdmin(r.id, r.title, cancel));
      actTd.appendChild(cancel);
    } else {
      actTd.textContent = '—';
    }
    tr.appendChild(actTd);
    tbody.appendChild(tr);
  });
}

// §7-I: explicit admin tap → cancelFood callable (admin path).
async function cancelFoodShareAdmin(shareId, title, btn) {
  const ok = await window.ghConfirm(`ลบรายการแบ่งปัน "${_foodEsc(title)}"? ผู้แบ่งจะเห็นว่าถูกปิด`, { danger: true });
  if (!ok) return;
  const fn = window.firebase?.functions?.httpsCallable?.('cancelFood');
  if (!fn) { window.ghAlert('Firebase functions ยังไม่พร้อม', { title: 'ขัดข้อง' }); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    await fn({ shareId });
    if (typeof showToast === 'function') showToast('ลบรายการแล้ว', 'success');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'ลบ'; }
    window.ghAlert('ลบไม่สำเร็จ: ' + (e.message || e), { title: 'ขัดข้อง' });
  }
}

// Cross-script exports (tab-switcher + per-row handlers reach these).
if (typeof window !== 'undefined') {
  window.loadFoodShareAdmin = loadFoodShareAdmin;
  window.cancelFoodShareAdmin = cancelFoodShareAdmin;
}
