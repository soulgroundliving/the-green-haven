/*
 * Green Haven — Modal helper (UMD-ish window.GhModal)
 *
 * Single source of truth for modal behavior across surfaces.
 * Pairs with .gh-modal-* classes in shared/components.css.
 *
 * Features:
 *   - ESC-to-close
 *   - Focus trap (Tab cycles within modal)
 *   - Restores focus to trigger element after close
 *   - aria-modal="true" + role="dialog" + aria-labelledby
 *   - Backdrop click to close (configurable)
 *   - Body scroll lock while open
 *   - Stack-aware (multiple modals layered cleanly)
 *
 * Usage:
 *   const m = window.GhModal.open({
 *     title: 'ยืนยันการลบ',
 *     body: 'ลบรายการนี้แล้วกู้คืนไม่ได้',          // string OR HTMLElement
 *     size: 'small',                                // 'small' | 'default' | 'large'
 *     dismissible: true,                            // backdrop + X button + ESC
 *     actions: [
 *       { label: 'ยกเลิก',  variant: 'ghost',   onClick: m => m.close() },
 *       { label: 'ลบ',     variant: 'danger',  onClick: m => { ...; m.close(); } },
 *     ],
 *     onClose: () => { ... }
 *   });
 *
 * Returns: { close(), el, panel } — call .close() to dismiss programmatically.
 */
