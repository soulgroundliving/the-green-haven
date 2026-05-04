/*
 * Green Haven — Thai date utility + progressive enhancement (UMD-ish window.GhDate)
 *
 * Progressive enhancement: any <input type="date" data-thai-date> gets an
 * auto-injected <span> beside it showing the Buddhist Era (พ.ศ.) equivalent.
 * The input value stays in ISO CE format (YYYY-MM-DD) — no schema changes needed.
 *
 * API:
 *   GhDate.toBE(date)            — CE Date/string → BE year (number)
 *   GhDate.format(date, opts)    — format a date in Thai locale
 *   GhDate.init()                — wire all [data-thai-date] inputs on page
 *   GhDate.wire(inputEl)         — wire a single input element
 *
 * Format options:
 *   { style: 'short' }  → "15 ม.ค. 2568"   (default)
 *   { style: 'long'  }  → "15 มกราคม พ.ศ. 2568"
 *   { style: 'year'  }  → "พ.ศ. 2568"
 */
(function () {
  'use strict';

  var MONTH_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                     'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  var MONTH_LONG  = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                     'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

  function _parseISO(str) {
    if (!str) return null;
    // Accept Date objects too
    if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
    var parts = String(str).split('-');
    if (parts.length < 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m, d);
  }

  function toBE(date) {
    var d = _parseISO(date);
    if (!d) return null;
    return d.getFullYear() + 543;
  }

  function format(date, opts) {
    var d = _parseISO(date);
    if (!d) return '';
    opts = opts || {};
    var style = opts.style || 'short';
    var day = d.getDate();
    var mon = d.getMonth();
    var be  = d.getFullYear() + 543;

    if (style === 'year')  return 'พ.ศ. ' + be;
    if (style === 'long')  return day + ' ' + MONTH_LONG[mon]  + ' พ.ศ. ' + be;
    return day + ' ' + MONTH_SHORT[mon] + ' ' + be; // short (default)
  }

  // ─── Progressive enhancement ──────────────────────────────────────────────

  function _makeLabel(inputEl) {
    var span = document.createElement('span');
    span.className = 'gh-thai-date-label';
    span.setAttribute('aria-live', 'polite');
    span.style.cssText = [
      'display:inline-block',
      'margin-left:8px',
      'font-size:.8rem',
      'color:var(--muted,#64748b)',
      'font-variant-numeric:tabular-nums',
      'white-space:nowrap',
      'vertical-align:middle',
    ].join(';');
    return span;
  }

  function _update(inputEl, span) {
    var val = inputEl.value;
    span.textContent = val ? format(val, { style: 'short' }) + ' (พ.ศ.)' : '';
  }

  function wire(inputEl) {
    if (!inputEl || inputEl._ghDateWired) return;
    inputEl._ghDateWired = true;

    var span = _makeLabel(inputEl);
    // Insert after input; wrap if needed
    if (inputEl.parentNode) {
      inputEl.parentNode.insertBefore(span, inputEl.nextSibling);
    }

    _update(inputEl, span);
    // focusin catches pre-populated values (e.g. modal opened with existing tenant data)
    inputEl.addEventListener('focusin', function () { _update(inputEl, span); });
    inputEl.addEventListener('input',   function () { _update(inputEl, span); });
    inputEl.addEventListener('change',  function () { _update(inputEl, span); });
  }

  function init() {
    var els = document.querySelectorAll('input[data-thai-date]');
    for (var i = 0; i < els.length; i++) wire(els[i]);
  }

  // Auto-init after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Already parsed — but dynamic modals may render later, so also expose init()
    setTimeout(init, 0);
  }

  window.GhDate = {
    toBE:   toBE,
    format: format,
    wire:   wire,
    init:   init,
  };
})();
