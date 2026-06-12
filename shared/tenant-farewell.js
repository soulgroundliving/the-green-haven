/**
 * tenant-farewell.js — Farewell / journey-summary card (Meaning Layer #16, v1).
 * Renders a DERIVE-only summary into the #tlf-card slot at the top of the
 * #life-timeline page (above the #15 timeline list). Built ENTIRELY from the
 * tenant's OWN doc (tenants/{b}/list/{r}) — no new collection / index / capture,
 * no AI.
 *
 * Always visible (a warm "your story" overview); shifts to a FAREWELL tone when
 * the lease is ending (endDate ≤ FAREWELL_WINDOW_DAYS) or has ended. The only
 * client-readable move-out signal is `lease.endDate` — `leaseRequests` is
 * admin-read-only and the tenant doc carries no pending-move-out flag — so the
 * card keys off that date, not a request state.
 *
 * v2 (deferred): real move-out hook (admin gift at archive time), AI prose
 * summary, read from tenants/{b}/archive/{contractId}.
 *
 * §7-A/U claim guard · §7-N error cb · §7-V subscribe-once + unsub-before-rebind
 * · §7-QQ/CC window export · §7-B modular SDK · §7-RR static CSS (.tlf-* in
 * shared/components.css). The card is supplementary: when there's nothing to
 * celebrate it hides (the timeline below it owns the main content + its own
 * non-empty fallback), so an empty #tlf-card is intentional, not a §7-X dead-zone.
 */