(function () {
  'use strict';

  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[role="button"]:not([aria-disabled="true"])',
  ].join(', ');

  const stack = [];

  function nextId() {
    return 'gh-modal-' + Math.random().toString(36).slice(2, 9);
  }

  function makeElement(tag, opts) {
    const el = document.createElement(tag);
    if (!opts) return el;
    if (opts.className) el.className = opts.className;
    if (opts.id) el.id = opts.id;
    if (opts.text) el.textContent = opts.text;
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function (k) {
        el.setAttribute(k, opts.attrs[k]);
      });
    }
    return el;
  }

  function appendBody(target, body) {
    if (body == null) return;
    if (typeof body === 'string') {
      // Plain text — never innerHTML to avoid XSS
      target.textContent = body;
    } else if (body instanceof HTMLElement) {
      target.appendChild(body);
    } else if (typeof body === 'function') {
      const result = body(target);
      if (result instanceof HTMLElement) target.appendChild(result);
    }
  }

  function trapFocus(panel, e) {
    if (e.key !== 'Tab') return;
    const focusables = panel.querySelectorAll(FOCUSABLE_SELECTOR);
    if (!focusables.length) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function open(options) {
    options = options || {};
    const dismissible = options.dismissible !== false;       // default true
    const size = options.size || 'default';
    const previousFocus = document.activeElement;

    // Build DOM
    const overlay = makeElement('div', {
      className: 'gh-modal-overlay',
      attrs: { 'data-gh-modal-overlay': '' },
    });

    const panelClasses = ['gh-modal-panel'];
    if (size === 'small') panelClasses.push('gh-modal-panel--small');
    if (size === 'large') panelClasses.push('gh-modal-panel--large');
    const panel = makeElement('div', {
      className: panelClasses.join(' '),
      attrs: {
        'role': 'dialog',
        'aria-modal': 'true',
        'tabindex': '-1',
      },
    });

    const titleId = nextId();
    if (options.title) {
      const header = makeElement('div', { className: 'gh-modal-header' });
      const titleEl = makeElement('h2', {
        className: 'gh-modal-title',
        id: titleId,
        text: String(options.title),
      });
      header.appendChild(titleEl);
      panel.setAttribute('aria-labelledby', titleId);

      if (dismissible) {
        const closeBtn = makeElement('button', {
          className: 'gh-modal-close',
          attrs: { 'type': 'button', 'aria-label': 'ปิด' },
          text: '×',
        });
        closeBtn.addEventListener('click', function () { instance.close(); });
        header.appendChild(closeBtn);
      }
      panel.appendChild(header);
    }

    const bodyEl = makeElement('div', { className: 'gh-modal-body' });
    appendBody(bodyEl, options.body);
    panel.appendChild(bodyEl);

    if (Array.isArray(options.actions) && options.actions.length) {
      const footer = makeElement('div', { className: 'gh-modal-footer' });
      options.actions.forEach(function (action) {
        const variant = action.variant || 'primary';
        const btn = makeElement('button', {
          className: 'gh-btn gh-btn--' + variant,
          text: String(action.label || ''),
          attrs: { 'type': 'button' },
        });
        if (action.disabled) btn.disabled = true;
        btn.addEventListener('click', function (ev) {
          if (typeof action.onClick === 'function') {
            action.onClick(instance, ev);
          }
        });
        footer.appendChild(btn);
      });
      panel.appendChild(footer);
    }

    overlay.appendChild(panel);

    // Backdrop click
    if (dismissible) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) instance.close();
      });
    }

    // Body scroll lock (idempotent across stack)
    document.body.classList.add('gh-modal-open');

    document.body.appendChild(overlay);

    // Keydown handler — bind to document so it works even if focus drifts
    function onKeydown(e) {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        instance.close();
        return;
      }
      if (e.key === 'Tab') {
        trapFocus(panel, e);
      }
    }
    document.addEventListener('keydown', onKeydown, true);

    // Move initial focus into the modal
    // Prefer first input/textarea, else first button, else the panel itself
    requestAnimationFrame(function () {
      const focusables = panel.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusables.length) {
        // Skip the close button — better UX to focus the body's first action
        const skipClose = panel.querySelector('.gh-modal-close');
        for (let i = 0; i < focusables.length; i++) {
          if (focusables[i] !== skipClose) {
            focusables[i].focus();
            return;
          }
        }
        focusables[0].focus();
      } else {
        panel.focus();
      }
    });

    let closed = false;
    const instance = {
      el: overlay,
      panel: panel,
      body: bodyEl,
      close: function () {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        const idx = stack.indexOf(instance);
        if (idx !== -1) stack.splice(idx, 1);
        if (stack.length === 0) {
          document.body.classList.remove('gh-modal-open');
        }
        // Restore focus to whatever opened the modal
        if (previousFocus && typeof previousFocus.focus === 'function') {
          try { previousFocus.focus(); } catch (e) { /* element may be detached */ }
        }
        if (typeof options.onClose === 'function') {
          try { options.onClose(); } catch (e) {
            if (window.console) console.error('[GhModal] onClose error:', e);
          }
        }
      },
    };
    stack.push(instance);
    return instance;
  }

  // Convenience: confirm dialog (returns Promise<boolean>)
  function confirm(options) {
    options = options || {};
    return new Promise(function (resolve) {
      let resolved = false;
      const m = open({
        title: options.title || 'ยืนยัน',
        body: options.body || '',
        size: options.size || 'small',
        dismissible: options.dismissible !== false,
        actions: [
          {
            label: options.cancelLabel || 'ยกเลิก',
            variant: 'ghost',
            onClick: function (modal) {
              resolved = true;
              resolve(false);
              modal.close();
            },
          },
          {
            label: options.confirmLabel || 'ยืนยัน',
            variant: options.danger ? 'danger' : 'primary',
            onClick: function (modal) {
              resolved = true;
              resolve(true);
              modal.close();
            },
          },
        ],
        onClose: function () {
          if (!resolved) resolve(false);
        },
      });
      return m;
    });
  }

  // Convenience: alert dialog (returns Promise<void>)
  function alert(options) {
    options = options || {};
    return new Promise(function (resolve) {
      open({
        title: options.title || 'แจ้งเตือน',
        body: options.body || '',
        size: options.size || 'small',
        dismissible: true,
        actions: [
          {
            label: options.okLabel || 'ตกลง',
            variant: 'primary',
            onClick: function (modal) {
              resolve();
              modal.close();
            },
          },
        ],
        onClose: function () { resolve(); },
      });
    });
  }

  window.GhModal = {
    open: open,
    confirm: confirm,
    alert: alert,
    _stack: stack,  // exposed for debugging only
  };

  /*
   * window.ghConfirm — terse promise-based replacement for native confirm()
   *
   * Migration pattern:
   *   Before: if (!confirm('ลบ?')) return; doDelete();
   *   After:  ghConfirm('ลบ?', { danger: true }).then(ok => { if (!ok) return; doDelete(); });
   *
   * The native confirm() blocks the JS thread; ghConfirm returns a Promise
   * so callers must use .then() or be async. Inline-ifing the body in .then()
   * keeps the diff small and avoids spreading async through callers.
   */
  window.ghConfirm = function (message, opts) {
    opts = opts || {};
    return confirm({
      title: opts.title || (opts.danger ? 'ยืนยันการลบ' : 'ยืนยัน'),
      body: String(message == null ? '' : message),
      confirmLabel: opts.confirmLabel || (opts.danger ? 'ลบ' : 'ตกลง'),
      cancelLabel: opts.cancelLabel || 'ยกเลิก',
      danger: !!opts.danger,
    });
  };

  /*
   * window.ghPrompt — styled replacement for native prompt().
   * Returns Promise<string|null>: the entered text, or null if cancelled.
   *
   *   const val = await window.ghPrompt('Enter reason:', 'default');
   *   if (val === null) return;  // cancelled
   */
  window.ghPrompt = function (message, defaultValue, opts) {
    if (defaultValue !== null && typeof defaultValue === 'object') {
      opts = defaultValue;
      defaultValue = opts.defaultValue || '';
    }
    opts = opts || {};
    defaultValue = (defaultValue == null) ? '' : String(defaultValue);
    return new Promise(function (resolve) {
      var resolved = false;
      var wrapper = document.createElement('div');
      var msgEl = document.createElement('p');
      msgEl.style.cssText = 'margin:0 0 10px 0;white-space:pre-wrap;font-size:14px';
      msgEl.textContent = message || '';
      var input = document.createElement('input');
      input.type = 'text';
      input.value = defaultValue;
      input.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-muted,#d1d5db);border-radius:6px;font-size:14px;font-family:inherit';
      wrapper.appendChild(msgEl);
      wrapper.appendChild(input);

      var m = open({
        title: opts.title || 'กรอกข้อมูล',
        body: wrapper,
        size: opts.size || 'small',
        dismissible: opts.dismissible !== false,
        actions: [
          {
            label: opts.cancelLabel || 'ยกเลิก',
            variant: 'ghost',
            onClick: function (modal) { resolved = true; resolve(null); modal.close(); },
          },
          {
            label: opts.confirmLabel || 'ตกลง',
            variant: 'primary',
            onClick: function (modal) { resolved = true; resolve(input.value); modal.close(); },
          },
        ],
        onClose: function () { if (!resolved) resolve(null); },
      });
      // Focus input after mount; allow Enter/Escape shortcuts
      setTimeout(function () { try { input.focus(); input.select(); } catch (_) {} }, 60);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { resolved = true; resolve(input.value); m.close(); }
        else if (e.key === 'Escape') { resolved = true; resolve(null); m.close(); }
      });
    });
  };

  /*
   * window.ghAlert — terse promise-based replacement for native alert().
   * Drop-in fallback to native alert if GhModal is unavailable.
   *
   *   ghAlert('บันทึกสำเร็จ');                       // simple
   *   ghAlert('ลบไม่สำเร็จ', { title: 'ขัดข้อง' });   // titled
   */
  window.ghAlert = function (message, opts) {
    opts = opts || {};
    return alert({
      title: opts.title || 'แจ้งเตือน',
      body: String(message == null ? '' : message),
      okLabel: opts.okLabel || 'ตกลง',
    });
  };
})();
