// shared/tenant-profile-ui.js
// Receipt settings, company info, astro/greeting, avatar, openModal/closeModal/submitSuggestion.
// Extracted from tenant_app.html (lines 5249-5631, 5636-5889).
//
// Requires (globals):
//   _taTenant, _taBuilding, _taRoom   — var globals from tenant-liff-auth.js
//   window._tenantAppBuilding, window._tenantAppRoom — same, window aliases
//   window.toast, window._esc         — global helpers
//   window.firebaseReady, window.firebase — Firebase SDK
//   window._authUid                   — auth state
//   window.TenantFirebaseSync         — data sync
//   window.PersonManager              — people/ SSoT
//
// Exports (window.*):
//   _receiptTypeKey, loadReceiptSettings, saveCompanyInfo, onReceiptTypeChange,
//   applyReceiptUI, getReceiptMetaForBill,
//   updateAstro, updatePowerWordOfDay, initGreeting, updateName, _loadNickname,
//   setAvatar, loadAvatar, applyAvatarImage, applyAvatarEmoji, handleAvatarUpload,
//   compressImageToDataUrl, openModal, closeModal, submitSuggestion

'use strict';
(function () {
    // ── Astro data ───────────────────────────────────────────────────────────
    const astroData = {
        Sunday:    { word: "'เจิดจรัส' (Radiant)",    desc: 'วันนี้พลังงานแสงอาทิตย์ในตัวคุณสูงมาก ลองทำสิ่งที่กลัว แล้วความสำเร็จจะสว่างไสวครับ' },
        Monday:    { word: "'ราบรื่น' (Flowing)",      desc: 'เสน่ห์ของคุณอยู่ที่ความใจเย็น วันนี้การเจรจาจะง่ายเหมือนสายน้ำไหลผ่านครับ' },
        Tuesday:   { word: "'ทะยาน' (Soar)",           desc: 'แรงขับเคลื่อนของคุณแรงกล้ามาก วันนี้เหมาะกับการเริ่มโปรเจกต์ใหม่ที่ตั้งใจไว้ครับ' },
        Wednesday: { word: "'เชื่อมโยง' (Connect)",    desc: 'คำพูดของคุณจะมีพลังวิเศษ ลองทักทายคนใหม่ๆ หรือส่งต่อไอเดียดีๆ ดูนะ' },
        Thursday:  { word: "'มั่นคง' (Steadfast)",     desc: 'สติและเหตุผลจะพาคุณผ่านทุกอุปสรรค วันนี้เป็นวันที่ดีในการตัดสินใจเรื่องเงินทองครับ' },
        Friday:    { word: "'เบิกบาน' (Blissful)",     desc: 'ความสุขจะดึงดูดโชคลาภ วันนี้ลองยิ้มให้ตัวเองในกระจกบ่อยๆ แล้วสิ่งดีๆ จะวิ่งเข้าหาครับ' },
        Saturday:  { word: "'หยั่งรู้' (Intuition)",   desc: 'เชื่อในสัญชาตญาณแรกของคุณ วันนี้คำตอบที่มองไม่เห็นจะเริ่มชัดเจนขึ้นเองครับ' }
    };

    // ── Receipt / company info ───────────────────────────────────────────────
    function _receiptTypeKey() {
        const b = window._tenantAppBuilding || 'unknown';
        const r = window._tenantAppRoom || 'unknown';
        return `tenant_receipt_type_${b}_${r}`;
    }

    function loadReceiptSettings() {
        try {
            const localType = localStorage.getItem(_receiptTypeKey());
            const adminType = (_taTenant && _taTenant.receiptType) || null;
            const type = localType || adminType || 'personal';
            const co = (_taTenant && (_taTenant.companyInfo || _taTenant.company)) || {};
            const $ = id => document.getElementById(id);
            const sel = $('receipt-type-select');
            if (sel) sel.value = type;
            if ($('comp-name-input')) $('comp-name-input').value = co.name || '';
            if ($('comp-tax-input'))  $('comp-tax-input').value  = co.taxId || '';
            if ($('comp-addr-input')) $('comp-addr-input').value = co.address || '';
            if ($('display-comp-name')) $('display-comp-name').textContent = co.name || '-';
            if ($('display-comp-tax'))  $('display-comp-tax').textContent  = co.taxId || '-';
            if ($('display-comp-addr')) $('display-comp-addr').textContent = co.address || '-';
            applyReceiptUI(type, co);
        } catch (_) {}
    }

    async function saveCompanyInfo() {
        const $ = id => document.getElementById(id);
        const co = {
            name:    $('comp-name-input')?.value.trim() || '',
            taxId:   $('comp-tax-input')?.value.trim() || '',
            address: $('comp-addr-input')?.value.trim() || ''
        };
        if (!co.name && !co.taxId) {
            _showCompMsg('⚠️ กรุณากรอกอย่างน้อยชื่อบริษัทหรือเลขผู้เสียภาษี', '#fee', '#b71c1c');
            return;
        }
        if (co.taxId && !/^\d{13}$/.test(co.taxId)) {
            _showCompMsg('⚠️ เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก', '#fee', '#b71c1c');
            return;
        }
        const btn = $('comp-save-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
        try {
            // Phase 6: companyInfo lives on people/{tenantId} SSoT.
            if (window.firebaseReady && window.PersonManager && _taTenant?.tenantId) {
                await window.PersonManager.savePerson(_taTenant.tenantId, { companyInfo: co });
            }
            if (_taTenant) _taTenant.companyInfo = co;
            _showCompMsg('✅ บันทึกข้อมูลบริษัทเรียบร้อย — ใบเสร็จเดือนถัดไปจะออกในนามนี้', 'var(--soft-green)', 'var(--primary-dark, #1a5c38)');
        } catch (e) {
            _showCompMsg('❌ บันทึกไม่สำเร็จ: ' + (e?.message || 'unknown'), '#fee', '#b71c1c');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> บันทึกข้อมูลบริษัท'; }
        }
    }

    function _showCompMsg(text, bg, color) {
        const el = document.getElementById('comp-save-msg');
        if (!el) return;
        el.textContent = text;
        el.style.background = bg;
        el.style.color = color;
        el.style.display = 'block';
        setTimeout(() => { if (el) el.style.display = 'none'; }, 4500);
    }

    function onReceiptTypeChange() {
        const sel = document.getElementById('receipt-type-select');
        if (!sel) return;
        const type = sel.value;
        try { localStorage.setItem(_receiptTypeKey(), type); } catch (_) {}
        const co = (_taTenant && (_taTenant.companyInfo || _taTenant.company)) || {};
        applyReceiptUI(type, co);
        try {
            if (typeof TenantFirebaseSync !== 'undefined' && window.firebaseReady && window._tenantAppRoom) {
                const userStr = sessionStorage.getItem('user');
                const user = userStr ? JSON.parse(userStr) : { roomNumber: window._tenantAppRoom };
                TenantFirebaseSync.initialize(user, window._tenantAppBuilding, window._tenantAppRoom);
                if (typeof TenantFirebaseSync.saveReceiptType === 'function') TenantFirebaseSync.saveReceiptType(type);
            }
        } catch (_) {}
    }

    function applyReceiptUI(type, co) {
        const $ = id => document.getElementById(id);
        const isCo = type === 'company';
        if ($('company-info-display')) $('company-info-display').style.display = isCo ? 'block' : 'none';
        if ($('receipt-company-info-block')) $('receipt-company-info-block').style.display = isCo ? 'block' : 'none';
        const missing = isCo && !(co && (co.name || co.taxId || co.address));
        if ($('comp-info-missing-warn')) $('comp-info-missing-warn').style.display = missing ? 'block' : 'none';
        if ($('receipt-confirm-type')) $('receipt-confirm-type').textContent = isCo ? 'ใบเสร็จเต็มรูป (นามบริษัทผู้เช่า)' : 'นามบุคคล';
    }

    function getReceiptMetaForBill() {
        const type = (document.getElementById('receipt-type-select')?.value)
                  || localStorage.getItem(_receiptTypeKey())
                  || (_taTenant && _taTenant.receiptType)
                  || 'personal';
        const co = (_taTenant && (_taTenant.companyInfo || _taTenant.company)) || {};
        if (type === 'company' && co && (co.name || co.taxId)) {
            return {
                type: 'company',
                header: 'ใบกำกับภาษีเต็มรูปแบบ',
                lines: [
                    { label: 'ออกในนาม',                    value: co.name    || '' },
                    { label: 'เลขประจำตัวผู้เสียภาษี',       value: co.taxId   || '' },
                    { label: 'ที่อยู่',                      value: co.address || '' },
                ],
            };
        }
        return {
            type: 'personal',
            header: 'ใบเสร็จรับเงิน',
            lines: [{ label: 'ออกในนาม', value: (_taTenant?.name || _taTenant?.tenantName || '') }],
        };
    }

    // ── Astro / greeting ────────────────────────────────────────────────────
    function updateAstro() {
        const daySelect = document.getElementById('birth-day-select');
        if (!daySelect) return;
        const day = daySelect.value;
        const data = astroData[day];
        if (data) {
            document.getElementById('power-word').innerText = data.word;
            document.getElementById('power-desc').innerText = data.desc;
            const card = document.querySelector('.power-card');
            if (card) {
                card.style.animation = 'none';
                card.offsetHeight; // eslint-disable-line no-unused-expressions
                card.style.animation = 'slideUp 0.5s ease';
            }
        }
    }

    function updatePowerWordOfDay() {
        const today = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Bangkok' });
        const data = astroData[today];
        const wordEl = document.getElementById('power-word');
        const descEl = document.getElementById('power-desc');
        if (data && wordEl && descEl) {
            wordEl.innerText = data.word;
            descEl.innerText = data.desc;
        }
    }

    function initGreeting() {
        const hour = new Date().getHours();
        const text = document.getElementById('time-greet');
        if (!text) return;
        if (hour < 12) text.innerText = 'อรุณสวัสดิ์ยามเช้า รับกาแฟสักแก้วไหมครับ? ☕';
        else if (hour < 18) text.innerText = 'ทิวาสวัสดิ์ยามบ่าย วันนี้ทำงานเหนื่อยไหมครับ? 🌿';
        else text.innerText = 'สายัณห์สวัสดิ์ยามเย็น พักผ่อนให้เต็มที่นะครับ 🌙';
    }

    function updateName(val) {
        const name = val || 'คุณลูกบ้าน';
        ['display-name', 'display-name-map'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = name;
        });
        const greetEl = document.getElementById('user-greeting');
        if (greetEl) greetEl.textContent = val ? `สวัสดีครับ คุณ${val}` : 'สวัสดีครับ คุณลูกบ้าน';
        try {
            const k = `tenant_nickname_${window._tenantAppBuilding || 'x'}_${window._tenantAppRoom || 'x'}`;
            if (val) localStorage.setItem(k, val);
            else localStorage.removeItem(k);
        } catch (_) {}
    }

    function _loadNickname() {
        try {
            const k = `tenant_nickname_${window._tenantAppBuilding || 'x'}_${window._tenantAppRoom || 'x'}`;
            const saved = localStorage.getItem(k);
            if (saved) {
                updateName(saved);
                const inp = document.getElementById('nickname-input');
                if (inp) inp.value = saved;
            }
        } catch (_) {}
    }

    // ── Avatar ───────────────────────────────────────────────────────────────
    function _avatarStorageKey() {
        const b = window._tenantAppBuilding || 'unknown';
        const r = window._tenantAppRoom || 'unknown';
        return `tenant_avatar_${b}_${r}`;
    }

    function setAvatar(emoji, el) {
        ['current-avatar', 'current-avatar-map', 'avatar-current-tile'].forEach(id => {
            const curr = document.getElementById(id);
            if (curr) { curr.innerText = emoji; curr.style.backgroundImage = ''; }
        });
        if (el && el.classList.contains('avatar-option')) {
            document.querySelectorAll('.avatar-selector .avatar-option').forEach(opt => {
                if (opt.id !== 'avatar-current-tile') opt.classList.remove('active');
            });
            el.classList.add('active');
        }
        saveAvatar({ type: 'emoji', value: emoji });
    }

    function saveAvatar(data) {
        try {
            localStorage.setItem(_avatarStorageKey(), JSON.stringify({ ...data, at: Date.now() }));
            try {
                if (typeof TenantFirebaseSync !== 'undefined' && window.firebaseReady && window._tenantAppRoom) {
                    const userStr = sessionStorage.getItem('user');
                    const user = userStr ? JSON.parse(userStr) : { roomNumber: window._tenantAppRoom };
                    TenantFirebaseSync.initialize(user, window._tenantAppBuilding, window._tenantAppRoom);
                    if (typeof TenantFirebaseSync.saveAvatar === 'function') TenantFirebaseSync.saveAvatar(data);
                }
            } catch (_) {}
            if (window.PersonManager && _taTenant?.tenantId) {
                window.PersonManager.savePerson(_taTenant.tenantId, { avatar: data });
            }
        } catch (_) {}
    }

    function loadAvatar() {
        try {
            const raw = localStorage.getItem(_avatarStorageKey());
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.type === 'image' && data.value) applyAvatarImage(data.value);
            else if (data.type === 'emoji' && data.value) applyAvatarEmoji(data.value);
        } catch (_) {}
    }

    function applyAvatarEmoji(emoji) {
        ['current-avatar', 'current-avatar-map', 'avatar-current-tile'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.innerText = emoji; el.style.backgroundImage = ''; }
        });
    }

    function applyAvatarImage(dataUrl) {
        const set = el => {
            if (!el) return;
            el.innerHTML = '';
            el.style.backgroundImage = `url('${dataUrl}')`;
            el.style.backgroundSize = 'cover';
            el.style.backgroundPosition = 'center';
        };
        ['current-avatar', 'current-avatar-map', 'avatar-current-tile'].forEach(id => set(document.getElementById(id)));
    }

    async function handleAvatarUpload(event) {
        const file = event.target?.files?.[0];
        if (!file) return;
        const status = document.getElementById('avatar-upload-status');
        const show = (msg, color) => {
            if (status) { status.style.display = 'block'; status.style.color = color || 'var(--text-muted)'; status.textContent = msg; }
        };
        if (!/^image\//.test(file.type)) { show('ไฟล์ต้องเป็นรูปภาพ (jpg/png/webp)', 'var(--danger)'); return; }
        if (file.size > 10 * 1024 * 1024) { show('รูปใหญ่เกิน 10MB กรุณาเลือกรูปเล็กลง', 'var(--danger)'); return; }
        show('กำลังบีบอัดรูป...');
        try {
            const compressed = await compressImageToDataUrl(file, { maxSize: 256, quality: 0.7 });
            const origKB = Math.round(file.size / 1024);
            const newKB  = Math.round((compressed.length * 0.75) / 1024);
            applyAvatarImage(compressed);
            saveAvatar({ type: 'image', value: compressed });
            const uploadLabel = document.querySelector('.avatar-selector label[for="avatar-upload-input"]');
            document.querySelectorAll('.avatar-selector .avatar-option').forEach(o => {
                if (o.id !== 'avatar-current-tile') o.classList.remove('active');
            });
            uploadLabel?.classList.add('active');
            show(`✓ อัปโหลดสำเร็จ (${origKB}KB → ${newKB}KB)`, 'var(--primary-green)');
        } catch (e) {
            show('บีบอัดล้มเหลว กรุณาลองใหม่', 'var(--danger)');
        }
    }

    function compressImageToDataUrl(file, opts) {
        const { maxSize = 256, quality = 0.7 } = opts || {};
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => {
                const img = new Image();
                img.onerror = reject;
                img.onload = () => {
                    const side = Math.min(img.width, img.height);
                    const sx = (img.width - side) / 2;
                    const sy = (img.height - side) / 2;
                    const canvas = document.createElement('canvas');
                    canvas.width = maxSize;
                    canvas.height = maxSize;
                    const ctx = canvas.getContext('2d');
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
                    try { resolve(canvas.toDataURL('image/jpeg', quality)); }
                    catch (e) { reject(e); }
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // ── Modal (legacy inline modal + suggestion form) ────────────────────────
    function openModal(type) {
        const body = document.getElementById('modal-body');
        const modal = document.getElementById('mainModal');
        if (!body || !modal) return;

        if (type === 'pay') {
            body.innerHTML = `<h3>ชำระเงิน</h3><p>ยอด: 2,736.00 ฿</p><div class="ta-slip-slot">คลิกเพื่อแนบสลิปการโอนเงินที่นี่</div><button class="btn-main u-mt-15" data-action="closeModal">ส่งหลักฐาน</button>`;
        } else if (type === 'suggest') {
            body.innerHTML = `<h3 class="ta-modal-h3">กระซิบถึงเจ้าของตึก</h3>
              <p style="font-size:var(--fs-md); opacity: 0.8; margin-bottom: 15px;">ข้อความนี้จะถูกส่งตรงเพื่อพัฒนา Nature Haven ครับ</p>
              <textarea id="suggest-text" placeholder="บอกเราได้ทุกเรื่องเลยครับ..." rows="5" style="width:100%; border-radius:12px; border:1px solid #eee; padding:12px; font-family:inherit; font-size:16px; box-sizing:border-box;"></textarea>
              <button id="suggest-submit-btn" class="btn-main" style="margin-top:20px;" data-action="submitSuggestion">ส่งข้อความ</button>`;
        } else if (type === 'preference') {
            const t = _taTenant || {};
            const curName = t.name || t.tenantName || '';
            const curPhone = t.phone || t.tel || '';
            body.innerHTML = `<h3 class="ta-modal-h3-plain">แก้ไขข้อมูลส่วนตัว</h3>
              <label>ชื่อที่แสดงผล</label><input type="text" placeholder="คุณ..." value="${curName}" data-action-input="updateName">
              <label style="display:block; margin-top:10px;">เบอร์โทร</label><input type="text" value="${curPhone}">
              <p style="margin:8px 0 15px; font-size:var(--fs-sm); color:var(--text-muted);">* แก้เบอร์/ชื่อเพิ่มเติม กรุณาแจ้งนิติเพื่ออัปเดตระบบ</p>
              <label style="display:block; margin-top:10px;">เปลี่ยน Avatar</label>
              <div class="avatar-selector u-mb-15">
                  <div class="avatar-option active" data-action="setAvatar" data-avatar="🌿">🌿</div>
                  <div class="avatar-option" data-action="setAvatar" data-avatar="🌊">🌊</div>
                  <div class="avatar-option" data-action="setAvatar" data-avatar="⛰️">⛰️</div>
              </div>
              <button class="btn-main" data-action="closeModal">บันทึกข้อมูล</button>`;
        }
        modal.style.display = 'block';
    }

    function closeModal() {
        const modal = document.getElementById('mainModal');
        if (modal) modal.style.display = 'none';
    }

    async function submitSuggestion() {
        const msg = (document.getElementById('suggest-text')?.value || '').trim();
        if (!msg) { toast('กรุณาพิมพ์ข้อความก่อนนะครับ', 'warning'); return; }
        const btn = document.getElementById('suggest-submit-btn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังส่ง...'; }
        try {
            const db = window.firebase?.firestore?.();
            const fs = window.firebase?.firestoreFunctions;
            if (!db || !fs || !window._authUid) {
                toast('ระบบยังไม่พร้อม กรุณาลองใหม่ครับ', 'error');
                if (btn) { btn.disabled = false; btn.textContent = 'ส่งข้อความ'; }
                return;
            }
            await fs.addDoc(fs.collection(db, 'complaints'), {
                title: '💬 กระซิบถึงเจ้าของตึก',
                desc: msg,
                room: 'Anonymous',
                status: 'open',
                createdAt: new Date().toISOString()
            });
            closeModal();
            toast('✅ ส่งแล้ว ขอบคุณสำหรับคำแนะนำครับ', 'success');
        } catch (e) {
            console.warn('submitSuggestion failed:', e);
            toast('ส่งไม่สำเร็จ กรุณาลองใหม่ครับ', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'ส่งข้อความ'; }
        }
    }

    window._receiptTypeKey        = _receiptTypeKey;
    window.loadReceiptSettings    = loadReceiptSettings;
    window.saveCompanyInfo        = saveCompanyInfo;
    window.onReceiptTypeChange    = onReceiptTypeChange;
    window.applyReceiptUI         = applyReceiptUI;
    window.getReceiptMetaForBill  = getReceiptMetaForBill;
    window.updateAstro            = updateAstro;
    window.updatePowerWordOfDay   = updatePowerWordOfDay;
    window.initGreeting           = initGreeting;
    window.updateName             = updateName;
    window._loadNickname          = _loadNickname;
    window.setAvatar              = setAvatar;
    window.saveAvatar             = saveAvatar;
    window.loadAvatar             = loadAvatar;
    window.applyAvatarEmoji       = applyAvatarEmoji;
    window.applyAvatarImage       = applyAvatarImage;
    window.handleAvatarUpload     = handleAvatarUpload;
    window.compressImageToDataUrl = compressImageToDataUrl;
    window.openModal              = openModal;
    window.closeModal             = closeModal;
    window.submitSuggestion       = submitSuggestion;
})();
