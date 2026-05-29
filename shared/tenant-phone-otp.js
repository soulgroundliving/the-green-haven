/**
 * tenant-phone-otp.js — Phone number OTP verification flow for tenant_app.html.
 *
 * Extracted from the ===== PHONE OTP FLOW ===== section (~219 lines inline).
 * Loaded as a deferred script. All public functions exported to window.*.
 *
 * Flow: enter new phone → reCAPTCHA + signInWithPhoneNumber → enter 6-digit
 * code → confirmationResult.confirm() → save phone to Firestore.
 * Backend `requestPhoneOtp` callable enforces 3/hr per UID + per phone before
 * the actual SMS goes out (Firebase Phone Auth has its own per-IP limiter).
 *
 * Why linkWithCredential not signInWithCredential: the latter creates a
 * brand-new phone-auth UID which breaks the tenant doc's linkedAuthUid
 * relationship. Link preserves the original anon UID so Firestore rules pass.
 *
 * Depends on globals (all set before this defer script runs):
 *   _taTenant, _taRoom, _taBuilding  (var in tenant-liff-auth.js → global scope)
 *   window.firebasePhone, window.firebaseAuth, window.firebase.functions
 *   window.toast(msg, kind)          (tenant_app.html inline)
 *   window.renderProfilePage()       (tenant_app.html inline, optional)
 *   window.loadProfilePage()         (tenant_app.html inline, optional)
 *   window._taLineUserId             (tenant-liff-auth.js)
 *   window._tenantAppTenant          (tenant_app.html inline mirror)
 */
