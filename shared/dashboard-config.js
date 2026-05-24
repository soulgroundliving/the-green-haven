// shared/dashboard-config.js
// Admin configuration surfaces — owner info, building internet,
// apartment/owner logos, community documents, gamification config,
// policy CRUD, rewards CRUD.
// Extracted from shared/dashboard-extra.js on 2026-05-21 (Phase 2 S4).
// See tasks/todo.md for the full Phase 2 plan.
//
// Loaded BEFORE shared/dashboard-extra.js in dashboard.html.
//
// §7-CC window-attached cross-script vars (S1 prereq):
//   window._docsUnsub, window._rewardsAdminUnsub, window._gamificationConfigUnsub
//
// Cross-script identifiers this module READS (resolved via global lookup):
//  - OwnerConfigManager, BuildingConfig, BuildingRegistry, RoomConfigManager
//  - window.firebase, window.firebaseAuth, GAMIFICATION_LIVE
//  - showToast, window.ghConfirm

// ===== OWNER INFO PAGE =====
function initOwnerInfoPage() {
  renderOwnerInfoPage();
}

function renderOwnerInfoPage() {
  const container = document.getElementById('ownerInfoContainer');
  if (!container) return;

  const owner = OwnerConfigManager.getOwnerInfo();
  const safeLogoUrl = _safeDataUrl(owner.logoDataUrl || '');
  const safeApartmentLogoUrl = _safeDataUrl(owner.apartmentLogoDataUrl || '');
  const safeFaviconUrl = _safeDataUrl(owner.faviconDataUrl || '');

  container.innerHTML = `
    <!-- Company identity (used in tax report letterhead) -->
    <div style="background:#f8faf9; padding:1.2rem; border-left:4px solid var(--green); border-radius:6px; margin-bottom:1.5rem;">
      <div style="font-weight:700; color:var(--green-dark); margin-bottom:.6rem;">🏢 ข้อมูลบริษัท / นิติบุคคล (สำหรับใบเสร็จ + รายงานภาษี)</div>

      <!-- Company logo (B2B — used when tenant chooses "นิติบุคคล") -->
      <div style="display:flex; gap:1rem; align-items:center; margin-bottom:1rem; padding:.8rem; background:white; border:1px dashed #c8e6c9; border-radius:6px;">
        <div id="logoPreviewBox" style="width:80px; height:80px; border:1px solid #e0e0e0; border-radius:6px; display:flex; align-items:center; justify-content:center; background:#fafafa; overflow:hidden; flex-shrink:0;">
          ${safeLogoUrl ? `<img src="${safeLogoUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" alt="company logo">` : `<span style="font-size:2rem; color:#ccc;">🏢</span>`}
        </div>
        <div style="flex:1;">
          <label style="display:block; margin-bottom:.3rem; font-weight:600; font-size:.9rem;">โลโก้บริษัท (ใช้บนบิลที่ลูกบ้านเลือก "นิติบุคคล" + รายงานภาษี)</label>
          <input type="file" id="ownerLogoInput" accept="image/png,image/jpeg" onchange="uploadOwnerLogo(event)" style="font-size:.85rem;">
          <div style="font-size:.75rem; color:var(--text-muted); margin-top:.3rem;">แนะนำ: PNG โปร่งแสง, สี่เหลี่ยมจัตุรัส, ≤ 512px</div>
          ${safeLogoUrl ? `<button type="button" data-action="removeOwnerLogo" style="margin-top:.4rem; padding:.3rem .7rem; background:#ffebee; color:#c62828; border:1px solid #ef9a9a; border-radius:4px; cursor:pointer; font-size:.78rem;">🗑️ ลบโลโก้</button>` : ''}
        </div>
      </div>

      <!-- Apartment logo (B2C / default — used when tenant chooses "บุคคลธรรมดา") -->
      <div style="display:flex; gap:1rem; align-items:center; margin-bottom:1rem; padding:.8rem; background:white; border:1px dashed #c8e6c9; border-radius:6px;">
        <div id="apartmentLogoPreviewBox" style="width:80px; height:80px; border:1px solid #e0e0e0; border-radius:6px; display:flex; align-items:center; justify-content:center; background:#fafafa; overflow:hidden; flex-shrink:0;">
          ${safeApartmentLogoUrl ? `<img src="${safeApartmentLogoUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" alt="apartment logo">` : `<span style="font-size:2rem; color:#ccc;">🌿</span>`}
        </div>
        <div style="flex:1;">
          <label style="display:block; margin-bottom:.3rem; font-weight:600; font-size:.9rem;">โลโก้อพาร์ทเม้น (ใช้บนบิลที่ลูกบ้านเลือก "บุคคลธรรมดา" — default)</label>
          <input type="file" id="ownerApartmentLogoInput" accept="image/png,image/jpeg" onchange="uploadApartmentLogo(event)" style="font-size:.85rem;">
          <div style="font-size:.75rem; color:var(--text-muted); margin-top:.3rem;">แนะนำ: โลโก้แบรนด์ Nature Haven — PNG โปร่งแสง, สี่เหลี่ยมจัตุรัส, ≤ 512px. ถ้าไม่อัพ → fallback เป็น "🌿 Nature Haven"</div>
          ${safeApartmentLogoUrl ? `<button type="button" data-action="removeApartmentLogo" style="margin-top:.4rem; padding:.3rem .7rem; background:#ffebee; color:#c62828; border:1px solid #ef9a9a; border-radius:4px; cursor:pointer; font-size:.78rem;">🗑️ ลบโลโก้อพาร์ทเม้น</button>` : ''}
        </div>
      </div>

      <!-- Favicon upload -->
      <div style="display:flex; gap:1rem; align-items:center; margin-bottom:1rem; padding:.8rem; background:white; border:1px dashed #c8e6c9; border-radius:6px;">
        <div id="faviconPreviewBox" style="width:48px; height:48px; border:1px solid #e0e0e0; border-radius:6px; display:flex; align-items:center; justify-content:center; background:#fafafa; overflow:hidden; flex-shrink:0;">
          ${safeFaviconUrl ? `<img src="${safeFaviconUrl}" style="width:32px; height:32px; object-fit:contain;" alt="favicon">` : `<span style="font-size:1.4rem; color:#ccc;">🌐</span>`}
        </div>
        <div style="flex:1;">
          <label style="display:block; margin-bottom:.3rem; font-weight:600; font-size:.9rem;">ไอคอนแท็บเบราว์เซอร์ (Favicon)</label>
          <input type="file" id="ownerFaviconInput" accept="image/png,image/jpeg,image/x-icon" onchange="uploadOwnerFavicon(event)" style="font-size:.85rem;">
          <div style="font-size:.75rem; color:var(--text-muted); margin-top:.3rem;">แนะนำ: PNG สี่เหลี่ยมจัตุรัส — จะย่อเป็น 64×64 อัตโนมัติ</div>
          ${safeFaviconUrl ? `<button type="button" data-action="removeOwnerFavicon" style="margin-top:.4rem; padding:.3rem .7rem; background:#ffebee; color:#c62828; border:1px solid #ef9a9a; border-radius:4px; cursor:pointer; font-size:.78rem;">🗑️ ลบ favicon</button>` : ''}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">ชื่อนิติบุคคล (ภาษาไทย)</label>
          <input type="text" id="companyLegalNameTH" value="${(owner.companyLegalNameTH || 'บริษัท เดอะ กรีนเฮฟเว่น จำกัด').replace(/"/g,'&quot;')}" placeholder="บริษัท เดอะ กรีนเฮฟเว่น จำกัด" class="dx-field-sm">
        </div>
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">ชื่อนิติบุคคล (ภาษาอังกฤษ)</label>
          <input type="text" id="companyLegalNameEN" value="${(owner.companyLegalNameEN || 'The Green Haven Co., Ltd.').replace(/"/g,'&quot;')}" placeholder="The Green Haven Co., Ltd." class="dx-field-sm">
        </div>
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">สถานะการจดทะเบียน</label>
          <select id="registrationStatus" class="dx-field-sm">
            <option value="active" ${owner.registrationStatus !== 'pending' ? 'selected' : ''}>✅ จดทะเบียนแล้ว</option>
            <option value="pending" ${owner.registrationStatus === 'pending' ? 'selected' : ''}>⏳ อยู่ระหว่างจดทะเบียน</option>
          </select>
        </div>
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">ประเภทเอกสารที่แสดงในรายงาน</label>
          <select id="ownerEntityType" class="dx-field-sm">
            <option value="personal" ${owner.entityType !== 'company' ? 'selected' : ''}>บุคคลธรรมดา (ภ.ง.ด.90)</option>
            <option value="company" ${owner.entityType === 'company' ? 'selected' : ''}>นิติบุคคล (ภ.ง.ด.50)</option>
          </select>
        </div>
      </div>
      <small style="display:block; margin-top:.6rem; color:var(--text-muted); font-size:.8rem;">
        ค่าเหล่านี้จะแสดงใน letterhead ของรายงานภาษี (Tax Filing) + ใบเสร็จลูกบ้าน อัตโนมัติ
      </small>
    </div>

    <!-- 👤 Owner personal info — grouped card -->
    <div style="background:#fff; padding:1.4rem; border:1px solid var(--border); border-radius:8px; margin-top:1.5rem;">
      <div style="font-weight:700; font-size:1.05rem; color:var(--green-dark); margin-bottom:1rem; padding-bottom:.6rem; border-bottom:1px solid var(--border);">
        👤 ข้อมูลเจ้าของ / ผู้จัดทำ
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:1.2rem;">
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">ชื่อ-นามสกุล *</label>
          <input type="text" id="ownerName" value="${owner.name || ''}" placeholder="ชื่อเจ้าของ" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">เลขประจำตัวประชาชน *</label>
          <input type="text" id="ownerIdCard" value="${owner.idCardNumber || ''}" placeholder="เลขประจำตัวประชาชน" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">เบอร์โทรศัพท์</label>
          <input type="tel" id="ownerPhone" value="${owner.phone || ''}" placeholder="เบอร์โทรศัพท์" maxlength="10" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
          <small id="ownerPhoneError" style="display:none;color:#d32f2f;font-size:0.85rem;margin-top:4px;"></small>
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">อีเมล</label>
          <input type="email" id="ownerEmail" value="${owner.email || ''}" placeholder="อีเมล" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
      </div>
    </div>

    <!-- 🏠 Address — grouped card -->
    <div style="background:#fff; padding:1.4rem; border:1px solid var(--border); border-radius:8px; margin-top:1.2rem;">
      <div style="font-weight:700; font-size:1.05rem; color:var(--green-dark); margin-bottom:1rem; padding-bottom:.6rem; border-bottom:1px solid var(--border);">
        🏠 ที่อยู่ตามทะเบียน
      </div>
      <div style="margin-bottom:1rem;">
        <label class="dx-label" style="font-size:1rem; font-weight:600;">ที่อยู่ (เลขที่ / หมู่ / ซอย / ถนน)</label>
        <input type="text" id="ownerAddress" value="${owner.address || ''}" placeholder="เช่น 123/45 หมู่ 3 ถนนรัชดาภิเษก" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:1rem;">
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">แขวง/ตำบล</label>
          <input type="text" id="ownerSubDistrict" value="${owner.subDistrict || ''}" placeholder="แขวง/ตำบล" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">เขต/อำเภอ</label>
          <input type="text" id="ownerDistrict" value="${owner.district || ''}" placeholder="เขต/อำเภอ" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">จังหวัด</label>
          <input type="text" id="ownerProvince" value="${owner.province || ''}" placeholder="จังหวัด" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">รหัสไปรษณีย์</label>
          <input type="text" id="ownerPostalCode" value="${owner.postalCode || ''}" placeholder="รหัสไปรษณีย์" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
      </div>
    </div>

    <!-- 🏦 Bank + tax — grouped card -->
    <div style="background:#fff; padding:1.4rem; border:1px solid var(--border); border-radius:8px; margin-top:1.2rem;">
      <div style="font-weight:700; font-size:1.05rem; color:var(--green-dark); margin-bottom:1rem; padding-bottom:.6rem; border-bottom:1px solid var(--border);">
        🏦 ธนาคาร & ภาษี
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:1.2rem;">
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">เลขประจำตัวผู้เสียภาษี</label>
          <input type="text" id="ownerTaxId" value="${owner.taxId || ''}" placeholder="เลขประจำตัวผู้เสียภาษี" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
          <small style="display:block; color:var(--text-muted); font-size:.8rem; margin-top:.3rem;">บุคคลธรรมดา = เลขบัตร 13 หลัก / นิติบุคคล = เลขจดทะเบียน 13 หลัก</small>
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">ชื่อธนาคาร</label>
          <input type="text" id="ownerBankName" value="${owner.bankName || ''}" placeholder="เช่น ไทยพาณิชย์ / กสิกร" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">เลขบัญชี</label>
          <input type="text" id="ownerBankAccount" value="${owner.bankAccount || ''}" placeholder="เลขบัญชีธนาคาร" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
      </div>
    </div>

    <!-- Action buttons — Save primary, Delete subtle outlined -->
    <div style="margin-top: 2rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
      <button data-action="saveOwnerInfo" style="padding: 0.9rem 2.2rem; background: var(--green); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 1.05rem; box-shadow: 0 2px 8px rgba(76,175,80,.25);">
        💾 บันทึกข้อมูล
      </button>
      <button data-action="clearOwnerInfo" style="padding: 0.9rem 1.5rem; background: transparent; color: #d32f2f; border: 1.5px solid #ef9a9a; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: .95rem;">
        🗑️ ลบข้อมูล
      </button>
      <small style="color:var(--text-muted); font-size:.85rem; margin-left:auto;">* คือฟิลด์ที่จำเป็นสำหรับรายงานภาษี</small>
    </div>

    <!-- Per-building Internet Status (subscribed by tenant_app displayBuildingInternetStatus) -->
    <hr style="margin: 2.5rem 0 1.5rem; border: none; border-top: 1px solid var(--border);">
    <div style="font-size: 1.1rem; font-weight: 700; margin-bottom: .25rem;">🌐 สถานะอินเทอร์เน็ตอาคาร</div>
    <div style="font-size: .85rem; color: var(--text-muted); margin-bottom: 1.25rem;">
      ตั้งค่าสถานะเน็ต/ผู้ให้บริการ/ความเร็ว แยกตามตึก — ลูกบ้านจะเห็น status จริงในหน้า Services.
      <br>เก็บที่ Firestore <code>buildings/{rooms|nest}.internet</code> (real-time ผ่าน onSnapshot)
    </div>
    <div id="buildingInternetConfigContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
      <div style="text-align:center;color:var(--text-muted);padding:1rem;grid-column:span 2;">กำลังโหลด...</div>
    </div>

  `;
  // Lazy-load building internet config (after Firebase ready). Payment config
  // (PromptPay/companyName/ownerName) lives in the Buildings page since 2026-05-14
  // consolidation — see CLAUDE.md §7-T.
  if (typeof renderBuildingInternetConfig === 'function') renderBuildingInternetConfig();
}

