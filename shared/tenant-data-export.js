/**
 * Tenant DSR export (PDPA §30 right-to-access) — UI caller for the exportMyData CF.
 *
 * Closes the §7-K orphan: exportMyData was deployed but had ZERO callers. The tenant
 * taps "ดาวน์โหลดข้อมูลของฉัน" in Settings → this calls the callable (tenant-scoped,
 * _authSoT-gated server-side, returns only the caller's own data) and downloads the
 * JSON. §7-I: explicit user action only (no auto-invoke). §7-N: errors surface to a
 * toast, never a silent failure.
 *
 * Self-wires by element id (no edit to the inline delegation hub) → tenant_app.html
 * stays markup + external-script only → no CSP inline-hash drift (§7-II). The CF's
 * auth gate is the real guard; the click happens post-load when claims are ready (§7-A).
 */
(function () {
  'use strict';

  async function exportMyDataPrompt() {
    const fb = window.firebase;
    const toast = (typeof window.toast === 'function') ? window.toast : function () {};
    if (!fb || !fb.functions || typeof fb.functions.httpsCallable !== 'function') {
      toast('แอปยังโหลดไม่เสร็จ ลองใหม่อีกครั้ง', 'warning');
      return;
    }
    toast('กำลังเตรียมข้อมูลของคุณ…', 'info');
    try {
      const res = await fb.functions.httpsCallable('exportMyData')({});
      const data = (res && res.data) || {};
      const json = JSON.stringify(data, null, 2);
      // Blob + object URL (NOT a data: URL — §7-Y: fetch('data:') is CSP-blocked;
      // a blob: object URL for an <a download> is same-origin and allowed).
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const ymd = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nature-haven-my-data-${ymd}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('ดาวน์โหลดข้อมูลของคุณแล้ว (ไฟล์ JSON) ✅', 'success');
    } catch (e) {
      console.warn('[tenant-data-export] exportMyData failed:', e && (e.message || e));
      toast('ดาวน์โหลดไม่สำเร็จ: ' + ((e && e.message) || e), 'error');
    }
  }

  window.exportMyDataPrompt = exportMyDataPrompt;

  // Self-wire the Settings menu item (avoids touching the inline delegation hub).
  function _wire() {
    const el = document.getElementById('btn-export-my-data');
    if (!el || el._exportWired) return;
    el._exportWired = true;
    el.addEventListener('click', exportMyDataPrompt);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); exportMyDataPrompt(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();
})();
