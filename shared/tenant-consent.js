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
      body.innerHTML =
        '<p style="margin:0 0 10px;">เพื่อให้บริการแอป Nature Haven เรามีการเก็บและใช้ข้อมูลส่วนบุคคลของคุณ ' +
        '(เช่น ข้อมูลห้องพัก บิล การชำระเงิน และข้อมูลติดต่อ) ตามที่ระบุไว้ใน:</p>' +
        '<ul style="margin:0 0 12px; padding-left:20px;">' +
          '<li><a href="/privacy.html" target="_blank" rel="noopener">นโยบายความเป็นส่วนตัว (PDPA)</a></li>' +
          '<li><a href="/terms.html" target="_blank" rel="noopener">ข้อตกลงการใช้งาน</a></li>' +
        '</ul>' +
        '<p style="margin:0; color:var(--text-muted,#888); font-size:var(--fs-sm,0.85rem);">' +
        'กด "ยอมรับ" เพื่อยืนยันว่าคุณได้อ่านและยอมรับนโยบายข้างต้น</p>';

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
