// shared/dashboard-admin-ops.js
// Admin-only utility surfaces — Debug Console helpers, manual CF triggers
function _escAO(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// (grantAdminRole, cleanupAnonUsers, runAwardComplaintFreeMonthDryRun).
// Extracted from shared/dashboard-extra.js on 2026-05-21 (Phase 2 S5).
//
// NOTE: cleanupAdminListeners + beforeunload registration STAYS in
// dashboard-extra.js — it reads _insightsUnsubs which lives with the
// Insights section in extra.js, so colocating cleanup with that side
// preserves single-source-of-truth for admin listener lifecycle.
//
// Loaded BEFORE shared/dashboard-extra.js in dashboard.html.
//
// Cross-script identifiers this module READS (resolved via global lookup):
//  - window.firebase, window.firebaseAuth
//  - showToast, _esc (now in dashboard-tenant-lease.js)
//  - CF endpoints: setAdminClaim, cleanupAnonUsers, awardComplaintFreeMonthDryRun

// ===== DEBUG CONSOLE HELPERS =====
// UI removed — call these from DevTools console. They return the data so you
// can chain (e.g. `debugShowMaintenance().filter(r => r.priority === 'high')`).
function debugShowMaintenance() {
  const data = JSON.parse(localStorage.getItem('maintenance_data') || '[]');
  console.info('🔍 maintenance_data (' + data.length + ' items):', data);
  return data;
}

function debugShowAnnouncements() {
  const data = JSON.parse(localStorage.getItem('announcements_data') || '[]');
  console.info('🔍 announcements_data (' + data.length + ' items):', data);
  return data;
}

function debugShowAllKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const size = new Blob([localStorage.getItem(key)]).size;
    keys.push({ key, size: size + ' bytes' });
  }
  console.info('🔍 All localStorage keys (' + keys.length + '):', keys);
  return keys;
}

// Grant admin/accountant custom claim to a user. Calls the deployed
// setAdminClaim CF with the current admin's ID token. Target user must
// already exist in Firebase Auth (signed up at least once). They need to
// log out + log back in for the new claim to appear in their token.
async function grantAdminRole() {
  const out = document.getElementById('ins-grant-output');
  const emailEl = document.getElementById('ins-grant-email');
  const roleEl = document.getElementById('ins-grant-role');
  if (!out || !emailEl || !roleEl) return;
  const email = (emailEl.value || '').trim();
  const role = roleEl.value || 'admin';
  if (!email || !email.includes('@')) {
    out.innerHTML = `<span style="color:${DashColors.RED_DEEP};">❌ ใส่ email ที่ถูกต้อง</span>`;
    return;
  }
  out.innerHTML = '⏳ กำลัง grant...';
  try {
    const authInstance = window.firebaseAuth || window.auth;
    const idToken = await authInstance?.currentUser?.getIdToken?.();
    if (!idToken) throw new Error('Session หมดอายุ — login ใหม่');
    const res = await fetch(
      'https://asia-southeast1-the-green-haven.cloudfunctions.net/setAdminClaim',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role })
      }
    );
    const json = await res.json();
    if (!res.ok || !json.success) {
      out.innerHTML = `<span style="color:${DashColors.RED_DEEP};">❌ ${_escAO(json.error || res.statusText)}</span>`;
      return;
    }
    out.innerHTML = `<span style="color:var(--green-dark);">✅ Granted <strong>${_escAO(role)}</strong> to <strong>${_escAO(json.email)}</strong> (uid: ${_escAO(json.uid.slice(0, 12))}...)</span><br><span style="color:var(--text-muted);">⚠️ User ต้อง logout/login ใหม่ เพื่อรับ token ที่มี claim ใหม่</span>`;
    emailEl.value = '';
  } catch (e) {
    out.innerHTML = `<span style="color:${DashColors.RED_DEEP};">❌ ${_escAO(e.message)}</span>`;
  }
}
window.grantAdminRole = grantAdminRole;

