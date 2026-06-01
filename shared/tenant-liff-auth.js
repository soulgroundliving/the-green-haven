/* shared/tenant-liff-auth.js
 * LIFF auth scaffold -- extracted from tenant_app.html for maintainability.
 * Loaded synchronously before the main inline script block in tenant_app.html.
 * Requires: Firebase SDK (window.firebaseAuth etc.) + LIFF SDK (liff).
 * See: CLAUDE.md s7-A, s7-U, s7-HH, s7-Z for anti-patterns that apply here.
 */

// Shared auth state -- var at script top-level = window.* globals.
// The main inline script reads these via bareword after this file loads.
// (s7-CC: let would break cross-script access; var is intentional here.)
// eslint-disable-next-line no-var
var _taRoom = '', _taBuilding = '', _taLease = null, _taTenant = null;

// `fn` MUST be idempotent — may run 3+ times (immediate + authReady + liffLinked).
function _onLiffClaimsReady(fn) {
    window.addEventListener('authReady', fn);
    window.addEventListener('liffLinked', fn);
    if (window.firebaseReady && window._authUid) fn();
}

// SSoT: Nest rooms are N101-N405 (N prefix OR legacy numeric 101-405).
// Everything else (13-33, 15ก, ร้านใหญ่) is the rooms/ห้องแถว building.
// Resolves through BuildingConfig.getBuildingForRoom (the one SoT). The inline
// branch is a defensive mirror — this file is auth-critical and loads non-defer,
// so it must never hard-depend on another module already being ready.
function _taDetectBuilding(roomId) {
    if (typeof BuildingConfig !== 'undefined' && BuildingConfig.getBuildingForRoom) {
        return BuildingConfig.getBuildingForRoom(roomId);
    }
    const s = String(roomId || '');
    if (/^N/i.test(s)) return 'nest';
    const n = parseInt(s, 10);
    return (n >= 101 && n <= 405) ? 'nest' : 'rooms';
}
// Normalize room ID: Nest bills live at bills/nest/N101, so N prefix is canonical for nest.
function _taNormalizeRoom(roomId, building) {
    const s = String(roomId || '').replace(/[^0-9A-Za-zก-๙]/g, '');
    if (building === 'nest' && !/^N/i.test(s)) return 'N' + s;
    if (building === 'rooms') return s.replace(/^N/i, '');
    return s;
}

function detectRoomBuilding() {
    // ?room=201&building=nest — admin preview shortcut (sets sessionStorage so whole app works)
    try {
        const params = new URLSearchParams(window.location.search);
        const urlRoom = params.get('room');
        if (urlRoom) {
            let cleanRoom = urlRoom.replace(/[^0-9A-Za-zก-๙]/g, '');
            // Derive building from the room itself, not the URL — 101 is always Nest
            // regardless of what ?building= says. rooms/101 does not exist.
            const resolvedBuilding = _taDetectBuilding(cleanRoom);
            cleanRoom = _taNormalizeRoom(cleanRoom, resolvedBuilding);
            sessionStorage.setItem('user', JSON.stringify({ roomNumber: cleanRoom, building: resolvedBuilding }));
            sessionStorage.setItem('_adminPreview', '1');
        }
    } catch(e) {}

    try {
        const userStr = sessionStorage.getItem('user');
        if (userStr) {
            const user = JSON.parse(userStr);
            const raw = String(user.roomNumber || user.room || user.email || '');
            const emailMatch = raw.match(/tenant(\w+)@/);
            _taRoom = emailMatch ? emailMatch[1] : raw.replace(/[^0-9A-Za-zก-๙]/g, '');
            if (user.building) _taBuilding = user.building;
        }
    } catch(e) {}
    if (!_taRoom) _taRoom = localStorage.getItem('tenant_app_room') || '';
    if (!_taRoom) return false;
    // Cache in localStorage so reload without ?room= still works
    try { localStorage.setItem('tenant_app_room', _taRoom); } catch(e) {}
    // Always derive building from room — sessionStorage building is a hint but room wins
    const derivedBuilding = _taDetectBuilding(_taRoom);
    _taBuilding = derivedBuilding;
    _taRoom = _taNormalizeRoom(_taRoom, _taBuilding);
    window._tenantAppRoom = _taRoom;
    window._tenantAppBuilding = _taBuilding;
    applyGamificationVisibility();
    // Subscriptions that filter by building (and were no-ops at authReady time
    // because _taBuilding wasn't derived yet) need a retry now that it's set.
    // Each function is idempotent so a double-call is harmless.
    try { if (typeof _subscribeMarketplace === 'function') _subscribeMarketplace(); } catch(_) {}
    return true;
}

// ---- LIFF (LINE Front-end Framework) integration ----
const LIFF_ID = '2009790149-Db7T76sd';
window._lineUserId = null;
window._lineProfile = null;
window._lineLinkStatus = null; // null | 'pending' | 'approved' | 'rejected'

// Apply community-member (player) mode — hides room-specific nav + pages.
// Called once after sign-in confirms role:'player'; idempotent.
function _applyPlayerMode() {
    // Hide "บิล" nav button (usage/billing page is room-specific)
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(btn => {
        const onclick = btn.getAttribute('onclick') || '';
        if (onclick.includes("'usage'") || onclick.includes('"usage"')) {
            btn.style.display = 'none';
        }
    });
    // Guard showPage so room-specific pages redirect to community
    const _origShowPage = window.showPage;
    if (typeof _origShowPage === 'function') {
        window.showPage = function(id, el) {
            const blocked = ['usage', 'maintenance', 'housekeeping',
                'contract-action-page', 'payment-page', 'meter-page'];
            if (blocked.includes(id)) {
                id = 'community';
                el = null;
            }
            return _origShowPage(id, el);
        };
    }
    // Hide contract section — players are not currently renting a room
    const contractSection = document.getElementById('profile-contract-section');
    if (contractSection) contractSection.style.display = 'none';
}

