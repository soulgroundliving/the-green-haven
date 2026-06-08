/**
 * dashboard-quests-admin.js — admin catalog CRUD + pending-claim review queue
 * for Community Quests (Meaning Layer #1). Lives on the Gamification → เควส tab.
 *
 * Catalog: direct admin Firestore writes to `quests/` (rule: write if isAdmin —
 * mirrors the rewards catalog). Claims: read-only `questClaims/` (admin-read),
 * approve/reject via the reviewQuestClaim callable (§7-I — explicit click, the
 * CF re-checks the admin claim and is the only thing that moves points).
 *
 * Top-level function declarations (NOT an IIFE) so the event-delegation hub in
 * dashboard-main.js can reach openQuestEdit / closeQuestEdit / saveQuest by the
 * bareword global lookup it already uses for the rewards twins (§7-QQ/CC).
 */

// §7-CC: window-attached so cleanupAdminListeners can tear them down cross-script.
window._questsAdminUnsub = null;
window._questClaimsUnsub = null;
let _questsAdminCache = [];

const QUEST_VERIFY_LABEL = { self: 'กดรับเอง', auto: 'อัตโนมัติ', admin: 'รออนุมัติ' };
const QUEST_CADENCE_LABEL = { daily: 'รายวัน', weekly: 'รายสัปดาห์', once: 'ครั้งเดียว' };

function _qEsc(s) { return String(s == null ? '' : s); }

// ───────────────────────── Catalog (quests/) ──────────────────────────────
function loadQuestsAdmin() {
  if (window._questsAdminUnsub) return; // idempotent
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  window._questsAdminUnsub = fs.onSnapshot(fs.collection(db, 'quests'), snap => {
    _questsAdminCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 999) - (b.order || 999));
    renderQuestsAdminTable();
  }, err => {
    console.warn('[quests-admin] catalog onSnapshot failed:', err);
    const t = document.getElementById('questsAdminTable');
    if (t) t.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#b00020;padding:20px;">โหลดไม่สำเร็จ: ${_qEsc(err.message)}</td></tr>`;
  });
}

