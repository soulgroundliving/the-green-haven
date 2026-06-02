/**
 * Admin: void an issued invoice (Roadmap 1.3) — the UI caller for the voidInvoice CF.
 *
 * Reads the persisted invoices/{building}_{room}_{period} doc for the room+month the
 * admin is currently billing (window.invoiceData, set by generateInvoice), PREVIEWS
 * it, REQUIRES an explicit reason, then calls the voidInvoice callable. §7-I: preview
 * → explicit user action, never auto-invoke / auto-click. Admin-only (firestore rules
 * gate the read; the CF gates the write + writes the BILL_VOIDED audit row).
 *
 * The period key is built with the SAME normalization as the server (issueInvoiceNo /
 * _billFlex.computeBill: 2-digit BE → 2500+yy), so writer and reader resolve the same
 * doc id by construction (§7-E year-format trap / §7-T one-key-shape).
 */
(function () {
  'use strict';

  function _beYear(year) {
    const y = Number(year);
    return y < 100 ? 2500 + y : y; // mirror _billFlex.computeBill — 2-digit BE → 4-digit BE
  }

  async function voidInvoicePrompt() {
    const d = window.invoiceData;
    if (!d || !d.building || !d.room || d.month == null || d.year == null) {
      window.showToast && window.showToast('ออกใบแจ้งหนี้ของห้อง/งวดก่อน แล้วจึงยกเลิกได้', 'info');
      return;
    }
    const fb = window.firebase;
    if (!fb || typeof fb.firestore !== 'function' || !fb.firestoreFunctions || !fb.functions) {
      window.showToast && window.showToast('Firebase ยังไม่พร้อม', 'error');
      return;
    }

    const period = `${_beYear(d.year)}${String(d.month).padStart(2, '0')}`;
    const safeRoom = String(d.room).replace(/[\/.#$\[\]]/g, '_');
    const key = `${d.building}_${safeRoom}_${period}`;

    const db = fb.firestore();
    const fs = fb.firestoreFunctions;
    let inv;
    try {
      const snap = await fs.getDoc(fs.doc(db, 'invoices', key));
      if (!snap.exists()) {
        window.showToast && window.showToast('ยังไม่มีใบแจ้งหนี้ที่ออก (ส่งผ่าน LINE) สำหรับห้อง/งวดนี้', 'info');
        return;
      }
      inv = snap.data() || {};
    } catch (e) {
      window.showToast && window.showToast('อ่านใบแจ้งหนี้ไม่สำเร็จ: ' + ((e && e.message) || e), 'error');
      return;
    }

    if (inv.status === 'void') {
      window.showToast && window.showToast(`ใบแจ้งหนี้ ${inv.invoiceNo} ถูกยกเลิกไปแล้ว`, 'info');
      return;
    }

    // §7-I: preview the doc, then require an EXPLICIT reason. ghPrompt → null on cancel.
    const promptMsg =
      `ยกเลิกใบแจ้งหนี้เลขที่ ${inv.invoiceNo}\n` +
      `ห้อง ${inv.room} • งวด ${period} • ฿${Number(inv.amount || 0).toLocaleString('th-TH')}\n\n` +
      `เหตุผลการยกเลิก (บันทึกถาวรใน audit trail):`;
    const reason = window.ghPrompt ? await window.ghPrompt(promptMsg, '') : null;
    if (reason == null) return; // cancelled
    if (!String(reason).trim()) {
      window.showToast && window.showToast('ต้องระบุเหตุผลการยกเลิก', 'warning');
      return;
    }

    try {
      const res = await fb.functions.httpsCallable('voidInvoice')({ invoiceId: key, reason: String(reason).trim() });
      const out = (res && res.data) || {};
      window.showToast && window.showToast(
        out.alreadyVoid
          ? `ใบแจ้งหนี้ ${out.invoiceNo} ถูกยกเลิกอยู่แล้ว`
          : `ยกเลิกใบแจ้งหนี้ ${out.invoiceNo || inv.invoiceNo} เรียบร้อย`,
        'success'
      );
    } catch (e) {
      window.showToast && window.showToast('ยกเลิกไม่สำเร็จ: ' + ((e && e.message) || e), 'error');
    }
  }

  window.voidInvoicePrompt = voidInvoicePrompt;
})();
