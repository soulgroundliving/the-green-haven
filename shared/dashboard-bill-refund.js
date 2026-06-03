/**
 * Admin: refund a PAID bill (คืนเงิน) — the UI caller for the refundBill CF (Roadmap Phase 2).
 *
 * Called from the payment-detail modal's paid-state footer (data-action="refundBill"
 * with data-id/year/month → dashboard-main.js delegation hub). Reads the bill from
 * BillStore to PREVIEW it, REQUIRES an explicit reason, then calls the refundBill
 * callable. §7-I: preview → explicit user action, never auto-invoke / auto-click.
 * Admin-only (the CF gates the write + writes the BILL_REFUNDED audit row).
 *
 * Distinct from "รีเซ็ตกลับยังไม่จ่าย" (resetRoomPayment): a refund means money was
 * genuinely returned — the bill is reversed (status:'refunded', excluded from revenue),
 * not just re-flagged as unpaid/owing.
 */
(function () {
  'use strict';

  async function refundBillPrompt(roomId, year, month) {
    if (!roomId || year == null || month == null) {
      window.showToast && window.showToast('ข้อมูลห้อง/งวดไม่ครบ', 'info');
      return;
    }
    const fb = window.firebase;
    if (!fb || !fb.functions) {
      window.showToast && window.showToast('Firebase ยังไม่พร้อม', 'error');
      return;
    }

    const bld = /^[Nn]\d/.test(String(roomId)) ? 'nest' : 'rooms';
    const monthNum = Number(month);
    const bill = (window.BillStore && typeof window.BillStore.getByMonth === 'function')
      ? window.BillStore.getByMonth(bld, roomId, String(year), monthNum)
      : null;

    if (!bill) {
      window.showToast && window.showToast('ไม่พบบิลของห้อง/งวดนี้', 'info');
      return;
    }
    if (bill.status === 'refunded') {
      window.showToast && window.showToast('บิลนี้คืนเงินไปแล้ว', 'info');
      return;
    }
    if (bill.status !== 'paid') {
      window.showToast && window.showToast('คืนเงินได้เฉพาะบิลที่ชำระแล้วเท่านั้น', 'warning');
      return;
    }

    const amount = Number(bill.totalCharge || bill.totalAmount || bill.total) || 0;
    // §7-I: preview the bill, then require an EXPLICIT reason. ghPrompt → null on cancel.
    const promptMsg =
      `คืนเงินบิลห้อง ${roomId} • งวด ${monthNum}/${year}\n` +
      `ยอด ฿${amount.toLocaleString('th-TH')}${bill.receiptNo ? ` • ${bill.receiptNo}` : ''}\n\n` +
      `การคืนเงินจะกลับรายการบิลนี้ (ตัดออกจากรายได้) และบันทึกถาวรใน audit trail\n` +
      `เหตุผลการคืนเงิน:`;
    const reason = window.ghPrompt ? await window.ghPrompt(promptMsg, '') : null;
    if (reason == null) return; // cancelled
    if (!String(reason).trim()) {
      window.showToast && window.showToast('ต้องระบุเหตุผลการคืนเงิน', 'warning');
      return;
    }

    try {
      const res = await fb.functions.httpsCallable('refundBill')({
        building: bld, room: roomId, year, month: monthNum, reason: String(reason).trim(),
      });
      const out = (res && res.data) || {};
      window.showToast && window.showToast(
        out.alreadyRefunded
          ? 'บิลนี้คืนเงินไปแล้ว'
          : `คืนเงินบิลห้อง ${roomId} เรียบร้อย (฿${Number(out.amount || amount).toLocaleString('th-TH')})`,
        'success'
      );
      if (typeof window.closePayModal === 'function') window.closePayModal();
    } catch (e) {
      window.showToast && window.showToast('คืนเงินไม่สำเร็จ: ' + ((e && e.message) || e), 'error');
    }
  }

  window.refundBillPrompt = refundBillPrompt;
})();