// World-map-only mode — applied when admin unlinks the LINE account.
// Two entry points: (a) _callLiffSignIn 403 status='unlinked' (next LIFF open),
// (b) _setupClaimLossListener detects mid-session claim removal (within ~1h
// after admin clicks unlink — once SDK refreshes the ID token).
// Idempotent via window._unlinkedModeApplied so both paths can fire safely.
function _applyUnlinkedMode() {
    if (window._unlinkedModeApplied) return;
    window._unlinkedModeApplied = true;
    // body class drives the CSS gate that hides world-map CTAs + bell icon.
    // Paired with the JS navigation gates below — CSS hides clickables,
    // JS catches anything that still tries to navigate (defense in depth).
    try { document.body.classList.add('gh-unlinked-mode'); } catch(_) {}
    // Force navigate to world map immediately (covers mid-session case where
    // user might be on another page like บิล/profile when claims are stripped).
    try { if (typeof showPage === 'function') showPage('world-map'); } catch(_) {}
    // Block top-level page navigation away from world-map (silent redirect).
    const _origShowPage = window.showPage;
    if (typeof _origShowPage === 'function') {
        window.showPage = function(id, el) {
            if (id === 'world-map' || id === 'world-map-page') return _origShowPage(id, el);
            return _origShowPage('world-map', null);
        };
    }
    // Block sub-page navigation — Quest / Pet Park / Smart Key etc. all
    // need claim-gated reads to be useful, so route everything back home.
    const _origShowSubPage = window.showSubPage;
    if (typeof _origShowSubPage === 'function') {
        window.showSubPage = function(id) {
            if (id === 'world-map-page' || id === 'world-map') return _origShowSubPage(id);
            if (typeof toast === 'function') {
                toast('🔌 บัญชี LINE ถูกยกเลิกการเชื่อม — ติดต่อ admin เพื่อเชื่อมใหม่', 'info');
            }
            return;
        };
    }
    // Persistent banner above world map (safe-area aware for iOS notch).
    try {
        if (!document.getElementById('unlinked-banner')) {
            const banner = document.createElement('div');
            banner.id = 'unlinked-banner';
            banner.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);left:0;right:0;background:#FFF3E0;color:#BF360C;padding:8px 12px;font-size:.78rem;text-align:center;z-index:100;border-bottom:1px solid #FFCC80;font-family:var(--font-brand,system-ui);line-height:1.4;';
            banner.textContent = '🔌 บัญชี LINE ถูกยกเลิกการเชื่อม — กรุณาติดต่อ admin เพื่อเชื่อมใหม่';
            document.body.appendChild(banner);
        }
    } catch(_) {}
}

// S4 detector: real-time Firestore status flip. Pairs with S3 (claim-loss
// via SDK token refresh, slow path ~50min worst case) — this listener
// catches admin unlink action on the NEXT Firestore snapshot tick (typically
// sub-second), shrinking the worst-case mid-session window from ~50min to
// ~immediate. Reads own liffUsers doc (rule loosened 2026-05-21 to allow
// own-doc read by deterministic UID 'line:'+userId).
// Guards: §7-U claim-first (need _lineUserId), §7-V unsub-before-rebind
// (call site is one-shot via _unlinkStatusListenerSet, but defensive),
// §7-N error callback (surface + reset on perm-denied for retry).
function _setupUnlinkStatusListener() {
    if (window._unlinkStatusListenerSet) return;
    if (!window._lineUserId) return;
    if (!window.firebase?.firestore) return;
    const fs = window.firebase.firestoreFunctions;
    if (!fs?.onSnapshot || !fs?.doc || !fs?.collection) return;
    // Defensive unsub of any prior listener (§7-V); should not happen
    // given the idempotency flag above, but cheap insurance for the case
    // where the flag was reset by a permission-denied retry.
    if (typeof window._unlinkStatusUnsub === 'function') {
        try { window._unlinkStatusUnsub(); } catch (_) {}
        window._unlinkStatusUnsub = null;
    }
    try {
        const db = window.firebase.firestore();
        const ref = fs.doc(fs.collection(db, 'liffUsers'), window._lineUserId);
        window._unlinkStatusListenerSet = true;
        window._unlinkStatusUnsub = fs.onSnapshot(
            ref,
            snap => {
                if (!snap || !snap.exists || !snap.exists()) return;
                const status = snap.data()?.status;
                if (status === 'unlinked' && !window._unlinkedModeApplied) {
                    console.warn('🔌 liffUsers status flipped to unlinked — applying mode immediately');
                    window._unlinkedMode = true;
                    _applyUnlinkedMode();
                }
            },
            err => {
                console.warn('[unlinkStatus] subscribe failed:', err?.message || err);
                // Reset on transient/permission errors so a future call
                // (e.g. on liffLinked re-fire) can resubscribe successfully.
                if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
                    window._unlinkStatusListenerSet = false;
                    window._unlinkStatusUnsub = null;
                }
            }
        );
    } catch (e) {
        console.warn('[unlinkStatus] setup threw:', e?.message || e);
        window._unlinkStatusListenerSet = false;
    }
}

