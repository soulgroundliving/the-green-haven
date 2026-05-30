/**
 * tenant-auth.js — Auth gate and logout for tenant_app.html.
 *
 * Extracted from tenant_app.html inline script (~110 lines removed):
 *   - logoutTenantApp       (confirm → clear session → LIFF closeWindow or overlay)
 *   - showLoggedOutScreen   (render locked-out overlay, hide nav + pages)
 *   - _enforceAccessGate    (hard access gate: LINE UA / admin claim / tenant session)
 *
 * Called from the inline `load` event listener via window._enforceAccessGate().
 * logoutTenantApp is invoked via data-action="logoutTenantApp" → _ta.logoutTenantApp().
 *
 * Depends on globals:
 *   window.GhModal    (shared/gh-modal.js)
 *   window.firebaseAuth  (Firebase module init)
 *   window.liff          (LIFF SDK)
 */
(function () {
    'use strict';

    // ── Logout ─────────────────────────────────────────────────────────────

    async function logoutTenantApp() {
        const ok = await window.GhModal.confirm({
            title: 'ออกจากระบบ',
            body: 'ต้องการออกจากระบบ?',
            confirmLabel: 'ออกจากระบบ',
            cancelLabel: 'ยกเลิก',
        });
        if (!ok) return;
        sessionStorage.clear();
        try { localStorage.removeItem('tenant_session'); } catch(_){}
        try { localStorage.removeItem('tenant_app_room'); } catch(_){}
        if (window.liff && liff.isInClient && liff.isInClient()) {
            try { liff.logout(); } catch(_){}
            try { liff.closeWindow(); return; } catch(_){}
        }
        showLoggedOutScreen();
    }

    function showLoggedOutScreen() {
        document.querySelectorAll('.page').forEach(p => { p.style.display='none'; p.classList.remove('active'); });
        const nav = document.getElementById('main-nav-bar') || document.getElementById('bottom-nav');
        if (nav) nav.style.display = 'none';
        document.querySelectorAll('.swal2-container, .swal-modal, #daily-modal').forEach(e => { e.style.display='none'; });
        let ov = document.getElementById('logged-out-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'logged-out-overlay';
            ov.style.cssText = 'position:fixed; inset:0; background:var(--bg-color,#f4f6f8); display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 24px; text-align:center; z-index:9999;';
            ov.innerHTML = '<div class="ta-emoji-lg">🌿</div>'
                + '<h2 style="margin:0 0 8px; color:var(--primary-dark,#1a5c38);">ออกจากระบบเรียบร้อย</h2>'
                + '<p style="margin:0 0 24px; color:var(--text-muted,#6b7a8d); max-width:320px;">เปิด LINE แล้วเข้าผ่านเมนู Green Haven อีกครั้งเพื่อใช้งาน</p>';
            document.body.appendChild(ov);
        } else { ov.style.display = 'flex'; }
    }

    // ── Access gate ────────────────────────────────────────────────────────
    // Hard gate — runs before any tenant init. Three paths allowed:
    //   1. LINE LIFF (User-Agent contains "Line/")
    //   2. Admin claim — auth.token.admin === true
    //   3. Tenant login via /login — sessionStorage.user.userType === 'tenant' + non-anon user

    async function _enforceAccessGate() {
        if (/Line\//i.test(navigator.userAgent)) return true;

        const authState = await new Promise(resolve => {
            let done = false;
            const finish = (s) => { if (!done) { done = true; resolve(s); } };
            const timer = setTimeout(() => finish({ admin: false, signedIn: false }), 5000);
            const check = async (user) => {
                if (done || !user) return;
                try {
                    const tr = await user.getIdTokenResult();
                    clearTimeout(timer);
                    finish({ admin: tr.claims.admin === true, signedIn: !user.isAnonymous });
                } catch(_) {}
            };
            try {
                if (window.firebaseAuth?.currentUser) check(window.firebaseAuth.currentUser);
                if (window.firebaseAuth?.onAuthStateChanged) {
                    window.firebaseAuth.onAuthStateChanged(check);
                } else {
                    // [audit-skip] fallback: reads token claims (admin) only — no Firestore read.
                    window.addEventListener('authReady', () => check(window.firebaseAuth?.currentUser), { once: true });
                }
            } catch(_) { clearTimeout(timer); finish({ admin: false, signedIn: false }); }
        });

        if (authState.admin) return true;

        let sessUser = null;
        try { sessUser = JSON.parse(sessionStorage.getItem('user') || 'null'); } catch(_) {}
        if (authState.signedIn && sessUser && sessUser.userType === 'tenant') return true;

        sessionStorage.removeItem('_adminPreview');
        sessionStorage.removeItem('user');

        // Replace body so later mutations land on the locked page, not the real app.
        document.body.innerHTML = `
            <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;background:linear-gradient(135deg,#e8f5e9,#f4f6f8);text-align:center;font-family:Sarabun,sans-serif;">
                <div style="font-size:5rem;margin-bottom:1rem;">🔒</div>
                <h1 style="font-size:1.4rem;margin-bottom:.6rem;color:#1a5c38;font-weight:700;">เข้าถึงไม่ได้</h1>
                <p style="color:#444;font-size:1rem;line-height:1.6;max-width:340px;margin-bottom:1rem;">
                    ระบบนี้ใช้งานผ่าน LINE เท่านั้น<br>
                    เฉพาะลูกบ้านที่ได้รับอนุมัติจากแอดมิน
                </p>
                <p style="color:#888;font-size:.85rem;max-width:320px;line-height:1.6;">
                    กรุณาเปิด LINE app → คลิก rich menu หรือ link ที่แอดมินส่งให้
                </p>
                <p style="color:#aaa;font-size:.7rem;margin-top:3rem;">Nature Haven · Tenant System</p>
            </div>`;
        try { document.documentElement.dataset.accessBlocked = '1'; } catch(_) {}
        return false;
    }

    window.logoutTenantApp    = logoutTenantApp;
    window.showLoggedOutScreen = showLoggedOutScreen;
    window._enforceAccessGate  = _enforceAccessGate;
})();
