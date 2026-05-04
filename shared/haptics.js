/*
 * Green Haven — Haptic feedback (UMD-ish window.GhHaptic)
 *
 * Tactile feedback for mobile actions. Detects LIFF SDK first (best on
 * iOS via CoreHaptics), falls back to Web Vibration API on Android, then
 * silent no-op on desktop or where unavailable.
 *
 * API:
 *   GhHaptic.tap()      — light, ~10ms — buttons / taps
 *   GhHaptic.success()  — short pattern — claim reward / slip verified
 *   GhHaptic.warning()  — double pulse — soft warning
 *   GhHaptic.error()    — long pulse — destructive action / failure
 *
 * Auto-respects prefers-reduced-motion (suppresses output).
 *
 * LIFF note: liff.vibrate() exists but only fires on Android in the LINE app;
 * iOS uses navigator.vibrate via UIWebKit which is mostly silent. We attempt
 * both layered — vibrate in any browser that supports it.
 */
(function () {
  'use strict';

  let _enabled = true;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      _enabled = false;
    }
  } catch (_) { /* noop */ }

  // Quiet hours — suppress haptics overnight (BKK local time, overnight range supported)
  let _quietStart = 22;
  let _quietEnd   = 7;

  function _inQuietHours() {
    try {
      const h = new Date().getHours();
      return _quietStart > _quietEnd
        ? (h >= _quietStart || h < _quietEnd)   // overnight: 22–07
        : (h >= _quietStart && h < _quietEnd);  // same-day range
    } catch (_) { return false; }
  }

  function _vibrate(pattern) {
    if (!_enabled) return;
    if (_inQuietHours()) return;
    // Try LIFF first (cleaner on supported devices)
    try {
      if (window.liff && typeof window.liff.vibrate === 'function') {
        window.liff.vibrate(pattern);
        return;
      }
    } catch (_) { /* liff not initialized */ }
    // Standard Web Vibration API
    try {
      if (navigator && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch (_) { /* unsupported */ }
  }

  // Patterns chosen to feel distinct without overwhelming
  const PATTERNS = {
    tap:     10,           // single quick pulse
    success: [10, 60, 30], // short-pause-medium = "done!"
    warning: [40, 80, 40], // double pulse with gap = "heads up"
    error:   [80, 40, 80], // long-short-long = "stop / wrong"
    select:  4,            // micro for picker selection
  };

  function tap()     { _vibrate(PATTERNS.tap); }
  function success() { _vibrate(PATTERNS.success); }
  function warning() { _vibrate(PATTERNS.warning); }
  function error()   { _vibrate(PATTERNS.error); }
  function select()  { _vibrate(PATTERNS.select); }

  function setEnabled(value) { _enabled = !!value; }
  function isEnabled() { return _enabled; }
  function setQuietHours(start, end) { _quietStart = start; _quietEnd = end; }
  function getQuietHours() { return { start: _quietStart, end: _quietEnd }; }

  window.GhHaptic = {
    tap: tap,
    success: success,
    warning: warning,
    error: error,
    select: select,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    setQuietHours: setQuietHours,
    getQuietHours: getQuietHours,
  };
})();
