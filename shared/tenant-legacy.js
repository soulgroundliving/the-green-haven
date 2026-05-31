// shared/tenant-legacy.js
// Functions ported from tenant.html (2026-04-18) + tenant speed-test + community subscriptions.
// Extracted from tenant_app.html god-file.
//
// Requires (all window globals):
//   _taRoom, _taBuilding, _taTenant, _taLease — var globals (tenant-liff-auth.js)
//   _taBills, _taCurrentBill                 — var globals (inline script §7-CC)
//   toast, _esc                              — function decls (inline script)
//   showPage, showSubPage                    — function decls (inline script)
//   renderBillsList, updateNavBadges         — from tenant-render.js
//   goToPaymentStep                          — from tenant-render.js
//   window.firebase, window.firebaseReady    — Firebase
//   window.GhHaptic, window.GhModal         — UI helpers
//
// Exports (window.*): see bottom of file

'use strict';
(function () {

// =========================================================
// ===== PORTED FROM tenant.html (legacy) — 2026-04-18 =====
// Adapted to tenant_app.html helpers: _esc, toast, _setStatus
// State refs: _taRoom / _taBuilding / _taLease / _taTenant / _taCurrentBill
// =========================================================

// Lightweight legacy aliases so ported code can stay close to original
function _legacyRoom()     { return _taRoom || ''; }
function _legacyBuilding() { return _taBuilding || 'rooms'; }
function _legacyTenant()   { return _taTenant || _taLease || {}; }
function _legacyLease()    { return _taLease || {}; }
function getOwnerName() {
    // Cached by _subscribePaymentConfig from Firestore buildings/{b}.ownerName/companyName
    try { return localStorage.getItem('owner_name') || localStorage.getItem('company_name') || 'The Green Haven Co., Ltd.'; } catch(e){ return 'The Green Haven Co., Ltd.'; }
}
function getCompanyName() {
    try { return localStorage.getItem('company_name') || getOwnerName(); } catch(e) { return 'The Green Haven Co., Ltd.'; }
}
function getBuildingDisplayName() {
    return _legacyBuilding() === 'nest' ? 'Nest Building' : 'Rent Rooms';
}

// ---- TOGGLE ACCORDION ----
function toggleAccordion(headerElement) {
    const content = headerElement.nextElementSibling;
    if (!content || !content.classList.contains('accordion-content')) {
        console.warn('toggleAccordion: missing .accordion-content');
        return;
    }
    const isOpen = content.classList.contains('is-open');
    content.classList.toggle('is-open', !isOpen);
    content.classList.toggle('active');
    headerElement.classList.toggle('active');
    headerElement.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
}

// ---- BUILDING INTERNET STATUS ----
// Real status only — subscribes to Firestore `buildings/{building}/meta/internet`
// (admin maintains via dashboard). If doc missing/unavailable → hide section
// (no fake "online" default leaking to UI).
function _applyBuildingInternetStatus(data) {
    const section = document.getElementById('internetStatusSection');
    if (!section) return;
    if (!data) { section.classList.add('ta-sect-hidden'); return; }
    section.classList.remove('ta-sect-hidden');

    const icon = document.getElementById('internetStatusIcon');
    const txt  = document.getElementById('internetStatusText');
    if (data.status === 'online') {
        if (icon) icon.textContent = '🟢';
        if (txt)  { txt.textContent = 'เชื่อมต่อแล้ว'; txt.style.color = '#16A34A'; }
    } else if (data.status === 'offline') {
        if (icon) icon.textContent = '🔴';
        if (txt)  { txt.textContent = 'ไม่เชื่อมต่อ'; txt.style.color = '#DC2626'; }
    } else if (data.status === 'maintenance') {
        if (icon) icon.textContent = '🟡';
        if (txt)  { txt.textContent = 'กำลังบำรุงรักษา'; txt.style.color = '#D97706'; }
    } else {
        if (icon) icon.textContent = '⚪';
        if (txt)  { txt.textContent = 'ยังไม่มีข้อมูล'; txt.style.color = '#6b7280'; }
    }

    const speedSec = document.getElementById('internetSpeedSection');
    const dl = document.getElementById('internetDownloadSpeed');
    const ul = document.getElementById('internetUploadSpeed');
    const hasSpeed = data.downloadSpeed || data.uploadSpeed;
    if (speedSec) speedSec.style.display = hasSpeed ? 'grid' : 'none';
    if (dl) dl.textContent = data.downloadSpeed || '-';
    if (ul) ul.textContent = data.uploadSpeed || '-';

    const provSec = document.getElementById('internetProviderSection');
    const prov = document.getElementById('internetProvider');
    const cont = document.getElementById('internetContact');
    if (prov) prov.textContent = data.provider || '-';
    if (cont) cont.textContent = data.contact || '-';
    if (provSec) provSec.style.display = data.provider ? 'block' : 'none';

    const last = document.getElementById('internetLastCheck');
    if (last) {
        const t = data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt ? new Date(data.updatedAt) : null);
        last.textContent = t ? t.toLocaleString('th-TH') : '-';
    }
}

let _buildingInternetUnsub = null;
function displayBuildingInternetStatus() {
    const section = document.getElementById('internetStatusSection');
    if (!section) return;
    // Default: hide until we get real data from Firestore
    section.classList.add('ta-sect-hidden');
    if (_buildingInternetUnsub) { _buildingInternetUnsub(); _buildingInternetUnsub = null; }
    if (!_taBuilding || !window.firebase?.firestore || !window.firebase.firestoreFunctions) return;
    // Map canonical _taBuilding → Firestore display id via SSoT helper
    const fsId = window.CONFIG.getFirestoreBuilding(_taBuilding);
    try {
        const db = window.firebase.firestore();
        const fs = window.firebase.firestoreFunctions;
        const ref = fs.doc(db, 'buildings', fsId);
        _buildingInternetUnsub = fs.onSnapshot(ref, snap => {
            const doc = snap.exists() ? snap.data() : null;
            _applyBuildingInternetStatus(doc?.internet || null);
        }, () => { _applyBuildingInternetStatus(null); });
    } catch (e) {
        _applyBuildingInternetStatus(null);
    }
}

// ---- ROOM-LEVEL INTERNET STATUS ----
// Real browser-measured status. Uses navigator.onLine (always supported)
// and Network Information API (navigator.connection, Chromium-based) when
// available. Live updates on online/offline + connection change events.
// SSID / per-room speed cannot be read from browser for security reasons —
// those fields are removed from the UI (replaced with effectiveType + rtt).
let _roomInternetWired = false;
function _applyRoomInternetStatus() {
    const section = document.getElementById('roomInternetStatusSection');
    if (!section) return;
    section.classList.remove('ta-sect-hidden');

    const online = navigator.onLine;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;

    const icon = document.getElementById('roomInternetStatusIcon');
    const txt  = document.getElementById('roomInternetStatusText');
    if (!online) {
        if (icon) icon.textContent = '🔴';
        if (txt)  { txt.textContent = 'ไม่เชื่อมต่อ'; txt.style.color = '#DC2626'; }
    } else if (conn && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) {
        if (icon) icon.textContent = '🟡';
        if (txt)  { txt.textContent = 'สัญญาณอ่อน'; txt.style.color = '#D97706'; }
    } else {
        if (icon) icon.textContent = '🟢';
        if (txt)  { txt.textContent = 'เชื่อมต่อแล้ว'; txt.style.color = '#16A34A'; }
    }

    const speedSec = document.getElementById('roomInternetSpeedSection');
    const dl = document.getElementById('roomInternetDownloadSpeed');
    const ul = document.getElementById('roomInternetUploadSpeed');
    if (conn && typeof conn.downlink === 'number') {
        if (speedSec) speedSec.style.display = 'grid';
        if (dl) dl.textContent = `~${conn.downlink.toFixed(1)} Mbps`;
        if (ul) ul.textContent = conn.rtt != null ? `RTT ${Math.round(conn.rtt)} ms` : '-';
    } else if (speedSec) {
        speedSec.style.display = 'none';
    }

    const provSec = document.getElementById('roomInternetProviderSection');
    const roomEl  = document.getElementById('roomInternetRoom');
    const ssidEl  = document.getElementById('roomInternetSSID');
    if (roomEl) roomEl.textContent = _taRoom || '-';
    if (ssidEl) {
        // Browser can't read SSID; show effectiveType as the useful proxy
        ssidEl.textContent = conn?.effectiveType ? conn.effectiveType.toUpperCase() : 'ไม่ทราบ';
    }
    if (provSec) provSec.style.display = 'block';

    const last = document.getElementById('roomInternetLastCheck');
    if (last) last.textContent = new Date().toLocaleString('th-TH');
}

function displayRoomInternetStatus() {
    _applyRoomInternetStatus();
    if (_roomInternetWired) return;
    _roomInternetWired = true;
    window.addEventListener('online',  _applyRoomInternetStatus);
    window.addEventListener('offline', _applyRoomInternetStatus);
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && typeof conn.addEventListener === 'function') {
        conn.addEventListener('change', _applyRoomInternetStatus);
    }
}