// S3 detector: claims stripped mid-session.
// unlinkLiffUser CF calls setCustomUserClaims({}) + revokeRefreshTokens —
// forces the SDK to fetch a fresh ID token. When the refreshed token has
// no useful claims, switch to unlinked mode without requiring close+reopen.
// §7-U cousin: idempotent via window._claimListenerSet.
function _setupClaimLossListener() {
    const auth = window.firebaseAuth;
    const fn = window.firebaseOnIdTokenChanged;
    if (!auth || !fn || window._claimListenerSet) return;
    window._claimListenerSet = true;
    let hadClaims = null;
    fn(auth, async user => {
        if (!user || user.isAnonymous) { hadClaims = false; return; }
        try {
            const tr = await user.getIdTokenResult();
            const useful = !!(tr.claims.room && tr.claims.building) || tr.claims.role === 'player';
            if (hadClaims === true && !useful && !window._unlinkedMode) {
                console.warn('🔌 LIFF claims lost mid-session — switching to unlinked mode');
                window._unlinkedMode = true;
                _applyUnlinkedMode();
            }
            hadClaims = useful;
        } catch (e) {
            console.warn('claim listener error:', e?.message || e);
        }
    });
}

// Fast-path: check if user is already signed in with valid claims.
// Returns the linked result if claims are fresh, null to fall through to liffSignIn POST.
// Force-refresh (true) — avoids serving cached tokens that may carry stale pre-unlink
// claims. If revokeRefreshTokens was called, this throws → fall through to POST.
async function _getFastPathToken(auth) {
    if (!auth?.currentUser || auth.currentUser.isAnonymous) return null;
    try {
        const tr = await auth.currentUser.getIdTokenResult(true);
        if (tr.claims.room && tr.claims.building) {
            window.dispatchEvent(new Event('liffLinked'));
            return { linked: true, room: tr.claims.room, building: tr.claims.building };
        }
        if (tr.claims.role === 'player') {
            window._isPlayerMode = true;
            try { window._playerProfile = JSON.parse(localStorage.getItem('player_profile') || 'null'); } catch(_) {}
            _applyPlayerMode();
            window.dispatchEvent(new Event('liffLinked'));
            return { linked: true, role: 'player' };
        }
        return null; // token fresh but no useful claims → fall through
    } catch (e) {
        // auth/user-token-expired (post-revokeRefreshTokens) or transient.
        console.warn('fast-path token refresh failed → falling to liffSignIn:', e?.code || e?.name, e?.message);
        try { await auth.signOut(); } catch(_) {}
        return null;
    }
}

// POST idToken to liffSignIn CF with per-attempt AbortController timeout (§7-R).
// Returns { resp, data } on success, null on network failure (error banner already shown).
async function _fetchLiffSignIn(idToken) {
    let resp, data, fetchErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 12000);
        try {
            resp = await fetch(
                'https://asia-southeast1-the-green-haven.cloudfunctions.net/liffSignIn',
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ idToken }), signal: ctrl.signal }
            );
            data = await resp.json().catch(() => ({}));
            fetchErr = null;
            break;
        } catch (e) {
            fetchErr = e;
            const aborted = e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''));
            console.warn(`⛔ liffSignIn fetch attempt ${attempt}/2 failed (${aborted ? 'timeout' : (e.code || e.name || 'error')}):`, e.message);
            if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
        } finally {
            clearTimeout(to);
        }
    }
    if (fetchErr) {
        const aborted = fetchErr.name === 'AbortError' || /aborted/i.test(fetchErr.message || '');
        _showAuthErrorBanner(aborted
            ? 'เซิร์ฟเวอร์ตอบช้า — ลองปิด LINE จาก app switcher แล้วเปิดใหม่'
            : `เชื่อมห้องไม่สำเร็จ (network): ${fetchErr.message}`);
        return null;
    }
    return { resp, data };
}

// Sign in with customToken with 5-attempt TLS-recovery retry (§7-R).
// Wipes any stale session on first attempt to prevent LIFF-reopen race (§7-HH).
// Returns true on success, null on failure (error banner already shown).
async function _signInWithRetry(auth, customToken) {
    const signInFn = window.firebaseSignInWithCustomToken;
    if (!signInFn) { _showAuthErrorBanner('signInWithCustomToken ไม่พร้อม'); return null; }
    // 5 attempts × 1000ms*attempt = ~10s TLS recovery window (§7-R).
    // Synced with booking.html. See memory/auth_liff_sot.md §4.
    const TRANSIENT = new Set(['auth/network-request-failed', 'auth/internal-error', 'auth/timeout']);
    const MAX_ATTEMPTS = 5;
    let signInErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            if (attempt === 1 && auth.currentUser) {
                try { await auth.signOut(); } catch (_) { /* best-effort */ }
            }
            await signInFn(auth, customToken);
            await auth.currentUser.getIdToken(true); // force-refresh so SDK has fresh claims
            signInErr = null;
            break;
        } catch (e) {
            signInErr = e;
            const code = e?.code || '';
            const transient = TRANSIENT.has(code) || /network-request-failed/i.test(e?.message || '');
            console.warn(`⛔ signInWithCustomToken attempt ${attempt}/${MAX_ATTEMPTS} failed (${code || 'no-code'}):`, e?.message);
            if (!transient || attempt === MAX_ATTEMPTS) break;
            await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s, 3s, 4s
        }
    }
    if (!signInErr) return true;
    console.error('⛔ signInWithCustomToken exhausted retries:', signInErr.message);
    const isTLS = /network-request-failed/i.test(signInErr?.message || '');
    _showAuthErrorBanner(isTLS
        ? 'LINE in-app browser ค้าง — กรุณาปิด LINE จาก app switcher แล้วเปิดใหม่ (1 ครั้ง) แล้วลองอีกที'
        : `sign-in ไม่สำเร็จ: ${signInErr.message}`);
    return null;
}