// Bulk-delete legacy anonymous user records (Firebase Auth users with
// providerData.length === 0). Anonymous provider must be disabled at the
// Firebase Console first — otherwise tenant_app would just create new
// anon users to replace the deleted ones. Calls cleanupAnonymousUsers CF.
async function cleanupAnonUsers() {
  const out = document.getElementById('ins-anon-output');
  if (!out) return;
  const ok = await window.ghConfirm('ลบ user records anon ทั้งหมด? ผู้ที่ link LINE แล้วไม่กระทบ — ลบเฉพาะ guest ที่ไม่เคย link', { danger: true });
  if (!ok) return;
  out.innerHTML = '⏳ กำลังลบ...';
  try {
    const authInstance = window.firebaseAuth || window.auth;
    const idToken = await authInstance?.currentUser?.getIdToken?.();
    if (!idToken) throw new Error('Session หมดอายุ — login ใหม่');
    const res = await fetch(
      'https://asia-southeast1-the-green-haven.cloudfunctions.net/cleanupAnonymousUsers',
      { method: 'POST', headers: { 'Authorization': 'Bearer ' + idToken } }
    );
    const json = await res.json();
    if (!res.ok || !json.success) {
      out.innerHTML = `<span style="color:${DashColors.RED_DEEP};">❌ ${_escAO(json.error || res.statusText)}</span>`;
      return;
    }
    out.innerHTML = `<span style="color:var(--green-dark);">✅ ลบ ${Number(json.deleted)} anonymous user records (สแกน ${Number(json.scanned)} users)</span>`;
  } catch (e) {
    out.innerHTML = `<span style="color:${DashColors.RED_DEEP};">❌ ${_escAO(e.message)}</span>`;
  }
}
window.cleanupAnonUsers = cleanupAnonUsers;

// Trigger manual dry-run of awardComplaintFreeMonth CF. Shows what would be
// awarded without writing to DB. Use before the 1st-of-month schedule to verify.
async function runAwardComplaintFreeMonthDryRun() {
  const out = document.getElementById('ins-award-dryrun-output');
  if (!out) return;
  out.style.display = 'block';
  out.textContent = '⏳ กำลังรัน...';
  try {
    const authInstance = window.firebaseAuth || window.auth;
    const idToken = await authInstance?.currentUser?.getIdToken?.();
    if (!idToken) throw new Error('Session หมดอายุ — login ใหม่');
    const res = await fetch(
      'https://asia-southeast1-the-green-haven.cloudfunctions.net/awardComplaintFreeMonthManual?dryRun=1',
      { method: 'POST', headers: { 'Authorization': 'Bearer ' + idToken } }
    );
    const j = await res.json();
    // Human-readable summary instead of raw JSON
    const [yr, mo] = (j.monthKey || '').split('-');
    const beYear = yr ? Number(yr) + 543 : '?';
    const monthThai = mo ? mo + '/' + beYear : j.monthKey || '?';
    const wouldAward = (j.wouldAward || []).join(', ') || '— ไม่มี';
    const complained = (j.complainedRooms || []).join(', ') || '— ไม่มี';
    out.textContent = [
      '✅ Dry run — เดือน ' + monthThai,
      '',
      '📊 สรุป:',
      '  จะได้รับ 40 แต้ม:      ' + (j.awarded ?? '?') + ' ห้อง',
      '  ข้ามเพราะรับแล้ว:     ' + (j.skippedAlreadyAwarded ?? '?') + ' ห้อง',
      '  ข้ามเพราะร้องเรียน:   ' + (j.skippedHadComplaint ?? '?') + ' ห้อง',
      '  ทั้งหมด Nest:         ' + (j.totalRooms ?? '?') + ' ห้อง  (ร้องเรียน ' + (j.complaintsLastMonth ?? '?') + ' ครั้ง)',
      '',
      '📋 ห้องที่จะได้แต้ม:',
      '  ' + wouldAward,
      '',
      '⚠️  ห้องที่ร้องเรียน:',
      '  ' + complained,
    ].join('\n');
  } catch (e) {
    out.textContent = '❌ Error: ' + e.message;
  }
}
window.runAwardComplaintFreeMonthDryRun = runAwardComplaintFreeMonthDryRun;
