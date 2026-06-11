/**
 * tenant-life-timeline.js — Life Timeline (Meaning Layer #15).
 * Renders into the #life-timeline sub-page (Profile → "ไทม์ไลน์ชีวิต" tile).
 *
 * A read-only, DERIVE-only "journey" view of the signed-in tenant's life in the
 * building — assembled ENTIRELY from the tenant's OWN doc
 * (tenants/{building}/list/{roomId}), which they always have claim-gated read
 * access to. No new collection, no new index, no capture flow:
 *   • ย้ายเข้า        ← lease.moveInDate || lease.startDate  (§7-BBB: moveInDate is
 *                       occupancy, startDate is the contract term — may be future)
 *   • อยู่ครบ N ปี    ← derived from the move-in date + wall clock (no stored event)
 *   • ได้รับเหรียญ     ← gamification.badges[].earnedAt (one per dated badge)
 *   • สัญญาครบกำหนด   ← lease.endDate || lease.moveOutDate (only when in the future)
 *
 * v2 (deferred): cross-room transfer / move-out events live in `occupancyLog`,
 * whose tenant read needs `getByTenant` (collectionGroup + {tenantId,at} composite
 * index — §7-J empty-collection trap) + the canonical tenantId + an extra script
 * include. Out of scope for a 1-PR, no-new-index ตัว.
 *
 * §7-A/U claim guard (reads gate on _bldg()/_room()) · §7-N error callback ·
 * §7-V subscribe-once-per-key + unsub-before-rebind · §7-X non-empty fallback ·
 * §7-QQ/CC window.X export (never a top-level `let` read cross-script) ·
 * §7-B modular SDK only · §7-RR CSS is static (.tl-* in shared/components.css).
 */
