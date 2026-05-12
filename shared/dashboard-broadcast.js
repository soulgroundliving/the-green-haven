/**
 * Dashboard — Broadcast Announcements tab.
 *
 * Admin publishes an in-app announcement via broadcastMessage CF; the doc
 * lands in broadcastMessages/{id} and tenant_app surfaces it on the World
 * Map bell icon. No LINE — free OA tier (200 msg/mo) is too restrictive.
 *
 * UI wires:
 *   - Title/body character counters + publish-button enable gate
 *   - Audience radio (all/rooms/nest)
 *   - Publish → ghConfirm → CF call → toast + clear form
 *   - Live log: onSnapshot(broadcastMessages orderBy sentAt desc limit 20)
 */
(function () {
  'use strict';

  const CF_URL = 'https://asia-southeast1-the-green-haven.cloudfunctions.net/broadcastMessage';
  const TITLE_MAX = 80;
  const BODY_MAX  = 500;

  let _bcLogUnsub = null;
  let _bcInited   = false;

  function $(id) { return document.getElementById(id); }

  function getAudience() {
    const checked = document.querySelector('input[name="bc-audience"]:checked');
    return checked ? checked.value : 'all';
  }

  function audienceLabel(a) {
    return ({ all: '🏢 ทุกอาคาร', rooms: '🏠 ห้องแถว', nest: '🪺 Nest' })[a] || a;
  }

  function updateCounters() {
    const title = $('bc-title-input')?.value || '';
    const body  = $('bc-body-input')?.value || '';
    const tc = $('bc-title-counter');
    const bc = $('bc-body-counter');
    if (tc) tc.textContent = `(${title.length}/${TITLE_MAX})`;
    if (bc) bc.textContent = `(${body.length}/${BODY_MAX})`;
    updatePublishGate();
  }

  function updatePublishGate() {
    const title = ($('bc-title-input')?.value || '').trim();
    const body  = ($('bc-body-input')?.value || '').trim();
    const btn   = $('bc-publish-btn');
    if (!btn) return;
    const ok = title.length > 0 && body.length > 0 && title.length <= TITLE_MAX && body.length <= BODY_MAX;
    btn.disabled = !ok;
    btn.style.opacity = ok ? '1' : '.5';
    btn.style.cursor  = ok ? 'pointer' : 'not-allowed';
  }

  function setStatusMsg(text, color) {
    const el = $('bc-status-msg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = color || 'var(--text-muted)';
  }

  function clearForm() {
    const t = $('bc-title-input'); if (t) t.value = '';
    const b = $('bc-body-input');  if (b) b.value = '';
    const r = document.querySelector('input[name="bc-audience"][value="all"]');
    if (r) r.checked = true;
    updateCounters();
  }

  async function publishBroadcast() {
    const title = ($('bc-title-input')?.value || '').trim();
    const body  = ($('bc-body-input')?.value || '').trim();
    const audience = getAudience();
    if (!title || !body) return;

    const confirmFn = window.ghConfirm || ((msg) => Promise.resolve(window.confirm(msg)));
    const confirmed = await confirmFn(
      `เผยแพร่ประกาศนี้ไปยัง ${audienceLabel(audience)} — ยืนยัน?`,
      { danger: false }
    );
    if (!confirmed) return;

    const btn = $('bc-publish-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '.5'; }
    setStatusMsg('กำลังเผยแพร่...', 'var(--text-muted)');

    try {
      const authInstance = window.firebaseAuth || window.auth;
      const idToken = await authInstance?.currentUser?.getIdToken?.();
      if (!idToken) throw new Error('Not signed in');

      const res = await fetch(CF_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + idToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body, building: audience }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      setStatusMsg('✅ เผยแพร่สำเร็จ', 'var(--ok-dark)');
      if (typeof window.showToast === 'function') {
        window.showToast('✅ เผยแพร่ประกาศแล้ว', 'success', 3000);
      }
      clearForm();
    } catch (e) {
      console.error('publishBroadcast failed:', e);
      setStatusMsg('❌ ' + (e?.message || 'ส่งไม่สำเร็จ'), 'var(--red, #d33)');
      if (typeof window.showToast === 'function') {
        window.showToast('❌ เผยแพร่ไม่สำเร็จ: ' + (e?.message || 'unknown'), 'error', 4000);
      }
    } finally {
      updatePublishGate();
    }
  }

  function formatRelativeTime(iso) {
    if (!iso) return '—';
    let ts;
    if (typeof iso === 'object' && iso && typeof iso.toDate === 'function') {
      ts = iso.toDate().getTime();
    } else if (typeof iso === 'string') {
      ts = new Date(iso).getTime();
    } else {
      return '—';
    }
    if (!Number.isFinite(ts)) return '—';
    const diff = Date.now() - ts;
    if (diff < 60 * 1000) return 'เมื่อสักครู่';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' นาทีที่แล้ว';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' ชั่วโมงที่แล้ว';
    if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' วันที่แล้ว';
    return new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderLogList(docs) {
    const el = $('bcLogList');
    if (!el) return;
    if (!docs.length) {
      el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.9rem;">ยังไม่มีประกาศ</div>';
      return;
    }
    el.innerHTML = docs.map(d => {
      const senderEmail = d.sender?.email || '—';
      const ts = formatRelativeTime(d.sentAt);
      const audBadge = audienceLabel(d.audience || 'all');
      return `<div style="border-bottom:1px solid var(--border);padding:.9rem .2rem;">
        <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:.3rem;">
          <strong style="font-size:.98rem;">${escapeHtml(d.title || '(ไม่มีหัวข้อ)')}</strong>
          <span style="font-size:.8rem;color:var(--text-muted);white-space:nowrap;">${ts}</span>
        </div>
        <div style="font-size:.88rem;color:var(--text-muted);margin-bottom:.4rem;white-space:pre-wrap;">${escapeHtml(d.body || '')}</div>
        <div style="display:flex;gap:.6rem;font-size:.78rem;color:var(--text-muted);">
          <span>${audBadge}</span>
          <span>·</span>
          <span>${escapeHtml(senderEmail)}</span>
        </div>
      </div>`;
    }).join('');
  }

  function subscribeLog() {
    if (_bcLogUnsub) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      const el = $('bcLogList');
      if (el) el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">⚠️ Firebase ยังไม่พร้อม</div>';
      return;
    }
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const q  = fs.query(
      fs.collection(db, 'broadcastMessages'),
      fs.orderBy('sentAt', 'desc'),
      fs.limit(20)
    );
    _bcLogUnsub = fs.onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderLogList(docs);
    }, err => {
      console.warn('broadcastMessages onSnapshot:', err);
      const el = $('bcLogList');
      if (el) el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--red);font-size:.9rem;">โหลดประวัติไม่สำเร็จ: ' + escapeHtml(err.message || '') + '</div>';
    });
  }

  function initBroadcastPage() {
    if (_bcInited) {
      subscribeLog();
      return;
    }
    _bcInited = true;

    $('bc-title-input')?.addEventListener('input', updateCounters);
    $('bc-body-input') ?.addEventListener('input', updateCounters);
    document.querySelectorAll('input[name="bc-audience"]').forEach(r => {
      r.addEventListener('change', updatePublishGate);
    });

    updateCounters();
    subscribeLog();
  }

  // Public API
  window.initBroadcastPage = initBroadcastPage;
  window.publishBroadcast  = publishBroadcast;
})();