(function () {
    'use strict';

    let _otpRecaptchaVerifier = null;
    let _otpVerificationId = null;
    let _otpPendingPhone = null;

    function _setOtpStatus(msg, kind) {
        const el = document.getElementById('otp-status');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = kind === 'error'   ? 'var(--danger)' :
                         kind === 'success' ? 'var(--primary-green)' :
                         'var(--text-muted)';
    }

    function openPhoneOtpModal() {
        const m = document.getElementById('phone-otp-modal');
        if (!m) return;
        m.style.display = 'flex';
        resetPhoneOtpFlow();
        // Pre-fill with current phone (user can edit)
        const cur = (_taTenant?.phone || '').replace(/\D/g, '');
        document.getElementById('otp-new-phone').value = cur;
    }

    function closePhoneOtpModal() {
        const m = document.getElementById('phone-otp-modal');
        if (m) m.style.display = 'none';
        // Clear reCAPTCHA so a fresh widget mounts next open (stale widget triggers
        // "RecaptchaVerifier already rendered" errors)
        if (_otpRecaptchaVerifier) {
            try { _otpRecaptchaVerifier.clear(); } catch(_) {}
            _otpRecaptchaVerifier = null;
        }
        const c = document.getElementById('otp-recaptcha-container');
        if (c) c.innerHTML = '';
    }

    function resetPhoneOtpFlow() {
        document.getElementById('otp-step-1').classList.remove('ta-sect-hidden');
        document.getElementById('otp-step-2').classList.add('ta-sect-hidden');
        document.getElementById('otp-code').value = '';
        _otpVerificationId = null;
        _otpPendingPhone = null;
        _setOtpStatus('');
    }

    async function sendPhoneOtp() {
        const raw = document.getElementById('otp-new-phone').value.trim().replace(/\D/g, '');
        if (!/^0\d{9}$/.test(raw)) {
            _setOtpStatus('กรุณาใส่เบอร์ 10 หลัก ขึ้นต้นด้วย 0', 'error'); return;
        }
        if (!window.firebasePhone || !window.firebaseAuth) {
            _setOtpStatus('ระบบ Phone Auth ยังไม่พร้อม', 'error'); return;
        }
        const e164 = '+66' + raw.slice(1); // Thai E.164
        const btn = document.getElementById('otp-send-btn');
        btn.disabled = true;
        _setOtpStatus('⏳ กำลังตรวจสอบ rate limit…');
        try {
            // Server-side gate first (3/hr per UID + per phone)
            const callable = window.firebase.functions.httpsCallable('requestPhoneOtp');
            await callable({ phone: e164 });

            _setOtpStatus('⏳ กำลังโหลด reCAPTCHA…');
            if (!_otpRecaptchaVerifier) {
                _otpRecaptchaVerifier = new window.firebasePhone.RecaptchaVerifier(
                    window.firebaseAuth, 'otp-recaptcha-container', { size: 'normal' }
                );
                await _otpRecaptchaVerifier.render();
            }
            _setOtpStatus('⏳ กำลังส่ง SMS…');
            // Use PhoneAuthProvider.verifyPhoneNumber instead of signInWithPhoneNumber:
            // the latter signs the user in as a brand-new phone-auth UID, which
            // breaks the Firestore tenant-doc linkedAuthUid relationship. Verify-only
            // returns a verificationId we later combine with the SMS code into a
            // PhoneAuthCredential, then linkWithCredential preserves the original
            // anonymous UID so writes still pass per-room rules.
            const provider = new window.firebasePhone.PhoneAuthProvider(window.firebaseAuth);
            _otpVerificationId = await provider.verifyPhoneNumber(e164, _otpRecaptchaVerifier);
            _otpPendingPhone = raw;
            document.getElementById('otp-sent-to').textContent = raw;
            document.getElementById('otp-step-1').classList.add('ta-sect-hidden');
            document.getElementById('otp-step-2').classList.remove('ta-sect-hidden');
            _setOtpStatus('✅ ส่ง OTP แล้ว — รออ่าน SMS', 'success');
            setTimeout(() => document.getElementById('otp-code')?.focus(), 100);
        } catch (e) {
            console.error('sendPhoneOtp failed:', e);
            const code = e?.code || '';
            if (code === 'functions/resource-exhausted') {
                _setOtpStatus('⛔ ขอ OTP ครบโควต้า (3 ครั้ง/ชั่วโมง) แล้ว', 'error');
            } else if (code === 'auth/invalid-phone-number') {
                _setOtpStatus('⛔ รูปแบบเบอร์ไม่ถูกต้อง', 'error');
            } else if (code === 'auth/too-many-requests') {
                _setOtpStatus('⛔ Firebase block ชั่วคราว — ลองอีก ~1 ชม.', 'error');
            } else {
                _setOtpStatus('⛔ ส่งไม่สำเร็จ: ' + (e?.message || 'unknown'), 'error');
            }
            // Reset reCAPTCHA so user can retry without page reload
            if (_otpRecaptchaVerifier) {
                try { _otpRecaptchaVerifier.clear(); } catch(_) {}
                _otpRecaptchaVerifier = null;
                const c = document.getElementById('otp-recaptcha-container');
                if (c) c.innerHTML = '';
            }
        } finally {
            btn.disabled = false;
        }
    }

    async function confirmPhoneOtp() {
        const code = document.getElementById('otp-code').value.trim();
        if (!/^\d{6}$/.test(code)) {
            _setOtpStatus('รหัส OTP ต้องเป็นตัวเลข 6 หลัก', 'error'); return;
        }
        if (!_otpVerificationId || !_otpPendingPhone) {
            _setOtpStatus('Session OTP หมดอายุ — เริ่มใหม่', 'error'); return;
        }
        const btn = document.getElementById('otp-confirm-btn');
        btn.disabled = true;
        _setOtpStatus('⏳ กำลังยืนยัน…');
        try {
            // Build credential from verificationId + user-typed code, then LINK to
            // the existing (anonymous) user. This preserves the UID, so the tenant
            // doc's linkedAuthUid still matches and Firestore rules let us write.
            // If the user has a previously-linked phone, unlink first (link op fails
            // when a provider is already linked).
            // Use linkWithCredential to UPGRADE the existing user (preserves UID,
            // adds 'phone' provider). signInWithCredential created a brand-new
            // phone-auth UID which broke the tenant doc's linkedAuthUid lineage and
            // caused permanent data-read failures after refresh. Link keeps the
            // original anon UID intact, so all Firestore reads continue to work.
            const credential = window.firebasePhone.PhoneAuthProvider.credential(_otpVerificationId, code);
            const user = window.firebaseAuth.currentUser;
            if (!user) {
                _setOtpStatus('⛔ Session หาย — รีเฟรชหน้าใหม่', 'error'); btn.disabled = false; return;
            }
            const uidBefore = user.uid;
            const lineUserId = (typeof window._taLineUserId === 'string' && window._taLineUserId) ||
                               sessionStorage.getItem('lineUserId') || null;

            // Unlink any previously-linked phone first — link rejects when a provider
            // is already linked. Swallow errors (no-op if no phone was linked).
            if (user.providerData?.some(p => p.providerId === 'phone')) {
                try { await window.firebasePhone.unlink(user, 'phone'); } catch(_) {}
            }

            try {
                await window.firebasePhone.linkWithCredential(user, credential);
            } catch (le) {
                console.error('[OTP] linkWithCredential failed:', le?.code, le?.message);
                if (le?.code === 'auth/invalid-verification-code') {
                    _setOtpStatus('⛔ รหัส OTP ไม่ถูกต้อง', 'error');
                } else if (le?.code === 'auth/code-expired') {
                    _setOtpStatus('⛔ รหัสหมดอายุ — ขอใหม่', 'error');
                } else if (le?.code === 'auth/credential-already-in-use') {
                    _setOtpStatus('⛔ เบอร์นี้ถูกใช้แล้วในระบบ — ติดต่อ admin', 'error');
                } else {
                    _setOtpStatus('⛔ ยืนยันไม่สำเร็จ: ' + (le?.code || le?.message), 'error');
                }
                btn.disabled = false; return;
            }

            if (!_taRoom || !_taBuilding) {
                _setOtpStatus('⛔ ข้อมูลห้องไม่พร้อม', 'error'); btn.disabled = false; return;
            }

            _setOtpStatus('⏳ กำลังบันทึก…');
            try {
                // Server-side write via CF to bypass any token-refresh fragility post-link.
                const setVerified = window.firebase.functions.httpsCallable('setVerifiedPhone');
                await setVerified({
                    oldAnonUid: uidBefore,
                    lineUserId,
                    building: _taBuilding,
                    room: String(_taRoom),
                    phone: _otpPendingPhone,
                });
            } catch (we) {
                console.error('[OTP] setVerifiedPhone CF failed:', we?.code, we?.message);
                _setOtpStatus('⛔ บันทึกไม่สำเร็จ: ' + (we?.message || we?.code || 'unknown'), 'error');
                btn.disabled = false; return;
            }

            _taTenant = { ..._taTenant, phone: _otpPendingPhone, phoneVerifiedAt: new Date().toISOString() };
            window._tenantAppTenant = _taTenant;

            if (typeof window.renderProfilePage === 'function') window.renderProfilePage();
            if (typeof window.loadProfilePage === 'function') window.loadProfilePage();
            _setOtpStatus('✅ บันทึกเบอร์ใหม่แล้ว', 'success');
            document.getElementById('profile-edit-phone-display').textContent = _otpPendingPhone;
            if (typeof window.toast === 'function') window.toast('ยืนยันและบันทึกเบอร์ใหม่แล้ว', 'success');
            setTimeout(closePhoneOtpModal, 1200);
        } catch (e) {
            console.error('confirmPhoneOtp failed:', e);
            const code = e?.code || '';
            if (code === 'auth/invalid-verification-code') {
                _setOtpStatus('⛔ รหัส OTP ไม่ถูกต้อง', 'error');
            } else if (code === 'auth/code-expired') {
                _setOtpStatus('⛔ รหัสหมดอายุ — ขอใหม่', 'error');
            } else {
                _setOtpStatus('⛔ ยืนยันไม่สำเร็จ: ' + (e?.message || 'unknown'), 'error');
            }
        } finally {
            btn.disabled = false;
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    window.openPhoneOtpModal  = openPhoneOtpModal;
    window.closePhoneOtpModal = closePhoneOtpModal;
    window.resetPhoneOtpFlow  = resetPhoneOtpFlow;
    window.sendPhoneOtp       = sendPhoneOtp;
    window.confirmPhoneOtp    = confirmPhoneOtp;
})();
