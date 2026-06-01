// ===== SLIP UPLOAD + VERIFY + PROMPTPAY QR =====
// Extracted from tenant_app.html. Exports:
//   window.handleSlipFileUpload  — data-action-change on slip file input (el)
//   window.verifyTenantSlip      — data-action: verify slip via verifySlip CF
//   window._imageToJpegBase64    — used by tenant-cleaning.js (AVIF/HEIC→JPEG)
//   window._tenantRateLimit      — rate limiter used by tenant-cleaning.js
//   window.buildPromptPayPayload — PromptPay EMVCo payload builder; used by tenant-cleaning.js
//
// Shared state (window.* resolved at call time):
//   window._slipBase64          — var global (shared across slip + cleaning flows)
//   window._taCurrentBill       — current bill object (mirrored on window by inline script)
//   window._taBuilding, window._taRoom — var globals from tenant-liff-auth.js
//   window._setStatus           — 3-arg status helper (function decl in inline script)
//   window._saveTenantPayment   — payment record writer (stays inline — touches _taBills)
//   window.toast, window.goToPaymentStep, window.renderPaymentReceipt
(function () {
    'use strict';

    // ── Image conversion ─────────────────────────────────────────────────────
    // Convert any browser-decodable image (AVIF/WEBP/BMP/PNG/HEIC-Safari) → JPEG
    // because SlipOK only accepts JPG/PNG/WEBP; other formats cause verify fail.
    // Uses createObjectURL (§7-Y: never fetch('data:...') — violates connect-src CSP).
    async function _imageToJpegBase64(file, maxWidth = 1600, quality = 0.9) {
        const objUrl = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const im = new Image();
                im.onload = () => resolve(im);
                im.onerror = () => reject(new Error('เบราว์เซอร์ไม่รองรับไฟล์รูปนี้ (อาจเป็น HEIC) กรุณาบันทึกสลิปเป็น JPG แล้วลองใหม่'));
                im.src = objUrl;
            });
            let w = img.naturalWidth, h = img.naturalHeight;
            if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            return canvas.toDataURL('image/jpeg', quality);
        } finally {
            URL.revokeObjectURL(objUrl);
        }
    }

    // ── Slip upload ──────────────────────────────────────────────────────────
    // Called via data-action-change — receives (el, e) where el is the file input.
    async function handleSlipFileUpload(el) {
        const input = el || document.getElementById('slip-file-input');
        const file = input.files[0];
        if (!file) return;
        if (file.size > 10*1024*1024) { alert('ไฟล์ต้องไม่เกิน 10MB'); input.value = ''; return; }
        if (!file.type.startsWith('image/')) { alert('กรุณาเลือกไฟล์รูปภาพ'); input.value = ''; return; }

        const preview = document.getElementById('slip-preview-img');
        const wrap = document.getElementById('slip-preview-wrap');
        const drop = document.getElementById('slip-drop-area');
        const btn = document.getElementById('slip-verify-btn');

        const needsConvert = !['image/jpeg','image/png','image/webp'].includes(file.type);
        try {
            if (needsConvert) {
                window._slipBase64 = await _imageToJpegBase64(file);
            } else {
                window._slipBase64 = await new Promise((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = e => resolve(e.target.result);
                    r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
                    r.readAsDataURL(file);
                });
            }
        } catch (e) {
            alert(e.message);
            input.value = '';
            return;
        }

        if (preview) preview.src = window._slipBase64;
        if (wrap) wrap.style.display = '';
        if (drop) drop.style.display = 'none';
        if (btn) btn.disabled = false;
    }

    // ── Slip verification ────────────────────────────────────────────────────
    async function verifyTenantSlip() {
        if (!window._slipBase64) return;
        if (!_tenantRateLimit()) { toast('ส่งคำขอบ่อยเกินไป กรุณารอสักครู่', 'error'); return; }
        const statusEl = document.getElementById('slip-verify-status');
        const btn = document.getElementById('slip-verify-btn');
        _setStatus(statusEl, 'loading', 'กำลังตรวจสอบสลิป...');
        if (btn) btn.disabled = true;
        try {
            const total = window._taCurrentBill ? (window._taCurrentBill.totalAmount || window._taCurrentBill.total || 0) : 0;
            // onCall: SDK auto-attaches the LIFF custom-token ID token (room/building
            // claims) → CF assertTenantAccess authorizes this tenant (fixes the 401
            // from the old admin-only requireAdmin gate). §7-R: bound the LIFF wire
            // call with Promise.race (httpsCallable's built-in timeout is 70s).
            const callVerify = window.firebase.functions.httpsCallable('verifySlip');
            const callRes = await Promise.race([
                callVerify({ file: window._slipBase64, expectedAmount: total, building: _taBuilding, room: _taRoom }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 35000))
            ]);
            const result = callRes.data;
            if (result.success || result.verified) {
                _setStatus(statusEl, 'success', 'ตรวจสอบสำเร็จ!');
                if (typeof window._saveTenantPayment === 'function') window._saveTenantPayment({ slipOkVerified: true, ...result });
                setTimeout(() => {
                    if (typeof goToPaymentStep === 'function') goToPaymentStep(3);
                    if (typeof renderPaymentReceipt === 'function') renderPaymentReceipt(window._taCurrentBill);
                }, 1000);
            } else if (result.retryable && result.code === 'scb_delay') {
                const wait = result.retryAfterSec || 120;
                _setStatus(statusEl, 'warning', result.message);
                let remain = wait;
                if (btn) { btn.disabled = true; btn.textContent = `⏳ รออีก ${remain} วินาที`; }
                const tick = setInterval(() => {
                    remain--;
                    if (btn) btn.textContent = `⏳ รออีก ${remain} วินาที`;
                    if (remain <= 0) {
                        clearInterval(tick);
                        if (btn) { btn.disabled = false; btn.textContent = '🔄 ลองตรวจสอบอีกครั้ง'; }
                        _setStatus(statusEl, 'info', 'พร้อมลองใหม่ กดปุ่มด้านล่างได้เลย');
                    }
                }, 1000);
            } else {
                _setStatus(statusEl, 'error', result.message || result.error || 'ตรวจสอบไม่ผ่าน กรุณาลองใหม่');
                if (btn) btn.disabled = false;
            }
        } catch (e) {
            const isTimeout = e?.name === 'AbortError' || e?.message === 'timeout';
            // httpsCallable rejects with HttpsError (functions/*) for auth / rate-limit;
            // surface its message. scb_delay / mismatch / duplicate / slip-not-valid
            // RESOLVE with {success:false} and are handled above, not here.
            const cfMsg = (typeof e?.code === 'string' && e.code.startsWith('functions/')) ? e.message : null;
            _setStatus(statusEl, 'error', isTimeout ? 'เชื่อมต่อนานเกินไป กรุณาลองใหม่' : (cfMsg || 'เกิดข้อผิดพลาด กรุณาลองใหม่'));
            if (btn) btn.disabled = false;
        }
    }

    // ── Rate limiter ─────────────────────────────────────────────────────────
    function _tenantRateLimit() {
        const key = 'ta_slip_rl', now = Date.now();
        let hits = [];
        try { hits = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
        hits = hits.filter(t => now - t < 60000);
        if (hits.length >= 3) return false;
        hits.push(now);
        localStorage.setItem(key, JSON.stringify(hits));
        return true;
    }

    // ── PromptPay QR ─────────────────────────────────────────────────────────
    function crc16(str) {
        let crc = 0xFFFF;
        for (const c of str) { crc ^= c.charCodeAt(0) << 8; for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1; }
        return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    }

    function buildPromptPayPayload(phone, amount) {
        const clean = phone.replace(/\D/g, '');
        const mobile = clean.startsWith('0') ? '0066' + clean.slice(1) : clean;
        const f = (id, v) => id + v.length.toString().padStart(2, '0') + v;
        const acc = f('00', '0066') + f('01', mobile);
        const merchant = f('00', 'A000000677010111') + f('01', acc);
        const payload = f('00', '01') + f('01', '12') + f('29', merchant) + '5303764' + f('54', amount.toFixed(2)) + '5802TH' + '6304';
        return payload + crc16(payload);
    }

    // ── Exports ──────────────────────────────────────────────────────────────
    window.handleSlipFileUpload  = handleSlipFileUpload;
    window.verifyTenantSlip      = verifyTenantSlip;
    window._imageToJpegBase64    = _imageToJpegBase64;
    window._tenantRateLimit      = _tenantRateLimit;
    window.buildPromptPayPayload = buildPromptPayPayload;
})();