// Process liffSignIn CF response: route by status code, sign in, set globals.
// Returns the linked result or null on failure (error banner already shown).
async function _handleLiffSignInResponse(auth, resp, data) {
    if (resp.status === 404) return { linked: false, status: null }; // first-time user
    if (resp.status === 403) {
        // Admin-initiated unlink: app shell still renders; _applyUnlinkedMode gates UI.
        if (data.status === 'unlinked') {
            window._unlinkedMode = true;
            _applyUnlinkedMode();
            return { linked: true, role: 'unlinked' };
        }
        return { linked: false, status: data.status || 'pending' };
    }
    if (!resp.ok) {
        const msg = data.error || `HTTP ${resp.status}`;
        console.error('⛔ liffSignIn CF rejected:', msg);
        _showAuthErrorBanner(`เชื่อมห้องไม่สำเร็จ: ${msg} — ลองเปิด LINE LIFF ใหม่`);
        return null;
    }

    const { customToken, room, building } = data;
    if (!auth) { _showAuthErrorBanner('Firebase ยังไม่พร้อม'); return null; }
    if (!await _signInWithRetry(auth, customToken)) return null;

    if (data.role === 'player') {
        window._isPlayerMode = true;
        if (data.name || data.phone) {
            window._playerProfile = { name: data.name || '', phone: data.phone || '', tenantId: data.tenantId || '' };
            try { localStorage.setItem('player_profile', JSON.stringify(window._playerProfile)); } catch(_) {}
        } else {
            try { window._playerProfile = JSON.parse(localStorage.getItem('player_profile') || 'null'); } catch(_) {}
        }
        _applyPlayerMode();
        window.dispatchEvent(new Event('liffLinked'));
        return { linked: true, role: 'player' };
    }

    // Set room globals BEFORE dispatching liffLinked so subscribers can read them.
    _taRoom = String(room);
    _taBuilding = String(building || 'rooms');
    localStorage.setItem('tenant_app_room', _taRoom);
    window._tenantAppRoom = _taRoom;
    window._tenantAppBuilding = _taBuilding;
    window.dispatchEvent(new Event('liffLinked'));
    return { linked: true, room: _taRoom, building: _taBuilding };
}

// Call liffSignIn CF: verify LIFF ID token server-side → Firebase custom token.
// Returns: { linked: true, room, building } | { linked: false, status } | null (error)
async function _callLiffSignIn() {
    const auth = window.firebaseAuth;

    const fastResult = await _getFastPathToken(auth);
    if (fastResult) return fastResult;

    let idToken;
    try {
        idToken = liff.getIDToken();
        if (!idToken) throw new Error('getIDToken returned null');
    } catch (e) {
        console.error('⛔ liffSignIn: getIDToken failed:', e.message);
        _showAuthErrorBanner(`ดึง LIFF token ไม่สำเร็จ: ${e.message}`);
        return null;
    }

    const fetchResult = await _fetchLiffSignIn(idToken);
    if (!fetchResult) return null;

    return await _handleLiffSignInResponse(auth, fetchResult.resp, fetchResult.data);
}
function _showAuthErrorBanner(msg) {
    try {
        if (document.getElementById('auth-error-banner')) return; // dedupe
        const b = document.createElement('div');
        b.id = 'auth-error-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c62828;color:#fff;padding:.6rem 1rem;font-size:.82rem;z-index:9999;text-align:center;';
        b.textContent = '⛔ ' + msg;
        document.body.appendChild(b);
    } catch(_) {}
}

// Visible overlay so the user knows the LIFF link is running. Old code
// returned null silently on every failure path, leaving tenants on the
// generic Nest landing with no idea why they weren't seeing their room.
function _showLiffConnectingOverlay(msg) {
    try {
        let ov = document.getElementById('liff-connecting-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'liff-connecting-overlay';
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(244,246,248,0.97);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;z-index:9998;font-family:Sarabun,sans-serif;text-align:center;';
            document.body.appendChild(ov);
        }
        ov.innerHTML = `
            <div style="font-size:3rem;margin-bottom:1rem;">🌿</div>
            <div style="font-size:1.05rem;color:#1a5c38;font-weight:700;margin-bottom:.5rem;">${msg || 'กำลังเชื่อมต่อ...'}</div>
            <div style="font-size:.8rem;color:#888;">Nature Haven · LINE LIFF</div>`;
        ov.style.display = 'flex';
    } catch(_) {}
}
function _hideLiffConnectingOverlay() {
    try { document.getElementById('liff-connecting-overlay')?.remove(); } catch(_) {}
}
function _showLiffErrorOverlay(reason) {
    try {
        let ov = document.getElementById('liff-connecting-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'liff-connecting-overlay';
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(244,246,248,0.97);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;z-index:9998;font-family:Sarabun,sans-serif;text-align:center;';
            document.body.appendChild(ov);
        }
        ov.innerHTML = `
            <div style="font-size:3rem;margin-bottom:1rem;">⚠️</div>
            <div style="font-size:1.1rem;color:#c62828;font-weight:700;margin-bottom:.5rem;">เชื่อมต่อไม่สำเร็จ</div>
            <div style="font-size:.85rem;color:#444;max-width:320px;line-height:1.6;margin-bottom:1.5rem;">${reason || 'ลองอีกครั้งหรือเปิด LINE LIFF ใหม่'}</div>
            <button data-action="reloadPage" style="padding:.7rem 2rem;background:#2d8653;color:#fff;border:none;border-radius:8px;font-family:Sarabun,sans-serif;font-size:.95rem;font-weight:600;cursor:pointer;">🔄 ลองใหม่</button>`;
        ov.style.display = 'flex';
    } catch(_) {}
}