// ===== BUILDING INTERNET CONFIG (per-building ISP + status + speed) =====
// Same pattern as payment config: writes buildings/{canonicalId}.internet (merged)
// where canonicalId ∈ {rooms, nest, ...} from BuildingRegistry (Tier 3F dynamic).
// Tenant_app subscribes via displayBuildingInternetStatus onSnapshot.
async function renderBuildingInternetConfig() {
  const container = document.getElementById('buildingInternetConfigContainer');
  if (!container) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    container.innerHTML = '<div style="color:#c62828;text-align:center;padding:1rem;grid-column:span 2;">Firestore unavailable</div>';
    return;
  }
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const [rrSnap, nestSnap] = await Promise.all([
    fs.getDoc(fs.doc(db, 'buildings', 'rooms')).catch(() => null),
    fs.getDoc(fs.doc(db, 'buildings', 'nest')).catch(() => null)
  ]);
  const rr = rrSnap?.exists() ? (rrSnap.data().internet || {}) : {};
  const nest = nestSnap?.exists() ? (nestSnap.data().internet || {}) : {};
  const esc = s => String(s ?? '').replace(/"/g, '&quot;');
  const statusOpt = (cur, v, lbl) => `<option value="${v}"${cur === v ? ' selected' : ''}>${lbl}</option>`;
  const cardHtml = (label, fsId, data) => `
    <div style="border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1.25rem; background: #fafafa;">
      <div style="font-weight: 700; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
        <span>${label}</span>
        <span style="font-size: .72rem; color: var(--text-muted); font-family: monospace;">buildings/${fsId}.internet</span>
      </div>
      <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">สถานะ</label>
      <select id="bi-${fsId}-status" style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;margin-bottom:.8rem;font-family:Sarabun,sans-serif;">
        ${statusOpt(data.status, 'online', '🟢 เชื่อมต่อแล้ว')}
        ${statusOpt(data.status, 'maintenance', '🟡 กำลังบำรุงรักษา')}
        ${statusOpt(data.status, 'offline', '🔴 ไม่เชื่อมต่อ')}
      </select>
      <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">ผู้ให้บริการ</label>
      <input type="text" id="bi-${fsId}-provider" value="${esc(data.provider)}" placeholder="เช่น True Internet" class="dx-field-sm-mb">
      <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">เบอร์ติดต่อ</label>
      <input type="tel" id="bi-${fsId}-contact" value="${esc(data.contact)}" placeholder="เช่น 1686" class="dx-field-sm-mb">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:1rem;">
        <div>
          <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">Download</label>
          <input type="text" id="bi-${fsId}-download" value="${esc(data.downloadSpeed)}" placeholder="500 Mbps" style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">
        </div>
        <div>
          <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">Upload</label>
          <input type="text" id="bi-${fsId}-upload" value="${esc(data.uploadSpeed)}" placeholder="500 Mbps" style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">
        </div>
      </div>
      <button data-action="saveBuildingInternetConfig" data-id="${fsId}" style="width:100%;padding:.65rem;background:#4caf50;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-family:Sarabun,sans-serif;">💾 บันทึก ${label}</button>
    </div>
  `;
  container.innerHTML = cardHtml('🏠 ห้องแถว', 'rooms', rr) + cardHtml('🏢 Nest', 'nest', nest);
}

