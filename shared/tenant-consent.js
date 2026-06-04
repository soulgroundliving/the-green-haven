/*
 * Green Haven — Whole-app PDPA consent (window.maybePromptAccountConsent)
 *
 * Roadmap 1.4 Slice C (tenant first-run gate). PDPA §19 needs demonstrable
 * consent before personal data is processed. Existing tenants never clicked
 * "I accept" for general app use (only the checklist feature recorded consent),
 * so this shows a one-time acknowledgment of the privacy notice + ToS and mints
 * a server-side ledger row at consents/{tenantId}_account_v1 for proof.
 *
 * Design notes:
 *   - localStorage fast-path (account_consent_v1) + server ledger for proof —
 *     mirrors shared/checklist-page.js (the proven consent pattern here).
 *   - SELF-WIRES via window._onLiffClaimsReady (§7-A) — NOT an inline-script
 *     edit in tenant_app.html, so the page's CSP hash does NOT drift (mirrors
 *     shared/tenant-data-export.js Slice B). Only a <script src> tag is added.
 *   - The CF call happens on the ACCEPT click, which lands after auth settles
 *     (post-liffLinked), so auth.uid is the line: UID by then — the same
 *     auth-safe property a user-triggered button has. The CF also resolves
 *     claims server-side (§7-Z), so a brief claim-strip window is tolerated.
 *   - Fire-and-forget (§7-N error surfaced to console, non-fatal): worst case
 *     is re-prompting on the next device/install.
 */
