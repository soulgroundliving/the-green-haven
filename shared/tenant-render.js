// shared/tenant-render.js
// Render functions (home, bills, profile, pets, contract, nav-badges) + payment flow.
// Extracted from tenant_app.html god-file.
//
// Requires (globals):
//   var _taBills, _taPayments, _taCurrentBill — var globals in inline script (§7-CC: var = window.*)
//   _isBillPaid                               — function decl in inline script (window.*)
//   _taTenant, _taLease, _taRoom, _taBuilding — var globals from tenant-liff-auth.js
//   var _slipBase64                           — var global in inline script
//   var userPoints                            — var global in inline script
//   window.YearUtils, window.BillStore        — shared utilities
//   window.GhEmptyState                       — empty-state helper
//   getOwnerName, getCompanyName              — function decls in inline (ported-legacy section)
//   window._receiptTypeKey                    — from tenant-profile-ui.js
//   window.buildPromptPayPayload              — from tenant-slip-verify.js
//   window.ensureQRCode                       — QR code loader
//   window.showPage, window.showBillsSkeleton — function decls / exports
//   window.setupContractQuizGate              — from tenant-quiz.js
//   window._renderUsageChart                  — from tenant-usage-chart.js
//   window.getMaintenanceTickets              — from tenant-maintenance.js
//   window._syncEmailVerified                 — from tenant-profile-edit.js
//
// Exports (window.*):
//   renderHomePage, showBillsSkeleton, renderBillsList,
//   renderProfilePage, renderPetList, renderContractPage, updateNavBadges,
//   openPaymentFlow, goToPaymentStep, renderPaymentInvoice, renderPaymentReceipt

