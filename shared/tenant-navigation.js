/**
 * Tenant Navigation — page-switching and nav-bar state.
 * Extracted from tenant_app.html god-file (was lost in god-file refactor).
 *
 * Exports: window.showPage, window.showSubPage, window.updateNavActiveIndex,
 *          window.goBackToService, window.goBackToProfile, window.goBackToCommunity,
 *          window.goBackToHome, window.goBackToUsage, window.goBackFromPayment,
 *          window.goBackToMarketplace
 *
 * Load order: must be present before tenant-liff-auth.js wraps window.showPage
 * in _applyUnlinkedMode / _applyPlayerMode (both called at auth-time, after
 * deferred scripts have run — so this defer is fine).
 */

window.showPage = function showPage(id, element) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
        p.style.pointerEvents = 'none';
    });

    // Resolve target: try <id>-page first, then <id> directly
    const targetId = id + '-page';
    const target = document.getElementById(targetId) || document.getElementById(id);

    if (target) {
        target.style.display = 'block';
        target.classList.add('active');
        target.style.pointerEvents = 'auto';
        window.scrollTo(0, 0);
        // world-map sits below other pages to avoid z-index conflicts
        target.style.zIndex = (target.id === 'world-map-page' || target.id === 'world-map') ? '5' : '10';
    } else {
        console.error('[nav] showPage: page not found:', targetId);
    }

    // Hide nav bar on full-screen sub-pages (world-map + marketplace); show on the 5 bottom-nav pages.
    // 'marketplace' was dropped in the god-file refactor (§7-QQ) → the bottom nav bled onto the
    // marketplace overlay with a stale "Quiz" active state. tenant_app.html:3369 (id="marketplace")
    // + the comment at :3367 document that showPage MUST hide it here.
    const navBar = document.getElementById('main-nav-bar') || document.getElementById('bottom-nav');
    if (navBar) {
        navBar.style.display = (id === 'world-map' || id === 'marketplace' || (target && target.id === 'world-map-page')) ? 'none' : 'flex';
    }

    // Marketplace sub-nav (#market-nav-bar) — shown only on the 3 marketplace
    // pages; hidden everywhere else. Defined in shared/tenant-marketplace.js.
    if (typeof window._syncMarketNav === 'function') window._syncMarketNav(target ? target.id : null);

    // Update active nav-item highlight when element is passed
    if (element) {
        document.querySelectorAll('.nav-item').forEach(nav => { nav.classList.remove('active'); nav.removeAttribute('aria-current'); });
        element.classList.add('active');
        element.setAttribute('aria-current', 'page');  // WCAG 4.1.2 — move state off the hardcoded Home button
    }

    // Refresh usage data when navigating to payment/usage pages
    if ((id === 'payment' || id === 'usage') && typeof window.updateDashboard === 'function') {
        window.updateDashboard();
    }
};

window.showSubPage = function showSubPage(id) {
    // Close all pages first
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
        p.style.pointerEvents = 'none';
    });

    // Open the target sub-page
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
        target.style.display = 'block';
        target.style.pointerEvents = 'auto';
        target.style.zIndex = '20';
    }

    // Hide nav bar for sub-pages
    const navBar = document.getElementById('main-nav-bar') || document.getElementById('bottom-nav');
    if (navBar) navBar.style.display = 'none';

    // Marketplace sub-nav (#market-nav-bar): market-chat-list-page and
    // market-mine-page are sub-pages that SHOULD keep the bar; everything else
    // (active chat, post form, …) hides it. _syncMarketNav decides per target.
    if (typeof window._syncMarketNav === 'function') window._syncMarketNav(target ? target.id : null);

    // Optional render hooks (guarded — may not be loaded yet)
    if (id === 'elec_usage' && typeof window.renderElecUsage === 'function') window.renderElecUsage();
    if (id === 'water_usage' && typeof window.renderWaterUsage === 'function') window.renderWaterUsage();

    window.scrollTo(0, 0);
};

window.updateNavActiveIndex = function updateNavActiveIndex(index) {
    const navItems = document.querySelectorAll('.nav-item');
    if (navItems.length > index) {
        navItems.forEach(nav => { nav.classList.remove('active'); nav.removeAttribute('aria-current'); });
        navItems[index].classList.add('active');
        navItems[index].setAttribute('aria-current', 'page');  // WCAG 4.1.2 — dynamic active state for SR
    }
};

// ── goBack helpers (nav-index values match bottom-nav button order) ──
window.goBackToService    = function() { window.showPage('services'); window.updateNavActiveIndex(1); };
window.goBackToCommunity  = function() { window.showPage('community'); window.updateNavActiveIndex(2); };
window.goBackToMarketplace = function() { window.showPage('marketplace'); window.updateNavActiveIndex(2); };
window.goBackToUsage      = function() { window.showPage('usage'); window.updateNavActiveIndex(3); };
window.goBackToProfile    = function() { window.showPage('profile'); window.updateNavActiveIndex(4); };
window.goBackToHome       = function() { window.showPage('home'); window.updateNavActiveIndex(0); };
window.goBackFromPayment  = function() { window.showPage('usage'); window.updateNavActiveIndex(3); };

// ── Keyboard accessibility for menu tiles (WCAG 2.1.1 + 2.4.7) ───────────────
// The .menu-item tiles are <div>s (not <button>), so by default they are neither
// focusable nor operable with Enter/Space. We (1) tag them role="button" +
// tabindex="0" so they join the tab order and announce correctly, and (2)
// translate Enter/Space into a synthetic bubbling click that the existing
// capture-phase click-delegation hub (tenant_app.html) already handles — the
// exact same path as a tap. Native controls are skipped so they keep their
// built-in keyboard behavior (no double activation). User-initiated only —
// this is assistive key→click translation, NOT the §7-I auto-action pattern.

function enhanceMenuItemA11y(root) {
    const scope = (root && typeof root.querySelectorAll === 'function')
        ? root
        : (typeof document !== 'undefined' ? document : null);
    if (!scope) return 0;
    const tiles = scope.querySelectorAll('.menu-item[data-action]');
    tiles.forEach(function (el) {
        if (!el.getAttribute('role')) el.setAttribute('role', 'button');
        if (el.getAttribute('tabindex') === null) el.setAttribute('tabindex', '0');
    });
    return tiles.length;
}
window.enhanceMenuItemA11y = enhanceMenuItemA11y;

function _onTileKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const el = (e.target && typeof e.target.closest === 'function')
        ? e.target.closest('[data-action]')
        : null;
    if (!el) return;
    // Native interactive elements handle Enter/Space natively — don't double-fire.
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
window._onTileKeydown = _onTileKeydown;

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', _onTileKeydown);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { enhanceMenuItemA11y(); });
    } else {
        // Deferred scripts run after the DOM is parsed but before DOMContentLoaded —
        // the tiles are already present, so enhance immediately.
        enhanceMenuItemA11y();
    }
}