(function () {
  'use strict';

  var LS_KEY = 'account_consent_v1';            // accepted (persistent, cross-session)
  var SS_DEFER = 'account_consent_deferred_v1'; // tapped "ภายหลัง" (this session only)
  var NOTICE_VERSION = 'v1';
  var _busy = false;

  // ── In-app legal-doc viewer ──────────────────────────────────────────────
  // The consent prompt must NOT pop a new tab or navigate away. In LIFF a 2nd
  // tab confuses back-nav, and the legal pages' "/" link → index.html →
  // location.replace('/dashboard') would dump tenants on the ADMIN page. So the
  // privacy/ToS links open a STACKED GhModal in-app instead:
  //   • privacy → clone the in-DOM #policy-privacy-content (no network, styled)
  //   • ToS     → fetch /terms.html <main> (SSoT; AbortController timeout §7-R)
  // Closing the doc modal returns to the consent prompt to tap "ยอมรับ".

  function _lineSafeOpen(url) {
    // Last-resort fallback (no modal infra / fetch failed). external:true opens
    // the system browser outside LINE — the app's openDocFile convention.
    try {
      if (window.liff && typeof liff.isInClient === 'function' && liff.isInClient()) {
        liff.openWindow({ url: url, external: true });
        return;
      }
    } catch (_) { /* fall through */ }
    try { window.open(url, '_blank', 'noopener'); } catch (_) { /* noop */ }
  }

  function _openDocModal(title, bodyEl) {
    return window.GhModal.open({
      title: title,
      body: bodyEl,
      size: 'large',
      dismissible: true,
      actions: [{ label: 'ปิด', variant: 'ghost', onClick: function (m) { m.close(); } }],
    });
  }

  // Keep anchors inside fetched legal HTML in-app — a raw <a href="/privacy.html">
  // would full-page-navigate the LIFF webview (re-introducing the new-tab/admin bug).
  function _rewireDocLinks(scope) {
    var links = scope.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      (function (a) {
        var href = a.getAttribute('href') || '';
        if (href.indexOf('mailto:') === 0) return; // email links are fine
        a.addEventListener('click', function (e) {
          e.preventDefault();
          if (/\/privacy\.html/.test(href)) {
            _openLegalModal({ title: 'นโยบายความเป็นส่วนตัว', cloneId: 'policy-privacy-content', url: '/privacy.html' });
          } else if (/\/terms\.html/.test(href)) {
            _openLegalModal({ title: 'ข้อตกลงการใช้งาน', url: '/terms.html' });
          } else {
            _lineSafeOpen(href);
          }
        });
      })(links[i]);
    }
  }

  function _openLegalModal(opts) {
    if (!window.GhModal || typeof window.GhModal.open !== 'function') {
      _lineSafeOpen(opts.url);  // no modal infra — degrade to LINE-safe open
      return;
    }

    var wrap = document.createElement('div');
    wrap.style.cssText = 'max-height:68vh; overflow-y:auto; -webkit-overflow-scrolling:touch;';

    // 1) Prefer cloning content already rendered in the app (no network, styled).
    var src = opts.cloneId ? document.getElementById(opts.cloneId) : null;
    if (src) {
      var clone = src.cloneNode(true);
      clone.removeAttribute('id');   // avoid a duplicate id in the document
      clone.className = '';          // drop .card/.u-pb-nav → no card-in-card
      wrap.appendChild(clone);
      _openDocModal(opts.title, wrap);
      return;
    }

    // 2) Otherwise fetch the canonical page and show its <main> (single source).
    var loading = document.createElement('p');
    loading.textContent = 'กำลังโหลด…';
    loading.style.cssText = 'text-align:center; color:var(--text-muted,#888); padding:24px 0;';
    wrap.appendChild(loading);
    var modal = _openDocModal(opts.title, wrap);

    var ctrl = new AbortController();
    var to = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 8000); // §7-R
    fetch(opts.url, { signal: ctrl.signal, credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
      .then(function (html) {
        var parsed = new DOMParser().parseFromString(html, 'text/html');
        var main = parsed.querySelector('main');
        if (!main) throw new Error('no <main>');
        // The page wraps its body in <section class="card"> — inside the modal
        // that renders as a nested framed box (cramped, hard to read). Drop the
        // card framing so the content flows flat in the modal body.
        var cards = main.querySelectorAll('.card');
        for (var c = 0; c < cards.length; c++) cards[c].classList.remove('card');
        wrap.textContent = '';
        wrap.appendChild(main);     // parsed in an inert doc → its scripts never run
        _rewireDocLinks(wrap);
      })
      .catch(function (e) {
        wrap.textContent = '';
        var err = document.createElement('p');
        err.style.cssText = 'text-align:center; color:var(--text-muted,#888); padding:16px 0;';
        err.textContent = 'โหลดเอกสารไม่สำเร็จ';
        wrap.appendChild(err);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gh-btn gh-btn--ghost';
        btn.textContent = 'เปิดหน้าเต็ม';
        btn.style.cssText = 'display:block; margin:10px auto 0;';
        btn.addEventListener('click', function () { _lineSafeOpen(opts.url); if (modal) modal.close(); });
        wrap.appendChild(btn);
        if (window.console) console.warn('[consent] legal doc load failed:', e && e.message);
      })
      .finally(function () { clearTimeout(to); });
  }

  function _legalLinkItem(label, opts) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = opts.url || '#';   // real href → graceful nav if JS is disabled
    a.textContent = label;
    a.style.cssText = 'color:var(--brand-primary,#2f6f4e); text-decoration:underline; cursor:pointer;';
    a.addEventListener('click', function (e) { e.preventDefault(); _openLegalModal(opts); });
    li.appendChild(a);
    return li;
  }

  function _alreadyHandled() {
    try {
      if (localStorage.getItem(LS_KEY) === '1') return true;
      if (sessionStorage.getItem(SS_DEFER) === '1') return true;
    } catch (_) { /* storage disabled — fall through and prompt */ }
    return false;
  }

  async function maybePromptAccountConsent() {
    if (_busy) return;                 // a prompt is already open (re-entrant hook fire)
    if (_alreadyHandled()) return;     // accepted before, or deferred this session
    // GhModal is a defer module too — if it hasn't loaded yet, bail; the next
    // _onLiffClaimsReady fire (liffLinked) will retry once it's available.
    if (!window.GhModal || typeof window.GhModal.confirm !== 'function') return;

    _busy = true;
    try {
      var body = document.createElement('div');
      body.style.cssText = 'font-size:var(--fs-sm,0.9rem); line-height:1.6; color:var(--text-dark,#333);';

      var _p1 = document.createElement('p');
      _p1.style.cssText = 'margin:0 0 10px;';
      _p1.textContent = 'เพื่อให้บริการแอป Nature Haven เรามีการเก็บและใช้ข้อมูลส่วนบุคคลของคุณ ' +
        '(เช่น ข้อมูลห้องพัก บิล การชำระเงิน และข้อมูลติดต่อ) ตามที่ระบุไว้ใน:';
      body.appendChild(_p1);

      var _ul = document.createElement('ul');
      _ul.style.cssText = 'margin:0 0 12px; padding-left:20px;';
      _ul.appendChild(_legalLinkItem('นโยบายความเป็นส่วนตัว (PDPA)', {
        title: 'นโยบายความเป็นส่วนตัว', cloneId: 'policy-privacy-content', url: '/privacy.html',
      }));
      _ul.appendChild(_legalLinkItem('ข้อตกลงการใช้งาน', {
        title: 'ข้อตกลงการใช้งาน', url: '/terms.html',
      }));
      body.appendChild(_ul);

      var _p2 = document.createElement('p');
      _p2.style.cssText = 'margin:0; color:var(--text-muted,#888); font-size:var(--fs-sm,0.85rem);';
      _p2.textContent = 'กด "ยอมรับ" เพื่อยืนยันว่าคุณได้อ่านและยอมรับนโยบายข้างต้น';
      body.appendChild(_p2);

      var ok = await window.GhModal.confirm({
        title: '🛡️ ความเป็นส่วนตัวและข้อตกลงการใช้งาน',
        body: body,
        confirmLabel: 'ยอมรับ',
        cancelLabel: 'ภายหลัง',
        dismissible: true,
      });

      if (!ok) {
        // Deferred — don't nag again this session; re-prompt next session until accepted.
        try { sessionStorage.setItem(SS_DEFER, '1'); } catch (_) { /* noop */ }
        return;
      }

      try { localStorage.setItem(LS_KEY, '1'); } catch (_) { /* noop */ }

      // Fire-and-forget server ledger write (PDPA proof). consents/{tenantId}_account_v1.
      try {
        var fn = window.firebase
              && window.firebase.functions
              && window.firebase.functions.httpsCallable
              && window.firebase.functions.httpsCallable('recordChecklistConsent');
        if (fn) {
          fn({
            purpose: 'account_v1',
            noticeVersion: NOTICE_VERSION,
            userAgent: (navigator.userAgent || '').slice(0, 256),
          }).catch(function (e) {
            console.warn('[consent] account_v1 ledger write failed (non-fatal):', e && e.message);
          });
        }
      } catch (_) { /* CF not wired in this build — non-fatal */ }
    } finally {
      _busy = false;
    }
  }

  // Exposed for the wiring below + debug/reset from the console.
  window.maybePromptAccountConsent = maybePromptAccountConsent;

  // Self-wire (§7-A): the canonical hook fires on authReady + liffLinked, and
  // re-fires safely (guarded above). Mirrors facility-booking-ui.js's presence
  // guard — if the hook is absent the prompt simply never shows (non-fatal).
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(function () { maybePromptAccountConsent(); });
  }
})();