'use strict';
(function () {
    const THAI_MONTHS_SHORT = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const THAI_MONTHS_FULL  = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

    // ── Home ─────────────────────────────────────────────────────────────────
    function renderHomePage() {
        const nameEl = document.getElementById('user-greeting');
        if (nameEl && _taTenant) {
            const name = _taTenant.name || _taTenant.tenantName || '';
            if (name) nameEl.textContent = `สวัสดีครับ คุณ${name}`;
        }
    }

    // ── Bills ────────────────────────────────────────────────────────────────
    function showBillsSkeleton() {
        if (_taBills && _taBills.length > 0) return;
        const section = document.getElementById('bills-history-section');
        const list    = document.getElementById('bills-history-list');
        const amt     = document.getElementById('current-bill-amount');
        const label   = document.getElementById('bill-label');
        if (section) section.classList.remove('ta-sect-hidden');
        if (list && !list.children.length) {
            list.innerHTML =
                '<div class="gh-skeleton gh-skeleton--card ta-my-10"></div>' +
                '<div class="gh-skeleton gh-skeleton--card ta-my-10"></div>' +
                '<div class="gh-skeleton gh-skeleton--card ta-my-10"></div>';
        }
        if (amt)   amt.textContent = '฿ —';
        if (label) label.innerHTML = '<span class="gh-skeleton gh-skeleton--text gh-skeleton--text-half" style="display:inline-block;height:1em;"></span>';
    }

    function renderBillsList() {
        const el      = document.getElementById('bills-history-list');
        const section = document.getElementById('bills-history-section');
        const badge   = document.getElementById('usage-room-badge');
        if (badge) {
            if (_taRoom) { badge.textContent = _taRoom; badge.style.display = 'flex'; }
            else { badge.style.display = 'none'; }
        }
        if (!el) return;
        if (!_taBills.length) {
            if (section) section.classList.remove('ta-sect-hidden');
            if (window.GhEmptyState) {
                el.innerHTML = window.GhEmptyState.html('bills', {
                    title: 'ยังไม่มีบิล',
                    text: 'เมื่อมีบิลใหม่จะแสดงที่นี่ — รออดมินส่งให้',
                });
            } else {
                el.innerHTML = '<div class="gh-empty-state">' +
                    '<div class="gh-empty-state__illust">' +
                    '<svg viewBox="0 0 120 120" aria-hidden="true">' +
                    '<path d="M30 22 h60 v76 l-12-8 -12 8 -12-8 -12 8 -12-8z"/>' +
                    '<path d="M42 42 h36 M42 56 h36 M42 70 h22"/>' +
                    '<circle cx="78" cy="70" r="9"/>' +
                    '<path d="M73 70 l4 4 6-7"/>' +
                    '</svg></div>' +
                    '<p class="gh-empty-state__title">ยังไม่มีบิล</p>' +
                    '<p class="gh-empty-state__text">เมื่อมีบิลใหม่จะแสดงที่นี่</p>' +
                    '</div>';
            }
            const amtEl = document.getElementById('current-bill-amount');
            if (amtEl) amtEl.textContent = '฿ —';
            const labelEl = document.getElementById('bill-label');
            if (labelEl) labelEl.textContent = 'ยังไม่มีบิล';
            return;
        }
        if (section) section.classList.remove('ta-sect-hidden');
        const _isPaid = _isBillPaid;
        const latest = _taBills[0];
        _taCurrentBill = latest; window._taCurrentBill = _taCurrentBill;
        const amtEl = document.getElementById('current-bill-amount');
        if (amtEl && latest) {
            const total = Number(latest.totalAmount || latest.total || latest.totalCharge || latest.rentAmount) || 0;
            amtEl.textContent = `฿ ${Number(total).toLocaleString('th-TH',{minimumFractionDigits:2})}`;
        }
        const latestPaid = _isPaid(latest);
        const labelEl = document.getElementById('bill-label');
        if (labelEl && latest) {
            const mName = THAI_MONTHS_SHORT[latest.month] || '';
            const yBE = latest.year ? ` ${window.YearUtils.toBE(latest.year) || latest.year}` : '';
            const suffix = mName ? ` ประจำเดือน ${mName}${yBE}` : '';
            labelEl.textContent = (latestPaid ? 'ยอดที่ชำระ' : 'ยอดที่ต้องชำระ') + suffix;
        }
        const dueBadge = document.getElementById('service-due-badge');
        if (dueBadge && latest) {
            if (latestPaid) {
                dueBadge.style.cssText = 'font-size:var(--fs-sm);background:#D1FAE5;color:#065F46;padding:4px 10px;border-radius:20px;';
                dueBadge.innerHTML = '<i class="fas fa-check"></i> ชำระแล้ว';
            } else if (latest.status === 'overdue') {
                dueBadge.style.cssText = 'font-size:var(--fs-sm);background:#FEE2E2;color:#991B1B;padding:4px 10px;border-radius:20px;';
                dueBadge.innerHTML = '<i class="fas fa-exclamation-circle"></i> เกินกำหนด';
            } else {
                dueBadge.style.cssText = 'font-size:var(--fs-sm);background:#FFF4E5;color:#D97706;padding:4px 10px;border-radius:20px;';
                dueBadge.innerHTML = '<i class="fas fa-clock"></i> รอชำระ';
            }
        }
        const payBtn = document.getElementById('service-pay-btn');
        if (payBtn && latest) {
            const bId = latest.id || latest.billId || '';
            if (latestPaid) {
                payBtn.textContent = 'ดูใบเสร็จ';
                payBtn.onclick = () => openPaymentFlow(true, bId);
            } else {
                payBtn.textContent = 'ชำระบิล';
                payBtn.onclick = () => openPaymentFlow(false, bId);
            }
        }
        const validBills = _taBills.filter(b => {
            const t = Number(b.totalAmount || b.total || b.totalCharge || b.rentAmount) || 0;
            const hasCharges = b.charges && (b.charges.rent || b.charges.electric?.cost || b.charges.water?.cost);
            const hasMeter = b.meterReadings?.electric?.new || b.meterReadings?.water?.new;
            if (t > 0) return true;
            if (hasCharges) return true;
            if (hasMeter) return true;
            return false;
        });
        if (!validBills.length) {
            if (window.GhEmptyState) {
                el.innerHTML = window.GhEmptyState.html('bills', {
                    title: 'ยังไม่มีบิล',
                    text: 'เมื่อมีบิลใหม่จะแสดงที่นี่',
                });
            }
            return;
        }
        el.innerHTML = validBills.slice(0,12).map(b => {
            const m = THAI_MONTHS_SHORT[b.month] || b.month || '?';
            const yr = window.YearUtils.toBE(b.year) || '?';
            const total = Number(b.totalAmount || b.total || b.totalCharge || b.rentAmount) || 0;
            const paid = window.BillStore?.isPaid?.(b) ?? (b.status === 'paid');
            const bId = b.id || b.billId || '';
            const isCashLegacy = paid && b.method === 'cash_legacy';
            const pillBase = 'margin-left:8px;font-size:var(--fs-sm);padding:2px 8px;border-radius:10px;white-space:nowrap;display:inline-block;';
            const statusPill = isCashLegacy
                ? `<span style="${pillBase}background:#F3F4F6;color:#4B5563">✓ จ่ายแล้ว (เงินสด)</span>`
                : paid
                    ? `<span style="${pillBase}background:#D1FAE5;color:#065F46">✓ จ่ายแล้ว</span>`
                    : `<span style="${pillBase}background:#FFF4E5;color:#D97706">รอชำระ</span>`;
            const actionBtn = paid
                ? `<button data-action="openPaymentFlow" data-arg="true" data-bid="${bId}" style="background:none;border:1px solid var(--primary-green);color:var(--primary-green);padding:5px 12px;border-radius:10px;font-size:var(--fs-sm);cursor:pointer;">ใบเสร็จ</button>`
                : `<button data-action="openPaymentFlow" data-arg="false" data-bid="${bId}" style="background:var(--primary-green);color:white;border:none;padding:5px 12px;border-radius:10px;font-size:var(--fs-sm);cursor:pointer;">จ่ายเลย</button>`;
            return `<div style="padding:16px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #f3f3f3;">
                    <div>
                        <span style="font-size:var(--fs-md);font-weight:600;">${m} ${yr}</span>
                        ${statusPill}
                        <p style="font-size:var(--fs-sm);color:#888;margin:3px 0 0;">฿${Number(total).toLocaleString()}</p>
                    </div>
                    ${actionBtn}
                </div>`;
        }).join('');
        if (typeof _renderUsageChart === 'function') _renderUsageChart();
    }

    // ── Profile ───────────────────────────────────────────────────────────────
    function renderProfilePage() {
        const set = (id, val) => { const el = document.getElementById(id); if (el && val != null && val !== '') el.textContent = val; };

        if (window._isPlayerMode && window._playerProfile) {
            const p = window._playerProfile;
            set('profile-fullname', p.name || '—');
            set('profile-phone',    p.phone || '—');
            ['display-name', 'display-name-map'].forEach(id => {
                const el = document.getElementById(id);
                if (el && p.name) el.textContent = `คุณ${p.name}`;
            });
            return;
        }

        if (_taTenant) {
            const name = _taTenant.name || _taTenant.tenantName || '';
            if (name) {
                ['display-name', 'display-name-map'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = `คุณ${name}`;
                });
            }
        }
        const t = _taTenant || {};
        set('profile-fullname', t.name || t.tenantName || t.fullName);
        set('profile-phone',    t.phone || t.tel || t.mobile);
        const _emailEl = document.getElementById('profile-email');
        const _badgeEl = document.getElementById('profile-email-badge');
        if (_emailEl) _emailEl.textContent = t.email || '—';
        if (_badgeEl) {
            const _authVerified = window.firebaseAuth?.currentUser?.emailVerified;
            const _isVerified = t.emailVerified || _authVerified;
            _badgeEl.textContent = t.email ? (_isVerified ? '✅' : '⚠️ ยังไม่ยืนยัน') : '';
            if (t.email && _authVerified && !t.emailVerified) {
                if (typeof _syncEmailVerified === 'function') _syncEmailVerified();
            }
        }
        set('profile-license', t.licensePlate || t.license || t.carPlate);

        const l = _taLease || {};
        const startRaw = l.startDate || l.moveInDate;
        const endRaw   = l.endDate   || l.moveOutDate;
        const fmt = d => { try { return new Date(d).toLocaleDateString('th-TH',{year:'numeric',month:'short',day:'numeric'}); } catch(e){ return ''; } };
        if (startRaw) set('profile-lease-start', fmt(startRaw));
        if (endRaw)   set('profile-lease-end',   fmt(endRaw));
        if (endRaw) {
            const diffMs = new Date(endRaw).getTime() - Date.now();
            if (!isNaN(diffMs) && diffMs > 0) {
                const totalDays = Math.floor(diffMs / 86400000);
                const months = Math.floor(totalDays / 30);
                const days = totalDays % 30;
                set('profile-lease-remaining', `${months} เดือน ${days} วัน`);
            } else if (!isNaN(diffMs)) {
                set('profile-lease-remaining', 'หมดอายุแล้ว');
            }
        }
        const rent = l.rentAmount || l.rent || l.monthlyRent;
        if (rent) {
            set('profile-rent', Number(rent).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' บาท');
        }
        const deposit = l.deposit || l.depositAmount;
        if (deposit) {
            set('profile-deposit', Number(deposit).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' บาท');
            const badge = document.getElementById('profile-deposit-badge');
            if (badge) {
                const isReturned = (l.depositStatus === 'returned') || (t && t.depositStatus === 'returned');
                // Installment (Slice B): paidSoFar mirrored to the tenant doc; absent = fully paid (§7-L).
                const paidSoFar = (t && t.depositPaidSoFar != null) ? Number(t.depositPaidSoFar) : Number(deposit);
                const depDue = Math.max(0, Number(deposit) - (Number.isFinite(paidSoFar) ? paidSoFar : Number(deposit)));
                badge.classList.remove('ta-sect-hidden');
                badge.innerHTML = isReturned
                    ? '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;">✅ คืนแล้ว</span>'
                    : (depDue > 0
                        ? `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;">ค้างมัดจำ ฿${depDue.toLocaleString()}</span>`
                        : '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;">💰 ถือมัดจำ</span>');
            }
        }
        const roomEl = document.getElementById('profile-room-display');
        if (roomEl && _taRoom) {
            roomEl.textContent = `ห้อง ${_taRoom} | ${_taBuilding === 'nest' ? 'ตึก Nest' : 'ตึก Rooms'}`;
        }
        const skLabel = document.getElementById('smart-key-room-label');
        if (skLabel && _taRoom) skLabel.textContent = `ห้อง ${_taRoom}`;
        const ptEl = document.getElementById('user-total-points');
        if (ptEl) {
            // Server-authoritative: window.userPoints (Firestore gamification.points
            // via _subscribeEcoPoints), room-scoped localStorage only as the
            // pre-snapshot paint. A real 0 is valid — never fall through to the
            // generic key (could show another room's stale value) or synthesize.
            const pts = (typeof window.userPoints === 'number')
                ? window.userPoints
                : (parseInt(localStorage.getItem(`tenant_eco_points_${_taBuilding}_${_taRoom}`), 10) || 0);
            ptEl.textContent = Number(pts).toLocaleString();
        }
    }

    // ── Pet list (localStorage-backed quick render, tenant-pets.js owns Firestore sub) ──
    function renderPetList() {
        const el = document.getElementById('pet-list-container');
        if (!el) return;
        let pets = [];
        try { pets = JSON.parse(localStorage.getItem(`tenant_pets_${_taBuilding}_${_taRoom}`) || '[]'); } catch (e) {}
        if (!pets.length) {
            try { pets = JSON.parse(localStorage.getItem(`tenant_pets_${_taRoom}`) || '[]'); } catch (e) {}
        }
        if (!pets.length) {
            el.innerHTML = `<div data-action="showSubPage" data-page="add-pet-page" class="ta-add-cta">
                    <div style="font-size:var(--fs-lg);margin-bottom:10px;opacity:0.5;">🐾</div>
                    <p style="font-size:var(--fs-md);color:#888;font-weight:500;">ยังไม่มีข้อมูลเพื่อนตัวป่วน</p>
                    <p style="font-size:var(--fs-sm);color:var(--primary-green);font-weight:600;margin-top:5px;">+ เพิ่มสัตว์เลี้ยงของคุณ</p>
                </div>`;
            return;
        }
        const emojiMap = {dog:'🐕',cat:'🐈',rabbit:'🐇',bird:'🐦',fish:'🐠',hamster:'🐹',other:'🐾'};
        el.innerHTML = pets.map(p => {
            const emoji = emojiMap[p.type||p.petType] || '🐾';
            return `<div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                    <div class="u-fs-lg">${emoji}</div>
                    <div><strong class="u-fs-md">${p.name||p.petName||'สัตว์เลี้ยง'}</strong>
                    <p style="font-size:var(--fs-sm);color:#888;margin:2px 0 0;">${p.breed||p.petBreed||''}</p></div>
                </div>`;
        }).join('');
    }

    // ── Contract ─────────────────────────────────────────────────────────────
    function renderContractPage() {
        if (!_taRoom) return;
        const titleEl = document.getElementById('contract-room-title');
        if (titleEl) titleEl.textContent = `สัญญาห้อง ${_taRoom}`;
        if (_taLease) {
            const endEl = document.getElementById('contract-end-date');
            if (endEl) {
                const raw = _taLease.endDate || _taLease.moveOutDate;
                if (raw) {
                    try {
                        const d = new Date(raw);
                        endEl.textContent = d.toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'});
                    } catch (e) { endEl.textContent = raw; }
                }
            }
        }
        const contractPath = _taLease?.contractPath || null;
        window.currentContractDocument = contractPath || _taLease?.contractDocument || null;
        const docBtns = document.getElementById('lease-doc-btns');
        if (docBtns) docBtns.style.display = window.currentContractDocument ? 'flex' : 'none';
        if (typeof setupContractQuizGate === 'function') setupContractQuizGate();
    }

    // ── Nav badges ────────────────────────────────────────────────────────────
    function updateNavBadges() {
        const _isPaid = _isBillPaid;
        const latestBill = _taBills[0];
        const billBadge = document.getElementById('nav-badge-bills');
        if (billBadge) {
            billBadge.style.display = (latestBill && !_isPaid(latestBill)) ? 'block' : 'none';
        }
        const tickets = (typeof getMaintenanceTickets === 'function') ? getMaintenanceTickets() : [];
        const pendingTix = tickets.filter(t => t.status === 'pending' || t.status === 'inprogress').length;
        const svcBadge = document.getElementById('nav-badge-services');
        if (svcBadge) {
            svcBadge.textContent = pendingTix > 9 ? '9+' : pendingTix;
            svcBadge.style.display = pendingTix > 0 ? 'flex' : 'none';
        }
        if (typeof window._renderBellVisibility === 'function') window._renderBellVisibility();
    }

    // ── Payment flow ──────────────────────────────────────────────────────────
    let _payIsReceipt = false;

    function openPaymentFlow(isReceipt, billId) {
        _payIsReceipt = isReceipt;
        if (billId) {
            const found = _taBills.find(b => (b.id||b.billId) === billId);
            if (found) { _taCurrentBill = found; window._taCurrentBill = _taCurrentBill; }
        } else if (!_taCurrentBill) {
            const _isPaid = _isBillPaid;
            _taCurrentBill = _taBills.find(b => !_isPaid(b)) || _taBills[0] || null;
            window._taCurrentBill = _taCurrentBill;
        }
        if (!isReceipt && _taCurrentBill?.status === 'paid') {
            isReceipt = true;
            _payIsReceipt = true;
        }
        showPage('payment-page');
        _slipBase64 = null;
        if (isReceipt) {
            goToPaymentStep(3);
            renderPaymentReceipt(_taCurrentBill);
        } else {
            goToPaymentStep(1);
            renderPaymentInvoice(_taCurrentBill);
        }
    }

    function goToPaymentStep(n) {
        [1,2,3].forEach(i => {
            const s = document.getElementById(`payment-step-${i}`);
            if (s) s.classList.toggle('ta-sect-hidden', i !== n);
            const stepEl = document.getElementById(`step-${i}`);
            if (stepEl) {
                stepEl.classList.toggle('active', i === n);
                stepEl.classList.toggle('completed', i < n);
            }
        });
    }

    async function renderPaymentInvoice(bill) {
        if (!bill) return;
        const mFull = THAI_MONTHS_FULL[bill.month] || bill.month || '?';
        const yr = bill.year ? (window.YearUtils.toBE(bill.year) || '?') : '?';
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('inv-bill-no', bill.billId || bill.id || '—');
        set('inv-room', `ห้อง ${_taRoom || '—'}`);
        set('inv-period', `${mFull} ${yr}`);
        const issueDate = bill.billDate || (bill.createdAt ? new Date(bill.createdAt).toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}) : new Date().toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}));
        set('inv-date', issueDate);
        const dueDate = `5 ${THAI_MONTHS_FULL[bill.month === 12 ? 1 : bill.month + 1] || '?'} ${bill.month === 12 ? yr + 1 : yr}`;
        set('inv-due-date', dueDate);
        const items = document.getElementById('inv-items');
        if (items) {
            const rent   = Number(bill.charges?.rent)         || Number(bill.rentAmount||bill.rent)               || 0;
            const elecC  = Number(bill.charges?.electric?.cost) || Number(bill.electricityAmount||bill.electricity) || 0;
            const waterC = Number(bill.charges?.water?.cost)    || Number(bill.waterAmount||bill.water)             || 0;
            const trash  = Number(bill.charges?.trash)          || Number(bill.trashAmount||bill.trash)             || 0;
            const eOld = bill.charges?.electric?.old ?? bill.meterReadings?.electric?.old;
            const eNew = bill.charges?.electric?.new ?? bill.meterReadings?.electric?.new;
            const eU   = bill.charges?.electric?.units ?? bill.meterReadings?.electric?.units;
            const eR   = bill.charges?.electric?.rate  ?? 8;
            const wOld = bill.charges?.water?.old ?? bill.meterReadings?.water?.old;
            const wNew = bill.charges?.water?.new ?? bill.meterReadings?.water?.new;
            const wU   = bill.charges?.water?.units ?? bill.meterReadings?.water?.units;
            const wR   = bill.charges?.water?.rate  ?? 20;
            const row = (label, amount, subline) => `
                    <div class="ta-row-split-5">
                        <span>${label}</span><strong>฿${Number(amount).toLocaleString()}</strong>
                    </div>${subline ? `<div class="ta-tag-label">${subline}</div>` : ''}`;
            items.innerHTML = [
                rent  ? row('ค่าเช่าห้อง',  rent)  : '',
                elecC !== null ? row('ค่าไฟฟ้า',   elecC,  (eOld!=null&&eNew!=null) ? `มิเตอร์ไฟ: ${eOld} → ${eNew} (${eU||0} หน่วย × ฿${eR})` : '') : '',
                waterC!== null ? row('ค่าน้ำประปา', waterC, (wOld!=null&&wNew!=null) ? `มิเตอร์น้ำ: ${wOld} → ${wNew} (${wU||0} หน่วย × ฿${wR})` : '') : '',
                trash ? row('ค่าขยะ',       trash) : ''
            ].join('');
        }
        const total = Number(bill.totalAmount||bill.total||bill.totalCharge) || 0;
        set('inv-total', `฿${total.toLocaleString()}`);
        set('inv-qr-amount', `฿${total.toLocaleString()}`);
        const phone = localStorage.getItem('promptpay') || '';
        set('inv-promptpay', phone || '—');
        const qrBox = document.getElementById('pay-qr-canvas');
        if (qrBox) {
            qrBox.innerHTML = '';
            if (phone && total) {
                try {
                    await window.ensureQRCode();
                    new QRCode(qrBox, { text: buildPromptPayPayload(phone, total), width:180, height:180, correctLevel: QRCode.CorrectLevel.M });
                } catch (e) { qrBox.innerHTML = '<p class="ta-lighter-sm">ไม่สามารถสร้าง QR ได้</p>'; }
            } else {
                qrBox.innerHTML = '<p class="ta-lighter-sm">ไม่มีข้อมูล PromptPay</p>';
            }
        }
    }

    function renderPaymentReceipt(bill) {
        if (!bill) return;
        const mFull = THAI_MONTHS_FULL[bill.month] || bill.month || '?';
        const yr = bill.year ? (window.YearUtils.toBE(bill.year) || '?') : '?';
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        // Gapless RCP- receipt number (Roadmap 1.2a) when present (slip via verifySlip,
        // cash via assignReceiptNumber); falls back to the bill id for un-numbered legacy receipts.
        set('rcpt-bill-no', bill.receiptNo || bill.billId || bill.id || '—');
        set('rcpt-room',    `ห้อง ${_taRoom || '—'}`);
        set('rcpt-period',  `${mFull} ${yr}`);
        const paidAt = bill.paidAt
            ? new Date(bill.paidAt).toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'})
            : new Date().toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});
        set('rcpt-paid-date', paidAt);
        const items = document.getElementById('rcpt-items');
        if (items) {
            const rent   = Number(bill.charges?.rent)           || Number(bill.rentAmount||bill.rent)               || 0;
            const elecC  = Number(bill.charges?.electric?.cost)  || Number(bill.electricityAmount||bill.electricity) || 0;
            const waterC = Number(bill.charges?.water?.cost)     || Number(bill.waterAmount||bill.water)             || 0;
            const trash  = Number(bill.charges?.trash)           || Number(bill.trashAmount||bill.trash)             || 0;
            const eOld = bill.charges?.electric?.old ?? bill.meterReadings?.electric?.old;
            const eNew = bill.charges?.electric?.new ?? bill.meterReadings?.electric?.new;
            const eU   = bill.charges?.electric?.units ?? bill.meterReadings?.electric?.units;
            const eR   = bill.charges?.electric?.rate  ?? 8;
            const wOld = bill.charges?.water?.old ?? bill.meterReadings?.water?.old;
            const wNew = bill.charges?.water?.new ?? bill.meterReadings?.water?.new;
            const wU   = bill.charges?.water?.units ?? bill.meterReadings?.water?.units;
            const wR   = bill.charges?.water?.rate  ?? 20;
            const row = (label, amount, subline) => `
                    <div class="ta-row-split-5">
                        <span>${label}</span><strong>฿${Number(amount).toLocaleString()}</strong>
                    </div>${subline ? `<div class="ta-tag-label">${subline}</div>` : ''}`;
            items.innerHTML = [
                rent   ? row('ค่าเช่าห้อง',  rent)   : '',
                elecC  ? row('ค่าไฟฟ้า',     elecC,  (eOld!=null&&eNew!=null) ? `มิเตอร์ไฟ: ${eOld} → ${eNew} (${eU||0} หน่วย × ฿${eR})` : '') : '',
                waterC ? row('ค่าน้ำประปา',  waterC, (wOld!=null&&wNew!=null) ? `มิเตอร์น้ำ: ${wOld} → ${wNew} (${wU||0} หน่วย × ฿${wR})` : '') : '',
                trash  ? row('ค่าขยะ',       trash)  : ''
            ].join('');
        }
        const total = Number(bill.totalAmount||bill.total||bill.totalCharge) || 0;
        set('rcpt-total', `฿${total.toLocaleString()}`);
        const ownerEl = document.getElementById('receipt-owner-name');
        if (ownerEl && typeof getOwnerName === 'function') ownerEl.textContent = getOwnerName();
        const sel = document.getElementById('receipt-type-select');
        const receiptType = (sel?.value)
            || localStorage.getItem(_receiptTypeKey?.() || '')
            || (_taTenant && _taTenant.receiptType)
            || 'personal';
        const co = (_taTenant && (_taTenant.companyInfo || _taTenant.company)) || {};
        const showCompany = receiptType === 'company' && (co.name || co.taxId || co.address);
        const compBlock = document.getElementById('receipt-company-info-block');
        if (compBlock) compBlock.style.display = showCompany ? 'block' : 'none';
        if (showCompany) {
            set('display-comp-name', co.name    || '-');
            set('display-comp-tax',  co.taxId   || '-');
            set('display-comp-addr', co.address || '-');
        }
        const badge = document.getElementById('rcpt-status-badge');
        const noteEl = document.getElementById('rcpt-method-note');
        if (bill.method === 'cash_legacy' && badge && noteEl) {
            badge.innerHTML = '✅ ชำระแล้ว (เงินสด)';
            badge.style.background = '#F3F4F6';
            badge.style.color = '#4B5563';
            badge.style.borderColor = '#9CA3AF';
            noteEl.style.display = 'block';
            noteEl.textContent = 'บันทึกย้อนหลัง — ก่อนระบบ SlipOK (ไม่มีสลิปดิจิทัล)';
        } else if (badge) {
            badge.innerHTML = '✅ ชำระแล้ว';
            badge.style.background = 'var(--soft-green)';
            badge.style.color = 'var(--primary-green)';
            badge.style.borderColor = 'var(--primary-green)';
            if (noteEl) noteEl.style.display = 'none';
        }
    }

    window.renderHomePage       = renderHomePage;
    window.showBillsSkeleton    = showBillsSkeleton;
    window.renderBillsList      = renderBillsList;
    window.renderProfilePage    = renderProfilePage;
    window.renderPetList        = renderPetList;
    window.renderContractPage   = renderContractPage;
    window.updateNavBadges      = updateNavBadges;
    window.openPaymentFlow      = openPaymentFlow;
    window.goToPaymentStep      = goToPaymentStep;
    window.renderPaymentInvoice = renderPaymentInvoice;
    window.renderPaymentReceipt = renderPaymentReceipt;
})();
