/**
 * pet-fee.js — single source of truth for the monthly pet fee (Slice A2).
 *
 * Owner spec (2026-06-04, tasks/deposit-pet-damage-rules.md §1.2):
 *   ค่าธรรมเนียมสัตว์เลี้ยง 400 บาท/ตัว/เดือน — เรียกเก็บรวมในบิลรายเดือน.
 *
 * The fee is derived from the count of APPROVED pets in a room. The derived
 * value is persisted to rooms_config/{building}/{roomId}.petFee (the single
 * config both the client bill-compute — RoomConfigManager.getRoom — and the
 * Cloud Function — loadRoomConfig — read), so no bill-compute path re-counts
 * pets at render time. See syncRoomPetFee() in dashboard-tenant-lease.js.
 *
 * Dual export: window.PetFee for the browser (dashboard), module.exports for
 * Node (backfill script + unit test).
 */
(function () {
  // ฿ per approved pet, per month.
  const PER_PET = 400;

  /**
   * Monthly pet fee for a room, from its pet docs.
   * Only pets with status === 'approved' are billable (pending/rejected = ฿0).
   * @param {Array<{status?: string}>} pets - pet docs for one room
   * @returns {number} approvedCount * PER_PET
   */
  function computeRoomFee(pets) {
    const approved = (Array.isArray(pets) ? pets : [])
      .filter(function (p) { return p && p.status === 'approved'; })
      .length;
    return approved * PER_PET;
  }

  const api = { PER_PET, computeRoomFee };

  if (typeof window !== 'undefined') window.PetFee = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