async function initLiffAndLink() {
    const inLine = /Line\//i.test(navigator.userAgent);
    if (inLine) _showLiffConnectingOverlay('🔄 กำลังเชื่อมต่อ LINE...');

    if (typeof liff === 'undefined') {
        console.warn('[LIFF] SDK not loaded');
        if (inLine) _showLiffErrorOverlay('LIFF SDK โหลดไม่สำเร็จ');
        return null;
    }
    try {
        await liff.init({ liffId: LIFF_ID });
    } catch (e) {
        console.warn('[LIFF] init failed:', e);
        if (inLine) _showLiffErrorOverlay('LIFF init failed: ' + (e.message || e));
        return null;
    }
    if (!liff.isLoggedIn()) {
        if (liff.isInClient && liff.isInClient()) {
            liff.login();
            return null;
        }
        if (inLine) _hideLiffConnectingOverlay();
        return null;
    }
    try {
        const profile = await liff.getProfile();
        window._lineProfile = profile;
        window._lineUserId = profile.userId;
    } catch (e) {
        console.warn('[LIFF] getProfile failed:', e);
        if (inLine) _showLiffErrorOverlay('ดึงข้อมูล LINE ไม่สำเร็จ: ' + (e.message || e));
        return null;
    }

    if (inLine) _showLiffConnectingOverlay('🔍 กำลังตรวจสอบสิทธิ์...');

    // Wait for Firebase Auth to be ready (needed for signInWithCustomToken).
    if (!window.firebaseAuth) {
        await new Promise(resolve => {
            const t = setTimeout(() => { console.warn('[LIFF] firebase wait timed out'); resolve(); }, 6000);
            window.addEventListener('firebaseInitialized', () => { clearTimeout(t); resolve(); }, { once: true });
        });
    }
    if (!window.firebaseAuth) {
        console.warn('[LIFF] firebaseAuth not available after wait');
        if (inLine) _showLiffErrorOverlay('Firebase ยังไม่พร้อม — รีเฟรชหน้าใหม่');
        return null;
    }

    // S3: catch mid-session claim loss (admin unlinks while user is on LIFF).
    // Idempotent — safe even if init runs twice (orientation change, etc.).
    _setupClaimLossListener();

    // Verify LIFF token server-side and get custom token (no client Firestore read).
    if (inLine) _showLiffConnectingOverlay('🔐 กำลังตั้งค่าสิทธิ์...');
    const result = await _callLiffSignIn();

    if (result?.linked) {
        window._lineLinkStatus = 'approved';
        if (inLine) _hideLiffConnectingOverlay();
        // S4: subscribe to own liffUsers doc so an admin unlink action
        // flips us to unlinked mode on the next snapshot tick (sub-second)
        // instead of waiting for the ~50min SDK token refresh that S3
        // (_setupClaimLossListener) depends on. Safe to call here — at
        // this point _lineUserId is set, firebase is ready, and the user
        // is signed in with the deterministic UID needed to pass the
        // own-doc read rule.
        _setupUnlinkStatusListener();
        return { linked: true };
    }
    // linked: false → pending/rejected/first-time, or null → error (banner already shown)
    if (result) window._lineLinkStatus = result.status || null;
    if (inLine) _hideLiffConnectingOverlay();

    // Returning tenant whose link request is pending/rejected (e.g. after
    // they submitted relink form). hasRoomEarly fast-path may have already
    // skipped awaiting LIFF and let initTenantApp render the home/bills
    // shell from cached localStorage data — looking "logged in" while
    // Firestore status is still pending + claims are revoked. Clear the
    // room cache and force the pending/rejected overlay on top, so the
    // user actually sees the right state and can't read stale UI as
    // "approved". Pairs with submitRelinkRequest's same cleanup.
    if (result && !result.linked && (result.status === 'pending' || result.status === 'rejected')) {
        try {
            localStorage.removeItem('tenant_app_room');
            sessionStorage.removeItem('user');
        } catch(_) {}
        if (typeof showLiffLinkStatus === 'function') {
            showLiffLinkStatus(result.status);
        }
        document.getElementById('app-loading-splash')?.remove();
    }
    return result;
}

// Normalize phone: keep only digits
function _normalizePhone(p) { return String(p||'').replace(/\D/g, ''); }

