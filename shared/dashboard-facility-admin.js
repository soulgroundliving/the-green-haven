// ===== FACILITY BOOKING MANAGEMENT (Tier 3G) =====

let _facilityBookingsUnsub = null;

/**
 * Called once when the Facility tab is first opened.
 * Populates the building selector and sets today's date.
 */
function initFacilityBookingsTab() {
  _populateFacilityBuildingSelector();
  const dateEl = document.getElementById('facility-admin-date');
  if (dateEl && !dateEl.value) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }
  renderFacilityBookings();
  renderFacilityConfigList();
}

function _populateFacilityBuildingSelector() {
  const sel = document.getElementById('facility-admin-building');
  if (!sel) return;
  const buildings = (window.BuildingRegistry?.list()?.map(b => b.id)) || ['rooms', 'nest'];
  const current = sel.value;
  sel.innerHTML = buildings.map(id => {
    const label = window.BuildingRegistry?.list()?.find(b => b.id === id)?.name || id;
    return `<option value="${id}">${label}</option>`;
  }).join('');
  if (current && buildings.includes(current)) sel.value = current;
}

/** Called by data-action="facilityAdminFilter" on any filter change. */
function facilityAdminFilter() {
  renderFacilityBookings();
  renderFacilityConfigList();
}

/**
 * Subscribe to bookings for the current filter, render rows.
 * Cleans up previous subscription first.
 */
