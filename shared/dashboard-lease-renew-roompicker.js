// shared/dashboard-lease-renew-roompicker.js
//
// Room-picker helpers extracted from dashboard-lease-renew.js (per Plan B P5.6
// hard cap ≤ 600 LOC for the main composite UI file).
//
// Surface:
//   window.LRRoomPicker.loadVacantRooms(building, excludeRoomId) → Promise<string[]>
//   window.LRRoomPicker.loadBuildings()                            → Array<{id, label}>
//   window.LRRoomPicker.loadRoomDefaults(building, roomId)         → Promise<{rent, deposit}|null>
//   window.LRRoomPicker.populate(selectEl, vacantList)             → void
//   window.LRRoomPicker.autoFill(modal, defaults)                  → void
//
// All read-only; no Firestore writes. Used by the composite "ต่อสัญญา/ย้ายห้อง"
// modal to power the room-change branch of the dispatch matrix.
'use strict';

(function (root) {
  const _esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  // List vacant rooms in a building. Uses TenantLookup cache when available
  // (hot-path safe); falls back to direct Firestore scan.
  async function loadVacantRooms(building, excludeRoomId) {
    try {
      if (typeof TenantLookup !== 'undefined' && typeof TenantLookup.getTenantList === 'function') {
        const all = TenantLookup.getTenantList(building) || [];
        return all
          .filter((r) => {
            const id = r.roomId || r.id;
            if (!id || id === excludeRoomId) return false;
            if (r.tenantId) return false;
            if (r.lease && r.lease.leaseId) return false;
            return true;
          })
          .map((r) => String(r.roomId || r.id))
          .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
      }
    } catch (e) {
      console.warn('[lr-roompicker] TenantLookup.getTenantList failed:', e?.message);
    }
    try {
      const db = window.firebase.firestore();
      const { collection, getDocs } = window.firebase.firestoreFunctions;
      const snap = await getDocs(collection(db, `tenants/${building}/list`));
      const out = [];
      snap.forEach((d) => {
        const v = d.data() || {};
        if (d.id === excludeRoomId) return;
        if (v.tenantId) return;
        if (v.lease && v.lease.leaseId) return;
        out.push(d.id);
      });
      return out.sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
    } catch (e) {
      console.warn('[lr-roompicker] vacant rooms fallback failed:', e?.message);
      return [];
    }
  }

  function loadBuildings() {
    try {
      if (typeof BuildingRegistry !== 'undefined' && typeof BuildingRegistry.list === 'function') {
        return (BuildingRegistry.list() || [])
          .filter((b) => b && b.id)
          .map((b) => ({ id: String(b.id), label: String(b.displayName || b.name || b.id) }));
      }
    } catch (e) {
      console.warn('[lr-roompicker] BuildingRegistry.list failed:', e?.message);
    }
    return [
      { id: 'rooms', label: 'Rooms' },
      { id: 'nest', label: 'Nest' },
    ];
  }

  // Fetch buildings/{b}/rooms/{newR} for auto-fill defaults (rent/deposit).
  async function loadRoomDefaults(building, roomId) {
    try {
      const db = window.firebase.firestore();
      const { doc, getDoc } = window.firebase.firestoreFunctions;
      const snap = await getDoc(doc(db, `buildings/${building}/rooms/${roomId}`));
      if (!snap.exists()) return null;
      const v = snap.data() || {};
      return {
        rent: Number(v.rentAmount || v.rent || 0) || null,
        deposit: Number(v.deposit || v.depositAmount || 0) || null,
      };
    } catch (e) {
      console.warn('[lr-roompicker] room defaults fetch failed:', e?.message);
      return null;
    }
  }

  // Populate the new-room <select> with vacant rooms in the chosen building.
  // selectEl: <select> element to fill. vacant: array of roomId strings.
  function populate(selectEl, vacant) {
    if (!selectEl) return;
    if (!vacant.length) {
      selectEl.innerHTML = '<option value="">— ไม่มีห้องว่าง —</option>';
      return;
    }
    selectEl.innerHTML = '<option value="">— เลือกห้อง —</option>'
      + vacant.map((r) => `<option value="${_esc(r)}">ห้อง ${_esc(r)}</option>`).join('');
  }

  // Apply rent/deposit placeholders + hint text from the new room's registry defaults.
  function autoFill(modal, defaults) {
    if (!defaults || !modal) return;
    const rentEl = modal.querySelector('#gh-lr-rent');
    const depositEl = modal.querySelector('#gh-lr-deposit');
    const rentHint = modal.querySelector('[data-rent-hint]');
    const depositHint = modal.querySelector('[data-deposit-hint]');
    if (rentEl && defaults.rent) {
      rentEl.placeholder = String(defaults.rent);
      if (rentHint) rentHint.textContent = `ค่าเช่าตามทะเบียนห้องใหม่ ฿${defaults.rent.toLocaleString()} — เว้นว่างหากใช้ตามนี้`;
    }
    if (depositEl && defaults.deposit !== null && defaults.deposit !== undefined) {
      depositEl.placeholder = String(defaults.deposit);
      if (depositHint) depositHint.textContent = `มัดจำตามทะเบียนห้องใหม่ ฿${defaults.deposit.toLocaleString()} — เว้นว่างหากใช้ตามนี้`;
    }
  }

  root.LRRoomPicker = { loadVacantRooms, loadBuildings, loadRoomDefaults, populate, autoFill };
})(window);