async function submitLiffLinkRequest() {
    const bld = document.getElementById('liff-link-building').value;
    const room = document.getElementById('liff-link-room').value.trim();
    if (!bld || !room) { toast('กรุณาเลือกตึกและใส่หมายเลขห้อง', 'error'); return; }
    if (!window._lineUserId) { toast('ไม่พบ LINE user — กรุณาเปิดผ่านแอป LINE', 'error'); return; }
    if (!window.firebase?.firestore) { toast('Firebase ยังไม่พร้อม', 'error'); return; }
    const btn = document.getElementById('liff-link-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังส่ง...'; }

    // No more checkTenantPhone auto-approve: at LIFF signup time the tenant DB
    // doesn't yet have the phone (admin enters it after lease signing). Admin
    // verifies manually using the "ดูข้อมูลห้องนี้" link on the request page.
    try {
        const db = window.firebase.firestore();
        const fs = window.firebase.firestoreFunctions;
        const payload = {
            lineUserId: window._lineUserId,
            lineDisplayName: window._lineProfile?.displayName || '',
            linePictureUrl: window._lineProfile?.pictureUrl || '',
            room: String(room),
            building: bld,
            status: 'pending',
            requestedAt: new Date().toISOString()
        };
        await fs.setDoc(fs.doc(fs.collection(db, 'liffUsers'), window._lineUserId), payload);

        // Fire LINE push notification to admins (best-effort).
        // Firestore write is the source of truth — admin sees the request
        // on next dashboard refresh regardless. Push only accelerates that.
        // Capture failures to Sentry so ops know if pushes start dropping.
        fetch('https://asia-southeast1-the-green-haven.cloudfunctions.net/notifyLiffRequest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineUserId: window._lineUserId })
        }).then(r => {
            if (!r.ok) throw new Error('notifyLiffRequest non-2xx: ' + r.status);
        }).catch(e => {
            console.warn('notifyLiffRequest failed (non-blocking):', e);
            if (window.Sentry?.captureException) {
                window.Sentry.captureException(e, { tags: { source: 'notifyLiffRequest' } });
            }
        });
        showLiffLinkStatus('pending');
        toast('✅ ส่งคำขอเรียบร้อย รอ admin อนุมัติ', 'success');
    } catch (e) {
        toast('❌ บันทึกไม่สำเร็จ: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '🔗 ส่งคำขอเชื่อมบัญชี'; }
    }
}

// Rebuilds the room <select> options for the currently-selected building.
// Idempotent — safe to call on overlay show, on building change, and on
// late RoomConfigManager RTDB sync via the 'roomconfig-updated' event.
// Preserves a still-valid prior selection across rebuilds so a sync
// arriving after the user picked doesn't reset their choice.
function _taPopulateLiffRoomSelect() {
    const sel = document.getElementById('liff-link-room');
    const bldSel = document.getElementById('liff-link-building');
    if (!sel || !bldSel) return;
    const building = bldSel.value;
    let rooms = [];
    try {
        if (typeof RoomConfigManager !== 'undefined') {
            const cfg = RoomConfigManager.getRoomsConfig(building);
            rooms = (cfg?.rooms || []).filter(r => !r.deleted && r.id);
        }
    } catch (e) {
        console.warn('[liff-link] populate room select failed:', e?.message || e);
    }
    const prev = sel.value;
    const opts = ['<option value="">— เลือกห้อง —</option>'];
    rooms.forEach(r => {
        const id = String(r.id);
        const label = r.name || (building === 'nest' ? `Nest ${id}` : `ห้อง ${id}`);
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        opts.push(`<option value="${esc(id)}">${esc(label)}</option>`);
    });
    sel.innerHTML = opts.join('');
    if (prev && rooms.some(r => String(r.id) === prev)) sel.value = prev;
}

// One-time wiring: building change repaints the room list; late RTDB
// sync from RoomConfigManager refreshes both buildings, so we refresh
// whichever is currently selected.
function _taWireLiffRoomSelect() {
    if (_taWireLiffRoomSelect._wired) return;
    _taWireLiffRoomSelect._wired = true;
    document.getElementById('liff-link-building')
        ?.addEventListener('change', _taPopulateLiffRoomSelect);
    document.addEventListener('roomconfig-updated', _taPopulateLiffRoomSelect);
}

function showLiffLinkForm() {
    const host = document.getElementById('liff-link-overlay');
    if (!host) return;
    host.style.display = 'flex';
    const greet = document.getElementById('liff-link-greeting');
    if (greet && window._lineProfile) greet.textContent = `สวัสดีคุณ ${window._lineProfile.displayName} 👋`;
    document.getElementById('liff-link-form-box').style.display = '';
    document.getElementById('liff-link-status-box').style.display = 'none';
    // Reset submit button to fresh-signup mode (in case showRelinkForm
    // swapped it earlier this session). The standard create path uses
    // client setDoc → submitLiffLinkRequest.
    const btn = document.getElementById('liff-link-submit-btn');
    if (btn) {
        btn.dataset.action = 'submitLiffLinkRequest';
        btn.textContent = '🔗 ส่งคำขอเชื่อมบัญชี';
        btn.disabled = false;
    }
    _taWireLiffRoomSelect();
    _taPopulateLiffRoomSelect();
}

// Re-link path — same overlay/form as showLiffLinkForm, but the submit
// routes through the requestRoomRelink CF (admin SDK) because the user's
// liffUsers/{lineId} doc already exists in a terminal state (unlinked /
// rejected) and the firestore rule blocks client-side update of that
// doc. The CF validates LIFF idToken + room/building, flips status to
// 'pending', and notifies admin via the same LINE push as a fresh
// signup. Triggered from the #relink-pin on the world map (unlinked
// mode only) and from the "ส่งคำขอใหม่" button on the rejected status.
function showRelinkForm() {
    const host = document.getElementById('liff-link-overlay');
    if (!host) return;
    host.style.display = 'flex';
    const greet = document.getElementById('liff-link-greeting');
    if (greet) {
        const name = window._lineProfile?.displayName || 'ลูกบ้าน';
        greet.textContent = `สวัสดีคุณ ${name} — ขอเชื่อมห้องใหม่ได้ที่นี่`;
    }
    document.getElementById('liff-link-form-box').style.display = '';
    document.getElementById('liff-link-status-box').style.display = 'none';
    const btn = document.getElementById('liff-link-submit-btn');
    if (btn) {
        btn.dataset.action = 'submitRelinkRequest';
        btn.textContent = '🔄 ส่งคำขอเชื่อมห้อง';
        btn.disabled = false;
    }
    _taWireLiffRoomSelect();
    _taPopulateLiffRoomSelect();
}
window.showRelinkForm = showRelinkForm;

