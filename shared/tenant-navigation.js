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

    // Hide nav bar on world-map, show everywhere else
    const navBar = document.getElementById('main-nav-bar') || document.getElementById('bottom-nav');
    if (navBar) {
        navBar.style.display = (id === 'world-map' || (target && target.id === 'world-map-page')) ? 'none' : 'flex';
    }

    // Update active nav-item highlight when element is passed
    if (element) {
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        element.classList.add('active');
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

    // Optional render hooks (guarded — may not be loaded yet)
    if (id === 'elec_usage' && typeof window.renderElecUsage === 'function') window.renderElecUsage();
    if (id === 'water_usage' && typeof window.renderWaterUsage === 'function') window.renderWaterUsage();

    window.scrollTo(0, 0);
};

window.updateNavActiveIndex = function updateNavActiveIndex(index) {
    const navItems = document.querySelectorAll('.nav-item');
    if (navItems.length > index) {
        navItems.forEach(nav => nav.classList.remove('active'));
        navItems[index].classList.add('active');
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