async function saveBuildingInternetConfig(fsId) {
  if (!['rooms', 'nest'].includes(fsId)) return;
  const status = document.getElementById(`bi-${fsId}-status`)?.value || 'online';
  const provider = document.getElementById(`bi-${fsId}-provider`)?.value?.trim() || '';
  const contact = document.getElementById(`bi-${fsId}-contact`)?.value?.trim() || '';
  const downloadSpeed = document.getElementById(`bi-${fsId}-download`)?.value?.trim() || '';
  const uploadSpeed = document.getElementById(`bi-${fsId}-upload`)?.value?.trim() || '';
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    showToast('Firestore ไม่พร้อม', 'error');
    return;
  }
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    await fs.setDoc(fs.doc(db, 'buildings', fsId), {
      internet: {
        status, provider, contact, downloadSpeed, uploadSpeed,
        updatedAt: new Date().toISOString()
      }
    }, { merge: true });
    showToast(`✅ บันทึกสถานะเน็ต ${fsId === 'rooms' ? 'ห้องแถว' : 'Nest'} แล้ว`, 'success');
  } catch (e) {
    console.error('saveBuildingInternetConfig failed:', e);
    showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

if (typeof window !== 'undefined') {
  window.renderBuildingInternetConfig = renderBuildingInternetConfig;
  window.saveBuildingInternetConfig = saveBuildingInternetConfig;
}


// Accepts only data:image/* base64 URLs so arbitrary strings can never reach the DOM or storage.
function _safeDataUrl(v) {
  if (typeof v !== 'string' || v === '') return '';
  return /^data:image\/(png|jpeg|webp|x-icon);base64,[A-Za-z0-9+/=\r\n]+$/.test(v) ? v : '';
}

// Low-level logo write that bypasses name-required validation in OwnerConfigManager.saveOwnerInfo.
// Needed because users may upload a logo before filling in the owner name.
function _writeOwnerLogo(dataUrl) {
  const safe = _safeDataUrl(dataUrl);
  const current = OwnerConfigManager.getOwnerInfo();
  const updated = { ...current, logoDataUrl: safe };
  // Direct localStorage write (no name check)
  localStorage.setItem('owner_info', JSON.stringify(updated));
  // Best-effort Firestore sync (if signed in)
  try {
    if (window.firebase && window.firebaseAuth?.currentUser) {
      const db = window.firebase.firestore();
      const fn = window.firebase.firestoreFunctions;
      const ref = fn.doc(fn.collection(db, 'owner_info'), 'main');
      fn.setDoc(ref, { ...updated, updatedAt: new Date().toISOString() }, { merge: true })
        .catch(e => console.warn('logo Firestore sync:', e?.message));
    }
  } catch(e) { console.warn('logo sync:', e?.message); }
}

window.uploadOwnerLogo = function(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('ไฟล์ใหญ่เกิน 2MB', 'warning');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = file.type !== 'image/jpeg'
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.85);
      _writeOwnerLogo(dataUrl);
      showToast('✅ อัปโหลดโลโก้เรียบร้อย', 'success');
      renderOwnerInfoPage();
    };
    img.onerror = () => showToast('อ่านรูปไม่ได้ — ลองไฟล์อื่น', 'warning');
    img.src = e.target.result;
  };
  reader.onerror = () => showToast('อ่านไฟล์ไม่สำเร็จ', 'warning');
  reader.readAsDataURL(file);
};