function renderFacilityBookings() {
  if (!window.FacilityBookingManager) {
    const el = document.getElementById('facility-admin-bookings-list');
    if (el) el.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:2rem;">⚠️ กำลังโหลดโมดูล...</div>';
    return;
  }

  const building = document.getElementById('facility-admin-building')?.value || '';
  const type     = document.getElementById('facility-admin-type')?.value    || '';
  const date     = document.getElementById('facility-admin-date')?.value    || new Date().toISOString().slice(0, 10);
  const list     = document.getElementById('facility-admin-bookings-list');

  if (!building || !list) return;

  if (_facilityBookingsUnsub) { _facilityBookingsUnsub(); _facilityBookingsUnsub = null; }

  list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:2rem;">⏳ กำลังโหลด...</div>';

  _facilityBookingsUnsub = window.FacilityBookingManager.subscribeAdminBookings(
    building, type || null, date,
    function(bookings) {
      if (!bookings.length) {
        list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:2rem;">ไม่มีการจองในวันนี้</div>';
        return;
      }
      const TIME_LABEL = { morning: 'เช้า', afternoon: 'บ่าย', evening: 'เย็น', fullday: 'ทั้งวัน' };
      const STATUS_STYLE = {
        confirmed: 'background:#d1fae5;color:#065f46;',
        cancelled: 'background:#fee2e2;color:#991b1b;',
      };
      list.innerHTML = `
        <div class="u-scroll-x">
          <table style="width:100%;border-collapse:collapse;font-size:.875rem;">
            <thead>
              <tr style="border-bottom:2px solid var(--border);">
                <th class="u-td-l" style="padding:8px 10px;">ประเภท</th>
                <th class="u-td-l" style="padding:8px 10px;">Slot</th>
                <th class="u-td-l" style="padding:8px 10px;">ช่วงเวลา</th>
                <th class="u-td-l" style="padding:8px 10px;">ห้อง / ชื่อ</th>
                <th class="u-td-l" style="padding:8px 10px;">วันที่</th>
                <th class="u-td-l" style="padding:8px 10px;">สถานะ</th>
                <th class="u-td-l" style="padding:8px 10px;"></th>
              </tr>
            </thead>
            <tbody>
              ${bookings.map(b => `
                <tr style="border-bottom:1px solid var(--border);">
                  <td style="padding:8px 10px;">${window.FacilityBookingManager.getFacilityEmoji(b.facilityType)} ${window.FacilityBookingManager.getFacilityLabel(b.facilityType)}</td>
                  <td style="padding:8px 10px;font-weight:600;">${b.slot}</td>
                  <td style="padding:8px 10px;">${TIME_LABEL[b.timeSlot] || b.timeSlot}</td>
                  <td style="padding:8px 10px;">${b.tenantRoom ? `ห้อง ${b.tenantRoom}` : ''}${b.tenantName ? ` · ${b.tenantName}` : ''}</td>
                  <td style="padding:8px 10px;">${b.date}</td>
                  <td style="padding:8px 10px;">
                    <span style="padding:2px 8px;border-radius:4px;font-size:.8rem;font-weight:600;${STATUS_STYLE[b.status] || ''}">
                      ${b.status === 'confirmed' ? '✅ ยืนยัน' : b.status === 'cancelled' ? '❌ ยกเลิก' : b.status}
                    </span>
                  </td>
                  <td style="padding:8px 10px;">
                    ${b.status === 'confirmed'
                      ? `<button data-action="facilityAdminCancel" data-id="${b.id}" style="padding:4px 10px;background:#fee2e2;color:#991b1b;border:none;border-radius:6px;font-size:.8rem;cursor:pointer;font-weight:600;">ยกเลิก</button>`
                      : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;
    }
  );
}

/** Admin cancel a booking by ID. */
async function facilityAdminCancel(bookingId) {
  if (!window.FacilityBookingManager) return;
  if (!confirm('ยืนยันการยกเลิกการจองนี้?')) return;
  try {
    await window.FacilityBookingManager.cancelBooking(bookingId);
    if (typeof showToast === 'function') showToast('✅ ยกเลิกการจองแล้ว');
  } catch (err) {
    console.error('facilityAdminCancel error:', err);
    alert('ยกเลิกไม่ได้: ' + (err.message || err));
  }
}

/** Render the config cards for the selected building. */
async function renderFacilityConfigList() {
  const listEl = document.getElementById('facility-config-list');
  if (!listEl || !window.FacilityBookingManager) return;
  const building = document.getElementById('facility-admin-building')?.value || '';
  if (!building) { listEl.innerHTML = '<div style="color:var(--text-muted);font-size:.88rem;padding:1rem;">เลือกอาคารก่อน</div>'; return; }
  listEl.innerHTML = '<div style="color:var(--text-muted);font-size:.88rem;padding:1rem;">⏳ กำลังโหลด...</div>';
  try {
    const configs = await window.FacilityBookingManager.listConfig(building);
    if (!configs.length) {
      listEl.innerHTML = '<div style="color:var(--text-muted);font-size:.88rem;padding:1rem;">ยังไม่มี config — กด "+ เพิ่ม / แก้ไข" เพื่อตั้งค่า</div>';
      return;
    }
    listEl.innerHTML = configs.map(cfg => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.65rem .8rem;border-bottom:1px solid var(--border);font-size:.875rem;">
        <div>
          <span style="font-weight:700;">${window.FacilityBookingManager.getFacilityEmoji(cfg.facilityType)} ${cfg.displayName || window.FacilityBookingManager.getFacilityLabel(cfg.facilityType)}</span>
          <span style="color:var(--text-muted);margin-left:.5rem;">${(cfg.slots||[]).length} slots · ${cfg.active ? '✅ เปิด' : '❌ ปิด'}</span>
        </div>
        <button data-action="facilityOpenConfig" data-id="${cfg.facilityType}" style="padding:4px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green-dark);border-radius:6px;font-size:.8rem;cursor:pointer;font-weight:600;">แก้ไข</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('renderFacilityConfigList error:', err);
    listEl.innerHTML = '<div style="color:#dc2626;font-size:.88rem;padding:1rem;">โหลด config ไม่ได้: ' + (err.message || err) + '</div>';
  }
}

/** Open config modal. Optionally pre-fill facilityType. */
async function facilityOpenConfig(facilityType) {
  const modal = document.getElementById('facility-config-modal');
  if (!modal) return;

  const building = document.getElementById('facility-admin-building')?.value || '';
  if (!building) { alert('กรุณาเลือกอาคารก่อน'); return; }

  // Pre-select type
  const typeEl = document.getElementById('fc-type');
  if (typeEl && facilityType) typeEl.value = facilityType;
  else if (typeEl) {
    const filterType = document.getElementById('facility-admin-type')?.value;
    if (filterType) typeEl.value = filterType;
  }

  // Clear fields
  const displayNameEl = document.getElementById('fc-displayName');
  const slotsEl       = document.getElementById('fc-slots');
  const timeSlotsEl   = document.getElementById('fc-timeSlots');
  const maxDaysEl     = document.getElementById('fc-maxDays');
  const activeEl      = document.getElementById('fc-active');
  if (displayNameEl) displayNameEl.value = '';
  if (slotsEl)       slotsEl.value       = '';
  if (timeSlotsEl)   timeSlotsEl.value   = '';
  if (maxDaysEl)     maxDaysEl.value     = '14';
  if (activeEl)      activeEl.checked    = true;

  // Load existing config if any
  if (typeEl && window.FacilityBookingManager) {
    try {
      const existing = await window.FacilityBookingManager.getConfig(building, typeEl.value);
      if (existing) {
        if (displayNameEl) displayNameEl.value = existing.displayName || '';
        if (slotsEl)       slotsEl.value       = existing.slots     ? JSON.stringify(existing.slots, null, 2)     : '';
        if (timeSlotsEl)   timeSlotsEl.value   = existing.timeSlots ? JSON.stringify(existing.timeSlots, null, 2) : '';
        if (maxDaysEl)     maxDaysEl.value     = existing.maxAdvanceDays ?? 14;
        if (activeEl)      activeEl.checked    = existing.active !== false;
      }
    } catch (_) { /* new config */ }
  }

  modal.style.display = 'flex';
}

/** Close the config modal. */
function facilityCloseConfig() {
  const modal = document.getElementById('facility-config-modal');
  if (modal) modal.style.display = 'none';
}

/** Parse + save facility config from modal inputs. */
async function facilitySaveConfig() {
  if (!window.FacilityBookingManager) return;
  const building    = document.getElementById('facility-admin-building')?.value || '';
  const facilityType = document.getElementById('fc-type')?.value || '';
  if (!building || !facilityType) { alert('ขาด building หรือ facilityType'); return; }

  const displayName = document.getElementById('fc-displayName')?.value.trim() || '';
  const slotsRaw    = document.getElementById('fc-slots')?.value.trim()       || '[]';
  const tsRaw       = document.getElementById('fc-timeSlots')?.value.trim()   || '';
  const maxDays     = parseInt(document.getElementById('fc-maxDays')?.value || '14', 10);
  const active      = document.getElementById('fc-active')?.checked !== false;

  let slots, timeSlots;
  try { slots = JSON.parse(slotsRaw); } catch (e) { alert('Slots JSON ไม่ถูกต้อง: ' + e.message); return; }
  if (!Array.isArray(slots)) { alert('Slots ต้องเป็น array'); return; }

  if (tsRaw) {
    try { timeSlots = JSON.parse(tsRaw); } catch (e) { alert('Time Slots JSON ไม่ถูกต้อง: ' + e.message); return; }
    if (!Array.isArray(timeSlots)) { alert('Time Slots ต้องเป็น array'); return; }
  } else {
    timeSlots = [];
  }

  const saveBtn = document.querySelector('[data-action="facilitySaveConfig"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ กำลังบันทึก...'; }

  try {
    await window.FacilityBookingManager.saveConfig(building, facilityType, {
      displayName, slots, timeSlots, maxAdvanceDays: maxDays, active,
    });
    if (typeof showToast === 'function') showToast('✅ บันทึก config แล้ว');
    facilityCloseConfig();
    await renderFacilityConfigList();
  } catch (err) {
    console.error('facilitySaveConfig error:', err);
    alert('บันทึกไม่ได้: ' + (err.message || err));
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 บันทึก'; }
  }
}

// Refresh building selector when registry is updated
window.addEventListener('buildingRegistryChanged', function() {
  _populateFacilityBuildingSelector();
});

if (typeof window !== 'undefined') {
  window.initFacilityBookingsTab = initFacilityBookingsTab;
  window.facilityAdminFilter     = facilityAdminFilter;
  window.facilityAdminCancel     = facilityAdminCancel;
  window.facilityOpenConfig      = facilityOpenConfig;
  window.facilityCloseConfig     = facilityCloseConfig;
  window.facilitySaveConfig      = facilitySaveConfig;
}
