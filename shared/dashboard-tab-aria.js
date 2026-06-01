/**
 * Dashboard tab ARIA — adds WCAG 4.1.2 / 1.4.1 tab semantics to the dashboard's
 * tab switchers WITHOUT touching any of the 7 switcher functions or the HTML.
 *
 * Every dashboard tab button carries `.year-tab` or `.dash-tab-btn`, and the
 * active one carries `.active` (set by whichever switcher ran). We read that
 * single source of truth and mirror it into role="tab" + aria-selected, and tag
 * the parent bar role="tablist". A capture-phase click listener re-syncs on the
 * next microtask — AFTER the switcher's synchronous handler set `.active` — so we
 * never duplicate switch logic and never race it. Purely additive ARIA: no
 * display/behavior change, so the §7-SS counterexample switchDashboardTab is
 * safe to include.
 *
 * NOTE: panel role="tabpanel" + aria-controls linkage is a deliberate follow-up
 * (panels share no single selector); role=tablist/tab + aria-selected is the
 * high-value core and the audit's explicit ask.
 *
 * Export: window.syncTabAria
 */
(function () {
  'use strict';

  var TAB_SELECTOR = '.year-tab, .dash-tab-btn';

  function syncTabAria(root) {
    try {
      var scope = (root && typeof root.querySelectorAll === 'function')
        ? root
        : (typeof document !== 'undefined' ? document : null);
      if (!scope) return 0;
      var tabs = scope.querySelectorAll(TAB_SELECTOR);
      tabs.forEach(function (b) {
        if (!b || !b.setAttribute) return;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', (b.classList && b.classList.contains('active')) ? 'true' : 'false');
        var bar = b.parentElement;
        if (bar && bar.getAttribute && bar.getAttribute('role') !== 'tablist') {
          bar.setAttribute('role', 'tablist');
        }
      });
      return tabs.length;
    } catch (e) {
      // a11y enhancement must NEVER break tab switching
      return 0;
    }
  }
  window.syncTabAria = syncTabAria;

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    // Capture phase fires before the bubble-phase delegation hub; the microtask
    // defers the sync until AFTER the switcher's synchronous handler set .active.
    document.addEventListener('click', function (e) {
      var btn = (e.target && typeof e.target.closest === 'function')
        ? e.target.closest(TAB_SELECTOR)
        : null;
      if (btn) Promise.resolve().then(function () { syncTabAria(); });
    }, true);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { syncTabAria(); });
    } else {
      // Deferred script: DOM already parsed — sync the initial state now.
      syncTabAria();
    }
  }
})();
