/* shared/tenant-profile-edit.js
 * Profile-edit flow — extracted from tenant_app.html for maintainability.
 * Allows tenant to update their own contact fields (email, future: license plate).
 * Phone number changes go through the OTP modal (shared/tenant-phone-otp.js).
 *
 * Dependencies (all var globals from shared/tenant-liff-auth.js or window.*):
 *   _taTenant, _taRoom, _taBuilding — var globals, accessible as barewords.
 *   toast()                          — top-level fn in inline script → on window.
 *   renderProfilePage()              — top-level fn in inline script → on window.
 *   window.firebase.*               — Firebase SDK globals.
 *
 * Exports (window.*):
 *   window.toggleProfileEditMode    — action hub + data-action="toggleProfileEditMode"
 *   window.saveProfileEdit          — action hub + data-action="saveProfileEdit"
 *   window._syncEmailVerified       — called bareword from renderProfilePage (inline)
 */
(function () {
    'use strict';

    // ===== PROFILE EDIT (phone / email / license plate) =====
    // Allows tenant to update their own contact fields. Writes directly to
    // tenants/{building}/list/{roomId} — name + lease fields stay locked (admin only).
    function toggleProfileEditMode(show) {
        const view = document.getElementById('profile-readonly-view');
        const form = document.getElementById('profile-edit-form');
        const tgl  = document.getElementById('profile-edit-toggle');
        if (!view || !form) return;
        const showForm = (show === undefined) ? form.classList.contains('ta-sect-hidden') : !!show;
        if (showForm) {
            // Pre-fill current values. Phone is read-only here — must go through OTP modal.
            document.getElementById('profile-edit-phone-display').textContent = _taTenant?.phone || '— ยังไม่ได้ตั้ง';
            document.getElementById('profile-edit-email').value         = _taTenant?.email || '';
            view.classList.add('ta-sect-hidden');
            form.classList.remove('ta-sect-hidden');
            if (tgl) tgl.textContent = '↩️ ยกเลิก';
        } else {
            view.classList.remove('ta-sect-hidden');
            form.classList.add('ta-sect-hidden');
            if (tgl) tgl.textContent = '✏️ แก้ไข';
        }
    }

    async function saveProfileEdit() {
        const email = document.getElementById('profile-edit-email').value.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            toast('อีเมลไม่ถูกต้อง', 'error'); return;
        }
        if (!_taRoom || !_taBuilding) { toast('ข้อมูลห้องไม่พร้อม', 'error'); return; }
        if (!window.firebase?.functions) { toast('ระบบยังไม่พร้อม', 'error'); return; }
        try {
            const callable = window.firebase.functions.httpsCallable('setTenantEmail');
            await callable({ email, building: _taBuilding, room: String(_taRoom) });
            // Reload auth user so it picks up the newly-set Firebase Auth email,
            // then fire the verification email (uses Firebase's own mail delivery).
            if (window.firebaseAuth?.currentUser) {
                await window.firebaseAuth.currentUser.reload();
            }
            if (email && window.firebaseSendEmailVerification && window.firebaseAuth?.currentUser) {
                try {
                    await window.firebaseSendEmailVerification(window.firebaseAuth.currentUser, {
                        url: 'https://the-green-haven.vercel.app/tenant_app.html',
                    });
                    toast('บันทึกแล้ว — ส่งลิงก์ยืนยันไปยัง ' + email + ' แล้ว', 'success');
                } catch (ve) {
                    console.warn('sendEmailVerification failed:', ve?.code, ve?.message);
                    toast('บันทึกอีเมลแล้ว (ส่งลิงก์ยืนยันไม่สำเร็จ — ลองใหม่ทีหลัง)', 'warning');
                }
            } else {
                toast('บันทึกอีเมลแล้ว', 'success');
            }
            _taTenant = { ..._taTenant, email, emailVerified: false };
            window._tenantAppTenant = _taTenant;
            if (typeof renderProfilePage === 'function') renderProfilePage();
            toggleProfileEditMode(false);
        } catch (e) {
            console.error('saveProfileEdit failed:', e);
            toast('บันทึกไม่สำเร็จ — กรุณาลองใหม่', 'error');
        }
    }

    async function _syncEmailVerified() {
        if (!_taBuilding || !_taRoom || !window.firebase?.firestoreFunctions) return;
        try {
            const fs = window.firebase.firestoreFunctions;
            const db = window.firebase.firestore();
            await fs.updateDoc(fs.doc(db, 'tenants', _taBuilding, 'list', String(_taRoom)), {
                emailVerified: true,
                emailVerifiedAt: fs.serverTimestamp(),
            });
            _taTenant = { ..._taTenant, emailVerified: true };
            window._tenantAppTenant = _taTenant;
        } catch (e) {
            console.warn('emailVerified sync failed:', e);
        }
    }

    window.toggleProfileEditMode = toggleProfileEditMode;
    window.saveProfileEdit       = saveProfileEdit;
    window._syncEmailVerified    = _syncEmailVerified; // called bareword from renderProfilePage (inline script)
})();