window.removeOwnerLogo = function() {
  window.ghConfirm('ลบโลโก้บริษัท?', { danger: true }).then(ok => {
    if (!ok) return;
    _writeOwnerLogo('');
    showToast('ลบโลโก้แล้ว', 'success');
    renderOwnerInfoPage();
  });
};

// ===== APARTMENT LOGO (used on personal-recipient bills, default brand-friendly) =====
function _writeApartmentLogo(dataUrl) {
  const safe = _safeDataUrl(dataUrl);
  const current = OwnerConfigManager.getOwnerInfo();
  const updated = { ...current, apartmentLogoDataUrl: safe };
  localStorage.setItem('owner_info', JSON.stringify(updated));
  try {
    if (window.firebase && window.firebaseAuth?.currentUser) {
      const db = window.firebase.firestore();
      const fn = window.firebase.firestoreFunctions;
      const ref = fn.doc(fn.collection(db, 'owner_info'), 'main');
      fn.setDoc(ref, { ...updated, updatedAt: new Date().toISOString() }, { merge: true })
        .catch(e => console.warn('apartment logo Firestore sync:', e?.message));
    }
  } catch(e) { console.warn('apartment logo sync:', e?.message); }
}

window.uploadApartmentLogo = function(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('ไฟล์ใหญ่เกิน 2MB', 'warning');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = file.type !== 'image/jpeg'
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.85);
      _writeApartmentLogo(dataUrl);
      showToast('✅ อัปโหลดโลโก้อพาร์ทเม้นเรียบร้อย', 'success');
      renderOwnerInfoPage();
    };
    img.onerror = () => showToast('อ่านรูปไม่ได้ — ลองไฟล์อื่น', 'warning');
    img.src = e.target.result;
  };
  reader.onerror = () => showToast('อ่านไฟล์ไม่สำเร็จ', 'warning');
  reader.readAsDataURL(file);
};

window.removeApartmentLogo = function() {
  window.ghConfirm('ลบโลโก้อพาร์ทเม้น?', { danger: true }).then(ok => {
    if (!ok) return;
    _writeApartmentLogo('');
    showToast('ลบโลโก้อพาร์ทเม้นแล้ว', 'success');
    renderOwnerInfoPage();
  });
};

function _writeOwnerFavicon(dataUrl) {
  const safe = _safeDataUrl(dataUrl);
  const current = OwnerConfigManager.getOwnerInfo();
  const updated = { ...current, faviconDataUrl: safe };
  localStorage.setItem('owner_info', JSON.stringify(updated));
  try {
    if (window.firebase && window.firebaseAuth?.currentUser) {
      const db = window.firebase.firestore();
      const fn = window.firebase.firestoreFunctions;
      const ref = fn.doc(fn.collection(db, 'owner_info'), 'main');
      fn.setDoc(ref, { ...updated, updatedAt: new Date().toISOString() }, { merge: true })
        .catch(e => console.warn('favicon Firestore sync:', e?.message));
    }
  } catch(e) { console.warn('favicon sync:', e?.message); }
}

window.uploadOwnerFavicon = function(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 1 * 1024 * 1024) {
    showToast('ไฟล์ใหญ่เกิน 1MB', 'warning');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const SIZE = 64;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      // Crop centre-square before scaling so non-square images don't stretch.
      const minSide = Math.min(img.width, img.height);
      const sx = (img.width - minSide) / 2;
      const sy = (img.height - minSide) / 2;
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);
      const dataUrl = canvas.toDataURL('image/png');
      _writeOwnerFavicon(dataUrl);
      OwnerConfigManager.applyFavicon(dataUrl);
      showToast('✅ อัปโหลด favicon เรียบร้อย', 'success');
      renderOwnerInfoPage();
    };
    img.onerror = () => showToast('อ่านรูปไม่ได้ — ลองไฟล์อื่น', 'warning');
    img.src = e.target.result;
  };
  reader.onerror = () => showToast('อ่านไฟล์ไม่สำเร็จ', 'warning');
  reader.readAsDataURL(file);
};

window.removeOwnerFavicon = function() {
  window.ghConfirm('ลบ favicon?', { danger: true }).then(ok => {
    if (!ok) return;
    _writeOwnerFavicon('');
    OwnerConfigManager.applyFavicon('');
    showToast('ลบ favicon แล้ว', 'success');
    renderOwnerInfoPage();
  });
};

function saveOwnerInfo() {
  const name = document.getElementById('ownerName').value.trim();
  if (!name) {
    showToast('กรุณากรอกชื่อเจ้าของ', 'warning');
    return;
  }

  const existing = OwnerConfigManager.getOwnerInfo();

  const ownerData = {
    // Preserve existing logo + favicon (uploaded separately)
    logoDataUrl: existing.logoDataUrl || '',
    faviconDataUrl: existing.faviconDataUrl || '',
    // ===== COMPANY IDENTITY (used in tax report letterhead + tenant receipts) =====
    companyLegalNameTH: document.getElementById('companyLegalNameTH')?.value?.trim() || '',
    companyLegalNameEN: document.getElementById('companyLegalNameEN')?.value?.trim() || '',
    registrationStatus: document.getElementById('registrationStatus')?.value || 'active',
    entityType: document.getElementById('ownerEntityType')?.value || 'personal',
    // ===== BASIC INFO =====
    name: name,
    idCardNumber: document.getElementById('ownerIdCard').value.trim(),
    phone: document.getElementById('ownerPhone').value.trim(),
    email: document.getElementById('ownerEmail').value.trim(),
    address: document.getElementById('ownerAddress').value.trim(),
    subDistrict: document.getElementById('ownerSubDistrict').value.trim(),
    district: document.getElementById('ownerDistrict').value.trim(),
    province: document.getElementById('ownerProvince').value.trim(),
    postalCode: document.getElementById('ownerPostalCode').value.trim(),

    // ===== TAX & BANKING =====
    taxId: document.getElementById('ownerTaxId').value.trim(),
    bankName: document.getElementById('ownerBankName').value.trim(),
    bankAccount: document.getElementById('ownerBankAccount').value.trim(),

    // ===== ACCOUNTING INFO =====
    operationStartDate: document.getElementById('ownerOperationStartDate')?.value?.trim() || '',
    businessType: document.getElementById('ownerBusinessType')?.value || 'residential_rental',
    businessCategory: document.getElementById('ownerBusinessCategory')?.value?.trim() || ''
  };

  // Use Firebase-enabled save if available
  if (typeof OwnerConfigManager.saveOwnerInfoWithFirebase === 'function') {
    OwnerConfigManager.saveOwnerInfoWithFirebase(ownerData);
  } else {
    OwnerConfigManager.saveOwnerInfo(ownerData);
  }
  showToast('บันทึกข้อมูลเจ้าของสำเร็จ', 'success');
  renderOwnerInfoPage();
}

