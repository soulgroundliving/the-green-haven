/* shared/tenant-lease-request.js
 * Lease request flow (renew / move-out) — extracted from tenant_app.html.
 * Persists tenant decision to Firestore `leaseRequests/{auto}` so admin sees it
 * in the dashboard Lease Management page.
 *
 * Dependencies (all var globals from shared/tenant-liff-auth.js or window.*):
 *   _taRoom, _taBuilding, _taLease, _taTenant — var globals, accessible as barewords.
 *   toast()       — top-level fn in inline script → on window.
 *   window.GhModal.confirm() — global modal helper.
 *   window.firebase.*        — Firebase SDK globals.
 *
 * Exports (window.*):
 *   window.submitLeaseRequest   — action hub + data-action="submitLeaseRequest"
 *   window.confirmLeaseRequest  — action hub + data-action="confirmLeaseRequest"
 *   window.toggleContractForm   — data-action-change="toggleContractForm" on <select>
 */
(function () {
    'use strict';

    // ===== LEASE REQUEST (renew / moveout) =====
    // Persists tenant decision to Firestore `leaseRequests/{auto}` so admin sees it in
    // dashboard's Lease Management page. Replaces the old alert()-only stub.
    async function submitLeaseRequest(type) {
        if (!_taRoom || !_taBuilding) { toast('ข้อมูลห้องไม่พร้อม กรุณาลองใหม่', 'error'); return; }
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
            toast('ระบบยังไม่พร้อม', 'error'); return;
        }
        const fs = window.firebase.firestoreFunctions;
        const db = window.firebase.firestore();
        let payload = {
            type, building: _taBuilding, room: String(_taRoom),
            tenantId: _taLease?.tenantId || _taTenant?.id || '',
            tenantName: _taTenant?.name || _taLease?.tenantName || '',
            phone: _taTenant?.phone || '',
            leaseId: _taLease?.id || _taLease?.leaseId || '',
            createdAt: new Date().toISOString(),
            status: 'pending'
        };
        if (type === 'renew') {
            payload.duration = document.getElementById('renew-duration')?.value || '1y';
            payload.note     = document.getElementById('renew-note')?.value?.trim() || '';
        } else if (type === 'moveout') {
            const date = document.getElementById('moveout-date')?.value;
            const bank = document.getElementById('moveout-bank')?.value?.trim();
            if (!date) { toast('กรุณาระบุวันที่ย้ายออก', 'warning'); return; }
            if (!bank) { toast('กรุณาระบุบัญชีธนาคารรับมัดจำ', 'warning'); return; }
            payload.moveOutDate = date;
            payload.depositRefundBank = bank;
            payload.reason = document.getElementById('moveout-reason')?.value?.trim() || '';
        }
        try {
            await fs.addDoc(fs.collection(db, 'leaseRequests'), payload);
            document.getElementById('contract-forms-section').style.display = 'none';
            document.getElementById('contract-quiz-section').style.display = 'none';
            const successEl = document.getElementById('lease-request-success');
            document.getElementById('lease-success-title').textContent =
                type === 'renew' ? 'ส่งคำขอต่อสัญญาแล้ว' : 'แจ้งย้ายออกแล้ว';
            document.getElementById('lease-success-msg').textContent =
                type === 'renew' ? 'รอเจ้าของยืนยัน — ทีมงานจะติดต่อกลับเร็วๆ นี้'
                                 : 'เจ้าของจะติดต่อกลับเร็วๆ นี้';
            successEl.style.display = 'block';
        } catch (e) {
            console.error('submitLeaseRequest failed:', e);
            toast('ส่งคำขอไม่สำเร็จ — กรุณาลองใหม่', 'error');
        }
    }

    async function confirmLeaseRequest(type) {
        if (!_taRoom || !_taBuilding) { toast('ข้อมูลห้องไม่พร้อม กรุณาลองใหม่', 'error'); return; }
        if (type === 'moveout') {
            const date = document.getElementById('moveout-date')?.value;
            const bank = document.getElementById('moveout-bank')?.value?.trim();
            if (!date) { toast('กรุณาระบุวันที่ย้ายออก', 'warning'); return; }
            if (!bank) { toast('กรุณาระบุบัญชีธนาคารรับมัดจำ', 'warning'); return; }
        }
        const labels = { renew: 'ต่อสัญญาเช่า', moveout: 'แจ้งย้ายออก' };
        const ok = await window.GhModal.confirm({
            title: type === 'renew' ? '✅ ยืนยันต่อสัญญา' : '❌ ยืนยันแจ้งย้ายออก',
            body: `ต้องการ${labels[type]}ใช่หรือไม่? หลังจากส่งแล้วทีมงานจะติดต่อกลับ`,
            confirmLabel: 'ยืนยัน',
            cancelLabel: 'ยกเลิก',
        });
        if (ok) submitLeaseRequest(type);
    }

    function toggleContractForm() {
        const val = document.getElementById('contract-decision')?.value || '';
        const renewEl   = document.getElementById('renew-form');
        const moveoutEl = document.getElementById('moveout-form');
        if (renewEl)   renewEl.style.display   = val === 'renew'   ? 'block' : 'none';
        if (moveoutEl) moveoutEl.style.display  = val === 'moveout' ? 'block' : 'none';
    }

    window.submitLeaseRequest  = submitLeaseRequest;
    window.confirmLeaseRequest = confirmLeaseRequest;
    window.toggleContractForm  = toggleContractForm;
})();