function renderQuestsAdminTable() {
  const tbody = document.getElementById('questsAdminTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!_questsAdminCache.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">ยังไม่มีเควส — กด "+ เพิ่มเควส" เพื่อสร้าง</td>';
    tbody.appendChild(tr);
    return;
  }
  _questsAdminCache.forEach(q => {
    const tr = document.createElement('tr');
    const td = (txt, mut) => { const c = document.createElement('td'); c.textContent = txt; if (mut) { c.style.fontSize = '.82rem'; c.style.color = 'var(--text-muted)'; } return c; };
    tr.appendChild(td(q.order || '—'));
    const tdIcon = document.createElement('td'); tdIcon.style.fontSize = '1.3rem'; tdIcon.textContent = q.icon || '🎯'; tr.appendChild(tdIcon);
    tr.appendChild(td(_qEsc(q.title)));
    tr.appendChild(td(Number(q.rewardPoints || 0).toLocaleString()));
    tr.appendChild(td(QUEST_VERIFY_LABEL[q.verifyMode] || q.verifyMode || '—', true));
    tr.appendChild(td(QUEST_CADENCE_LABEL[q.cadence] || q.cadence || '—', true));
    const tdActive = document.createElement('td');
    tdActive.innerHTML = q.active === false
      ? '<span style="color:#b00020;font-weight:600;">ปิด</span>'
      : '<span style="color:var(--green-dark);font-weight:600;">เปิด</span>';
    tr.appendChild(tdActive);
    const tdActions = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.textContent = 'แก้ไข'; editBtn.className = 'u-btn-tbl-edit';
    editBtn.addEventListener('click', () => openQuestEdit(q.id));
    const delBtn = document.createElement('button');
    delBtn.textContent = 'ลบ'; delBtn.className = 'u-btn-tbl-del';
    delBtn.addEventListener('click', () => deleteQuest(q.id, q.title));
    tdActions.appendChild(editBtn); tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
}

// Show the autoSignal row only for `auto`, the cap row only for `self`.
function _questEditSyncRows() {
  const mode = document.getElementById('questEditVerifyMode')?.value;
  const autoRow = document.getElementById('questEditAutoSignalRow');
  const capRow = document.getElementById('questEditCapRow');
  if (autoRow) autoRow.style.display = mode === 'auto' ? '' : 'none';
  if (capRow) capRow.style.display = mode === 'self' ? '' : 'none';
}

function openQuestEdit(questId) {
  const modal = document.getElementById('questEditModal');
  if (!modal) return;
  const isNew = !questId;
  const g = id => document.getElementById(id);
  g('questEditTitle').textContent = isNew ? 'เพิ่มเควส' : 'แก้ไขเควส';
  g('questEditId').value = questId || '';
  const q = isNew ? {} : (_questsAdminCache.find(x => x.id === questId) || {});
  g('questEditTitleInput').value = q.title || '';
  g('questEditDesc').value = q.description || '';
  g('questEditIcon').value = q.icon || '🎯';
  g('questEditPoints').value = q.rewardPoints || '';
  g('questEditCadence').value = q.cadence === 'once' ? 'once' : 'daily';
  g('questEditVerifyMode').value = ['self', 'auto', 'admin'].includes(q.verifyMode) ? q.verifyMode : 'self';
  g('questEditAutoSignal').value = q.autoSignal === 'login_streak' ? 'login_streak' : 'checkin_today';
  g('questEditCap').value = q.selfDailyCap != null ? q.selfDailyCap : '';
  g('questEditBuilding').value = ['rooms', 'nest'].includes(q.building) ? q.building : 'all';
  g('questEditOrder').value = q.order || (_questsAdminCache.length + 1);
  g('questEditActive').checked = q.active !== false;
  // Bind the verifyMode→rows toggle once, then sync.
  const vm = g('questEditVerifyMode');
  if (vm && !vm._rowsBound) { vm.addEventListener('change', _questEditSyncRows); vm._rowsBound = true; }
  _questEditSyncRows();
  modal.style.display = 'flex';
  modal.classList.remove('u-hidden');
}

function closeQuestEdit() {
  const modal = document.getElementById('questEditModal');
  if (!modal) return;
  modal.style.display = '';
  modal.classList.add('u-hidden');
}

async function saveQuest() {
  const g = id => document.getElementById(id);
  const id = g('questEditId').value;
  const title = g('questEditTitleInput').value.trim();
  const rewardPoints = parseInt(g('questEditPoints').value, 10);
  const verifyMode = g('questEditVerifyMode').value;
  if (!title || !rewardPoints || rewardPoints < 1) {
    window.ghAlert('กรุณากรอกชื่อเควสและแต้มรางวัล (>0)', { title: 'ข้อมูลไม่ครบ' });
    return;
  }
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    window.ghAlert('Firestore ไม่พร้อมใช้งาน', { title: 'ขัดข้อง' });
    return;
  }
  const data = {
    title,
    description: g('questEditDesc').value.trim(),
    icon: g('questEditIcon').value.trim() || '🎯',
    rewardPoints,
    cadence: g('questEditCadence').value === 'once' ? 'once' : 'daily',
    verifyMode,
    building: ['rooms', 'nest'].includes(g('questEditBuilding').value) ? g('questEditBuilding').value : 'all',
    order: parseInt(g('questEditOrder').value, 10) || 99,
    active: g('questEditActive').checked,
    updatedAt: new Date().toISOString(),
  };
  // Mode-specific fields (only persist the one that applies; null the other so
  // an edit that switches modes doesn't leave a stale field behind).
  data.autoSignal = verifyMode === 'auto'
    ? (g('questEditAutoSignal').value === 'login_streak' ? 'login_streak' : 'checkin_today')
    : null;
  const capRaw = parseInt(g('questEditCap').value, 10);
  data.selfDailyCap = (verifyMode === 'self' && capRaw > 0) ? capRaw : null;

  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  try {
    if (id) {
      await fs.updateDoc(fs.doc(db, 'quests', id), data);
    } else {
      const slug = title.toLowerCase().replace(/[^฀-๿a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
      const newId = `${slug || 'quest'}-${Date.now().toString(36)}`;
      await fs.setDoc(fs.doc(db, 'quests', newId), { ...data, createdAt: new Date().toISOString() });
    }
    closeQuestEdit();
    if (typeof showToast === 'function') showToast(id ? '✅ บันทึกเควสแล้ว' : '✅ เพิ่มเควสแล้ว', 'success');
  } catch (e) {
    window.ghAlert('บันทึกไม่สำเร็จ: ' + e.message, { title: 'ขัดข้อง' });
  }
}

async function deleteQuest(questId, title) {
  const ok = await window.ghConfirm(`ลบเควส "${title}"? ลูกบ้านจะไม่เห็นเควสนี้อีก (ประวัติการรับยังอยู่)`, { danger: true });
  if (!ok) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  try {
    await fs.deleteDoc(fs.doc(db, 'quests', questId));
  } catch (e) {
    window.ghAlert('ลบไม่สำเร็จ: ' + e.message, { title: 'ขัดข้อง' });
  }
}

// ──────────────────── Review queue (questClaims, pending) ───────────────────
function loadQuestClaimsQueue() {
  if (window._questClaimsUnsub) return; // idempotent
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  // Single-field equality (auto-indexed); sort newest-first client-side.
  const q = fs.query(fs.collection(db, 'questClaims'), fs.where('status', '==', 'pending'));
  window._questClaimsUnsub = fs.onSnapshot(q, snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => _claimMs(b.claimedAt) - _claimMs(a.claimedAt));
    renderQuestClaimsQueue(rows);
  }, err => {
    console.warn('[quests-admin] claims onSnapshot failed:', err);
    const c = document.getElementById('questClaimsQueue');
    if (c) c.innerHTML = `<div class="dash-empty-msg" style="padding:14px;color:#b00020;">โหลดคำขอไม่สำเร็จ: ${_qEsc(err.message)}</div>`;
  });
}

function _claimMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const n = Date.parse(ts); return Number.isFinite(n) ? n : 0;
}