function clearOwnerInfo() {
  window.ghConfirm('ลบข้อมูลเจ้าของทั้งหมด? การดำเนินการนี้กู้คืนไม่ได้', { danger: true }).then(ok => {
    if (!ok) return;
    OwnerConfigManager.clearOwnerInfo();
    showToast('ลบข้อมูลเรียบร้อย', 'success');
    renderOwnerInfoPage();
  });
}


// ===== COMMUNITY DOCUMENTS MANAGEMENT =====
// §7-CC: _docsUnsub window-attached so cleanupAdminListeners + future extracted
// dashboard-config.js can read it cross-script.
window._docsUnsub = null;
let _docsCache = null; // null = not yet hydrated from Firestore; falls back to localStorage

function initCommunityDocsPage() {
  loadAndRenderCommunityDocs();
  if (window._docsUnsub) return;
  if (!window.firebase?.firestore) return;
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const col = fs.collection(db, 'communityDocuments');
    window._docsUnsub = fs.onSnapshot(col, snap => {
      const remote = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const local = _docsCache || JSON.parse(localStorage.getItem('community_documents_data') || '[]');
      const byId = new Map();
      local.forEach(d => byId.set(d.id, d));
      remote.forEach(d => byId.set(d.id, d)); // Firestore wins on id collision
      _docsCache = Array.from(byId.values());
      localStorage.setItem('community_documents_data', JSON.stringify(_docsCache));
      loadAndRenderCommunityDocs();
    }, err => console.warn('docs onSnapshot failed:', err));
  } catch(e) { console.warn('docs subscribe failed:', e); }
}

function loadAndRenderCommunityDocs() {
  const list = document.getElementById('docsList');
  if (!list) return;

  let docs = (_docsCache ?? JSON.parse(localStorage.getItem('community_documents_data') || '[]')).slice();
  const searchVal = document.getElementById('docSearch')?.value.toLowerCase() || '';

  if (searchVal) {
    docs = docs.filter(d =>
      d.title.toLowerCase().includes(searchVal) ||
      d.category.toLowerCase().includes(searchVal)
    );
  }

  // Group by category
  const grouped = {};
  docs.forEach(d => {
    if (!grouped[d.category]) grouped[d.category] = [];
    grouped[d.category].push(d);
  });

  if (docs.length === 0) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">📭 No documents added</div>';
    return;
  }

  list.innerHTML = Object.entries(grouped).map(([category, items]) => `
    <div style="margin-bottom: 2rem;">
      <div style="font-weight: 700; font-size: 0.95rem; color: var(--green-dark); margin-bottom: 1rem; border-bottom: 2px solid var(--green-pale); padding-bottom: 0.5rem;">📑 ${category}</div>
      ${items.map(d => `
        <div class="card" style="margin-bottom: 1rem; border-left: 4px solid #1976d2;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="flex: 1;">
              <div style="font-weight: 700;">📄 ${d.title}</div>
              <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">Type: <strong>${d.fileType || '-'}</strong></div>
              ${d.description ? `<div style="font-size: 0.9rem; margin-top: 0.5rem;">${d.description}</div>` : ''}
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <a href="${d.fileUrl}" target="_blank" class="compact-btn compact-btn-view">📥 View</a>
              <button data-action="deleteDocument" data-id="${d.id}" class="compact-btn compact-btn-delete">🗑️</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function toggleAddDocForm() {
  const form = document.getElementById('addDocForm');
  if (!form) return;
  form.classList.toggle('u-hidden');
  if (!form.classList.contains('u-hidden')) {
    document.getElementById('docTitle').focus();
  }
}

async function saveCommunityDocument() {
  const title = document.getElementById('docTitle')?.value.trim();
  const category = document.getElementById('docCategory')?.value;
  let fileType = document.getElementById('docType')?.value.trim();
  let fileUrl = document.getElementById('docUrl')?.value.trim();
  const description = document.getElementById('docDescription')?.value.trim();
  const fileInput = document.getElementById('docFile');
  const file = fileInput?.files?.[0] || null;

  if (!title || !category) {
    showToast('กรุณากรอก Title และ Category', 'warning');
    return;
  }
  if (!file && !fileUrl) {
    showToast('กรุณาอัพไฟล์ หรือกรอก URL', 'warning');
    return;
  }
  if (file && file.size > 5 * 1024 * 1024) {
    showToast('ไฟล์ใหญ่เกิน 5 MB', 'warning');
    return;
  }

  const docId = 'doc_' + Date.now();

  // If admin uploaded a file: push to Firebase Storage, then use downloadURL.
  // Falls back to manually-entered URL when no file was selected.
  if (file && window.firebase?.storage && window.firebase?.storageFunctions) {
    try {
      showToast('📤 กำลังอัพโหลดไฟล์...', 'info');
      const storage = window.firebase.storage();
      const { ref: sRef, uploadBytes, getDownloadURL } = window.firebase.storageFunctions;
      // Sanitize filename — keep extension, strip path traversal
      const safeName = file.name.replace(/[^\w.฀-๿-]+/g, '_').slice(-80);
      const fileRef = sRef(storage, `communityDocuments/${docId}/${safeName}`);
      const snap = await uploadBytes(fileRef, file);
      fileUrl = await getDownloadURL(snap.ref);
      // Auto-detect fileType from extension if admin didn't fill it
      if (!fileType) {
        const ext = (safeName.split('.').pop() || '').toLowerCase();
        fileType = ext || (file.type.startsWith('image/') ? 'image' : 'file');
      }
    } catch (e) {
      console.error('Doc upload failed:', e);
      showToast('❌ อัพโหลดไม่สำเร็จ: ' + (e?.message || e), 'error');
      return;
    }
  }

  const newDoc = {
    id: docId,
    title: title,
    category: category,
    description: description,
    fileUrl: fileUrl,
    fileType: fileType,
    building: 'rooms',
    uploadedDate: new Date().toISOString()
  };

  // Optimistic update via in-memory cache; onSnapshot writes localStorage + confirms
  _docsCache = (_docsCache || JSON.parse(localStorage.getItem('community_documents_data') || '[]')).concat(newDoc);

  // Firestore write must be awaited; previously fire-and-forget hid failures (§7-N silent failure).
  if (window.firebase?.firestore) {
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      await fs.setDoc(fs.doc(fs.collection(db, 'communityDocuments'), newDoc.id), newDoc);
    } catch(e) {
      console.warn('Firestore doc save failed:', e);
      // Roll back optimistic cache so UI doesn't lie about a successful save
      _docsCache = (_docsCache || []).filter(d => d.id !== newDoc.id);
      showToast('❌ บันทึกเอกสารไม่สำเร็จ: ' + (e?.message || e), 'error');
      return;
    }
  }

  ['docTitle', 'docCategory', 'docType', 'docUrl', 'docDescription'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const _fileInput = document.getElementById('docFile');
  if (_fileInput) _fileInput.value = '';

  toggleAddDocForm();
  loadAndRenderCommunityDocs();
  showToast('✅ Document added successfully', 'success');
}

function deleteDocument(id) {
  window.ghConfirm('ลบเอกสารนี้?', { danger: true }).then(ok => {
    if (!ok) return;
    // Optimistic update via in-memory cache; onSnapshot confirms
    _docsCache = (_docsCache || JSON.parse(localStorage.getItem('community_documents_data') || '[]')).filter(d => d.id !== id);
    if (window.firebase?.firestore) {
      try {
        const db = window.firebase.firestore();
        const fs = window.firebase.firestoreFunctions;
        fs.deleteDoc(fs.doc(fs.collection(db, 'communityDocuments'), id));
      } catch(e) { console.warn('Firestore doc delete failed:', e); }
    }
    loadAndRenderCommunityDocs();
    showToast('✅ Document deleted', 'success');
  });
}


// ===== GAMIFICATION PAGE =====
async function initGamificationPage() {
  console.log('✅ Gamification page initialized');
  subscribeGamificationConfig();

  const tbody = document.getElementById('leaderboardTable');
  if (!tbody) return;

  // Build tenant list from TenantConfigManager across both buildings
  const roomsTenants = TenantConfigManager.getTenantList('rooms').map(t => ({ ...t, building: 'rooms' }));
  const nestTenants  = TenantConfigManager.getTenantList('nest').map(t => ({ ...t, building: 'nest' }));
  const allTenants   = [...roomsTenants, ...nestTenants];

  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);">กำลังโหลด…</td></tr>';
    window.addEventListener('firebaseInitialized', () => initGamificationPage(), { once: true });
    return;
  }

  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);">กำลังโหลดข้อมูลจาก Firestore…</td></tr>';

  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();

  // Fetch the full per-building list collection in parallel rather than firing
  // one getDoc per tenant. Same Firestore document-read count, but two
  // network round-trips instead of N. With ~30 tenants the latency win is
  // small; main benefit is the cleaner pattern when the building grows.
  let dataByKey = new Map();
  try {
    const [roomsSnap, nestSnap] = await Promise.all([
      fs.getDocs(fs.collection(db, 'tenants/rooms/list')),
      fs.getDocs(fs.collection(db, 'tenants/nest/list'))
    ]);
    roomsSnap.forEach(d => dataByKey.set('rooms/' + d.id, d.data()));
    nestSnap.forEach(d => dataByKey.set('nest/' + d.id, d.data()));
  } catch (e) {
    console.warn('leaderboard: bulk tenant fetch failed, points will show 0:', e?.message || e);
  }

  const results = allTenants.map(t => {
    // Local TenantConfigManager exposes tenants by `roomId`. The legacy
    // `t.id`/`t.room` aliases were never populated, so the lookup always
    // missed and points/badges defaulted to 0 across the board.
    const roomId = t.roomId || t.id || t.room;
    const data = roomId ? (dataByKey.get(t.building + '/' + roomId) || {}) : {};
    return {
      ...t,
      roomId,
      // The canonical SSoT doc holds the tenant's display name; the local
      // config object only has room metadata. Prefer Firestore name fields.
      name: data.name || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : null) || t.name,
      points: data.gamification?.points || 0,
      badges: data.gamification?.badges || []
    };
  });

  // Drop vacant rooms — no tenant name means there's no one to rank.
  const scored = results
    .filter(t => t.name)
    .map(t => {
      const tier = window.GamificationRules
        ? window.GamificationRules.getLevelForPoints(t.points)
        : { emoji: '🌱', name: 'Seedling' };
      return { name: t.name, points: t.points, rank: `${tier.emoji} ${tier.name}`, badges: t.badges };
    })
    .sort((a, b) => b.points - a.points);

  if (scored.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);">ยังไม่มีข้อมูลผู้เช่า</td></tr>';
    return;
  }

  tbody.innerHTML = scored.map((t, i) => `
    <tr>
      <td style="text-align:center;font-weight:700;">${i + 1}</td>
      <td>${t.name}</td>
      <td style="text-align:center;font-weight:600;">${t.points.toLocaleString()}</td>
      <td style="text-align:center;font-size:0.85rem;">${t.rank}</td>
    </tr>`).join('');

  // Cache for badge tab use
  window._gamificationScored = scored;
}

