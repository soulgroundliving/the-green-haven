/**
 * OccupancyLog — client-side reader for the append-only per-room occupancy
 * history collection (Plan B' S1/S2). Pure read; admin-only surface lives in
 * dashboard-tenant-modal.js "📋 ประวัติผู้เช่าเก่า" (S3.2).
 *
 * Source of truth: `tenants/{building}/list/{roomId}/occupancyLog/{key}` —
 * write-only via CFs (convertBookingToTenant, archiveTenantOnMoveOut,
 * transferTenant). Firestore rule blocks client create/update/delete; reads
 * gated by admin OR self-tenant-match.
 *
 * Access patterns:
 *   - `getByRoom(building, roomId)` — "ใครเคยอยู่ห้องนี้?" (admin modal)
 *     Single-subcollection query, no composite index needed.
 *   - `getByTenant(tenantId)` — "ฉันเคยอยู่ห้องไหนบ้าง?" (tenant timeline)
 *     collectionGroup query, REQUIRES composite index
 *     {tenantId asc, at desc} (S3.4 deploy).
 *
 * Loads BEFORE shared/dashboard-tenant-modal.js (dashboard.html script tag).
 *
 * Usage:
 *   const events = await OccupancyLog.getByRoom('rooms', '15', { limit: 50 });
 *   for (const e of events) { ... e.action, e.at, e.tenantName, e.source ... }
 *
 * Schema (denormalized — see functions/_occupancyLog.js JSDoc):
 *   { tenantId, tenantName, personId, building, roomId, at: Timestamp,
 *     action: 'moved_in'|'moved_out'|'transferred_in'|'transferred_out'
 *           |'archived'|'restored',
 *     reason, otherBuilding, otherRoom, leaseId, by, byEmail,
 *     source, idempotencyKey, notes }
 */
