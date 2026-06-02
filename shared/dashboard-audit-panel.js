/**
 * Dashboard Audit panel — read UI for the immutable actionAudit trail.
 *
 * Core Readiness Phase 1.1, PR 1a.2. The write path (recordAdminAction callable +
 * in-tx CF logging) lands rows in Firestore `actionAudit`; this panel is the admin
 * read surface. It lives in dashboard.html (NOT the legacy audit-log-viewer.html,
 * which is SecurityUtils-session with no Firebase Auth — §7-M) because the dashboard
 * already has a Firebase Auth admin session + firestore + the isAdmin() claim needed
 * to read the admin-gated collection.
 *
 * Query: actionAudit order by `at` desc, limit 200. Uses only the auto single-field
 * `at` index (no composite needed) — search/filter is client-side over the loaded
 * page, so there is no §7-J index dependency for v1.
 *
 * Exposes window.initAuditPage() — called by _showPageImpl on showPage('audit').
 */
(function () {
  'use strict';

  const MOUNT_ID = 'audit-table-mount';
  const SEARCH_ID = 'audit-search';
  const COUNT_ID = 'audit-count';
  const PAGE_LIMIT = 200;

  let _unsub = null;
  let _rows = [];
  let _wired = false;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  // `at` is a Firestore Timestamp (serverTimestamp) — NOT a Date/ISO string.
  // Newly-written rows can momentarily have a null `at` (pending write).
  function fmtAt(ts) {
    if (ts && typeof ts.toDate === 'function') {
      try { return ts.toDate().toLocaleString('th-TH'); } catch (_) { /* fallthrough */ }
    }
    return '—';
  }

  function targetLabel(r) {
    const parts = [];
    if (r.targetType) parts.push(r.targetType);
    if (r.targetId) parts.push(r.targetId);
    let s = parts.join(' · ');
    if (r.roomId) s += ` (ห้อง ${r.roomId}${r.building ? '/' + r.building : ''})`;
    else if (r.building) s += ` (${r.building})`;
    return s || '—';
  }

  function matches(r, term) {
    if (!term) return true;
    const hay = [r.actor, r.actorEmail, r.actorRole, r.action, r.targetType, r.targetId, r.building, r.roomId, r.note, r.ip]
      .map(v => String(v == null ? '' : v)).join(' ').toLowerCase();
    return hay.includes(term);
  }

  function renderTable(errMsg) {
    const root = document.getElementById(MOUNT_ID);
    if (!root) return;
    const countEl = document.getElementById(COUNT_ID);

    if (errMsg) {
      root.innerHTML = `<div style="padding:1.5rem;color:var(--red,#c62828);">⚠️ โหลดบันทึกไม่สำเร็จ: ${esc(errMsg)}</div>`;
      if (countEl) countEl.textContent = '';
      return;
    }

    const termEl = document.getElementById(SEARCH_ID);
    const term = (termEl && termEl.value || '').trim().toLowerCase();
    const rows = term ? _rows.filter(r => matches(r, term)) : _rows;

    if (countEl) {
      countEl.textContent = term
        ? `${rows.length} / ${_rows.length} รายการ`
        : `${_rows.length} รายการ${_rows.length >= PAGE_LIMIT ? ' (ล่าสุด ' + PAGE_LIMIT + ')' : ''}`;
    }

    if (rows.length === 0) {
      root.innerHTML = `<div style="padding:1.5rem;color:var(--text-muted,#6b7a8d);text-align:center;">${
        _rows.length === 0 ? 'ยังไม่มีบันทึกการกระทำ' : 'ไม่พบรายการตรงกับคำค้น'
      }</div>`;
      return;
    }

    const body = rows.map(r => `
      <tr>
        <td style="padding:.5rem .6rem;white-space:nowrap;">${esc(fmtAt(r.at))}</td>
        <td style="padding:.5rem .6rem;">${esc(r.actorEmail || r.actor || '—')}</td>
        <td style="padding:.5rem .6rem;">${esc(r.actorRole || '—')}</td>
        <td style="padding:.5rem .6rem;font-weight:600;">${esc(r.action || '—')}</td>
        <td style="padding:.5rem .6rem;">${esc(targetLabel(r))}</td>
        <td style="padding:.5rem .6rem;color:var(--text-muted,#6b7a8d);">${esc(r.ip || '—')}</td>
      </tr>`).join('');

    root.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:.9rem;">
          <thead>
            <tr style="text-align:left;border-bottom:2px solid var(--border,#e0e6ed);">
              <th style="padding:.5rem .6rem;">วันเวลา</th>
              <th style="padding:.5rem .6rem;">ผู้กระทำ</th>
              <th style="padding:.5rem .6rem;">บทบาท</th>
              <th style="padding:.5rem .6rem;">การกระทำ</th>
              <th style="padding:.5rem .6rem;">เป้าหมาย</th>
              <th style="padding:.5rem .6rem;">IP</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function subscribe() {
    if (_unsub) { renderTable(); return; }
    if (!window.firebase || !window.firebase.firestore || !window.firebase.firestoreFunctions) {
      renderTable('Firebase ยังไม่พร้อม'); return;
    }
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    try {
      const q = fs.query(fs.collection(db, 'actionAudit'), fs.orderBy('at', 'desc'), fs.limit(PAGE_LIMIT));
      _unsub = fs.onSnapshot(q, (snap) => {
        _rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderTable();
      }, (err) => {
        // §7-N: surface the failure to the UI instead of a silent stuck state.
        console.error('[audit-panel] actionAudit subscription failed:', err);
        renderTable(err && (err.code || err.message) || 'unknown');
      });
    } catch (e) {
      console.error('[audit-panel] subscribe error:', e);
      renderTable(e && e.message || 'subscribe error');
    }
  }

  function wireFilters() {
    if (_wired) return;
    const termEl = document.getElementById(SEARCH_ID);
    if (termEl) { termEl.oninput = () => renderTable(); _wired = true; }
  }

  window.initAuditPage = function () {
    wireFilters();
    subscribe();
  };
})();