(function () {
  'use strict';

  const MAX_ANNIVERSARIES = 30; // safety bound — never loop unbounded on a bad date

  // ── PURE LAYER (exported to Node for unit tests; no DOM / Firebase) ─────────

  // ISO string / epoch ms / Firestore Timestamp → epoch ms (0 = unknown/invalid).
  function toMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : 0;
  }

  // Completed-year anniversaries between move-in and now (1..N, each its own event).
  // Calendar-accurate (setFullYear), not a 365-day approximation.
  function anniversaries(moveInMs, nowMs) {
    const out = [];
    if (!moveInMs || !nowMs || nowMs <= moveInMs) return out;
    for (let y = 1; y <= MAX_ANNIVERSARIES; y++) {
      const d = new Date(moveInMs);
      d.setFullYear(d.getFullYear() + y);
      const ms = d.getTime();
      if (ms > nowMs) break;
      out.push({ year: y, dateMs: ms });
    }
    return out;
  }

  // Human tenure ("2 ปี 3 เดือน") between move-in and now — for the warm intro line.
  function tenureText(moveInMs, nowMs) {
    if (!moveInMs || !nowMs || nowMs < moveInMs) return '';
    const a = new Date(moveInMs);
    const b = new Date(nowMs);
    let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) months -= 1;
    if (months < 0) months = 0;
    const y = Math.floor(months / 12);
    const m = months % 12;
    if (y && m) return y + ' ปี ' + m + ' เดือน';
    if (y) return y + ' ปี';
    if (m) return m + ' เดือน';
    return 'เพิ่งเริ่มต้น';
  }

  /**
   * deriveTimeline(input, nowMs) — pure, no I/O. Returns events newest-first.
   * @param {{lease:Object, badges:Array}} input — shape of the tenant doc subset
   * @param {number} nowMs — Date.now() at render time (injectable for tests)
   * @returns {Array<{id,type,dateMs,icon,title,sub,future}>}
   */
  function deriveTimeline(input, nowMs) {
    const lease = (input && input.lease) || {};
    const badges = Array.isArray(input && input.badges) ? input.badges : [];
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    const events = [];

    // §7-BBB: occupancy start is moveInDate; startDate is the (possibly future) term.
    const moveInMs = toMs(lease.moveInDate) || toMs(lease.startDate);
    if (moveInMs) {
      events.push({
        id: 'move-in', type: 'move_in', dateMs: moveInMs,
        icon: '🏠', title: 'ย้ายเข้า', sub: 'เริ่มต้นการอยู่อาศัยที่นี่', future: false,
      });
    }

    anniversaries(moveInMs, now).forEach(a => {
      events.push({
        id: 'anniv-' + a.year, type: 'anniversary', dateMs: a.dateMs,
        icon: '🎉', title: 'อยู่ครบ ' + a.year + ' ปี', sub: 'ขอบคุณที่อยู่กับเรา', future: false,
      });
    });

    badges.forEach((b, i) => {
      const ms = toMs(b && b.earnedAt);
      if (!ms) return; // undated badges stay in the gamification page, not the timeline
      events.push({
        id: 'badge-' + ((b && b.id) || i), type: 'badge', dateMs: ms,
        icon: (b && b.emoji) || '🏅', title: 'ได้รับเหรียญ', sub: (b && b.label) || 'เหรียญรางวัล', future: false,
      });
    });

    const endMs = toMs(lease.endDate) || toMs(lease.moveOutDate);
    if (endMs && now && endMs > now) {
      events.push({
        id: 'lease-end', type: 'lease_end', dateMs: endMs,
        icon: '📅', title: 'สัญญาครบกำหนด', sub: 'รอบสัญญาเช่าปัจจุบัน', future: true,
      });
    }

    return events.sort((x, y) => y.dateMs - x.dateMs);
  }

  // ── Node realm: export pure helpers + stop (no DOM/Firebase below) ─────────
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { toMs, anniversaries, tenureText, deriveTimeline };
    }
    return;
  }

  // ── Browser-only below ─────────────────────────────────────────────────────
  let _unsub = null;
  let _key = '';
  let _loaded = false;
  let _state = { lease: {}, badges: [] };

  function _fs() { const f = window.firebase; return (f && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { const f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }
  function _bldg() { return window._tenantAppBuilding || ''; }
  function _room() { return String(window._tenantAppRoom || ''); }

  function _thaiDate(ms) {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) { return ''; }
  }

  // "อีก N วัน" hint for an upcoming (future) event.
  function _untilHint(ms, nowMs) {
    const days = Math.round((ms - nowMs) / 86400000);
    if (days <= 0) return '';
    if (days === 1) return 'พรุ่งนี้';
    if (days < 30) return 'อีก ' + days + ' วัน';
    return 'อีกประมาณ ' + Math.round(days / 30) + ' เดือน';
  }

  // ── Live subscription: the tenant's OWN doc (claim-gated, no index) ─────────
  function _subscribe() {
    const b = _bldg();
    const r = _room();
    if (!b || !r) return;                 // §7-U: wait for claims before binding
    const key = b + '/' + r;
    if (_unsub && _key === key) return;   // §7-V: already bound to this room
    if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
    const fs = _fs();
    const db = _db();
    if (!fs || !db) return;
    _key = key;
    const ref = fs.doc(db, 'tenants', b, 'list', r);
    _unsub = fs.onSnapshot(ref, snap => {
      const d = (snap && snap.data && snap.data()) || {};
      _state = {
        lease: d.lease || {},
        badges: (d.gamification && Array.isArray(d.gamification.badges)) ? d.gamification.badges : [],
      };
      _loaded = true;
      _render();
    }, err => {                            // §7-N: surface, never swallow
      if (!/permission/i.test((err && err.message) || '')) {
        console.warn('[life-timeline] subscribe failed:', err && err.message);
      }
    });
  }

  function _itemNode(ev, nowMs) {
    const item = document.createElement('div');
    item.className = 'tl-item' + (ev.future ? ' tl-item--future' : '');

    const icon = document.createElement('div');
    icon.className = 'tl-item__icon';
    icon.textContent = ev.icon;
    item.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'tl-item__body';

    const date = document.createElement('p');
    date.className = 'tl-item__date';
    const hint = ev.future ? _untilHint(ev.dateMs, nowMs) : '';
    date.textContent = _thaiDate(ev.dateMs) + (hint ? ' · ' + hint : '');
    body.appendChild(date);

    const title = document.createElement('p');
    title.className = 'tl-item__title';
    title.textContent = ev.title;
    body.appendChild(title);

    if (ev.sub) {
      const sub = document.createElement('p');
      sub.className = 'tl-item__sub';
      sub.textContent = ev.sub;        // textContent — never innerHTML for badge labels
      body.appendChild(sub);
    }
    item.appendChild(body);
    return item;
  }

  function _render() {
    const list = document.getElementById('tl-list');
    if (!list) return;
    const nowMs = Date.now();

    const intro = document.getElementById('tl-intro');
    if (intro) {
      const moveInMs = toMs(_state.lease.moveInDate) || toMs(_state.lease.startDate);
      const t = tenureText(moveInMs, nowMs);
      intro.textContent = t ? ('🏡 อยู่กับเราที่นี่มาแล้ว ' + t) : 'เรื่องราวการอยู่อาศัยของคุณที่นี่';
    }

    if (!_loaded) {                       // first paint, before the snapshot lands
      list.innerHTML = '<div class="tl-empty">กำลังโหลด…</div>';
      return;
    }
    const events = deriveTimeline(_state, nowMs);
    if (!events.length) {                 // §7-X: always a non-empty fallback
      list.innerHTML = '<div class="tl-empty">ยังไม่มีเหตุการณ์ในไทม์ไลน์ — เรื่องราวของคุณกำลังจะเริ่มต้น 🌱</div>';
      return;
    }
    list.innerHTML = '';
    events.forEach(ev => list.appendChild(_itemNode(ev, nowMs)));
  }

  // ── Public entry — subscribe + render (idempotent) ─────────────────────────
  function renderLifeTimeline() {
    _subscribe();
    _render();
  }

  window.renderLifeTimeline = renderLifeTimeline;
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(function () { renderLifeTimeline(); });
  }
})();