function switchGamificationTab(tabName, btn) {
  document.querySelectorAll('[id^="gamification"]').forEach(el => {
    el.classList.add('u-hidden');
    // Static HTML ships gamification tabs with inline display:none/block.
    // Clear the inline rule so the class controls visibility from now on.
    if (el.style.display) el.style.display = '';
  });
  const sel = document.getElementById('gamification' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  if (sel) {
    sel.classList.remove('u-hidden');
    if (sel.style.display) sel.style.display = '';
  }
  // Scope to the 3 tab buttons only (Leaderboard/Badges/Rewards) — not every
  // button under #page-gamification. The earlier broad selector applied the
  // .u-gamification-tab `!important` color override to + Add Reward / Save /
  // Cancel / Edit / Delete buttons too, dimming their inline color:white.
  document.querySelectorAll('#page-gamification button[data-action="switchGamificationTab"]').forEach(b => {
    b.classList.remove('u-gamification-tab-active');
    b.classList.add('u-gamification-tab');
  });
  btn.classList.add('u-gamification-tab-active');
  if (tabName === 'rewards' && typeof loadRewardsAdmin === 'function') loadRewardsAdmin();
  if (tabName === 'badges') loadBadgesAdmin();
}

// ===== GAMIFICATION LIVE TOGGLE =====
// §7-CC: _gamificationConfigUnsub window-attached so cleanupAdminListeners +
// future extracted dashboard-config.js can read it cross-script.
window._gamificationConfigUnsub = null;
function subscribeGamificationConfig() {
  if (window._gamificationConfigUnsub) return;
  if (!window.firebase?.firestoreFunctions) return;
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    window._gamificationConfigUnsub = fs.onSnapshot(fs.doc(db, 'system', 'config'), snap => {
      const live = snap.exists() ? snap.data().gamificationLive === true : false;
      renderGamificationToggle(live);
    }, err => console.warn('gamificationConfig dashboard subscribe failed:', err.message));
  } catch(e) { console.warn('gamificationConfig subscribe init failed:', e.message); }
}
function renderGamificationToggle(live) {
  const btn = document.getElementById('gamificationToggleBtn');
  const status = document.getElementById('gamificationLiveStatus');
  if (!btn || !status) return;
  btn.dataset.state = live ? 'on' : 'off';
  btn.textContent = live ? '⏸ ปิด Gamification' : '🚀 เปิด Gamification';
  btn.style.background = live ? '#c62828' : 'var(--green-dark)';
  status.textContent = live
    ? '🟢 Live — ลูกบ้าน Nest เห็น gamification แล้ว'
    : '🔴 ปิดอยู่ (Pre-launch) — Coming Soon badges แสดงอยู่';
}
async function toggleGamification() {
  const btn = document.getElementById('gamificationToggleBtn');
  const goingLive = btn?.dataset.state !== 'on';
  const msg = goingLive
    ? 'เปิด Gamification ให้ลูกบ้าน Nest เห็น daily modal, badges, rewards?\nการเปลี่ยนแปลงมีผลทันที'
    : 'ปิด Gamification? ลูกบ้านจะเห็น Coming Soon badges อีกครั้ง';
  const ok = await window.ghConfirm(msg, { danger: !goingLive });
  if (!ok) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    if (typeof showToast === 'function') showToast('Firestore ไม่พร้อม', 'error');
    return;
  }
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    await fs.setDoc(fs.doc(db, 'system', 'config'),
      { gamificationLive: goingLive, gamificationUpdatedAt: new Date().toISOString() },
      { merge: true }
    );
    if (typeof showToast === 'function')
      showToast(goingLive ? '🚀 Gamification เปิดแล้ว' : '⏸ ปิด Gamification แล้ว', 'success');
  } catch(e) {
    console.error('toggleGamification failed:', e);
    if (typeof showToast === 'function') showToast('เปลี่ยนสถานะไม่สำเร็จ: ' + e.message, 'error');
  }
}
if (typeof window !== 'undefined') {
  window.toggleGamification = toggleGamification;
  window.subscribeGamificationConfig = subscribeGamificationConfig;
}