(function () {
  'use strict';

  // Action → display metadata. Single source of truth for icon + label so the
  // modal renderer stays minimal. Mirrors the action enum in
  // functions/_occupancyLog.js VALID_ACTIONS.
  const ACTION_META = {
    moved_in:         { icon: '🟢', label: 'ย้ายเข้า',     order: 1 },
    transferred_in:   { icon: '🔁', label: 'รับเข้า (ย้ายห้อง)', order: 2 },
    restored:         { icon: '↩️', label: 'คืนสภาพ',     order: 3 },
    transferred_out:  { icon: '🔁', label: 'ส่งออก (ย้ายห้อง)', order: 4 },
    moved_out:        { icon: '🔴', label: 'ย้ายออก',     order: 5 },
    archived:         { icon: '📦', label: 'เก็บประวัติ',   order: 6 },
  };

  // Source → human-friendly origin tag. Used in audit tooltip.
  const SOURCE_LABEL = {
    convertBookingToTenant:     'แปลงจองเป็นผู้เช่า',
    'transferTenant.variation': 'ย้ายห้อง (แก้สัญญา)',
    'transferTenant.novation':  'ย้ายห้อง (สัญญาใหม่)',
    archiveTenantOnMoveOut:     'เก็บประวัติย้ายออก',
    restoreReturningTenant:     'คืนสภาพผู้เช่าเดิม',
    backfill:                   'นำเข้าย้อนหลัง',
  };

  function _hasFirestore() {
    return !!(window.firebase?.firestore
          && window.firebase?.firestoreFunctions
          && typeof window.firebase.firestoreFunctions.collection === 'function');
  }

  // Firestore Timestamp → JS Date. Snapshot data may have either Timestamp
  // (live read) or null (serverTimestamp pending, very brief).
  function _toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * List occupancyLog entries for a specific (building, roomId). Sorted by
   * `at` DESC (newest first). Default limit=50.
   *
   * Returns: [{ id, ...data, atDate: Date|null, meta: {icon, label, ...} }]
   * Empty array on any error — UI surfaces still render the empty state.
   */
  async function getByRoom(building, roomId, opts) {
    const { limit = 50 } = opts || {};
    if (!building || !roomId || !_hasFirestore()) return [];
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    try {
      const subColl = fs.collection(db, 'tenants', String(building), 'list', String(roomId), 'occupancyLog');
      const q = fs.query(subColl, fs.orderBy('at', 'desc'), fs.limit(limit));
      const snap = await fs.getDocs(q);
      return snap.docs.map(d => {
        const data = d.data() || {};
        return {
          id: d.id,
          ...data,
          atDate: _toDate(data.at),
          meta: ACTION_META[data.action] || { icon: '•', label: data.action || '—', order: 99 },
          sourceLabel: SOURCE_LABEL[data.source] || data.source || '—',
        };
      });
    } catch (e) {
      console.warn('[OccupancyLog] getByRoom failed:', e?.message || e);
      return [];
    }
  }

  /**
   * Cross-room timeline for ONE tenantId. collectionGroup query needs the
   * composite index {tenantId asc, at desc} (deployed in S3.4). Without the
   * index, this throws "failed-precondition" and we surface an empty list.
   */
  async function getByTenant(tenantId, opts) {
    const { limit = 50 } = opts || {};
    if (!tenantId || !_hasFirestore()) return [];
    const fs = window.firebase.firestoreFunctions;
    if (typeof fs.collectionGroup !== 'function') {
      console.warn('[OccupancyLog] collectionGroup unavailable in this build');
      return [];
    }
    const db = window.firebase.firestore();
    try {
      const cg = fs.collectionGroup(db, 'occupancyLog');
      const q = fs.query(cg, fs.where('tenantId', '==', String(tenantId)),
                              fs.orderBy('at', 'desc'),
                              fs.limit(limit));
      const snap = await fs.getDocs(q);
      return snap.docs.map(d => {
        const data = d.data() || {};
        return {
          id: d.id,
          ...data,
          atDate: _toDate(data.at),
          meta: ACTION_META[data.action] || { icon: '•', label: data.action || '—', order: 99 },
          sourceLabel: SOURCE_LABEL[data.source] || data.source || '—',
        };
      });
    } catch (e) {
      // failed-precondition = index still building. UI shows empty + advisory.
      console.warn('[OccupancyLog] getByTenant failed:', e?.code || e?.message || e);
      return [];
    }
  }

  function formatAt(atDate) {
    if (!atDate) return '—';
    try {
      return atDate.toLocaleString('th-TH', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (_) {
      return atDate.toISOString();
    }
  }

  /**
   * Pair `transferred_out` + `transferred_in` entries that share the same
   * leaseId (variation) OR are linked via discriminator (novation). The pair
   * adds context for the modal — "moved 17 → 15" shown as one row, not two.
   *
   * Heuristic: if action ∈ {transferred_in, transferred_out} AND another entry
   * with the OPPOSITE action exists in the same list AND BOTH carry matching
   * otherBuilding/otherRoom, group them. Otherwise stay split.
   */
  function pairTransfers(entries) {
    const out = [];
    const used = new Set();
    for (let i = 0; i < entries.length; i++) {
      if (used.has(i)) continue;
      const e = entries[i];
      const isTransfer = e.action === 'transferred_in' || e.action === 'transferred_out';
      if (!isTransfer) { out.push(e); continue; }
      const opposite = e.action === 'transferred_in' ? 'transferred_out' : 'transferred_in';
      let pairIdx = -1;
      for (let j = 0; j < entries.length; j++) {
        if (j === i || used.has(j)) continue;
        const p = entries[j];
        if (p.action === opposite
            && p.tenantId === e.tenantId
            && p.otherBuilding === e.building
            && p.otherRoom === e.roomId
            && e.otherBuilding === p.building
            && e.otherRoom === p.roomId) {
          pairIdx = j;
          break;
        }
      }
      if (pairIdx >= 0) {
        used.add(i); used.add(pairIdx);
        // Show "transferred" as one row; carry both ids for traceability.
        const outSide = e.action === 'transferred_out' ? e : entries[pairIdx];
        const inSide  = e.action === 'transferred_in'  ? e : entries[pairIdx];
        out.push({
          ...inSide,
          action: 'transferred',
          paired: true,
          fromBuilding: outSide.building,
          fromRoom:     outSide.roomId,
          toBuilding:   inSide.building,
          toRoom:       inSide.roomId,
          meta: { icon: '🔁', label: 'ย้ายห้อง', order: 3 },
        });
      } else {
        out.push(e);
      }
    }
    return out;
  }

  window.OccupancyLog = {
    getByRoom,
    getByTenant,
    formatAt,
    pairTransfers,
    ACTION_META,
    SOURCE_LABEL,
  };
})();
