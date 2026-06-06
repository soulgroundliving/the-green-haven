/**
 * dashboard-behavioral-pets.js
 * Phase 3.1 Behavioral Intelligence — Pet patterns & vaccine compliance (community tab)
 *
 * Reads `pets` via a Firestore collectionGroup (the authoritative store at
 * tenants/{building}/list/{roomId}/pets/{petId}) — the COMPLETE registry, not the
 * admin browser's localStorage. Surfaces three things the old localStorage widget
 * (updatePetAnalyticsWidget) can't: vaccine compliance (expired/expiring/ok),
 * the approval pipeline (pending vs approved), and pet penetration across rooms.
 *
 * One bounded collectionGroup read, cached; the occupied-room count for the
 * penetration % reuses the warmed 'tenants_all' cache (0 extra reads).
 *
 * Compute fns are pure (no I/O) and exported on window._ins.behavioralPets for
 * unit tests. Depends on window._ins.utils (dashboard-insights.js, loads first).
 *
 * §7-E: vaccine dates are plain ISO strings (vaxExpiry), parsed via Date() — no
 *   BE/CE year fields involved. §7-RR/II: inline style="" attrs only, no injected
 *   / inline <style> block (CSP-safe, same as every sibling insights card).
 */
(function () {
  'use strict';

  const MS_PER_DAY = 86400000;
  const EXPIRING_DAYS = 30;
  const READ_LIMIT = 1000;

  // typeEmoji (the stored key) → Thai label. Falls back to the raw value.
  const TYPE_LABEL = {
    '🐶': 'สุนัข', '🐕': 'สุนัข',
    '🐱': 'แมว', '🐈': 'แมว',
    '🐰': 'กระต่าย', '🐇': 'กระต่าย',
    '🐦': 'นก',
    '🐾': 'อื่นๆ',
  };

  const VAX_META = {
    ok:       { label: 'ฉีดแล้ว (ยังไม่หมดอายุ)', emoji: '🟢' },
    expiring: { label: 'ใกล้หมดอายุ (≤30 วัน)',   emoji: '🟠' },
    expired:  { label: 'หมดอายุแล้ว',              emoji: '🔴' },
    unknown:  { label: 'ไม่มีข้อมูลวัคซีน',        emoji: '⚪' },
  };

  // ── PURE compute (testable) ─────────────────────────────────────────────
  function _expMs(v) {
    if (v == null || v === '') return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    const t = new Date(v).getTime();
    return isFinite(t) ? t : null;
  }

  /**
   * Vaccine currency for one pet, driven by vaxExpiry (the authoritative signal).
   * No usable expiry date → 'unknown' (covers both not-vaccinated and
   * vaccinated-without-a-recorded-expiry; in both cases currency can't be proven).
   * → 'ok' | 'expiring' | 'expired' | 'unknown'
   */
  function petVaccineStatus(pet, nowMs) {
    const now = nowMs || 0;
    const exp = _expMs(pet && pet.vaxExpiry);
    if (exp == null) return 'unknown';
    if (exp < now) return 'expired';
    if (exp <= now + EXPIRING_DAYS * MS_PER_DAY) return 'expiring';
    return 'ok';
  }

  /**
   * Aggregate the pet registry.
   * pets: [{ building, room, typeEmoji|type, vaxExpiry, status }]
   * opts: { occupiedRooms, nowMs }
   * → { totalApproved, pending, byType:[{type,label,count,pct}],
   *     vaccine:{ ok, expiring, expired, unknown },
   *     roomsWithPets, penetrationPct|null, byBuilding:[{building,count}] }
   */
  function computePetPatterns(pets, opts) {
    const o = opts || {};
    const occupiedRooms = o.occupiedRooms || 0;
    const nowMs = o.nowMs || 0;
    const list = pets || [];

    const approved = list.filter(p => p && (p.status || 'pending') === 'approved');
    const pending = list.filter(p => p && (p.status || 'pending') !== 'approved').length;

    const typeCounts = new Map();
    const vaccine = { ok: 0, expiring: 0, expired: 0, unknown: 0 };
    const rooms = new Set();
    const buildingCounts = new Map();

    approved.forEach(p => {
      const tkey = p.typeEmoji || p.type || '🐾';
      typeCounts.set(tkey, (typeCounts.get(tkey) || 0) + 1);
      vaccine[petVaccineStatus(p, nowMs)]++;
      if (p.room != null) rooms.add(`${p.building}:${p.room}`);
      if (p.building != null) buildingCounts.set(p.building, (buildingCounts.get(p.building) || 0) + 1);
    });

    const totalApproved = approved.length;
    const byType = Array.from(typeCounts.entries())
      .map(([type, count]) => ({
        type, label: TYPE_LABEL[type] || type, count,
        pct: totalApproved ? Math.round(count / totalApproved * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
    const byBuilding = Array.from(buildingCounts.entries())
      .map(([building, count]) => ({ building, count }))
      .sort((a, b) => b.count - a.count);

    const roomsWithPets = rooms.size;
    const penetrationPct = occupiedRooms > 0
      ? Math.round(roomsWithPets / occupiedRooms * 100)
      : null;

    return { totalApproved, pending, byType, vaccine, roomsWithPets, penetrationPct, byBuilding };
  }

  // ── Impure loaders (browser-only; not exercised by unit tests) ───────────
  async function loadPets() {
    const u = window._ins.utils;
    const cached = u.cacheGet('behavioral_pets');
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firestore ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collectionGroup, getDocs, query, limit } = window.firebase.firestoreFunctions;
    const snap = await getDocs(query(collectionGroup(db, 'pets'), limit(READ_LIMIT)));
    if (snap.size >= READ_LIMIT) {
      console.warn(`[behavioral-pets] pets read hit the ${READ_LIMIT} cap — some pets excluded this render.`);
    }
    const pets = [];
    snap.forEach(d => {
      const data = d.data() || {};
      pets.push({
        building: data.building, room: data.room != null ? data.room : data.roomId,
        typeEmoji: data.typeEmoji, type: data.type,
        vaxExpiry: data.vaxExpiry, isVaccinated: data.isVaccinated,
        status: data.status,
      });
    });
    u.cacheSet('behavioral_pets', pets);
    return pets;
  }

  // Occupied-room count for the penetration %. Reuses the warmed 'tenants_all' cache.
  async function loadOccupiedCount() {
    const u = window._ins.utils;
    const tenants = await u.loadAllTenantDocs();
    let occupied = 0;
    tenants.forEach(t => {
      const lease = t.lease || {};
      if (t.name || lease.tenantName || t.phone) occupied++;
    });
    return occupied;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderPetPatterns() {
    const u = window._ins.utils;
    const container = document.getElementById('dashBehavioralPets');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    return Promise.all([
      loadPets(),
      loadOccupiedCount().catch(() => 0),
    ]).then(([pets, occupiedRooms]) => {
      const p = computePetPatterns(pets, { occupiedRooms, nowMs: Date.now() });
      const C = (typeof DashColors !== 'undefined') ? DashColors : {};
      const TERRA = C.TERRACOTTA || '#c0563f';
      const ORANGE = C.ORANGE_MED || '#d99a3f';

      if (p.totalApproved === 0 && p.pending === 0) {
        container.innerHTML = `
          <div class="card">
            <div class="card-title u-flex-sb"><span>🐾 สัตว์เลี้ยง &amp; วัคซีน</span></div>
            <div style="color:var(--text-muted);font-size:.85rem;padding:.6rem 0;">ยังไม่มีสัตว์เลี้ยงลงทะเบียน</div>
          </div>`;
        return;
      }

      // KPI row
      const kpi = (label, value, sub) => `
        <div style="flex:1;min-width:120px;background:var(--green-pale);border-radius:12px;padding:.6rem .8rem;">
          <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.15rem;">${label}</div>
          <div style="font-size:1.35rem;font-weight:700;color:var(--green-dark);font-variant-numeric:tabular-nums;">${value}</div>
          ${sub ? `<div style="font-size:.68rem;color:var(--text-muted);">${sub}</div>` : ''}
        </div>`;
      const pendingSub = p.pending > 0
        ? `<span style="color:var(--alert,${TERRA});">${p.pending} รออนุมัติ</span>`
        : 'อนุมัติครบ';
      const kpiRow = `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">
          ${kpi('สัตว์เลี้ยง (อนุมัติแล้ว)', String(p.totalApproved), pendingSub)}
          ${kpi('ห้องที่มีสัตว์เลี้ยง', String(p.roomsWithPets), p.penetrationPct != null ? `${p.penetrationPct}% ของห้องมีผู้เช่า` : '')}
          ${kpi('ใกล้/หมดอายุวัคซีน', String(p.vaccine.expired + p.vaccine.expiring), `🔴 ${p.vaccine.expired} · 🟠 ${p.vaccine.expiring}`)}
        </div>`;

      // Vaccine compliance breakdown (the headline — colored buckets)
      const VAX_COLOR = {
        ok: 'var(--green)', expiring: `var(--accent,${ORANGE})`,
        expired: `var(--alert,${TERRA})`, unknown: '#9ca3af',
      };
      const vaxTotal = Math.max(1, p.vaccine.ok + p.vaccine.expiring + p.vaccine.expired + p.vaccine.unknown);
      const vaxRow = (key) => {
        const n = p.vaccine[key];
        const meta = VAX_META[key];
        return `
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;">
            <span style="width:150px;font-size:.74rem;color:var(--text-muted);flex-shrink:0;">${meta.emoji} ${meta.label}</span>
            <div style="flex:1;height:14px;background:var(--mist,#f2f1ec);border-radius:7px;overflow:hidden;">
              <div style="width:${Math.round(n / vaxTotal * 100)}%;height:100%;background:${VAX_COLOR[key]};"></div>
            </div>
            <span style="width:24px;text-align:right;font-size:.76rem;font-weight:600;font-variant-numeric:tabular-nums;">${n}</span>
          </div>`;
      };
      const vaxHTML = `
        <div style="margin-bottom:1rem;">
          <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin-bottom:.5rem;">สถานะวัคซีน (จากสัตว์เลี้ยงที่อนุมัติแล้ว)</div>
          ${vaxRow('ok')}${vaxRow('expiring')}${vaxRow('expired')}${vaxRow('unknown')}
        </div>`;

      // Type breakdown
      const typeMax = Math.max(1, ...p.byType.map(t => t.count));
      const typeBars = p.byType.length === 0
        ? `<div style="color:var(--text-muted);font-size:.8rem;padding:.4rem 0;">—</div>`
        : p.byType.map(t => `
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;">
              <span style="width:90px;font-size:.74rem;color:var(--text-muted);flex-shrink:0;">${u.esc(t.type)} ${u.esc(t.label)}</span>
              <div style="flex:1;height:12px;background:var(--mist,#f2f1ec);border-radius:6px;overflow:hidden;">
                <div style="width:${Math.round(t.count / typeMax * 100)}%;height:100%;background:var(--green-dark);"></div>
              </div>
              <span style="width:54px;text-align:right;font-size:.74rem;font-weight:600;font-variant-numeric:tabular-nums;">${t.count} <span style="color:var(--text-muted);font-weight:400;">(${t.pct}%)</span></span>
            </div>`).join('');
      const typeHTML = `
        <div>
          <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin-bottom:.5rem;">ชนิดสัตว์เลี้ยง</div>
          ${typeBars}
        </div>`;

      container.innerHTML = `
        <div class="card" style="border-left:4px solid var(--green);">
          <div class="card-title u-flex-sb">
            <span>🐾 สัตว์เลี้ยง &amp; วัคซีน</span>
            <button data-action="refreshInsight" data-target="petPatterns" aria-label="รีเฟรช"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
            ทะเบียนสัตว์เลี้ยงทั้งหมด (Firestore) · สถานะวัคซีน · ชนิด · ความครอบคลุมตามห้อง
          </div>
          ${kpiRow}
          ${vaxHTML}
          ${typeHTML}
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">${u.fmtCacheAge(Date.now())}</div>
        </div>`;
    }).catch(e => {
      console.error('[behavioral-pets] render failed:', e);
      container.innerHTML = u.errorHTML('petPatterns', e.message);
    });
  }

  // ── Register on namespace (compute fns exported for unit tests) ──────────
  window._ins = window._ins || {};
  window._ins.behavioralPets = {
    renderPetPatterns,
    // pure (tested):
    petVaccineStatus, computePetPatterns, TYPE_LABEL,
  };
}());
