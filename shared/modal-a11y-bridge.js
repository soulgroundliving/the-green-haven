/*
 * Green Haven — Modal a11y bridge
 *
 * Adds ESC-to-close + backdrop-click-to-close + focus restoration to ALL
 * legacy modals on the page that match [role="dialog"][aria-modal="true"],
 * without requiring any markup rewrites.
 *
 * How it works:
 *   - Listens for Escape on document; finds the topmost visible dialog and
 *     hides it via style.display='none' (matches the existing pattern in
 *     tenant_app.html / dashboard.html).
 *   - Listens for click on dialog overlays; if user clicked the overlay
 *     itself (not its child content), closes it.
 *   - Watches for dialogs becoming visible (MutationObserver on style/class)
 *     and snapshots document.activeElement so it can restore focus on close.
 *   - Auto-focuses the first focusable inside the dialog when it opens.
 *
 * Constraints:
 *   - Does NOT prevent the modal owner's own close logic — they coexist.
 *   - Skips dialogs marked data-gh-no-bridge="true" (escape hatch).
 *   - Uses inline display:none, NOT classList — that's the convention here.
 */
(function () {
  'use strict';

  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[role="button"]:not([aria-disabled="true"])',
  ].join(', ');

  const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]:not([data-gh-no-bridge])';

  // Map<dialogElement, previousFocus> — set when modal becomes visible
  const focusSnapshots = new WeakMap();

  function isVisible(el) {
    if (!el) return false;
    if (el.style.display === 'none') return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return el.offsetParent !== null || cs.position === 'fixed';
  }

  function visibleDialogs() {
    return Array.from(document.querySelectorAll(DIALOG_SELECTOR)).filter(isVisible);
  }

  function topmost(dialogs) {
    if (!dialogs.length) return null;
    // Highest z-index wins; break ties by document order (later = on top)
    let best = dialogs[0];
    let bestZ = parseInt(window.getComputedStyle(best).zIndex, 10) || 0;
    for (let i = 1; i < dialogs.length; i++) {
      const z = parseInt(window.getComputedStyle(dialogs[i]).zIndex, 10) || 0;
      if (z >= bestZ) { best = dialogs[i]; bestZ = z; }
    }
    return best;
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    // The convention here is inline display:none — preserve that
    dialog.style.display = 'none';
    const prev = focusSnapshots.get(dialog);
    if (prev && typeof prev.focus === 'function') {
      try { prev.focus(); } catch (_) { /* element may be detached */ }
    }
    focusSnapshots.delete(dialog);
  }

  function focusFirst(dialog) {
    // Skip the close button (×) — better UX to focus a meaningful action
    const closeBtn = dialog.querySelector('[aria-label*="ปิด"], [aria-label*="close" i], .close, .modal-close');
    const focusables = dialog.querySelectorAll(FOCUSABLE);
    for (let i = 0; i < focusables.length; i++) {
      if (focusables[i] !== closeBtn) {
        focusables[i].focus();
        return;
      }
    }
    if (focusables[0]) focusables[0].focus();
  }

  // ESC handler
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const dialog = topmost(visibleDialogs());
    if (!dialog) return;
    e.stopPropagation();
    closeDialog(dialog);
  }, true);

  // Backdrop click — only when the click target IS the dialog overlay element
  document.addEventListener('click', function (e) {
    const dialog = e.target.closest(DIALOG_SELECTOR);
    if (!dialog) return;
    if (!isVisible(dialog)) return;
    if (e.target !== dialog) return;  // clicked inside content, not on backdrop
    if (dialog.getAttribute('data-gh-no-backdrop-close') === 'true') return;
    closeDialog(dialog);
  });

  // Watch for dialogs becoming visible — snapshot focus + auto-focus first
  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      if (m.type !== 'attributes') return;
      const dialog = m.target;
      if (!dialog.matches || !dialog.matches(DIALOG_SELECTOR)) return;
      if (!isVisible(dialog)) {
        // Becoming hidden — clean up
        focusSnapshots.delete(dialog);
        return;
      }
      // Becoming visible — snapshot trigger focus + auto-focus first
      if (!focusSnapshots.has(dialog)) {
        focusSnapshots.set(dialog, document.activeElement);
        // Defer to allow content to render
        requestAnimationFrame(function () { focusFirst(dialog); });
      }
    });
  });

  // Re-scan when new dialogs are appended (rare but possible)
  const docObserver = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes && m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches(DIALOG_SELECTOR)) {
          observer.observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
        }
        if (node.querySelectorAll) {
          node.querySelectorAll(DIALOG_SELECTOR).forEach(function (d) {
            observer.observe(d, { attributes: true, attributeFilter: ['style', 'class'] });
          });
        }
      });
    });
  });

  function attach() {
    document.querySelectorAll(DIALOG_SELECTOR).forEach(function (dialog) {
      observer.observe(dialog, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    });
    // document.body is guaranteed by the time DOMContentLoaded fires (or if
    // readyState is already 'interactive'/'complete'). Calling .observe(null)
    // earlier would throw "parameter 1 is not of type 'Node'".
    if (document.body) {
      docObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }

  window.GhModalA11yBridge = {
    closeTopmost: function () { closeDialog(topmost(visibleDialogs())); },
    visibleDialogs: visibleDialogs,
  };
})();