async function submitRelinkRequest() {
    const bld = document.getElementById('liff-link-building').value;
    const room = document.getElementById('liff-link-room').value.trim();
    if (!bld || !room) { toast('กรุณาเลือกตึกและใส่หมายเลขห้อง', 'error'); return; }
    const btn = document.getElementById('liff-link-submit-btn');
    const resetBtn = () => { if (btn) { btn.disabled = false; btn.textContent = '🔄 ส่งคำขอเชื่อมห้อง'; } };
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังส่ง...'; }

    // LIFF idToken is the sole credential — server verifies via LINE /verify.
    // No Firebase Auth required (the user may be anonymous post-unlink).
    let idToken;
    try {
        if (typeof liff === 'undefined' || !liff.getIDToken) {
            throw new Error('LIFF SDK ไม่พร้อม กรุณาเปิดผ่าน LINE');
        }
        idToken = liff.getIDToken();
        if (!idToken) throw new Error('ดึง LIFF token ไม่สำเร็จ');
    } catch (e) {
        toast('❌ ' + e.message, 'error');
        resetBtn();
        return;
    }

    // §7-R: any wire-bound await inside LIFF webview needs an AbortController
    // timeout — LINE's TLS connection cache can hang fetch() indefinitely.
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    try {
        const resp = await fetch(
            'https://asia-southeast1-the-green-haven.cloudfunctions.net/requestRoomRelink',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken, building: bld, room: String(room) }),
                signal: ctrl.signal,
            }
        );
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            const msg = data.error || `HTTP ${resp.status}`;
            throw new Error(msg);
        }
        // Success — tear down the unlinked-mode UI overlays so the
        // pending-state overlay (showLiffLinkStatus) can take over cleanly.
        // Also clear the cached room from prior session — user is now in
        // 'pending' not 'approved', so any next reload (hasRoomEarly
        // fast-path or otherwise) must NOT short-circuit into rendering
        // the home/bills shell from stale localStorage. initLiffAndLink
        // has the symmetric clear for the reload path.
        try { document.getElementById('unlinked-banner')?.remove(); } catch(_) {}
        try { document.body.classList.remove('gh-unlinked-mode'); } catch(_) {}
        try {
            localStorage.removeItem('tenant_app_room');
            sessionStorage.removeItem('user');
        } catch(_) {}
        showLiffLinkStatus('pending');
        toast('✅ ส่งคำขอเรียบร้อย รอ admin อนุมัติ', 'success');
    } catch (e) {
        const aborted = e?.name === 'AbortError' || /aborted/i.test(e?.message || '');
        toast('❌ ' + (aborted ? 'เซิร์ฟเวอร์ตอบช้า — ลองปิด LINE จาก app switcher แล้วเปิดใหม่' : e.message), 'error');
        resetBtn();
    } finally {
        clearTimeout(to);
    }
}
window.submitRelinkRequest = submitRelinkRequest;

function showLiffLinkStatus(status) {
    const host = document.getElementById('liff-link-overlay');
    if (!host) return;
    host.style.display = 'flex';
    document.getElementById('liff-link-form-box').style.display = 'none';
    const box = document.getElementById('liff-link-status-box');
    box.style.display = '';
    const icon = status === 'rejected' ? '❌' : '⏳';
    const title = status === 'rejected' ? 'คำขอถูกปฏิเสธ' : 'รอ admin อนุมัติ';
    const detail = status === 'rejected'
        ? 'กรุณาติดต่อ admin โดยตรงหรือส่งคำขอใหม่'
        : 'เมื่ออนุมัติแล้วจะเข้าใช้งานได้อัตโนมัติ กรุณารอสักครู่';
    // Rejected path → showRelinkForm (CF write); doc already exists so a
    // direct client setDoc would be blocked by the liffUsers update rule.
    const actionBtn = status === 'rejected'
        ? '<button data-action="showRelinkForm" style="padding:10px 24px;background:var(--primary-green);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;touch-action:manipulation;">🔄 ส่งคำขอใหม่</button>'
        : '<button data-action="reloadPage" style="padding:10px 24px;background:var(--primary-green);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;touch-action:manipulation;">🔄 ตรวจสอบอีกครั้ง</button>';
    box.innerHTML = `<div style="font-size:var(--fs-lg);margin-bottom:1rem;">${icon}</div>
        <div style="font-weight:800;font-size:var(--fs-lg);margin-bottom:.5rem;">${title}</div>
        <div style="font-size:var(--fs-md);color:var(--text-muted);max-width:320px;margin:0 auto 1.2rem;">${detail}</div>
        ${actionBtn}`;
}

