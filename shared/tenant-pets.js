// shared/tenant-pets.js
// Pet registration CRUD + Firestore subscription for tenant_app.html.
// Extracted from god-file (lines 5917-6251).
//
// Requires (globals from tenant_app.html inline script):
//   window._taBuilding, window._taRoom  — var globals from tenant-liff-auth.js
//   window.toast, window._esc           — global UI helpers
//   window.showSubPage                  — global nav helper
//   window.firebase, window.firebaseReady — Firebase SDK wrapper + readiness flag
//
// Exports (via window.*):
//   window.renderPetListToProfile, window.updatePetPhotoPreview,
//   window.saveNewPet, window.prepareEditPet, window.resetPetForm,
//   window.toggleVaccineInputs, window.updateFilePreview, window.viewVaccineBook

'use strict';
(function () {
    let petDataList = [];
    let _petsUnsub = null;
    let _pendingPetPhoto = null;
    let _pendingVaccineBook = null;

    // Breed suggestions per pet type (keyed by the #pet-type emoji value). A
    // representative — NOT exhaustive — set; the #pet-breed field is an <input list>
    // combobox, so the tenant can ALWAYS type a custom / mixed breed not listed
    // here ("พันธุ์ผสม" is also offered explicitly). updateBreedOptions() swaps the
    // datalist when the type changes.
    const PET_BREEDS = {
        '🐶': ['ไทยหลังอาน', 'ไทยบางแก้ว', 'โกลเด้น รีทรีฟเวอร์', 'ลาบราดอร์', 'ปอมเมอเรเนียน', 'ชิวาวา', 'ชิห์สุ', 'พุดเดิ้ล', 'บีเกิ้ล', 'ไซบีเรียน ฮัสกี้', 'เฟรนช์ บูลด็อก', 'อิงลิช บูลด็อก', 'ปั๊ก', 'ชเนาเซอร์', 'ร็อตไวเลอร์', 'เยอรมัน เชพเพิร์ด', 'คอร์กี้', 'ดัชชุน (ไส้กรอก)', 'ค็อกเกอร์ สแปเนียล', 'มอลทีส', 'ชิบะ อินุ', 'พิทบูล', 'โดเบอร์แมน', 'พันธุ์ผสม'],
        '🐱': ['วิเชียรมาศ (ไทย)', 'ขาวมณี', 'โคราช (สีสวาด)', 'เปอร์เซีย', 'สก็อตติช โฟลด์', 'อเมริกัน ช็อตแฮร์', 'บริติช ช็อตแฮร์', 'เมนคูน', 'แร็กดอลล์', 'สฟิงซ์ (ไร้ขน)', 'เบงกอล', 'มันช์กิน (ขาสั้น)', 'ไซบีเรียน', 'เอ็กโซติก ช็อตแฮร์', 'นอร์วีเจียน ฟอเรสต์', 'ขนสั้นไทย (DSH)', 'พันธุ์ผสม'],
        '🐰': ['ฮอลแลนด์ ล็อป', 'เนเธอร์แลนด์ ดวอร์ฟ', 'ไลอ้อนเฮด', 'มินิ เร็กซ์', 'เร็กซ์', 'อังโกร่า', 'เฟลมิช ไจแอนท์', 'ดัตช์', 'อิงลิช ล็อป', 'ฮอตอต', 'มินิลอป', 'เจอร์ซีย์ วูลลี่', 'พันธุ์ผสม'],
        '🐦': ['หงส์หยก (Budgerigar)', 'ค็อกคาเทล', 'เลิฟเบิร์ด', 'ฟอพัส', 'ซัน คอนัวร์', 'นกแก้วแอฟริกัน เกรย์', 'มาคอว์', 'ค็อกคาทู', 'นกเขา', 'นกกระตั้ว', 'ฟินช์', 'พันธุ์ผสม'],
        '🐾': ['หนูแฮมสเตอร์', 'หนูตะเภา (กินีพิก)', 'เม่นแคระ', 'ชูการ์ ไกลเดอร์', 'ชินชิล่า', 'เฟอร์เร็ต', 'เต่า', 'ปลา', 'กิ้งก่า / สัตว์เลื้อยคลาน', 'งู', 'อื่นๆ'],
    };

    // Repopulate the breed datalist for the currently-selected type. Wired to
    // #pet-type via data-action-change="updateBreedOptions" + called on init and
    // when editing a pet (after the type is set).
    function updateBreedOptions() {
        const listEl = document.getElementById('pet-breed-options');
        if (!listEl) return;
        const typeEl = document.getElementById('pet-type');
        const key = (typeEl && typeEl.value) || '🐶';
        const breeds = PET_BREEDS[key] || PET_BREEDS['🐾'] || [];
        const esc = window._esc || function (s) { return String(s == null ? '' : s); };
        listEl.innerHTML = breeds.map(function (b) { return '<option value="' + esc(b) + '"></option>'; }).join('');
    }

    // Subscribe to Firestore pets subcollection so data syncs across devices.
    // Falls back to localStorage on first load if Firestore is slow/unavailable.
    function _subscribePets() {
        if (_petsUnsub) return;
        // Fallback: localStorage
        try {
            const key = `tenant_pets_${_taBuilding}_${_taRoom}`;
            const saved = JSON.parse(localStorage.getItem(key) || '[]');
            if (Array.isArray(saved) && saved.length) { petDataList = saved; renderPetListToProfile(); }
        } catch (e) {}
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        if (!_taBuilding || !_taRoom) return;
        try {
            const fs = window.firebase.firestoreFunctions;
            const db = window.firebase.firestore();
            const petsRef = fs.collection(db, 'tenants', _taBuilding, 'list', String(_taRoom), 'pets');
            _petsUnsub = fs.onSnapshot(petsRef, snap => {
                petDataList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                try { localStorage.setItem(`tenant_pets_${_taBuilding}_${_taRoom}`, JSON.stringify(petDataList)); } catch (e) {}
                renderPetListToProfile();
            }, err => {
                console.error('[pets] subscribe failed:', err?.message);
                if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') _petsUnsub = null;
                const c = document.getElementById('pet-list-container');
                if (c && !c.querySelector('[data-err="pets"]') && !petDataList.length) {
                    c.innerHTML = '<p data-err="pets" class="ta-err-msg">โหลดไม่สำเร็จ — กรุณา Reload</p>';
                }
            });
        } catch (e) { console.warn('pets subscribe init failed:', e.message); }
    }

    function renderPetListToProfile() {
        const container = document.getElementById('pet-list-container');
        if (!container) return;

        if (petDataList.length === 0) {
            container.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 0;">
                <span style="font-size:var(--fs-md); font-weight:600; color:var(--text-muted);">สมาชิกตัวน้อย 🐾</span>
                <span data-action="showSubPage" data-page="add-pet-page" style="font-size:var(--fs-sm); color:var(--primary-green); font-weight:700; cursor:pointer; touch-action:manipulation;">+ เพิ่ม</span>
            </div>`;
            return;
        }

        let headerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <span style="font-size: var(--fs-md); font-weight: 600; color: #334435;">สมาชิกตัวน้อย 🐾</span>
            <button data-action="showSubPage--resetPetForm" data-page="add-pet-page"
                style="background: transparent; border: none; color: var(--primary-green); font-size: var(--fs-sm); font-weight: 600; cursor: pointer;">
                + เพิ่มสมาชิกเพิ่ม
            </button>
        </div>
    `;
        container.innerHTML = headerHTML;

        petDataList.forEach(pet => {
            const vaxStatusHTML = pet.isVaccinated
                ? '<p style="margin:4px 0; font-size:var(--fs-sm); color:#22c55e; font-weight: 600;">✓ ฉีดวัคซีนแล้ว</p>'
                : '<p style="margin:4px 0; font-size:var(--fs-sm); color:var(--warn); font-weight: 600;">⚠️ รออัปเดตวัคซีน</p>';

            const safeId = _esc(pet.id);
            const avatarStyle = pet.photoURL
                ? `background-image:url('${_esc(pet.photoURL)}'); background-size:cover; background-position:center;`
                : 'background: var(--soft-green);';
            const avatarInner = pet.photoURL ? '' : _esc(pet.typeEmoji);
            const html = `
        <div class="pet-item" style="animation: slideUp 0.5s ease; background: white; padding: 15px; border-radius: 20px; display: flex; align-items: center; gap: 15px; margin-bottom: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.03); border: 1px solid #f9f9f9;">
            <div class="pet-avatar" style="font-size: var(--fs-lg); ${avatarStyle} width:60px; height:60px; display:flex; align-items:center; justify-content:center; border-radius:15px; overflow:hidden;">${avatarInner}</div>
            <div class="u-flex-1">
                <strong style="font-size: var(--fs-md); color: #334435;">น้อง${_esc(pet.name)} (${_esc(pet.breed)})</strong>
                ${vaxStatusHTML}
                ${pet.alertStatusHTML || ''}
                <div style="margin-top: 5px; display:flex; flex-wrap:wrap; gap:6px;">
                    <button data-action="viewVaccineBook" data-arg="${safeId}" style="background: #e8f5e9; color: #2d8653; border: none; padding: 4px 10px; border-radius: 8px; font-size: var(--fs-sm); font-weight: 600; cursor: pointer;">
                        <i class="fas fa-book-medical"></i> ดูสมุดวัคซีน
                    </button>
                    <button data-action="openPetHealth" data-arg="${safeId}" style="background: #eef2ff; color: #4338ca; border: none; padding: 4px 10px; border-radius: 8px; font-size: var(--fs-sm); font-weight: 600; cursor: pointer;">
                        <i class="fas fa-notes-medical"></i> ประวัติสุขภาพ
                    </button>
                </div>
                <small style="opacity: 0.5; font-size: var(--fs-sm); display: block; margin-top: 4px;">เพศ${_esc(pet.gender)} | อายุ ${_esc(pet.age)}</small>
            </div>
            <i class="fas fa-edit" style="color:var(--primary-green); opacity:0.5; cursor:pointer; font-size:var(--fs-lg);" data-action="prepareEditPet" data-arg="${safeId}"></i>
        </div>`;

            container.insertAdjacentHTML('beforeend', html);
        });
    }

    function updatePetPhotoPreview(input) {
        const f = input.files && input.files[0];
        if (!f) return;
        _pendingPetPhoto = f;
        const url = URL.createObjectURL(f);
        const el = document.getElementById('new-pet-avatar');
        if (el) {
            el.style.backgroundImage = `url('${url}')`;
            el.textContent = '';
        }
    }

    async function _uploadPetFile(file, building, room, petId, kind) {
        // kind ∈ 'photo' | 'vaccineBook'
        const stg = window.firebase?.storage?.();
        const stgFs = window.firebase?.storageFunctions;
        if (!stg || !stgFs) throw new Error('Firebase Storage not initialized');
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 6);
        const path = `pets/${building}/${room}/${petId}/${kind}_${Date.now()}.${ext}`;
        const ref = stgFs.ref(stg, path);
        await stgFs.uploadBytes(ref, file, { contentType: file.type });
        const url = await stgFs.getDownloadURL(ref);
        return { url, path, fileName: file.name };
    }

    function _computePetAge(dob) {
        const birth = new Date(dob);
        const now = new Date();
        let years = now.getFullYear() - birth.getFullYear();
        let months = now.getMonth() - birth.getMonth();
        if (months < 0) { years--; months += 12; }
        if (years > 0 && months > 0) return `${years} ปี ${months} เดือน`;
        if (years > 0) return `${years} ปี`;
        if (months > 0) return `${months} เดือน`;
        const days = Math.floor((now - birth) / 86400000);
        return days > 0 ? `${days} วัน` : 'แรกเกิด';
    }

    async function saveNewPet() {
        const editId = document.getElementById('edit-pet-id').value;
        const name = document.getElementById('pet-name')?.value.trim();

        if (!name) {
            toast('กรุณาระบุชื่อน้องด้วยนะครับ', 'error');
            document.getElementById('pet-name').focus();
            return;
        }

        const typeEmoji = document.getElementById('pet-type')?.value;
        const breed = document.getElementById('pet-breed')?.value || 'ไม่ระบุสายพันธุ์';
        const gender = document.getElementById('pet-gender')?.value;
        const dob = document.getElementById('pet-dob')?.value || '';
        const age = dob ? _computePetAge(dob) : (document.getElementById('pet-age')?.value || 'ไม่ระบุอายุ');
        const isVaccinated = document.getElementById('pet-vaccine')?.checked;
        const vaxDate = document.getElementById('vaccine-date').value;
        const vaxExpiry = document.getElementById('vaccine-expiry').value;
        const vaccineFile = document.getElementById('file-upload-input')?.files?.[0] || _pendingVaccineBook;

        const existing = editId ? petDataList.find(p => p.id === editId) : null;
        // ติ๊ก "ฉีดแล้ว" = บังคับให้ข้อมูลครบ: วันที่ฉีด + วันหมดอายุ + แนบสมุดวัคซีน
        // (เงื่อนไขเดียวกับการแนบรูป — เฉพาะตอนเพิ่มใหม่; ตอนแก้ไขค่าถูก prefill ไว้แล้ว)
        if (isVaccinated && !editId && !vaxDate) {
            toast('กรุณาเลือกวันที่ฉีดวัคซีนล่าสุดด้วยนะครับ', 'error');
            document.getElementById('vaccine-date')?.focus();
            return;
        }
        if (isVaccinated && !editId && !vaxExpiry) {
            toast('กรุณาเลือกวันหมดอายุวัคซีนด้วยนะครับ', 'error');
            document.getElementById('vaccine-expiry')?.focus();
            return;
        }
        if (isVaccinated && !editId && !vaccineFile) {
            toast('กรุณาแนบสมุดวัคซีนเพื่อตรวจสอบนะครับ', 'error');
            return;
        }

        let alertStatusHTML = '';
        if (isVaccinated && vaxExpiry) {
            const today = new Date();
            const exp = new Date(vaxExpiry);
            const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) {
                alertStatusHTML = `<div style="color: var(--alert); font-size: var(--fs-sm); font-weight: 700;">🛑 วัคซีนหมดอายุแล้ว!</div>`;
            } else if (diffDays <= 30) {
                alertStatusHTML = `<div style="color: var(--warn); font-size: var(--fs-sm); font-weight: 700;">⚠️ หมดอายุใน ${diffDays} วัน</div>`;
            }
        }

        const petId = editId || Date.now().toString();
        const building = _taBuilding || 'nest';
        const room = String(_taRoom || '');

        const petObject = {
            id: petId,
            name, typeEmoji, breed, gender, age, dateOfBirth: dob || null, isVaccinated, vaxDate, vaxExpiry, alertStatusHTML,
            type: typeEmoji,
            room, building,
            status: editId ? (existing?.status || 'pending') : 'pending',
            createdAt: editId ? (existing?.createdAt || undefined) : new Date().toISOString(),
            photoURL: existing?.photoURL || null,
            photoPath: existing?.photoPath || null,
            vaccineBookURL: existing?.vaccineBookURL || null,
            vaccineBookPath: existing?.vaccineBookPath || null,
            vaccineBookFileName: existing?.vaccineBookFileName || null,
        };

        if (window.firebaseReady && _taBuilding && _taRoom) {
            if (_pendingPetPhoto) {
                try {
                    const r = await _uploadPetFile(_pendingPetPhoto, building, room, petId, 'photo');
                    petObject.photoURL = r.url;
                    petObject.photoPath = r.path;
                } catch (e) { console.warn('photo upload failed:', e); toast('อัปโหลดรูปไม่สำเร็จ — ข้อมูลที่เหลือจะบันทึกต่อ', 'warning'); }
            }
            if (vaccineFile) {
                try {
                    const r = await _uploadPetFile(vaccineFile, building, room, petId, 'vaccineBook');
                    petObject.vaccineBookURL = r.url;
                    petObject.vaccineBookPath = r.path;
                    petObject.vaccineBookFileName = r.fileName;
                } catch (e) { console.warn('vaccine book upload failed:', e); toast('อัปโหลดสมุดวัคซีนไม่สำเร็จ — ข้อมูลที่เหลือจะบันทึกต่อ', 'warning'); }
            }
        }

        if (editId) {
            const index = petDataList.findIndex(p => p.id === editId);
            if (index !== -1) petDataList[index] = { ...petDataList[index], ...petObject };
        } else {
            petDataList.push(petObject);
        }

        try {
            const key = `tenant_pets_${petObject.building}_${petObject.room}`;
            localStorage.setItem(key, JSON.stringify(petDataList));
        } catch (e) {}
        try {
            if (window.firebaseReady && window.firebase?.firestore && _taBuilding && _taRoom) {
                const db = window.firebase.firestore();
                const fs = window.firebase.firestoreFunctions;
                const petRef = fs.doc(db, 'tenants', _taBuilding, 'list', String(_taRoom), 'pets', petId);
                await fs.setDoc(petRef, petObject, { merge: true });
            }
            _pendingPetPhoto = null;
            _pendingVaccineBook = null;
            renderPetListToProfile();
            toast(`บันทึกข้อมูลน้อง${_esc(name)} เรียบร้อยแล้วครับ!`);
            resetPetForm();
            showSubPage('pet-park-page');
        } catch (e) {
            console.warn('Firestore pet save failed:', e);
            toast('บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'error');
        }
    }

    function prepareEditPet(id) {
        const pet = petDataList.find(p => p.id === id);
        if (!pet) return;

        document.getElementById('edit-pet-id').value = pet.id;
        document.getElementById('pet-name').value = pet.name;
        document.getElementById('pet-type').value = pet.typeEmoji;
        updateBreedOptions();  // swap the datalist to match this pet's type
        document.getElementById('pet-breed').value = pet.breed;
        document.getElementById('pet-gender').value = pet.gender;
        const _dobEl = document.getElementById('pet-dob');
        if (_dobEl) _dobEl.value = pet.dateOfBirth || '';
        document.getElementById('pet-vaccine').checked = pet.isVaccinated;
        document.getElementById('vaccine-date').value = pet.vaxDate;
        document.getElementById('vaccine-expiry').value = pet.vaxExpiry;

        _pendingPetPhoto = null;
        _pendingVaccineBook = null;
        const avatar = document.getElementById('new-pet-avatar');
        if (avatar) {
            if (pet.photoURL) {
                avatar.style.backgroundImage = `url('${pet.photoURL}')`;
                avatar.textContent = '';
            } else {
                avatar.style.backgroundImage = '';
                avatar.textContent = '📸';
            }
        }
        const fileNamePrev = document.getElementById('file-name-preview');
        if (fileNamePrev) fileNamePrev.innerText = pet.vaccineBookFileName ? `📄 ${pet.vaccineBookFileName} (แนบไว้แล้ว)` : '';

        showSubPage('add-pet-page');
    }

    function toggleVaccineInputs() {
        const isChecked = document.getElementById('pet-vaccine').checked;
        const inputs = document.getElementById('vaccine-inputs');
        if (inputs) {
            inputs.style.opacity = isChecked ? '1' : '0.3';
            inputs.style.pointerEvents = isChecked ? 'auto' : 'none';
        }
    }

    function updateFilePreview(input) {
        if (input.files && input.files[0]) {
            document.getElementById('file-name-preview').innerText = '📄 ' + input.files[0].name;
        }
    }

    function resetPetForm() {
        document.getElementById('edit-pet-id').value = '';
        document.getElementById('pet-name').value = '';
        document.getElementById('pet-breed').value = '';
        const _dobResetEl = document.getElementById('pet-dob');
        if (_dobResetEl) _dobResetEl.value = '';
        document.getElementById('vaccine-date').value = '';
        document.getElementById('vaccine-expiry').value = '';
        document.getElementById('pet-vaccine').checked = true;
        _pendingPetPhoto = null;
        _pendingVaccineBook = null;
        const photoInput = document.getElementById('pet-photo-input');
        if (photoInput) photoInput.value = '';
        const fileInput = document.getElementById('file-upload-input');
        if (fileInput) fileInput.value = '';
        const avatar = document.getElementById('new-pet-avatar');
        if (avatar) { avatar.style.backgroundImage = ''; avatar.textContent = '📸'; }
        const fileNamePrev = document.getElementById('file-name-preview');
        if (fileNamePrev) fileNamePrev.innerText = '';
    }

    function viewVaccineBook(id) {
        const pet = petDataList.find(p => p.id === id);
        if (!pet) return;
        if (pet.vaccineBookURL) {
            window.open(pet.vaccineBookURL, '_blank', 'noopener');
            return;
        }
        alert(`📖 ข้อมูลวัคซีนของน้อง${pet.name}\nฉีดล่าสุด: ${pet.vaxDate || '-'}\nหมดอายุ: ${pet.vaxExpiry || '-'}\n\n(ยังไม่ได้แนบสมุดวัคซีน — แก้ไขข้อมูลน้องเพื่อแนบไฟล์)`);
    }

    // Initial render (shows empty-state placeholder until subscription fires)
    renderPetListToProfile();
    // Populate the breed datalist for the default type (deferred script → DOM parsed).
    updateBreedOptions();
    // Wire subscription on load (500ms delay matches original behaviour)
    window.addEventListener('load', () => { setTimeout(_subscribePets, 500); });

    window.renderPetListToProfile = renderPetListToProfile;
    window.updateBreedOptions = updateBreedOptions;
    // Exposed for shared/tenant-pet-health.js (#9) so the health timeline reuses
    // the SAME Storage uploader (DRY) — same pets/{b}/{r}/{petId}/ prefix + rules.
    window._taUploadPetFile = _uploadPetFile;
    window.updatePetPhotoPreview = updatePetPhotoPreview;
    window.saveNewPet = saveNewPet;
    window.prepareEditPet = prepareEditPet;
    window.resetPetForm = resetPetForm;
    window.toggleVaccineInputs = toggleVaccineInputs;
    window.updateFilePreview = updateFilePreview;
    window.viewVaccineBook = viewVaccineBook;
})();