(function () {
  'use strict';

  const FAREWELL_WINDOW_DAYS = 45; // lease ending within this many days → farewell tone

  // ── PURE LAYER (exported to Node for unit tests; no DOM / Firebase) ─────────

  function toMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : 0;
  }

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
   * deriveFarewell(input, nowMs) — pure. input = { lease, gamification }.
   * @returns {Object|null} view-model, or null when there's nothing to show
   *   (no tenure AND no points AND no badges — a blank/vacant room).
   */
  function deriveFarewell(input, nowMs) {
    const lease = (input && input.lease) || {};
    const g = (input && input.gamification) || {};
    const now = Number.isFinite(nowMs) ? nowMs : 0;

    const moveInMs = toMs(lease.moveInDate) || toMs(lease.startDate);
    const tenure = tenureText(moveInMs, now);
    const points = Math.max(0, Number(g.points) || 0);
    const badges = Array.isArray(g.badges) ? g.badges : [];
    const badgeCount = badges.length;
    const streak = Math.max(0, Number(g.dailyStreak) || 0);
    const trades = Math.max(0, Number(g.marketplaceStats && g.marketplaceStats.tradesCompleted) || 0);

    if (!moveInMs && !points && !badgeCount) return null; // nothing to celebrate → hide

    const endMs = toMs(lease.endDate) || toMs(lease.moveOutDate);
    const ended = String(lease.status) === 'ended' || (!!endMs && !!now && endMs < now);
    const daysLeft = (endMs && now && endMs >= now) ? Math.round((endMs - now) / 86400000) : null;
    const ending = !ended && daysLeft !== null && daysLeft <= FAREWELL_WINDOW_DAYS;
    const phase = ended ? 'ended' : (ending ? 'ending' : 'active');

    const title = phase === 'active' ? 'เรื่องราวของคุณที่นี่' : 'ขอบคุณสำหรับช่วงเวลาดี ๆ 🌿';

    let message;
    if (phase === 'ended') {
      message = 'ขอบคุณที่เคยเป็นส่วนหนึ่งของ Nature Haven — เราจะคิดถึงคุณ 🌱';
    } else if (phase === 'ending') {
      message = (daysLeft <= 1 ? 'อีกไม่นานก็ถึงวันย้าย' : 'อีก ' + daysLeft + ' วันจะครบสัญญา')
        + ' — ขอบคุณสำหรับทุกช่วงเวลาที่นี่ 🌿';
    } else {
      message = 'ขอบคุณที่ทำให้ที่นี่เป็นบ้านที่อบอุ่น 🌿';
    }

    const badgeEmojis = badges.map(b => (b && b.emoji) || '🏅').slice(0, 6);

    return { tenure, points, badgeCount, badgeEmojis, streak, trades, phase, daysLeft, title, message };
  }

  // ── Node realm: export pure helpers + stop ─────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { toMs, tenureText, deriveFarewell, FAREWELL_WINDOW_DAYS };
    }
    return;
  }

  // ── Browser-only below ──────────────────────────────────────────────────────
  let _unsub = null;
  let _key = '';
  let _loaded = false;
  let _state = { lease: {}, gamification: {} };

  function _fs() { const f = window.firebase; return (f && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { const f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }
  function _bldg() { return window._tenantAppBuilding || ''; }
  function _room() { return String(window._tenantAppRoom || ''); }

  function _subscribe() {
    const b = _bldg();
    const r = _room();
    if (!b || !r) return;                 // §7-U: wait for claims
    const key = b + '/' + r;
    if (_unsub && _key === key) return;   // §7-V: already bound
    if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
    const fs = _fs();
    const db = _db();
    if (!fs || !db) return;
    _key = key;
    const ref = fs.doc(db, 'tenants', b, 'list', r);
    _unsub = fs.onSnapshot(ref, snap => {
      const d = (snap && snap.data && snap.data()) || {};
      _state = { lease: d.lease || {}, gamification: d.gamification || {} };
      _loaded = true;
      _render();
    }, err => {                            // §7-N
      if (!/permission/i.test((err && err.message) || '')) {
        console.warn('[farewell] subscribe failed:', err && err.message);
      }
    });
  }

  function _statTile(emoji, value, label) {
    const t = document.createElement('div');
    t.className = 'tlf-stat';
    const e = document.createElement('span'); e.className = 'tlf-stat__emoji'; e.textContent = emoji;
    const v = document.createElement('span'); v.className = 'tlf-stat__val'; v.textContent = String(value);
    const l = document.createElement('span'); l.className = 'tlf-stat__label'; l.textContent = label;
    t.appendChild(e); t.appendChild(v); t.appendChild(l);
    return t;
  }

  function _render() {
    const host = document.getElementById('tlf-card');
    if (!host) return;
    if (!_loaded) { host.innerHTML = ''; return; } // before the first snapshot — timeline shows its own loader
    const vm = deriveFarewell(_state, Date.now());
    if (!vm) { host.innerHTML = ''; return; }       // blank room → intentionally hidden (see header)

    host.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'tlf-card' + (vm.phase !== 'active' ? ' tlf-card--farewell' : '');

    const title = document.createElement('p');
    title.className = 'tlf-card__title';
    title.textContent = vm.title;
    card.appendChild(title);

    if (vm.tenure) {
      const hero = document.createElement('p');
      hero.className = 'tlf-hero';
      hero.textContent = '🌿 อยู่กับเราที่นี่มาแล้ว ' + vm.tenure;
      card.appendChild(hero);
    }

    const stats = document.createElement('div');
    stats.className = 'tlf-stats';
    if (vm.badgeCount) stats.appendChild(_statTile('🏅', vm.badgeCount, 'เหรียญ'));
    if (vm.points) stats.appendChild(_statTile('✨', vm.points, 'คะแนน'));
    if (vm.trades) stats.appendChild(_statTile('🤝', vm.trades, 'แลกเปลี่ยน'));
    if (vm.streak > 1) stats.appendChild(_statTile('🔥', vm.streak, 'วันต่อเนื่อง'));
    if (stats.children.length) card.appendChild(stats);

    const msg = document.createElement('p');
    msg.className = 'tlf-msg';
    msg.textContent = vm.message;
    card.appendChild(msg);

    host.appendChild(card);
  }

  function renderFarewell() {
    _subscribe();
    _render();
  }

  window.renderFarewell = renderFarewell;
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(function () { renderFarewell(); });
  }
})();