function loadBadgesAdmin() {
  const container = document.getElementById('gamificationBadgesContent');
  if (!container) return;

  const catalog = window.GamificationRules?.BADGE_CATALOG;
  if (!catalog) {
    container.innerHTML = '<p style="color:var(--text-muted)">ไม่พบ BADGE_CATALOG — โหลด shared/gamification-rules.js</p>';
    return;
  }

  const scored = window._gamificationScored || [];

  container.innerHTML = catalog.map(badge => {
    const earnedBy = scored.filter(t => Array.isArray(t.badges) && t.badges.some(b => (b.id || b) === badge.id));
    const count = earnedBy.length;
    return `
      <div style="background:var(--green-pale);border-radius:10px;padding:1rem;text-align:center;position:relative;">
        <div style="font-size:2rem;margin-bottom:.4rem;">${badge.emoji || '🏅'}</div>
        <div style="font-weight:700;font-size:.95rem;">${badge.label || badge.name || badge.id}</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem;">≥ ${(badge.minPts || 0).toLocaleString()} pts</div>
        <div style="margin-top:.6rem;background:${count > 0 ? '#dcfce7' : '#f1f5f9'};color:${count > 0 ? '#166534' : '#64748b'};border-radius:20px;padding:2px 10px;font-size:.8rem;font-weight:600;display:inline-block;">
          ${count > 0 ? `${count} คน ได้รับแล้ว` : 'ยังไม่มีผู้รับ'}
        </div>
        ${count > 0 ? `<div style="margin-top:.4rem;font-size:.75rem;color:var(--text-muted);">${earnedBy.slice(0,3).map(t=>t.name).join(', ')}${count > 3 ? ` +${count-3}` : ''}</div>` : ''}
      </div>`;
  }).join('');
}


// ===== POLICY ADMIN CRUD (Firestore `system/policies`) =====
// Tenant app subscribes via _subscribePolicies() and renders sanitized HTML live.
// Admin UI is a contenteditable rich-text editor (shared/rich-text-policy.js).
async function loadPoliciesAdmin() {
  const KEYS = ['privacy', 'terms', 'compliance', 'ip'];
  const ID_MAP = {
    privacy: 'policy-privacy-content',
    terms:   'policy-terms-content',
    compliance: 'policy-compliance-content',
    ip:      'policy-ip-content'
  };

  // Mount editors immediately so the UI is responsive even if Firestore is slow
  // or the read fails. mountEditor is idempotent — content updates after fetch.
  KEYS.forEach(key => {
    const wrap = document.getElementById(`policy-admin-${key}`);
    if (!wrap || !window.RichTextPolicy?.mountEditor) return;
    if (wrap.dataset.rtMounted !== '1') {
      wrap._rtEditor = window.RichTextPolicy.mountEditor(wrap, '');
    }
  });

  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  try {
    const snap = await fs.getDoc(fs.doc(db, 'system', 'policies'));
    const data = snap.exists() ? (snap.data() || {}) : {};

    const missing = KEYS.filter(k => !data[k]);
    if (missing.length) {
      try {
        const resp = await fetch('/tenant_app.html');
        const html = await resp.text();
        const parser = new DOMParser();
        const tenantDoc = parser.parseFromString(html, 'text/html');
        function _htmlToPlain(el) {
          el.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
          el.querySelectorAll('p,div').forEach(b => { if (b.nextSibling) b.insertAdjacentText('afterend', '\n'); });
          return (el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
        }
        const seedData = {};
        missing.forEach(k => {
          const el = tenantDoc.getElementById(ID_MAP[k]);
          if (el) seedData[k] = _htmlToPlain(el);
        });
        if (Object.keys(seedData).length) {
          await fs.setDoc(fs.doc(db, 'system', 'policies'), seedData, { merge: true });
          Object.assign(data, seedData);
        }
      } catch(e) { console.warn('policy seed failed:', e.message); }
    }

    // Update editor content with fetched data (mount call is idempotent — re-mounting
    // just updates the contenteditable's innerHTML through _setContent).
    KEYS.forEach(key => {
      const wrap = document.getElementById(`policy-admin-${key}`);
      if (!wrap || !data[key]) return;
      if (window.RichTextPolicy?.mountEditor) {
        wrap._rtEditor = window.RichTextPolicy.mountEditor(wrap, data[key]);
      } else {
        wrap.textContent = data[key];
      }
    });
  } catch(e) { console.warn('loadPoliciesAdmin:', e.message); }
}

async function savePolicyDoc(key) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const wrap = document.getElementById(`policy-admin-${key}`);
  if (!wrap) return;
  // Editor mounted by rich-text-policy.js stores the contenteditable on `_rtEditor`.
  // Sanitize via the same helper tenant_app uses, so admin and tenant agree on output.
  const editor = wrap._rtEditor || wrap.querySelector('.rt-content');
  let content = '';
  if (editor && window.RichTextPolicy?.getContent) {
    content = window.RichTextPolicy.getContent(editor);
  } else if (wrap.value !== undefined) {
    content = String(wrap.value || '').trim();
  } else {
    content = (wrap.textContent || '').trim();
  }
  const btn = document.getElementById(`policy-save-${key}`);
  const orig = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    await fs.setDoc(fs.doc(db, 'system', 'policies'), { [key]: content }, { merge: true });
    if (btn) { btn.textContent = '✅ บันทึกแล้ว'; setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 2000); }
    if (typeof showToast === 'function') showToast('บันทึก Policy แล้ว — ลูกบ้านเห็นทันที', 'success');
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    if (typeof showToast === 'function') showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

// ===== REWARDS ADMIN CRUD (Firestore `rewards/` collection) =====
// §7-CC: _rewardsAdminUnsub window-attached so cleanupAdminListeners + future
// extracted dashboard-config.js can read it cross-script.
window._rewardsAdminUnsub = null;
let _rewardsAdminCache = [];