function _initAdminPreviewBar() {
    if (sessionStorage.getItem('_adminPreview') !== '1') return;
    const bar = document.getElementById('admin-preview-bar');
    if (!bar) return;
    bar.style.display = 'flex';
    document.body.style.paddingTop = '34px';
    const label = document.getElementById('apb-current');
    const roomInput = document.getElementById('apb-room-input');
    const buildingSelect = document.getElementById('apb-building-select');
    if (label) label.textContent = `ห้อง ${_taRoom} / ${_taBuilding}`;
    if (roomInput) roomInput.value = _taRoom;
    if (buildingSelect && _taBuilding) buildingSelect.value = _taBuilding;
    document.getElementById('apb-switch-btn')?.addEventListener('click', () => {
        let r = (roomInput?.value || '').trim().replace(/[^0-9A-Za-zก-๙]/g, '');
        if (!r) return;
        // Room number dictates building — 101 is always nest, 15ก is always rooms.
        // The select is a hint but room wins (so typo-proof).
        const b = _taDetectBuilding(r);
        r = _taNormalizeRoom(r, b);
        const url = new URL(window.location.href);
        url.searchParams.set('room', r);
        url.searchParams.set('building', b);
        window.location.href = url.toString();
    });
    // Logout — clears admin-preview flags + signs out Firebase, then back to /login.
    // Without the explicit signOut, the next /login visit auto-restores the cached
    // admin session from IndexedDB and skips the form.
    document.getElementById('apb-logout-btn')?.addEventListener('click', async () => {
        try {
            sessionStorage.removeItem('_adminPreview');
            sessionStorage.removeItem('user');
            localStorage.removeItem('tenant_app_room');
            if (window.firebaseAuth?.signOut) {
                await window.firebaseAuth.signOut().catch(() => {});
            }
        } catch(_) {}
        window.location.href = '/login';
    });
}

async function initTenantApp() {
    // Safety net: remove splash after 10s regardless, so a silent error never leaves user stuck
    const _splashTimeout = setTimeout(() => document.getElementById('app-loading-splash')?.remove(), 10000);

    // Fast-path: if room already in storage/URL, don't block on liff.init() (~2-5s)
    const hasRoomEarly = !!(
        new URLSearchParams(window.location.search).get('room') ||
        sessionStorage.getItem('user') ||
        localStorage.getItem('tenant_app_room')
    );
    // Start LIFF; only await it when we don't yet know the room (first-time LINE user)
    const liffPromise = initLiffAndLink();
    const liffResult = hasRoomEarly ? null : await liffPromise;

    const hasRoom = detectRoomBuilding();
    _initAdminPreviewBar();
    clearTimeout(_splashTimeout);

    if (!hasRoom && window._lineUserId && liffResult && !liffResult.linked) {
        // LIFF user without linked account — show link form or pending status
        if (liffResult.status === 'pending' || liffResult.status === 'rejected') {
            showLiffLinkStatus(liffResult.status);
        } else {
            showLiffLinkForm();
        }
        document.getElementById('app-loading-splash')?.remove();
        return; // stop here; don't render tenant pages without room
    }

    if (hasRoom) {
        // SWR (stale-while-revalidate) — loadTenantAppData hydrates from localStorage
        // synchronously, then refreshes from Firestore in the background and re-renders.
        // No awaits before first paint: total init time = JS load + Firebase init + sign-in,
        // not JS + Firebase + 5s firebase-wait + 5s claims-wait + 1-2s Firestore round-trip.
        // Subscribes (bills/maintenance/marketplace) handle missing Firebase/claims with
        // retry listeners on authReady/liffLinked, so they self-heal as the app warms up.
        loadTenantAppData();
    }
    renderHomePage();
    renderBillsList();
    renderProfilePage();
    renderContractPage();
    updateNavBadges();
    loadAvatar();
    renderWellness();
    loadWellnessFromFirestore();
    _loadNickname();
    // Daily bonus — safe to run now: _nestOnlyDisabled is set by detectRoomBuilding() above
    checkDailyLogin();
    // Deep-link: ?page=<key> from LINE notification → jump to the matching surface.
    //   bill|bills|usage → usage page (bills-history-section)
    //   payment          → payment-page
    //   contract         → contract-action-page (renewal/move-out subpage)
    //                      — symmetric with bell click target (openLeaseAlertFromBell)
    try {
        const qp = new URLSearchParams(window.location.search);
        const target = (qp.get('page') || '').toLowerCase();
        if ((target === 'bill' || target === 'bills' || target === 'usage') && typeof showPage === 'function') {
            showPage('usage');
            if (typeof updateNavActiveIndex === 'function') updateNavActiveIndex(3);
        } else if (target === 'payment' && typeof showPage === 'function') {
            showPage('payment-page');
        } else if ((target === 'contract' || target === 'contract-action-page') && typeof showSubPage === 'function') {
            showSubPage('contract-action-page');
        }
    } catch(e) {}
    document.getElementById('app-loading-splash')?.remove();

    // First-run onboarding tour for new tenants. Runs once per device
    // (gated by localStorage) and only when a real tenant is loaded.
    if (hasRoom && window.GhTour && !window.GhTour.hasSeen('tenant_v1')) {
        setTimeout(_startTenantTour, 800);
    }
}


// ============================================================
// Public API -- required by data-action dispatch (_ta === window)
// and by bareword calls from the main inline script
// ============================================================
window._onLiffClaimsReady = _onLiffClaimsReady;
window.detectRoomBuilding = detectRoomBuilding;
window.initTenantApp = initTenantApp;
window.submitLiffLinkRequest = submitLiffLinkRequest;
window.showLiffLinkForm = showLiffLinkForm;
window.showLiffLinkStatus = showLiffLinkStatus;
// window.showRelinkForm and window.submitRelinkRequest already assigned inline above