function renderQuestClaimsQueue(rows) {
  const cont = document.getElementById('questClaimsQueue');
  const countEl = document.getElementById('questClaimsCount');
  if (countEl) countEl.textContent = String(rows.length);
  if (!cont) return;
  cont.innerHTML = '';
  if (!rows.length) {
    cont.innerHTML = '<div class="dash-empty-msg" style="padding:14px;">— ไม่มีคำขอรอตรวจ —</div>';
    return;
  }
  rows.forEach(r => {
    const who = _claimWho(r);
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid var(--border);border-radius:10px;padding:.7rem .9rem;display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;';
    const left = document.createElement('div');
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:.92rem;';
    title.textContent = `${r.questTitle || 'เควส'} · +${Number(r.points || 0)} แต้ม`;
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:.8rem;color:var(--text-muted);';
    sub.textContent = r.note ? `${who} · “${r.note}”` : who;
    left.appendChild(title); left.appendChild(sub);
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;';
    const approve = document.createElement('button');
    approve.textContent = '✓ อนุมัติ';
    approve.style.cssText = 'padding:6px 12px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:.82rem;';
    approve.addEventListener('click', () => reviewClaim(r.id, 'approve', approve));
    const reject = document.createElement('button');
    reject.textContent = '✕ ปฏิเสธ';
    reject.style.cssText = 'padding:6px 12px;background:#f3f3f3;color:#b00020;border:1px solid #e0c0c0;border-radius:6px;cursor:pointer;font-weight:600;font-size:.82rem;';
    reject.addEventListener('click', () => reviewClaim(r.id, 'reject', reject));
    actions.appendChild(approve); actions.appendChild(reject);
    card.appendChild(left); card.appendChild(actions);
    cont.appendChild(card);
  });
}

function _claimWho(r) {
  // Best-effort display name; falls back to room/building.
  try {
    if (r.tenantId && window.PersonManager?.getPersonSync) {
      const p = window.PersonManager.getPersonSync(r.tenantId);
      if (p && (p.name || p.firstName)) return p.name || `${p.firstName} ${p.lastName || ''}`.trim();
    }
  } catch (_) { /* noop */ }
  if (r.building && r.roomId) return `${r.building === 'nest' ? 'Nest' : 'ห้อง'} ${r.roomId}`;
  return r.tenantId || 'ผู้เช่า';
}

// §7-I: explicit admin tap → reviewQuestClaim callable (the only point-mover).
async function reviewClaim(claimId, decision, btn) {
  const fn = window.firebase?.functions?.httpsCallable?.('reviewQuestClaim');
  if (!fn) { window.ghAlert('Firebase functions ยังไม่พร้อม', { title: 'ขัดข้อง' }); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    await fn({ claimId, decision });
    if (typeof showToast === 'function') showToast(decision === 'approve' ? '✅ อนุมัติแล้ว' : 'ปฏิเสธคำขอแล้ว', 'success');
    // The onSnapshot queue auto-refreshes (the claim leaves 'pending').
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = decision === 'approve' ? '✓ อนุมัติ' : '✕ ปฏิเสธ'; }
    window.ghAlert('ดำเนินการไม่สำเร็จ: ' + (e.message || e), { title: 'ขัดข้อง' });
  }
}

// Cross-script exports (hub + tab-switcher reach these).
if (typeof window !== 'undefined') {
  window.loadQuestsAdmin = loadQuestsAdmin;
  window.loadQuestClaimsQueue = loadQuestClaimsQueue;
  window.openQuestEdit = openQuestEdit;
  window.closeQuestEdit = closeQuestEdit;
  window.saveQuest = saveQuest;
  window.deleteQuest = deleteQuest;
  window.reviewClaim = reviewClaim;
}
