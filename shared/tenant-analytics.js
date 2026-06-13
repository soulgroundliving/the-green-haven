/**
 * tenant-analytics.js — Behavioral Analytics Phase 1a (instrument + sink).
 *
 * Self-contained client telemetry for the dead-feature detector. Captures two
 * signals from the tenant LIFF app, buffers them, and flushes batches to RTDB:
 *   • page_view  — every window.showPage / showSubPage call
 *   • action     — every [data-action] click (the global _dispatch surface)
 *
 * WHY a standalone module (not inline edits to tenant_app.html): zero inline
 * <script> changes → zero CSP-hash churn (§7-II). It adds its OWN capture-phase
 * click listener and WRAPS window.showPage (capture-before-reassign, §7-EE) — it
 * never edits the _dispatch hub or tenant-navigation.js.
 *
 * Sink: behaviorEvents/{building}/{room}/{pushId} = { events:[…], flushedAt, n }.
 * Building+room live in the PATH (the identity); NO tenantId/name/uid in any event.
 *
 * Identity gate (§7-P/HH/FFF — never key on raw auth.uid): only flush when the
 * session is a REAL LINE tenant — window._authUid starts with 'line:' (excludes
 * admin-preview + web) AND _tenantAppBuilding/_tenantAppRoom are set AND
 * sessionStorage _adminPreview !== '1' AND firebaseReady.
 *
 * Flush (§7-R — LIFF webview TLS can hang): on visibilitychange:hidden + pagehide
 * + a 60s interval + a size cap; each write is bounded by Promise.race timeout.
 * Best-effort: a failed flush is dropped (analytics is non-critical, never retried
 * into unbounded growth). Mirrors the presence-heartbeat model (facility-booking-ui.js).
 *
 * Pure helpers are exported on window.TenantAnalytics.__t for unit tests; the
 * browser-only wiring is guarded so the module loads cleanly in a node vm.
 */
(function () {
  'use strict';

  const FLUSH_INTERVAL_MS = 60 * 1000;
  const FLUSH_TIMEOUT_MS = 8 * 1000;   // §7-R bound
  const MAX_BUFFER = 200;              // hard cap — drop oldest beyond this
  const FLUSH_AT = 40;                 // flush early once the buffer reaches this
  const ACTION_MAX = 60, PAGE_MAX = 40;

  let _buf = [];
  let _curPage = '';
  let _inited = false;
  let _flushTimer = null;

  // ── PURE helpers (testable) ──────────────────────────────────────────────
  // Real LINE tenant only — excludes admin-preview (uid not 'line:') + web.
  function _eligibleFrom(authUid, building, room, adminPreview, firebaseReady) {
    return !!firebaseReady &&
      !!building && !!room &&
      adminPreview !== '1' &&
      typeof authUid === 'string' && authUid.indexOf('line:') === 0;
  }

  // Compact event: page_view {t:'pv', p, ts}; action {t:'ac', a, p, ts}.
  function _makeEvent(t, action, page, now) {
    const ev = { t: t, ts: now };
    const p = page ? String(page).slice(0, PAGE_MAX) : '';
    if (p) ev.p = p;
    if (t === 'ac' && action) ev.a = String(action).slice(0, ACTION_MAX);
    return ev;
  }

  // Keep only the newest `max` entries (drop oldest) — bounds memory if a session
  // never flushes (e.g. admin preview). Returns a new array.
  function _capBuffer(arr, max) {
    return arr.length <= max ? arr.slice() : arr.slice(arr.length - max);
  }

  // ── runtime gate (reads live globals) ────────────────────────────────────
  function _eligible() {
    let adminPreview = null;
    try { adminPreview = sessionStorage.getItem('_adminPreview'); } catch (_) { /* noop */ }
    return _eligibleFrom(
      window._authUid, window._tenantAppBuilding, window._tenantAppRoom,
      adminPreview, window.firebaseReady
    );
  }

  // ── buffer + record ──────────────────────────────────────────────────────
  function _enqueue(ev) {
    _buf.push(ev);
    if (_buf.length > MAX_BUFFER) _buf = _capBuffer(_buf, MAX_BUFFER);
    if (_buf.length >= FLUSH_AT) _flush();
  }

  function _record(t, action) {
    const uid = window._authUid;
    // Definitively-not-a-tenant (admin preview / web) → skip recording entirely.
    // Empty uid (auth not ready yet) → still record; the flush gate re-checks.
    if (typeof uid === 'string' && uid && uid.indexOf('line:') !== 0) return;
    _enqueue(_makeEvent(t, action, _curPage, Date.now()));
  }

  // ── flush to RTDB (bounded, best-effort) ─────────────────────────────────
  function _flush() {
    if (!_buf.length) return;
    if (!_eligible()) { _buf = []; return; }      // discard admin-preview/web noise
    if (!window.firebaseRef || !window.firebasePush || !window.firebaseDatabase) return;
    const batch = _buf;
    _buf = [];
    try {
      const path = 'behaviorEvents/' + window._tenantAppBuilding + '/' + window._tenantAppRoom;
      const ref = window.firebaseRef(window.firebaseDatabase, path);
      const payload = { events: batch, flushedAt: Date.now(), n: batch.length };
      Promise.race([
        window.firebasePush(ref, payload),
        new Promise(function (_, rej) { setTimeout(function () { rej(new Error('flush-timeout')); }, FLUSH_TIMEOUT_MS); })
      ]).catch(function (err) {
        // best-effort — drop on failure (never re-queue into unbounded growth)
        if (window.console) console.warn('[tenant-analytics] flush failed:', err && err.message);
      });
    } catch (err) {
      if (window.console) console.warn('[tenant-analytics] flush error:', err && err.message);
    }
  }

  // ── instrument ────────────────────────────────────────────────────────────
  function _wrapNav(name) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__taWrapped) return;
    const wrapped = function (id) {
      // §7-EE: `orig` captured before reassign → no recursion. Every wrapper in
      // the chain delegates, so page_view fires exactly once regardless of order.
      try { _curPage = String(id || ''); _record('pv'); } catch (_) { /* noop */ }
      return orig.apply(this, arguments);
    };
    wrapped.__taWrapped = true;
    window[name] = wrapped;
  }

  function _onClick(e) {
    try {
      const el = e.target && e.target.closest && e.target.closest('[data-action]');
      if (el) _record('ac', el.getAttribute('data-action') || '');
    } catch (_) { /* noop */ }
  }

  function _init() {
    if (_inited) return;
    _inited = true;
    _wrapNav('showPage');
    _wrapNav('showSubPage');
    document.addEventListener('click', _onClick, true);   // capture, passive read
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') _flush();
    });
    window.addEventListener('pagehide', _flush);
    _flushTimer = setInterval(_flush, FLUSH_INTERVAL_MS);
  }

  // ── export + browser-guarded boot ─────────────────────────────────────────
  window.TenantAnalytics = {
    flush: _flush,
    __t: { eligibleFrom: _eligibleFrom, makeEvent: _makeEvent, capBuffer: _capBuffer, MAX_BUFFER: MAX_BUFFER, FLUSH_AT: FLUSH_AT },
  };

  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init, { once: true });
    else _init();
  }
}());
