// ===== MAINTENANCE + COMPLAINT SYSTEM =====
// Extracted from tenant_app.html. Exports:
//   window.handleMaintenancePhotoChange — data-action-change on maintenance photo input
//   window.clearMaintenancePhoto        — data-action: clear photo preview
//   window.renderTicketsList            — called from showPage('maintenance') + DOMContentLoaded
//   window.submitMaintenance            — data-action-submit on maintenance form
//   window.setSeverity                  — data-action: complaint severity button selector
//   window.submitComplaint              — data-action-submit on complaint form
//   window.loadComplaints               — called from showPage('complaint')
//
// Shared state (window.* resolved at call time):
//   window._taBuilding, window._taRoom — var globals from tenant-liff-auth.js
//   window._TH_DATE_FMT               — Intl formatter from tenant-world-map.js
//   window.GhEmptyState, window.toast, window._onLiffClaimsReady
(function () {
    'use strict';


    // ── MAINTENANCE ──────────────────────────────────────────────────────────

    // Called via data-action-change with (el, e) — el is the file input element.
    // Original three-arg signature (inputId, previewId, imgId) replaced here
    // because data-action-change dispatch passes the element, not a string id.
    function handleMaintenancePhotoChange(el) {
        const fileInput = el || document.getElementById('maintenancePhoto');
        const preview = document.getElementById('maintenancePhotoPreview');
        const img = document.getElementById('maintenancePhotoImg');
        if (!fileInput || !fileInput.files || !fileInput.files[0]) {
            if (preview) preview.style.display = 'none';
            return;
        }
        const file = fileInput.files[0];
        if (file.size > 10 * 1024 * 1024) {
            alert('❌ ไฟล์ใหญ่เกินไป (สูงสุด 10MB)');
            fileInput.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = e => { if (img) img.src = e.target.result; if (preview) preview.style.display = 'block'; };
        reader.readAsDataURL(file);
    }

    function clearMaintenancePhoto() {
        const input = document.getElementById('maintenancePhoto');
        const preview = document.getElementById('maintenancePhotoPreview');
        if (input) input.value = '';
        if (preview) preview.style.display = 'none';
    }

    // Accepts a base64 string (legacy) OR a File/Blob (preferred). Passing a Blob
    // avoids the FileReader→base64 round-trip that held 3-5x file size in main-
    // thread heap simultaneously (file + base64 string + decoded image + canvas).
    // With createObjectURL the browser keeps the bytes in native memory, decoded
    // straight to GPU/canvas, then revoked.
    async function compressImage(source, maxWidth = 1280, maxHeight = 1280, quality = 0.75) {
        return new Promise(resolve => {
            let url = null, revoke = false;
            const fallback = () => (typeof source === 'string') ? source : '';
            try {
                if (typeof source === 'string') {
                    url = source;
                } else if (source instanceof Blob) {
                    url = URL.createObjectURL(source);
                    revoke = true;
                } else { resolve(fallback()); return; }
                const img = new Image();
                const cleanup = () => { if (revoke) URL.revokeObjectURL(url); };
                img.onload = function () {
                    let w = img.width, h = img.height;
                    if (w > maxWidth || h > maxHeight) {
                        const ratio = Math.min(maxWidth / w, maxHeight / h);
                        w = Math.round(w * ratio); h = Math.round(h * ratio);
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    cleanup();
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.onerror = () => { cleanup(); resolve(fallback()); };
                img.src = url;
            } catch (e) {
                if (revoke && url) URL.revokeObjectURL(url);
                resolve(fallback());
            }
        });
    }

    function getCategoryName(cat) {
        const m = { electric:'⚡ ไฟฟ้า', water:'💧 น้ำ/ประปา', aircon:'❄️ แอร์',
            furniture:'🪑 เฟอร์นิเจอร์', door:'🚪 ประตู/หน้าต่าง',
            internet:'📶 อินเทอร์เน็ต', other:'📝 อื่นๆ' };
        return m[cat] || cat;
    }

    let _maintParsedCache = null, _maintRawKey = null;
    function getMaintenanceTickets() {
        const raw = localStorage.getItem('tenant_maintenance_tickets') || '[]';
        if (raw !== _maintRawKey) {
            try { _maintParsedCache = JSON.parse(raw); } catch (e) { _maintParsedCache = []; }
            _maintRawKey = raw;
        }
        return _maintParsedCache;
    }

    function renderTicketsList() {
        const container = document.getElementById('ticketsList');
        if (!container) return;
        const tickets = getMaintenanceTickets();
        if (tickets.length === 0) {
            container.innerHTML = window.GhEmptyState
                ? window.GhEmptyState.html('tasks', { title:'ยังไม่มีรายการแจ้งซ่อม', text:'เมื่อแจ้งซ่อมแล้ว รายการจะแสดงที่นี่' })
                : '<p class="ta-text-ctr-muted">ยังไม่มีรายการแจ้งซ่อม</p>';
            return;
        }
        const fmt = window._TH_DATE_FMT || new Intl.DateTimeFormat('th-TH');
        const statusText = { pending:'⏳ รอดำเนินการ', inprogress:'🔧 กำลังซ่อม', done:'✅ เสร็จสิ้น' };
        const statusColor = { pending:'#f59e0b', inprogress:'#3b82f6', done:'#22c55e' };
        container.innerHTML = tickets.map(t => {
            const date = t.submittedDate ? fmt.format(new Date(t.submittedDate)) : (t.date || '');
            const status = t.status || 'pending';
            return `<div style="background:white;border-radius:14px;padding:14px;margin-bottom:10px;border:1px solid #f0f0f0;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span class="ta-sm-bold-muted">${_esc(t.id)}</span>
                    <span style="font-size:var(--fs-sm);font-weight:700;color:${statusColor[status]||'#6b7280'};">${_esc(statusText[status]||status)}</span>
                </div>
                <p class="ta-md-bold-mb4">${_esc(getCategoryName(t.category))}</p>
                <p class="ta-sm-gray-mb4">${_esc(t.description||t.desc||'')}</p>
                <p class="ta-sm-gray">${_esc(date)}</p>
                ${t.beforePhoto ? `<img src="${_esc(t.beforePhoto)}" style="margin-top:8px;width:100%;max-height:140px;object-fit:cover;border-radius:8px;">` : ''}
                ${status==='done' && t.workNotes ? `<p class="ta-divider-note">📝 ${_esc(t.workNotes)}</p>` : ''}
            </div>`;
        }).join('');
    }

    async function submitMaintenance(event) {
        if (event && event.preventDefault) event.preventDefault();
        const form = event ? event.target : document.querySelector('[data-action-submit="submitMaintenance"]');
        const category = document.getElementById('maintenanceCategory').value;
        const description = document.getElementById('maintenanceDescription').value.trim();
        const priority = document.getElementById('maintenancePriority')?.value || 'normal';
        const photoInput = document.getElementById('maintenancePhoto');
        if (!category || !description) { alert('⚠️ กรุณากรอกข้อมูลให้ครบถ้วน'); return; }

        const btn = document.getElementById('maintenanceSubmitBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังส่ง...'; }

        const ticketId = `T${Date.now()}`;
        const reportedDate = new Date().toISOString().split('T')[0];
        const ticket = {
            id: ticketId,
            room: _taRoom || '-',
            building: _taBuilding || '-',
            date: new Date().toLocaleDateString('th-TH'),
            category,
            categoryLabel: getCategoryName(category),
            description,
            desc: description,
            priority,
            status: 'pending',
            reportedAt: reportedDate,
            submittedDate: new Date().toISOString()
        };

        if (photoInput && photoInput.files && photoInput.files[0]) {
            const file = photoInput.files[0];
            compressImage(file, 1280, 1280, 0.75)
                .then(b64 => { ticket.beforePhoto = b64; ticket.photoFileName = file.name; _saveMaintenanceTicket(ticket); _afterMaintenanceSave(form, btn); })
                .catch(() => { _saveMaintenanceTicket(ticket); _afterMaintenanceSave(form, btn); });
        } else {
            _saveMaintenanceTicket(ticket);
            _afterMaintenanceSave(form, btn);
        }
    }

    function _saveMaintenanceTicket(ticket) {
        try {
            if (window.firebaseReady && window.firebaseRef && window.firebaseSet && window.firebaseDatabase) {
                const bld = ticket.building || _taBuilding || 'rooms';
                const room = ticket.room || _taRoom;
                const path = `maintenance/${bld}/${room}/${ticket.id}`;
                const payload = {
                    id: ticket.id,
                    room: String(room),
                    building: bld,
                    desc: ticket.description || ticket.desc || '',
                    category: ticket.category || 'other',
                    priority: ticket.priority || 'normal',
                    status: ticket.status || 'pending',
                    reportedAt: ticket.reportedAt || new Date().toISOString().split('T')[0],
                    beforePhoto: ticket.beforePhoto || null,
                    photoFileName: ticket.photoFileName || null,
                    createdAt: new Date().toISOString(),
                    tenantUid: window.firebaseAuth?.currentUser?.uid || null
                };
                window.firebaseSet(window.firebaseRef(window.firebaseDatabase, path), payload);
            }
        } catch (e) { console.warn('RTDB maintenance save failed:', e); }

        try {
            let adminList = JSON.parse(localStorage.getItem('maintenance_data') || '[]');
            adminList.unshift({ id:ticket.id, room:ticket.room, building:ticket.building, desc:ticket.description, category:ticket.category, priority:ticket.priority, status:ticket.status, reportedAt:ticket.reportedAt, beforePhoto:ticket.beforePhoto, photoFileName:ticket.photoFileName });
            localStorage.setItem('maintenance_data', JSON.stringify(adminList));
        } catch (e) {}

        try {
            let tenantList = getMaintenanceTickets();
            tenantList.unshift(ticket);
            localStorage.setItem('tenant_maintenance_tickets', JSON.stringify(tenantList));
        } catch (e) {}
    }

    function _afterMaintenanceSave(form, btn) {
        alert('✅ แจ้งปัญหาสำเร็จ!\nทีมงานจะติดต่อกลับโดยเร็ว');
        if (form) form.reset();
        clearMaintenancePhoto();
        if (btn) { btn.disabled = false; btn.textContent = '📤 ส่งแจ้งปัญหา'; }
        renderTicketsList();
    }

    // RTDB realtime subscribe — admin writes status/workNotes/afterPhoto to RTDB,
    // tenant sees updates live without having to be on the same device
    let _maintenanceRtdbOff = null;
    async function _subscribeMaintenanceFromRTDB() {
        if (_maintenanceRtdbOff) return;
        if (!window.firebaseReady || !window.firebaseDatabase || !window.firebaseRef || !window.firebaseOnValue) return;
        if (!_taBuilding || !_taRoom) return;
        // Phase 4C: RTDB rule requires {room, building} claims on token (or admin).
        // Defer quietly if claims not yet set — liffLinked event handler retries after linkAuthUid.
        try {
            const user = window.firebaseAuth?.currentUser;
            if (!user) return;
            const tr = await user.getIdTokenResult();
            if (!tr.claims.admin && !(tr.claims.room && tr.claims.building)) return;
        } catch (_) { return; }
        try {
            const path = `maintenance/${_taBuilding}/${_taRoom}`;
            const ref = window.firebaseRef(window.firebaseDatabase, path);
            _maintenanceRtdbOff = window.firebaseOnValue(ref, snap => {
                if (!snap.exists()) return;
                const rtdbMap = snap.val() || {};
                let local = getMaintenanceTickets();
                const byId = new Map(local.map(t => [t.id, t]));
                Object.values(rtdbMap).forEach(rt => {
                    if (!rt || !rt.id) return;
                    const existing = byId.get(rt.id);
                    if (existing) {
                        byId.set(rt.id, { ...existing, status: rt.status || existing.status,
                            workNotes: rt.workNotes || existing.workNotes,
                            updatedAt: rt.updatedAt || existing.updatedAt });
                    } else {
                        byId.set(rt.id, { id: rt.id, category: rt.category || 'other',
                            description: rt.desc || '', desc: rt.desc || '',
                            status: rt.status || 'pending', priority: rt.priority || 'normal',
                            submittedDate: rt.createdAt || new Date().toISOString() });
                    }
                });
                const merged = Array.from(byId.values()).sort((a,b) =>
                    (b.submittedDate||b.createdAt||'').localeCompare(a.submittedDate||a.createdAt||''));
                try { localStorage.setItem('tenant_maintenance_tickets', JSON.stringify(merged)); } catch (e) {}
                renderTicketsList();
            }, err => console.warn('maintenance RTDB subscribe failed:', err.message));
        } catch (e) { console.warn('maintenance RTDB subscribe init failed:', e.message); }
    }
    window._onLiffClaimsReady(_subscribeMaintenanceFromRTDB);

    // ── COMPLAINT ────────────────────────────────────────────────────────────

    let currentSeverity = 'low';
    let currentComplaintFilter = 'all';

    function setSeverity(level) {
        currentSeverity = level;
        const sev = document.getElementById('complaintSeverity');
        if (sev) sev.value = level;
        const styles = {
            low:    { border:'#4ade80', color:'#16a34a', bg:'#f0fdf4' },
            medium: { border:'#fbbf24', color:'#d97706', bg:'#fffbeb' },
            high:   { border:'#f87171', color:'#dc2626', bg:'#fef2f2' }
        };
        ['low','medium','high'].forEach(l => {
            const btn = document.getElementById('sev-' + l);
            if (!btn) return;
            if (l === level) {
                btn.style.borderColor = styles[l].border;
                btn.style.color = styles[l].color;
                btn.style.background = styles[l].bg;
            } else {
                btn.style.borderColor = '#ddd';
                btn.style.color = '#6b7280';
                btn.style.background = '#f9fafb';
            }
        });
    }

    async function submitComplaint(event) {
        if (event && event.preventDefault) event.preventDefault();
        const category = document.getElementById('complaintCategory').value;
        const severity = (document.getElementById('complaintSeverity')?.value) || 'low';
        const description = document.getElementById('complaintDescription').value.trim();
        const location = document.getElementById('complaintLocation')?.value.trim() || '';
        const startDate = document.getElementById('complaintStartDate')?.value || '';
        if (!category || !description) return;

        // linkedAuthUid scopes the doc to this tenant — required by the
        // Firestore rule (read: admin OR linkedAuthUid match). Without it
        // the create write is denied.
        const _linkedAuthUid = window.firebaseAuth?.currentUser?.uid
          || window._authUid
          || null;
        const complaint = {
            id: Date.now().toString(),
            category, severity, description, location, startDate,
            title: category,
            desc: description,
            room: _taRoom,
            building: _taBuilding,
            status: 'open',
            linkedAuthUid: _linkedAuthUid,
            createdAt: new Date().toISOString()
        };

        const list = JSON.parse(localStorage.getItem('tenant_app_complaints') || '[]');
        list.unshift(complaint);
        localStorage.setItem('tenant_app_complaints', JSON.stringify(list));

        const adminList = JSON.parse(localStorage.getItem('complaints_data') || '[]');
        adminList.push(complaint);
        localStorage.setItem('complaints_data', JSON.stringify(adminList));

        try {
            if (window.firebaseReady && window.firebase?.firestore) {
                const db = window.firebase.firestore();
                const fs = window.firebase.firestoreFunctions;
                const docRef = fs.doc(fs.collection(db, 'complaints'), complaint.id);
                await fs.setDoc(docRef, complaint);
            }
            toast('ส่งแจ้งเรียบร้อยแล้ว ทีมงานจะติดต่อกลับโดยเร็ว');
            if (event && event.target) event.target.reset();
            setSeverity('low');
            loadComplaints();
        } catch (e) {
            console.warn('Firestore complaint save failed:', e);
            toast('ส่งไม่สำเร็จ กรุณาลองใหม่หรือแจ้งแอดมินโดยตรง', 'error');
        }
    }

    // Firestore realtime subscribe — admin updates status, tenant sees it live
    let _complaintsUnsub = null;
    function _subscribeComplaintsFromFirestore() {
        if (_complaintsUnsub) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        if (!_taBuilding || !_taRoom) return;
        try {
            const fs = window.firebase.firestoreFunctions;
            const db = window.firebase.firestore();
            const q = fs.query(
                fs.collection(db, 'complaints'),
                fs.where('building', '==', _taBuilding),
                fs.where('room', '==', String(_taRoom)),
                fs.limit(50)
            );
            _complaintsUnsub = fs.onSnapshot(q, snap => {
                const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                let local = [];
                try { local = JSON.parse(localStorage.getItem('tenant_app_complaints') || '[]'); } catch (e) {}
                const byId = new Map();
                local.forEach(c => byId.set(c.id, c));
                docs.forEach(c => byId.set(c.id, c));
                const merged = Array.from(byId.values()).sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
                try { localStorage.setItem('tenant_app_complaints', JSON.stringify(merged)); } catch (e) {}
                filterComplaints(currentComplaintFilter || 'all', merged);
            }, err => console.warn('complaints subscribe failed:', err.message));
        } catch (e) { console.warn('complaints subscribe init failed:', e.message); }
    }
    window._onLiffClaimsReady(_subscribeComplaintsFromFirestore);

    function loadComplaints() {
        const all = JSON.parse(localStorage.getItem('tenant_app_complaints') || '[]');
        filterComplaints(currentComplaintFilter, all);
    }

    function filterComplaints(status, list) {
        currentComplaintFilter = status;
        const all = list || JSON.parse(localStorage.getItem('tenant_app_complaints') || '[]');
        const filtered = status === 'all' ? all : all.filter(c => c.status === status);

        ['all','open','in-progress','resolved'].forEach(s => {
            const btn = document.getElementById('filter-' + s);
            if (!btn) return;
            const active = s === status;
            btn.style.background = active ? 'var(--primary-green)' : 'var(--soft-green)';
            btn.style.color = active ? '#fff' : 'var(--primary-green)';
        });

        const container = document.getElementById('complaint-list');
        if (!container) return;
        if (filtered.length === 0) {
            container.innerHTML = window.GhEmptyState
                ? window.GhEmptyState.html('messages', { title:'ไม่พบรายการ', text:'ยังไม่มีประวัติการแจ้งที่ตรงกับตัวกรอง' })
                : '<p class="ta-text-ctr-muted">ไม่พบรายการ</p>';
            return;
        }
        const statusLabel = { open:'⏳ รอดำเนินการ', 'in-progress':'🔧 กำลังดำเนินการ', resolved:'✅ แก้ไขแล้ว' };
        const statusColor = { open:'#f59e0b', 'in-progress':'#3b82f6', resolved:'#22c55e' };
        const catLabel = { noise:'🔊 เสียงดัง', security:'🔒 ความปลอดภัย', parking:'🅿️ ที่จอดรถ', cleanliness:'🧹 ความสะอาด', facilities:'🔧 สิ่งอำนวยความสะดวก', neighbor:'👥 ปัญหาเพื่อนบ้าน', staff:'👤 พนักงาน', other:'📌 อื่นๆ' };
        container.innerHTML = filtered.map(c => {
            const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString('th-TH') : '—';
            const status = c.status || 'open';
            return `<div style="background:white;border-radius:14px;padding:14px;margin-bottom:10px;border:1px solid #f0f0f0;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span class="ta-sm-bold-muted">${_esc(c.id || '—')}</span>
                    <span style="font-size:var(--fs-sm);font-weight:700;color:${statusColor[status]||'#6b7280'};">${_esc(statusLabel[status]||status)}</span>
                </div>
                <p class="ta-md-bold-mb4">${_esc(catLabel[c.category]||c.category||'—')}</p>
                <p class="ta-sm-gray-mb4">${_esc(c.description||'')}</p>
                <p class="ta-sm-gray">${date}${c.location?' · '+_esc(c.location):''}</p>
                ${c.adminNote ? `<p class="ta-divider-note">📝 ${_esc(c.adminNote)}</p>` : ''}
            </div>`;
        }).join('');
    }

    // ── Exports ──────────────────────────────────────────────────────────────
    window.handleMaintenancePhotoChange = handleMaintenancePhotoChange;
    window.clearMaintenancePhoto        = clearMaintenancePhoto;
    window.renderTicketsList            = renderTicketsList;
    window.submitMaintenance            = submitMaintenance;
    window.setSeverity                  = setSeverity;
    window.submitComplaint              = submitComplaint;
    window.loadComplaints               = loadComplaints;
    // Shared image util — also used by shared/tenant-marketplace.js via
    // window.compressImage(File, maxW, maxH, q). It was a tenant_app.html inline
    // global before the god-file refactor moved it into this IIFE, which dropped
    // it from window (§7-QQ) and silently broke marketplace image upload
    // (window.compressImage was undefined → threw → swallowed by try/catch).
    // Keep this export; do not make compressImage IIFE-private again.
    window.compressImage                = compressImage;
})();