// ===== TENANT-SIDE SPEED TEST =====
// Tenants self-install ISP per room — project hands-off per design intent
// (see lifecycle_room_wifi.md "decommissioned" + tasks/todo.md WiFi pivot
// 2026-05-18). App's only job: let tenant measure their own download speed
// + latency on demand. No SSID/password storage, no admin-managed WiFi.
//
// Implementation: fetch a 2MB random payload from /api/speed-test (W1-B),
// compute Mbps from elapsed time. Cooldown 60s prevents accidental spam.
(function () {
    const COOLDOWN_MS = 60_000;
    const PAYLOAD_BYTES = 2_000_000;
    let _lastRunAt = 0;
    let _running = false;
    let _countdownIntervalId = null;

    function _setStatus(text) {
        const el = document.getElementById('speedTestStatus');
        if (el) el.textContent = text || '';
    }
    function _setResult(mbps, pingMs) {
        const result = document.getElementById('speedTestResult');
        const mbpsEl = document.getElementById('speedTestMbps');
        const pingEl = document.getElementById('speedTestPing');
        if (!result) return;
        result.style.display = 'grid';
        if (mbpsEl) mbpsEl.textContent = `${mbps.toFixed(1)} Mbps`;
        if (pingEl) pingEl.textContent = `${Math.round(pingMs)} ms`;
    }
    function _stopCountdown() {
        if (_countdownIntervalId) {
            clearInterval(_countdownIntervalId);
            _countdownIntervalId = null;
        }
    }
    function _startCountdown() {
        _stopCountdown();
        const tick = () => {
            const remaining = COOLDOWN_MS - (Date.now() - _lastRunAt);
            if (remaining <= 0) {
                _stopCountdown();
                _setStatus('พร้อมทดสอบใหม่แล้ว');
                return;
            }
            _setStatus(`รอ ${Math.ceil(remaining / 1000)} วินาทีก่อนทดสอบใหม่`);
        };
        tick();
        _countdownIntervalId = setInterval(tick, 1000);
    }

    async function runSpeedTest() {
        if (_running) return;
        const now = Date.now();
        const sinceLast = now - _lastRunAt;
        if (sinceLast < COOLDOWN_MS && _lastRunAt > 0) {
            _startCountdown();
            return;
        }
        _stopCountdown();
        _running = true;
        const btn = document.getElementById('speedTestRunBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'กำลังทดสอบ...'; }
        _setStatus('กำลังวัด latency...');
        try {
            // Ping: warm the serverless function first (cold-start is ~500ms on
            // first call), then 3 measured samples — take MIN to filter out
            // network jitter / GC pauses. Each ping is 1 byte response.
            let pingMs = 0;
            try {
                // Warmup (discarded). Bypass timeout — first call is the slow one.
                await (await fetch(`/api/speed-test?bytes=1&t=warmup-${now}`, { cache: 'no-store' })).arrayBuffer();
                // 3 measured samples in series; take min.
                const samples = [];
                for (let i = 0; i < 3; i++) {
                    const ctrlPing = new AbortController();
                    const pingTimeout = setTimeout(() => ctrlPing.abort(), 3000);
                    try {
                        const t0 = performance.now();
                        const r = await fetch(`/api/speed-test?bytes=1&t=p${i}-${now}`, {
                            cache: 'no-store', signal: ctrlPing.signal
                        });
                        await r.arrayBuffer();
                        samples.push(performance.now() - t0);
                    } finally { clearTimeout(pingTimeout); }
                }
                pingMs = Math.min(...samples);
            } catch (_) { /* ping non-fatal */ }

            _setStatus('กำลังดาวน์โหลด 2MB เพื่อวัดความเร็ว...');

            // Throughput: time to fully download PAYLOAD_BYTES from same origin.
            const ctrl = new AbortController();
            const dlTimeout = setTimeout(() => ctrl.abort(), 30_000);
            const t0 = performance.now();
            const resp = await fetch(`/api/speed-test?bytes=${PAYLOAD_BYTES}&t=${now}`, {
                cache: 'no-store', signal: ctrl.signal
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const buf = await resp.arrayBuffer();
            clearTimeout(dlTimeout);
            const elapsedMs = performance.now() - t0;
            const mbps = (buf.byteLength * 8) / (elapsedMs / 1000) / 1_000_000;
            _setResult(mbps, pingMs);
            _setStatus(`อัปเดตล่าสุด: ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
            _lastRunAt = Date.now();
        } catch (e) {
            const msg = e?.name === 'AbortError' ? 'หมดเวลา (timeout)' : (e?.message || 'ทดสอบไม่สำเร็จ');
            _setStatus(`ทดสอบไม่สำเร็จ: ${msg}`);
        } finally {
            _running = false;
            const b = document.getElementById('speedTestRunBtn');
            if (b) { b.disabled = false; b.textContent = 'เริ่มทดสอบใหม่'; }
        }
    }

    const runBtn = document.getElementById('speedTestRunBtn');
    if (runBtn && !runBtn._wired) {
        runBtn._wired = true;
        runBtn.addEventListener('click', runSpeedTest);
    }
})();

// ---- LEASE RENEWAL ALERT ----
// Renders into the 🔔 bell panel via _leaseAlertItem() synthesized in
// _renderBroadcastsList. The standalone banner surfaces (community page
// + home page mirror) were retired — bell is the single notification
// surface. This function is kept as a thin shim so existing callers
// (init flow, window.displayLeaseRenewalAlert) still trigger the badge
// and list refresh when tenant data lands.
function displayLeaseRenewalAlert() {
    try {
        if (typeof window._renderBroadcastBadge === 'function') window._renderBroadcastBadge();
        if (typeof window._renderBroadcastsList === 'function') window._renderBroadcastsList();
    } catch(e) { console.warn('displayLeaseRenewalAlert:', e); }
}

// ---- EMERGENCY CALL ----
function makeCall(phoneNumber) {
    if (!phoneNumber) { toast('ไม่มีหมายเลขโทรศัพท์', 'error'); return; }
    const clean = String(phoneNumber).replace(/[^0-9+]/g, '');
    window.location.href = `tel:${clean}`;
}

// ---- OPEN DOCUMENT FILE (LINE-safe) ----
function openDocFile(url) {
    if (!url || url === '#') return;
    try {
        if (window.liff && typeof liff.isInClient === 'function' && liff.isInClient()) {
            liff.openWindow({ url, external: true });
        } else {
            window.open(url, '_blank', 'noopener');
        }
    } catch(e) { window.open(url, '_blank', 'noopener'); }
}
function scrollToEmergencyContacts() {
    showPage('services'); updateNavActiveIndex(1);
    setTimeout(() => {
        const sec = document.getElementById('emergencyContactsSection');
        if (!sec) return;
        const content = sec.querySelector('.accordion-content');
        const header = sec.querySelector('[onclick]');
        if (content && content.style.display === 'none') toggleAccordion(header);
        sec.scrollIntoView({ behavior:'smooth', block:'start' });
    }, 300);
}

// ---- SERVICE PROVIDERS ----
let _providersUnsub = null;
function _subscribeServiceProviders() {
    if (_providersUnsub) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
    try {
        const fs = window.firebase.firestoreFunctions;
        const db = window.firebase.firestore();
        const ref = fs.doc(db, 'system', 'serviceProviders');
        _providersUnsub = fs.onSnapshot(ref, snap => {
            if (!snap.exists()) return;
            const items = (snap.data() || {}).items || [];
            try { localStorage.setItem('service_providers_data', JSON.stringify(items)); } catch(e) {}
            // Re-render if list currently visible
            if (document.getElementById('serviceProvidersList')) displayServiceProviders();
        }, err => console.warn('serviceProviders subscribe failed:', err.message));
    } catch (e) { console.warn('serviceProviders subscribe init failed:', e.message); }
}
// [audit-skip] reads system/serviceProviders — public-read (firestore.rules:33).
window.addEventListener('authReady', _subscribeServiceProviders);
if (window.firebaseReady && window._authUid) _subscribeServiceProviders();

function displayServiceProviders() {
    const container = document.getElementById('serviceProvidersList');
    if (!container) return;
    let providers = [];
    try {
        const stored = JSON.parse(localStorage.getItem('service_providers_data') || '[]');
        if (stored && stored.length) providers = stored;
    } catch(e) {}
    // Filter out legacy internet + maintenance entries — they're redundant with
    // the Internet Status accordions and Maintenance page respectively.
    providers = providers.filter(p => p.type !== 'internet' && p.type !== 'maintenance');
    if (!providers.length) {
        // No providers to show — hide container to avoid empty space
        container.textContent = '';
        return;
    }
    // Build via DOM API to avoid XSS from stored data
    container.textContent = '';
    providers.forEach(p => {
        const card = document.createElement('div');
        card.style.cssText = 'padding:12px; background:#EFF6FF; border-radius:12px; border-left:4px solid #3B82F6;';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:6px;';
        head.innerHTML = `<span class="ta-icon-1-6rem">${_esc(p.icon||'🔧')}</span>
            <div class="u-flex-1">
                <div class="u-bold">${_esc(p.name||'-')}</div>
                <small class="u-color-muted">ประเภท: ${_esc(p.type||'-')}</small>
            </div>`;
        card.appendChild(head);
        const info = document.createElement('div');
        info.style.cssText = 'font-size:var(--fs-sm); color:#333; display:grid; gap:4px; margin-bottom:6px;';
        if (p.phone)   info.innerHTML += `<div>📞 ${_esc(p.phone)}</div>`;
        if (p.email)   info.innerHTML += `<div>📧 ${_esc(p.email)}</div>`;
        if (p.website) info.innerHTML += `<div>🌐 ${_esc(p.website)}</div>`;
        card.appendChild(info);
        if (p.phone) {
            const btn = document.createElement('button');
            btn.textContent = '📞 เรียกตอนนี้';
            btn.style.cssText = 'width:100%; padding:10px; background:#3B82F6; color:#fff; border:none; border-radius:10px; font-weight:700; cursor:pointer;';
            btn.onclick = () => makeCall(p.phone);
            card.appendChild(btn);
        }
        container.appendChild(card);
    });
}

// ---- COMMUNITY DOCUMENTS — SSoT from Firestore (admin writes via dashboard Documents tab) ----
function _subscribeCommunityDocuments() {
    if (!window.firebaseReady || !window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
        window.addEventListener('firebaseInitialized', _subscribeCommunityDocuments, { once: true });
        return;
    }
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    fs.onSnapshot(fs.query(fs.collection(db, 'communityDocuments'), fs.limit(50)), snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (docs.length) {
            try { localStorage.setItem('community_documents_data', JSON.stringify(docs)); } catch(e) {}
            displayDocuments();
        }
    }, err => console.warn('communityDocuments subscribe:', err.message));
}

// ---- POLICIES — SSoT from Firestore `system/policies` (admin writes via dashboard People → Policies tab) ----
function _subscribePolicies() {
    if (!window.firebaseReady || !window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
        window.addEventListener('firebaseInitialized', _subscribePolicies, { once: true });
        return;
    }
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    const ref = fs.doc(db, 'system', 'policies');
    fs.onSnapshot(ref, snap => {
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const map = {
            privacy: 'policy-privacy-content',
            terms:   'policy-terms-content',
            compliance: 'policy-compliance-content',
            ip:      'policy-ip-content'
        };
        Object.entries(map).forEach(([key, elId]) => {
            if (!data[key]) return;
            const el = document.getElementById(elId);
            if (!el) return;
            // Renderer auto-detects HTML vs plain text (backward-compat with old
            // text-only policies). HTML is sanitized through the same whitelist
            // admin uses on save, so a compromised admin can't inject script tags.
            if (window.RichTextPolicy?.renderTo) {
                window.RichTextPolicy.renderTo(el, data[key]);
            } else {
                el.style.whiteSpace = 'pre-wrap';
                el.textContent = data[key];
            }
        });
    }, err => console.warn('policies subscribe:', err.message));
}

function displayDocuments() {
    const container = document.getElementById('documentsList');
    if (!container) return;
    let documents = [];
    try { documents = JSON.parse(localStorage.getItem('community_documents_data') || '[]'); } catch(e) {}
    container.textContent = '';
    if (!documents.length) {
        container.innerHTML = '<p class="ta-loading-state">ยังไม่มีเอกสาร</p>';
        return;
    }
    documents.forEach(d => {
        const isEmergency = d.id === 'doc002' || d.category === 'Emergency';
        const accentColor = isEmergency ? '#DC2626' : '#3B82F6';
        const badgeBg    = isEmergency ? '#FEF2F2' : '#EFF6FF';

        const card = document.createElement('div');
        card.className = 'card';
        card.style.cssText = `border-left:4px solid ${accentColor}; margin:0;`;

        const info = document.createElement('div');
        const icon = isEmergency ? '🚨' : '📄';
        info.innerHTML = `<strong>${icon} ${_esc(d.title||'-')}</strong>
            <p style="margin:4px 0;font-size:var(--fs-sm);color:#666;">${_esc(d.description||'')}</p>
            <span style="display:inline-block;padding:3px 10px;background:${badgeBg};border-radius:6px;font-size:var(--fs-xs);color:${accentColor};font-weight:700;">${_esc(d.category||'-')}</span>`;
        card.appendChild(info);

        const btn = document.createElement('button');
        btn.className = 'btn-main';
        btn.style.cssText = `margin-top:10px;padding:9px 14px;touch-action:manipulation;${isEmergency ? 'background:#DC2626;' : ''}`;

        if (isEmergency) {
            btn.textContent = '📋 ดูขั้นตอน';
            btn.onclick = () => scrollToEmergencyContacts();
        } else if (d.fileUrl && d.fileUrl !== '#') {
            btn.textContent = '📄 เปิดดู PDF';
            btn.onclick = () => openDocFile(d.fileUrl);
        } else {
            btn.textContent = 'ยังไม่มีไฟล์เอกสาร';
            btn.disabled = true;
            btn.style.cssText += 'background:#e5e7eb;color:#9ca3af;cursor:default;';
        }
        card.appendChild(btn);
        container.appendChild(card);
    });
}

// ---- BILL RECEIPT VIEWING ----
// Adapted: choose tier-1 (the 7146 implementation) — full receipt HTML, not the alert stub
function viewBillReceipt(billId, monthName, year) {
    try {
        let bill = null;
        for (const y of [2567, 2568, 2569, 2570]) {
            const data = localStorage.getItem(`bills_${y}`);
            if (!data) continue;
            try {
                const arr = JSON.parse(data);
                const found = arr.find(b => b.billId === billId);
                if (found) { bill = found; break; }
            } catch(e) {}
        }
        if (!bill && typeof BillingCalculator !== 'undefined') {
            const bills = BillingCalculator.getBillsByRoom(_legacyRoom()) || [];
            bill = bills.find(b => b.billId === billId);
        }
        if (!bill) { toast('ไม่พบข้อมูลบิล: ' + billId, 'error'); return; }
        if (bill.status !== 'paid') {
            toast('บิลนี้ยังไม่ได้ชำระเงิน', 'warning');
        }
        const receiptHTML = `
            <div style="padding:1rem; background:#fff; border-radius:8px; border:2px dashed #2d8653;">
                <div style="text-align:center; margin-bottom:0.8rem; border-bottom:2px solid var(--primary-green); padding-bottom:0.5rem;">
                    <h2 style="margin:0 0 0.5rem; color:var(--primary-green);">ใบเสร็จรับเงิน</h2>
                    <small class="u-color-sub">Receipt</small>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:var(--fs-sm); margin-bottom:10px;">
                    <div><small class="u-color-sub">อ้างอิงบิล</small><div><strong>${_esc(bill.billId)}</strong></div></div>
                    <div><small class="u-color-sub">งวด</small><div><strong>${_esc(monthName)} ${_esc(year)}</strong></div></div>
                    <div><small class="u-color-sub">ห้อง</small><div><strong>${_esc(bill.roomId || _legacyRoom())}</strong></div></div>
                    <div><small class="u-color-sub">วิธีชำระ</small><div><strong>PromptPay</strong></div></div>
                </div>
                <div style="border:1px solid #e0e0e0; border-radius:8px; overflow:hidden;">
                    <div style="background:var(--primary-green); color:#fff; padding:8px 10px; font-weight:700;">รายละเอียด</div>
                    <div class="u-p-10">
                        ${bill.charges?.rent ? `<div class="ta-row-split"><span>🏠 ค่าเช่า</span><strong>฿${Number(bill.charges.rent).toLocaleString('th-TH')}</strong></div>` : ''}
                        ${bill.charges?.electric?.cost ? `<div class="ta-row-split"><span>⚡ ค่าไฟ</span><strong>฿${Number(bill.charges.electric.cost).toLocaleString('th-TH')}</strong></div>` : ''}
                        ${bill.charges?.water?.cost ? `<div class="ta-row-split"><span>💧 ค่าน้ำ</span><strong>฿${Number(bill.charges.water.cost).toLocaleString('th-TH')}</strong></div>` : ''}
                        ${bill.charges?.trash ? `<div class="ta-row-split"><span>🗑️ ค่าขยะ</span><strong>฿${Number(bill.charges.trash).toLocaleString('th-TH')}</strong></div>` : ''}
                        <div style="display:flex; justify-content:space-between; padding:8px 0; border-top:2px solid var(--primary-green); margin-top:6px;">
                            <strong>รวมทั้งสิ้น</strong>
                            <strong class="u-color-green">฿${Number(bill.totalCharge||bill.total||0).toLocaleString('th-TH')}</strong>
                        </div>
                    </div>
                </div>
            </div>`;
        const rc = document.getElementById('receiptContent');
        if (rc) { rc.classList.remove('ta-sect-hidden'); rc.innerHTML = receiptHTML; }
        showPage('payment');
        goToPaymentStep && goToPaymentStep(3);
    } catch(error) {
        console.error('viewBillReceipt:', error);
        toast('เกิดข้อผิดพลาดในการแสดงใบเสร็จ', 'error');
    }
}

// Generate printable receipt for a bill (opens new window) — ported
function generateReceiptForBill(billId, monthName, year) {
    try {
        let billData = null;
        for (const y of [2567, 2568, 2569, 2570]) {
            const data = localStorage.getItem(`bills_${y}`);
            if (!data) continue;
            try {
                const arr = JSON.parse(data);
                billData = arr.find(b => b.billId === billId && b.building === _legacyBuilding() && b.roomId === _legacyRoom());
                if (billData) break;
            } catch(e) {}
        }
        if (!billData) { toast('ไม่พบข้อมูลบิล', 'error'); return; }
        const ch = billData.charges || {};
        const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>ใบเสร็จ ${_esc(billId)}</title>
            <style>body{font-family:Arial;padding:1rem;max-width:800px;margin:auto}.header{text-align:center;border-bottom:2px solid #333;padding-bottom:0.5rem;margin-bottom:1rem}.row{display:flex;justify-content:space-between;margin:0.4rem 0}table{width:100%;border-collapse:collapse;margin:1rem 0}th,td{padding:0.6rem;border-bottom:1px solid #ddd;text-align:left}th{background:#f5f5f5}.amt{text-align:right}.total{font-weight:bold;background:#f5f5f5}</style>
            </head><body>
            <div class="header"><h2>✅ ใบเสร็จรับเงิน</h2><small>Receipt</small></div>
            <div class="row"><span>เลขที่:</span><strong>${_esc(billId)}</strong></div>
            <div class="row"><span>ห้อง:</span><strong>${_esc(_legacyRoom())}</strong></div>
            <div class="row"><span>อาคาร:</span><strong>${_esc(getBuildingDisplayName())}</strong></div>
            <div class="row"><span>เดือน:</span><strong>${_esc(monthName)} ${_esc(year)}</strong></div>
            <div class="row"><span>วันที่:</span><strong>${new Date().toLocaleDateString('th-TH')}</strong></div>
            <table><thead><tr><th>รายการ</th><th class="amt">จำนวน (บาท)</th></tr></thead><tbody>
                <tr><td><span aria-hidden="true">💰</span> ค่าเช่า</td><td class="amt">฿${Number(ch.rent||0).toLocaleString('th-TH')}</td></tr>
                <tr><td><span aria-hidden="true">⚡</span> ค่าไฟ</td><td class="amt">฿${Number(ch.electric?.cost||0).toLocaleString('th-TH')}</td></tr>
                <tr><td><span aria-hidden="true">💧</span> ค่าน้ำ</td><td class="amt">฿${Number(ch.water?.cost||0).toLocaleString('th-TH')}</td></tr>
                <tr><td><span aria-hidden="true">🗑️</span> ค่าขยะ</td><td class="amt">฿${Number(ch.trash||0).toLocaleString('th-TH')}</td></tr>
                <tr class="total"><td>รวม</td><td class="amt">฿${Number(billData.totalCharge||0).toLocaleString('th-TH')}</td></tr>
            </tbody></table>
            <div style="text-align:center;color:#666;font-size:12px;border-top:1px solid #ddd;padding-top:0.5rem;">ขอบคุณที่ชำระตรงเวลา · ${_esc(getOwnerName())}</div>
            <script>window.addEventListener('load',function(){window.focus();window.print();});<\/script>
            </body></html>`;
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const blobUrl = URL.createObjectURL(blob);
        const w = window.open(blobUrl, '_blank');
        if (!w) { toast('โปรดอนุญาต popup', 'error'); URL.revokeObjectURL(blobUrl); return; }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } catch(error) {
        console.error('generateReceiptForBill:', error);
        toast('เกิดข้อผิดพลาดในการสร้างใบเสร็จ', 'error');
    }
}

// ---- ADMIN NOTIFY (localStorage events) ----
function notifyAdminPaymentVerified() {
    try {
        const arr = JSON.parse(localStorage.getItem('payment_notifications') || '[]');
        arr.push({
            type:'payment_verified',
            building:_legacyBuilding(), room:_legacyRoom(),
            amount:(_taCurrentBill?.totalAmount||_taCurrentBill?.total||0),
            timestamp:new Date().toISOString(),
            slipId:(_taCurrentBill?.slipData?.transactionId)||null,
            status:'verified'
        });
        localStorage.setItem('payment_notifications', JSON.stringify(arr));
        window.dispatchEvent(new Event('payment_verified'));
    } catch(e){ console.warn('notifyAdminPaymentVerified:', e); }
}
function notifyAdminReceiptGenerated(receipt) {
    try {
        const arr = JSON.parse(localStorage.getItem('payment_notifications') || '[]');
        arr.push({
            type:'receipt_generated',
            building:_legacyBuilding(), room:_legacyRoom(),
            amount:(_taCurrentBill?.totalAmount||_taCurrentBill?.total||0),
            receiptId:receipt?.id, timestamp:new Date().toISOString(),
            status:'completed', verified:true
        });
        localStorage.setItem('payment_notifications', JSON.stringify(arr));
        window.dispatchEvent(new Event('receipt_generated'));
    } catch(e){ console.warn('notifyAdminReceiptGenerated:', e); }
}

// ---- GENERATE RECEIPT (called after slip verified) ----
function generateReceipt() {
    try {
        const bill = _taCurrentBill || {};
        const total = bill.totalAmount || bill.total || 0;
        let receipt = null;
        if (typeof InvoiceReceiptManager !== 'undefined') {
            try {
                receipt = InvoiceReceiptManager.createReceipt(
                    _legacyBuilding(),
                    bill.billId || `INV-${_legacyRoom()}-${bill.month||''}`,
                    { amount: total, paymentMethod:'slip',
                      slipOkVerified:true, verifiedBy:'SlipOK',
                      verifiedAt:new Date().toISOString() }
                );
                InvoiceReceiptManager.updateInvoiceStatus(_legacyBuilding(), bill.billId || `INV-${_legacyRoom()}-${bill.month||''}`, 'paid');
                InvoiceReceiptManager.syncToDashboard(_legacyBuilding());
            } catch(e) { console.warn('InvoiceReceiptManager:', e); }
        }
        const receiptNo = receipt?.id || ('RCP-' + Date.now());
        const rc = document.getElementById('receiptContent');
        if (rc) {
            rc.style.display = 'block';
            rc.innerHTML = `
                <div style="padding:1rem; background:#fff; border-radius:8px; border:2px dashed var(--primary-green);">
                    <div class="ta-section-heading">
                        <h3 style="margin:0; color:var(--primary-green);">✅ ใบเสร็จรับเงิน</h3>
                        <small>${_esc(receiptNo)}</small>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:var(--fs-sm);">
                        <div><small>ห้อง</small><div><strong>${_esc(_legacyRoom())}</strong></div></div>
                        <div><small>วันที่</small><div><strong>${new Date().toLocaleDateString('th-TH')}</strong></div></div>
                    </div>
                    <div style="text-align:center; padding:14px; background:#f0fff4; border-radius:8px; margin-top:10px;">
                        <small>ยอดชำระ</small>
                        <div style="font-size:1.5rem; font-weight:800; color:var(--primary-green);">฿${Number(total).toLocaleString('th-TH')}</div>
                    </div>
                    <div style="text-align:center; margin-top:10px; color:var(--primary-green); font-size:var(--fs-sm);">✅ ยืนยันโดย SlipOK</div>
                </div>`;
        }
        notifyAdminReceiptGenerated(receipt);
        if (typeof goToPaymentStep === 'function') goToPaymentStep(3);
    } catch(error) {
        console.error('generateReceipt:', error);
        toast('เกิดข้อผิดพลาดในการสร้างใบเสร็จ', 'error');
    }
}

// ---- PRINT / DOWNLOAD RECEIPT ----
function printReceipt() { window.print(); }

// Save ONLY the invoice card (not the page nav / action buttons / chrome)
// as a PNG image — same html2canvas pattern as downloadReceipt(step 3).
async function saveInvoiceImage() {
    let tmp;
    try {
        const src = document.querySelector('#payment-step-1 .receipt-card');
        if (!src) { toast('ไม่พบใบวางบิล', 'error'); return; }
        try { await window.ensureHtml2Canvas(); } catch (e) { toast('โหลดไลบรารีไม่สำเร็จ', 'error'); return; }
        tmp = document.createElement('div');
        tmp.style.cssText = 'position:fixed; left:-9999px; top:0; background:#fff; padding:2rem; width:600px;';
        tmp.innerHTML = src.innerHTML;
        document.body.appendChild(tmp);
        const canvas = await html2canvas(tmp, { backgroundColor:'#ffffff', scale:2, logging:false });
        const link = document.createElement('a');
        const now = new Date();
        const ds = now.toISOString().split('T')[0];
        const ts = now.toTimeString().split(' ')[0].replace(/:/g, '');
        link.href = canvas.toDataURL('image/png');
        link.download = `invoice-${_legacyRoom()}-${ds}-${ts}.png`;
        document.body.appendChild(link); link.click();
        document.body.removeChild(link);
        toast('บันทึกใบวางบิลสำเร็จ', 'success');
    } catch (error) {
        console.error('saveInvoiceImage:', error);
        toast('เกิดข้อผิดพลาดในการบันทึก', 'error');
    } finally {
        if (tmp && tmp.parentNode) document.body.removeChild(tmp);
    }
}

async function downloadReceipt() {
    try {
        const src = document.getElementById('receiptContent') || document.querySelector('#payment-step-3 .receipt-card');
        if (!src) { toast('ไม่พบข้อมูลใบเสร็จ', 'error'); return; }
        try { await window.ensureHtml2Canvas(); } catch (e) { toast('โหลดไลบรารีไม่สำเร็จ', 'error'); return; }
        const tmp = document.createElement('div');
        tmp.style.cssText = 'position:fixed; left:-9999px; background:#fff; padding:2rem; width:600px;';
        tmp.innerHTML = src.innerHTML;
        document.body.appendChild(tmp);
        const canvas = await html2canvas(tmp, { backgroundColor:'#ffffff', scale:2, logging:false });
        const link = document.createElement('a');
        const now = new Date();
        const ds = now.toISOString().split('T')[0];
        const ts = now.toTimeString().split(' ')[0].replace(/:/g, '');
        link.href = canvas.toDataURL('image/png');
        link.download = `receipt-${_legacyRoom()}-${ds}-${ts}.png`;
        document.body.appendChild(link); link.click();
        document.body.removeChild(link); document.body.removeChild(tmp);
        toast('ดาวน์โหลดสำเร็จ', 'success');
    } catch(error) {
        console.error('downloadReceipt:', error);
        toast('เกิดข้อผิดพลาดในการดาวน์โหลด', 'error');
    }
}

async function downloadReceiptForBill(billId, monthName, year) {
    try {
        try { await window.ensureHtml2Canvas(); } catch (e) { toast('โหลดไลบรารีไม่สำเร็จ', 'error'); return; }
        let bill = null;
        for (const y of [2567, 2568, 2569, 2570]) {
            const data = localStorage.getItem(`bills_${y}`);
            if (!data) continue;
            try { const arr = JSON.parse(data); bill = arr.find(b => b.billId === billId); if (bill) break; } catch(e){}
        }
        if (!bill) { toast('ไม่พบข้อมูลบิล: ' + billId, 'error'); return; }
        const tmp = document.createElement('div');
        tmp.style.cssText = 'position:fixed; left:-9999px; background:#fff; padding:2rem; width:600px;';
        tmp.innerHTML = `
            <div style="padding:1rem; background:#fff; border:2px dashed #2d8653;">
                <div style="text-align:center; border-bottom:2px solid #2d8653; padding-bottom:8px;">
                    <h2 style="color:#2d8653; margin:0 0 4px;">ใบเสร็จรับเงิน</h2>
                    <small>Receipt · ${_esc(billId)}</small>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:10px 0;">
                    <div><small style="color:#999;">ห้อง</small><div><strong>${_esc(_legacyRoom())}</strong></div></div>
                    <div><small style="color:#999;">งวด</small><div><strong>${_esc(monthName)} ${_esc(year)}</strong></div></div>
                </div>
                <div style="text-align:center; background:#f0fff4; padding:14px; border-radius:8px;">
                    <small>ยอดชำระ</small>
                    <div style="font-size:1.6rem; font-weight:800; color:#2d8653;">฿${Number(bill.totalCharge||bill.total||0).toLocaleString('th-TH')}</div>
                </div>
                <div style="text-align:center; margin-top:10px; font-size:var(--fs-sm); color:#999;">${_esc(getOwnerName())}</div>
            </div>`;
        document.body.appendChild(tmp);
        const canvas = await html2canvas(tmp, { backgroundColor:'#ffffff', scale:2, logging:false });
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `receipt-${_legacyRoom()}-${billId}-${new Date().toISOString().split('T')[0]}.png`;
        document.body.appendChild(link); link.click();
        document.body.removeChild(link); document.body.removeChild(tmp);
        toast('ดาวน์โหลดสำเร็จ', 'success');
    } catch(error) {
        console.error('downloadReceiptForBill:', error);
        toast('เกิดข้อผิดพลาดในการดาวน์โหลด', 'error');
    }
}

// ---- BILL TEMPLATE ----
async function downloadBillTemplate() {
    try {
        const preview = document.getElementById('billTemplatePreview');
        if (!preview) { toast('ไม่มีเทมเพลทบิล', 'error'); return; }
        try { await window.ensureHtml2Canvas(); } catch (e) { toast('โหลดไลบรารีไม่สำเร็จ', 'error'); return; }
        const tmp = document.createElement('div');
        tmp.style.cssText = 'position:fixed; left:-9999px; background:#fff; padding:2rem; width:800px;';
        tmp.innerHTML = `<div class="ta-preview-wrap">${preview.innerHTML}</div>`;
        document.body.appendChild(tmp);
        const canvas = await html2canvas(tmp, { backgroundColor:'#ffffff', scale:2, logging:false });
        const fileName = getOwnerName().replace(/\s+/g, '-').toLowerCase();
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `bill-template-${fileName}.png`;
        document.body.appendChild(link); link.click();
        document.body.removeChild(link); document.body.removeChild(tmp);
        toast('ดาวน์โหลดเทมเพลทสำเร็จ', 'success');
    } catch(error) {
        console.error('downloadBillTemplate:', error);
        toast('เกิดข้อผิดพลาดในการดาวน์โหลดเทมเพลท', 'error');
    }
}

function updateBillTemplateWithOwnerInfo() {
    const owner = getOwnerName();
    const bld   = getBuildingDisplayName();
    const a = document.getElementById('billTemplateCompanyName');
    const b = document.getElementById('billTemplateBuildingName');
    const c = document.getElementById('billTemplateFooterCompany');
    if (a) a.textContent = owner;
    if (b) b.textContent = bld;
    if (c) c.textContent = owner;
}

// ---- PHOTO MODAL ----
function openPhotoModal(beforePhoto, afterPhoto) {
    const modal = document.getElementById('photoModal');
    const photos = document.getElementById('photoModalPhotos');
    if (!modal || !photos) return;
    photos.textContent = '';
    const mk = (label, src) => {
        const wrap = document.createElement('div');
        wrap.className = 'photo-modal-item';
        wrap.style.cssText = 'margin-bottom:12px; text-align:center;';
        const lab = document.createElement('div');
        lab.textContent = label;
        lab.style.cssText = 'font-weight:700; margin-bottom:6px; color:var(--primary-green);';
        const img = document.createElement('img');
        img.src = src; // src is base64 from FileReader, not user input HTML — safe
        img.alt = label;
        img.style.cssText = 'max-width:100%; border-radius:10px; border:1px solid #eee;';
        wrap.appendChild(lab); wrap.appendChild(img);
        photos.appendChild(wrap);
    };
    if (beforePhoto) mk('ก่อนซ่อม (Before)', beforePhoto);
    if (afterPhoto)  mk('หลังซ่อม (After)',  afterPhoto);
    modal.classList.add('active');
    modal.style.display = 'flex';
}
function closePhotoModal() {
    const modal = document.getElementById('photoModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.style.display = 'none';
}

// ---- PHOTO COMPRESSION + UPLOAD ----
async function _compressImage(base64Data, maxW=1280, maxH=1280, q=0.75) {
    return new Promise(resolve => {
        try {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxW || h > maxH) {
                    const r = Math.min(maxW/w, maxH/h);
                    w = Math.round(w*r); h = Math.round(h*r);
                }
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(cv.toDataURL('image/jpeg', q));
            };
            img.onerror = () => resolve(base64Data);
            img.src = base64Data;
        } catch(e) { resolve(base64Data); }
    });
}
async function uploadPhotoToStorage(base64Data, ticketId) {
    // Firebase Storage disabled (CORS) — store compressed Base64 instead
    if (!base64Data) return null;
    try { return await _compressImage(base64Data, 1280, 1280, 0.75); }
    catch(e) { console.warn('uploadPhotoToStorage:', e); return base64Data; }
}

// ---- LEASE AGREEMENT VIEW / DOWNLOAD ----
// Prefers getLeaseDocUrl CF (PDPA-friendly 1-h signed URL). Falls back to
// direct Firebase Storage getDownloadURL — storage.rules /leases/* already
// grants tenant read when token.room+token.building match the path, so the
// direct path works for the same user the CF would have authorised.
// Losing the short-TTL on fallback is acceptable: viewer is preserved.
async function _getLeaseSignedUrl() {
    const path = window.currentContractDocument;
    if (!path) return null;
    // Legacy: base64 data URL or external https URL — use directly, no resolve needed.
    if (typeof path !== 'string') return null;
    if (path.startsWith('data:') || /^https?:\/\//i.test(path)) return path;
    if (!path.startsWith('leases/')) return path;

    // Helper — invoke the callable once.
    const _callCF = async () => {
        const fn = window.firebase.functions.httpsCallable('getLeaseDocUrl');
        const result = await fn({ path });
        return result?.data?.url || null;
    };

    // Attempt 1: CF with current cached ID token.
    let cfErr;
    try {
        const url = await _callCF();
        if (url) return url;
        console.warn('[LeaseDoc] getLeaseDocUrl returned no url for', path);
    } catch (err) {
        cfErr = err;
    }

    // Attempt 2: force-refresh ID token (in case claims were re-issued
    // server-side after the cached token was minted), then retry CF.
    // The CF's Path 2 (linkedAuthUid match) doesn't depend on claims, so
    // this retry mainly helps when persistent claims got written between
    // the first and second call. Cheap insurance against §7-Z races.
    if (cfErr) {
        try {
            const u = window.firebaseAuth?.currentUser;
            if (u) await u.getIdToken(true);
            const url = await _callCF();
            if (url) return url;
        } catch (err2) {
            cfErr = err2;
        }
    }

    // CF still failing — dump diagnostic to console for ops.
    if (cfErr) {
        try {
            const u = window.firebaseAuth?.currentUser;
            const tr = u ? await u.getIdTokenResult(false) : null;
            const c = tr?.claims || {};
            console.error('[LeaseDoc] getLeaseDocUrl error for', path,
              '—', cfErr?.code || cfErr?.name, cfErr?.message,
              '· uid=' + (u?.uid?.slice(0,12) || 'none'),
              '· claims:', { room: c.room || null, building: c.building || null, admin: !!c.admin, role: c.role || null, tenantId: c.tenantId || null });
        } catch (_) {
            console.error('[LeaseDoc] getLeaseDocUrl error for', path, '—', cfErr?.code || cfErr?.name, cfErr?.message);
        }

        // Auto-recovery — if the session has a stale shape (non-line:/non-book:
        // UID + no useful claims) and we haven't tried it yet this LIFF session,
        // force signOut + reload to trigger a fresh liffSignIn handshake. This
        // typically fixes the case where a prior login.html / admin session is
        // still cached in the LINE in-app browser and `_callLiffSignIn`'s
        // signOut→signInWithCustomToken didn't replace it cleanly.
        try {
            const u = window.firebaseAuth?.currentUser;
            const tr = u ? await u.getIdTokenResult(false) : null;
            const c = tr?.claims || {};
            const uid = u?.uid || '';
            const isStaleSession = uid
                && !uid.startsWith('line:')
                && !uid.startsWith('book:')
                && c.admin !== true
                && c.role !== 'player'
                && cfErr?.code === 'functions/permission-denied';
            const alreadyRecovered = sessionStorage.getItem('_leaseDocRecoveryTried') === '1';
            if (isStaleSession && !alreadyRecovered && typeof liff !== 'undefined' && liff?.isInClient?.()) {
                sessionStorage.setItem('_leaseDocRecoveryTried', '1');
                toast('🔄 รีเฟรชสิทธิ์...', 'info');
                try { await window.firebaseAuth.signOut(); } catch(_) {}
                // Clear room cache so liffSignIn POST goes through cleanly.
                try { localStorage.removeItem('tenant_app_room'); } catch(_) {}
                try { sessionStorage.removeItem('user'); } catch(_) {}
                // Small delay so user sees the toast, then reload — fresh page
                // load re-runs initLiffAndLink → _callLiffSignIn → custom token.
                setTimeout(() => window.location.reload(), 800);
                return null;
            }
        } catch (_) {}
    }

    // Fallback: direct getDownloadURL (rules-gated, same auth subject).
    // Mainly useful for admin-claim users; tenants without room/building
    // claims will hit storage/unauthorized here too — but that's still a
    // meaningful surface compared to swallowing the error silently.
    try {
        const storage = window.firebase.storage();
        const { ref: sRef, getDownloadURL: sGetDownloadURL } = window.firebase.storageFunctions;
        return await sGetDownloadURL(sRef(storage, path));
    } catch (err3) {
        console.error('[LeaseDoc] getDownloadURL fallback failed for', path, '—', err3?.code || err3?.name, err3?.message);
        // Prefer the CF error code + message (more actionable — the CF
        // surfaces exactly which auth gate failed) over storage's
        // generic "unauthorized". CF message contains shape-only
        // diagnostic (e.g. "linkedAuthUid=empty, caller.uid=line:") so
        // sharing the toast screenshot tells us the failure mode.
        const cfCode = cfErr?.code || cfErr?.name;
        const cfMsg = cfErr?.message || '';
        const friendlyHint = cfCode === 'functions/permission-denied'
            ? ' (กรุณาปิด LINE จาก app switcher แล้วเปิดใหม่)'
            : '';
        const detail = cfMsg && cfMsg.length < 200 ? ' — ' + cfMsg : '';
        toast('ไม่สามารถเปิดเอกสาร: ' + (cfCode || err3?.code || err3?.message || 'unknown') + detail + friendlyHint, 'error');
        return null;
    }
}
async function viewLeaseAgreement() {
    if (!window.currentContractDocument) { toast('ยังไม่มีเอกสารสัญญาเช่า', 'warning'); return; }
    const previewEl = document.getElementById('lease-doc-preview');
    const contentEl = document.getElementById('lease-doc-preview-content');
    previewEl.style.display = 'block';
    contentEl.innerHTML = '<div class="ta-loading-state"><i class="fas fa-spinner fa-spin ta-spinner-icon"></i><br><span style="font-size:var(--fs-sm);">กำลังโหลด…</span></div>';
    previewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const url = await _getLeaseSignedUrl();
    if (!url) { previewEl.style.display = 'none'; return; }
    const origPath = window.currentContractDocument || '';
    // data:image/... → image; otherwise strip query-params then test extension
    const isImage = origPath.startsWith('data:image/')
        || /\.(jpg|jpeg|png|gif|webp)$/i.test(origPath.split('?')[0]);
    if (isImage) {
        contentEl.innerHTML = '';
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'เอกสารสัญญา';
        img.style.cssText = 'width:100%;border-radius:12px;display:block;';
        img.onerror = () => { contentEl.innerHTML = '<p class="ta-err-danger">โหลดเอกสารไม่ได้ กรุณาลองใหม่</p>'; };
        contentEl.appendChild(img);
    } else {
        // PDF — open externally (LINE WebView cannot render PDFs inline)
        previewEl.style.display = 'none';
        if (window.liff?.openWindow) window.liff.openWindow({ url, external: true });
        else window.open(url, '_blank', 'noopener');
    }
}

// B2: enhance all accordion header divs with role/tabindex/aria-expanded + keyboard
(function enhanceAccordions() {
    function apply() {
        document.querySelectorAll('[data-action="toggleAccordion"]').forEach(function(el) {
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
            if (!el.getAttribute('role')) el.setAttribute('role', 'button');
            if (!el.hasAttribute('aria-expanded')) el.setAttribute('aria-expanded', 'false');
            el.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAccordion(el); }
            });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
})();

// expose key ones to window for inline onclick reliability
window.toggleAccordion = toggleAccordion;
window.makeCall = makeCall;
window.scrollToEmergencyContacts = scrollToEmergencyContacts;
window.openPhotoModal = openPhotoModal;
window.closePhotoModal = closePhotoModal;
window.viewBillReceipt = viewBillReceipt;
window.generateReceiptForBill = generateReceiptForBill;
window.downloadReceipt = downloadReceipt;
window.downloadReceiptForBill = downloadReceiptForBill;
window.printReceipt = printReceipt;
window.saveInvoiceImage = saveInvoiceImage;
window.viewLeaseAgreement = viewLeaseAgreement;
window.downloadBillTemplate = downloadBillTemplate;
window.uploadPhotoToStorage = uploadPhotoToStorage;
window.generateReceipt = generateReceipt;
window.notifyAdminPaymentVerified = notifyAdminPaymentVerified;
window.notifyAdminReceiptGenerated = notifyAdminReceiptGenerated;
window.updateBillTemplateWithOwnerInfo = updateBillTemplateWithOwnerInfo;
window.displayBuildingInternetStatus = displayBuildingInternetStatus;
window.displayRoomInternetStatus = displayRoomInternetStatus;
window.displayLeaseRenewalAlert = displayLeaseRenewalAlert;
window.displayServiceProviders = displayServiceProviders;
window.displayDocuments = displayDocuments;
window._subscribeCommunityDocuments = _subscribeCommunityDocuments;
window._subscribePolicies = _subscribePolicies;

    // Bell panel — lease-alert row click handler
// Click handler for the lease-alert row in the 🔔 bell panel. Wired via
// data-action="openLeaseAlertFromBell" + data-notif-id; catch-all dispatcher
// at the top of this file passes (el, event). Closes the bell, navigates to
// the renewal subpage, marks all unread lease notifs as read (fire-and-forget).
window.openLeaseAlertFromBell = function(el /*, event */) {
    try {
        if (typeof window.closeBroadcastsPanel === 'function') {
            window.closeBroadcastsPanel();
        }
        if (typeof showSubPage === 'function') {
            showSubPage('contract-action-page');
        }
        if (window.firebase?.firestoreFunctions && Array.isArray(window._taLeaseNotifs)) {
            const fs = window.firebase.firestoreFunctions;
            const db = window.firebase.firestore();
            window._taLeaseNotifs
                .filter(d => d.status !== 'read' && d.status !== 'stale')
                .forEach(d => {
                    const ref = fs.doc(db, 'leaseNotifications', d.id);
                    fs.setDoc(ref, {
                        status: 'read',
                        lastReadAt: fs.serverTimestamp()
                    }, { merge: true }).catch(e =>
                        console.warn('[leaseNotifs] mark read failed:', d.id, e?.message)
                    );
                });
        }
    } catch (e) { console.warn('openLeaseAlertFromBell:', e); }
};

})();