function loadRewardsAdmin() {
  if (window._rewardsAdminUnsub) return; // idempotent
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const colRef = fs.collection(db, 'rewards');
  window._rewardsAdminUnsub = fs.onSnapshot(colRef, snap => {
    _rewardsAdminCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 999) - (b.order || 999));
    renderRewardsAdminTable();
  }, err => {
    console.warn('rewards admin onSnapshot failed:', err);
    document.getElementById('rewardsAdminTable').innerHTML = `<tr><td colspan="7" style="text-align:center;color:#c62828;padding:20px;">Failed to load: ${_esc(err.message)}</td></tr>`;
  });
}

function renderRewardsAdminTable() {
  const tbody = document.getElementById('rewardsAdminTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!_rewardsAdminCache.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted);">No rewards yet — click "+ Add Reward" to create one</td>';
    tbody.appendChild(tr);
    return;
  }
  // DOM API to avoid XSS — admin-controlled fields still escape to be safe
  const esc = s => String(s == null ? '' : s);
  _rewardsAdminCache.forEach(r => {
    const tr = document.createElement('tr');
    const tdOrder = document.createElement('td'); tdOrder.textContent = r.order || '—'; tr.appendChild(tdOrder);
    const tdIcon = document.createElement('td'); tdIcon.style.fontSize = '1.4rem'; tdIcon.textContent = r.icon || '🎁'; tr.appendChild(tdIcon);
    const tdName = document.createElement('td'); tdName.textContent = esc(r.name); tr.appendChild(tdName);
    const tdCost = document.createElement('td'); tdCost.textContent = Number(r.cost || 0).toLocaleString(); tr.appendChild(tdCost);
    const tdActive = document.createElement('td');
    tdActive.innerHTML = r.active === false
      ? '<span style="color:#c62828;font-weight:600;">No</span>'
      : '<span style="color:var(--green-dark);font-weight:600;">Yes</span>';
    tr.appendChild(tdActive);
    const tdQuota = document.createElement('td');
    tdQuota.className = 'u-text-sm u-color-muted';
    if (Number(r.monthlyQuota) > 0) {
      const quotaSpan = document.createElement('span');
      quotaSpan.style.cssText = 'display:inline-block;background:#fff3e0;color:#e65100;border:1px solid #ffb74d;border-radius:4px;padding:1px 6px;font-size:.78rem;font-weight:700;';
      quotaSpan.textContent = `🎯 ${r.monthlyQuota} ครั้ง/เดือน`;
      tdQuota.appendChild(quotaSpan);
    } else {
      tdQuota.textContent = '∞ ไม่จำกัด';
      tdQuota.style.color = 'var(--text-muted)';
    }
    tr.appendChild(tdQuota);
    const tdActions = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit'; editBtn.className = 'u-btn-tbl-edit';
    editBtn.addEventListener('click', () => openRewardEdit(r.id));
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete'; delBtn.className = 'u-btn-tbl-del';
    delBtn.addEventListener('click', () => deleteReward(r.id, r.name));
    tdActions.appendChild(editBtn); tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
}

function openRewardEdit(rewardId) {
  const modal = document.getElementById('rewardEditModal');
  if (!modal) return;
  const isNew = !rewardId;
  document.getElementById('rewardEditTitle').textContent = isNew ? '+ Add Reward' : 'Edit Reward';
  document.getElementById('rewardEditId').value = rewardId || '';
  if (isNew) {
    document.getElementById('rewardEditName').value = '';
    document.getElementById('rewardEditCost').value = '';
    document.getElementById('rewardEditIcon').value = '🎁';
    document.getElementById('rewardEditOrder').value = (_rewardsAdminCache.length + 1);
    document.getElementById('rewardEditMonthlyQuota').value = 0;
    document.getElementById('rewardEditActive').checked = true;
  } else {
    const r = _rewardsAdminCache.find(x => x.id === rewardId);
    if (!r) return;
    document.getElementById('rewardEditName').value = r.name || '';
    document.getElementById('rewardEditCost').value = r.cost || '';
    document.getElementById('rewardEditIcon').value = r.icon || '🎁';
    document.getElementById('rewardEditOrder').value = r.order || 99;
    document.getElementById('rewardEditMonthlyQuota').value = Number(r.monthlyQuota || 0);
    document.getElementById('rewardEditActive').checked = r.active !== false;
  }
  modal.style.display = 'flex';
  modal.classList.remove('u-hidden');
}

function closeRewardEdit() {
  const modal = document.getElementById('rewardEditModal');
  if (!modal) return;
  modal.style.display = '';
  modal.classList.add('u-hidden');
}

async function saveReward() {
  const id = document.getElementById('rewardEditId').value;
  const name = document.getElementById('rewardEditName').value.trim();
  const cost = parseInt(document.getElementById('rewardEditCost').value, 10);
  const icon = document.getElementById('rewardEditIcon').value.trim() || '🎁';
  const order = parseInt(document.getElementById('rewardEditOrder').value, 10) || 99;
  const monthlyQuota = Math.max(0, parseInt(document.getElementById('rewardEditMonthlyQuota').value, 10) || 0);
  const active = document.getElementById('rewardEditActive').checked;
  if (!name || !cost || cost < 1) {
    window.ghAlert('กรุณากรอกชื่อและคะแนน (>0)', { title: 'ข้อมูลไม่ครบ' });
    return;
  }
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    window.ghAlert('Firestore ไม่พร้อมใช้งาน', { title: 'ขัดข้อง' });
    return;
  }
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const now = new Date().toISOString();
  // Removed `note` — quota-only mode. Tenant_app + CF auto-generate alert text.
  const data = { name, cost, icon, order, monthlyQuota, active, updatedAt: now };
  try {
    if (id) {
      await fs.updateDoc(fs.doc(db, 'rewards', id), data);
    } else {
      // Auto-generate id from name slug + timestamp suffix for stable URL-friendly key
      const slug = name.toLowerCase().replace(/[^\u0E00-\u0E7Fa-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
      const newId = `${slug}-${Date.now().toString(36)}`;
      await fs.setDoc(fs.doc(db, 'rewards', newId), { ...data, createdAt: now });
    }
    closeRewardEdit();
    showToast(id ? '✅ บันทึกแล้ว' : '✅ เพิ่มของรางวัลแล้ว', 'success');
  } catch (e) {
    window.ghAlert('บันทึกไม่สำเร็จ: ' + e.message, { title: 'ขัดข้อง' });
  }
}

async function deleteReward(rewardId, rewardName) {
  const ok = await window.ghConfirm(`ลบของรางวัล "${rewardName}"? การดำเนินการนี้กู้คืนไม่ได้`, { danger: true });
  if (!ok) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  try {
    await fs.deleteDoc(fs.doc(db, 'rewards', rewardId));
  } catch (e) {
    window.ghAlert('ลบไม่สำเร็จ: ' + e.message, { title: 'ขัดข้อง' });
  }
}

// Expose for inline onclick handlers
if (typeof window !== 'undefined') {
  window.loadRewardsAdmin = loadRewardsAdmin;
  window.openRewardEdit = openRewardEdit;
  window.closeRewardEdit = closeRewardEdit;
  window.saveReward = saveReward;
  window.deleteReward = deleteReward;
}

