/**
 * remindLeaseExpiry — scheduled CF that alerts tenants (and logs a summary
 * for admin) when an active lease is approaching its moveOutDate.
 *
 * Why: formal 6/12-month contracts silently expire if no one watches the
 * calendar. Admin used to spot this by scrolling the Tenant Information
 * tab; if they missed it, tenant stays past expiry with no renewal doc.
 *
 * Schedule: daily 08:00 BKK — one hour before the late-payment sweep so
 * alerts land first in tenants' LINE inbox.
 *
 * Tiers (days until moveOutDate):
 *   60 → soft "สัญญาจะหมดอายุในอีก 60 วัน"  (amber, #f57f17)
 *   30 → firm "สัญญาจะหมดอายุในอีก 30 วัน — เตรียมต่อสัญญา"  (orange, #e65100)
 *   14 → urgent "สัญญาเหลืออีก 14 วัน — โปรดติดต่อผู้ดูแล"  (red, #c62828)
 *   0  → expired-today "สัญญาหมดอายุวันนี้"  (dark red, #b71c1c)
 *
 * Anti-spam: each lease carries lastExpiryAlertAt + lastExpiryTier. We
 * only fire when:
 *   - no alert sent yet, OR
 *   - the lease just crossed into a new tier (60→30→14→0)
 * Same-tier re-runs within the window are silently skipped.
 *
 * Cost: LINE Messaging API free tier 200 push/mo. Lease expiries are
 * rare events (30 rooms × maybe 5 expiries/yr × 4 alerts = 20/yr).
 *
 * Region: asia-southeast1. Secret: LINE_CHANNEL_ACCESS_TOKEN.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const TENANT_APP_URL = 'https://the-green-haven.vercel.app/tenant_app.html?page=profile';
const THAI_MONTHS_SHORT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                           'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const BUILDINGS = ['rooms', 'nest'];

// Tier breakpoints — ordered from farthest-ahead to expired. We pick the
// MOST-RECENT tier the lease has crossed (e.g. if daysLeft=12, we're in
// the 14-day tier, not the 30 or 60).
const TIERS = [
  { key: 'expired', threshold: 0, color: '#b71c1c', title: '⛔ สัญญาหมดอายุวันนี้',
    subtitle: (d) => `สัญญาเช่าหมดอายุวันนี้ — กรุณาติดต่อผู้ดูแลโดยเร็ว` },
  { key: '14', threshold: 14, color: '#c62828', title: '🚨 สัญญาใกล้หมดอายุ',
    subtitle: (d) => `เหลือเวลาอีก ${d} วัน — โปรดติดต่อผู้ดูแลเพื่อดำเนินการ` },
  { key: '30', threshold: 30, color: '#e65100', title: '⚠️ เตรียมต่อสัญญา',
    subtitle: (d) => `สัญญาจะหมดในอีก ${d} วัน — ควรเริ่มคุยเรื่องต่อสัญญา` },
  { key: '60', threshold: 60, color: '#f57f17', title: '📅 สัญญาใกล้หมดอายุ',
    subtitle: (d) => `สัญญาจะหมดในอีก ${d} วัน` }
];

function pickTier(daysLeft) {
  // daysLeft can be negative (expired). We fire at exactly 0 (today), then
  // stop (admin handles post-expiry manually — no point pinging tenant every
  // day). Positive days → find the smallest tier threshold that still covers.
  if (daysLeft === 0) return TIERS.find(t => t.key === 'expired');
  if (daysLeft < 0) return null;  // post-expiry silence
  for (const t of TIERS.slice().reverse()) {  // 60 → 30 → 14
    if (daysLeft <= t.threshold) return t;
  }
  return null;  // further away than 60 days
}

function fmtThaiDate(isoOrDate) {
  if (!isoOrDate) return '—';
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth() + 1]} ${d.getFullYear() + 543}`;
}

function buildExpiryFlex(lease, tier, daysLeft) {
  const bubble = {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: tier.color, paddingAll: '16px',
      contents: [
        { type: 'text', text: tier.title, color: '#ffffff', weight: 'bold', size: 'lg' },
        { type: 'text', text: `ห้อง ${lease.roomId} • ${lease.tenantName || 'ผู้เช่า'}`,
          color: '#ffffff', size: 'sm', margin: 'xs' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [
        { type: 'text', text: tier.subtitle(daysLeft), size: 'md', color: tier.color,
          weight: 'bold', wrap: true },
        { type: 'separator', margin: 'md' },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: 'วันหมดสัญญา', size: 'sm', color: '#666666', flex: 3 },
            { type: 'text', text: fmtThaiDate(lease.moveOutDate), size: 'sm',
              color: '#222222', weight: 'bold', flex: 2, align: 'end' }
          ]
        }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: [
        {
          type: 'button', style: 'primary', color: tier.color, height: 'sm',
          action: { type: 'uri', label: 'ติดต่อผู้ดูแล', uri: TENANT_APP_URL }
        }
      ]
    }
  };

  return {
    type: 'flex',
    altText: `${tier.title} ห้อง ${lease.roomId} เหลือ ${daysLeft} วัน`,
    contents: bubble
  };
}

async function pushLineMessage(lineUserId, flex, token) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: lineUserId, messages: [flex] })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`LINE ${res.status}: ${txt.slice(0, 200)}`);
  }
  return lineUserId;
}

async function runExpirySweep() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN not set — aborting');
    return { scanned: 0, sent: 0, skipped: 0 };
  }

  const todayMs = Date.now();
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayMidnightMs = todayMidnight.getTime();

  let scanned = 0, sent = 0, skipped = 0, errors = 0;
  const adminSummary = [];  // { building, room, tenant, daysLeft, tier, notified }

  for (const building of BUILDINGS) {
    let leaseSnap;
    try {
      leaseSnap = await firestore.collection(`leases/${building}/list`)
        .where('status', '==', 'active')
        .get();
    } catch (e) {
      console.error(`❌ leases query failed for ${building}: ${e.message}`);
      errors++;
      continue;
    }

    for (const doc of leaseSnap.docs) {
      const lease = { id: doc.id, ...doc.data() };
      scanned++;
      if (!lease.moveOutDate) { skipped++; continue; }

      const endMs = new Date(lease.moveOutDate).getTime();
      if (isNaN(endMs)) { skipped++; continue; }

      // daysLeft: integer days from today-midnight to lease-end-midnight
      const endMidnight = new Date(endMs);
      endMidnight.setHours(0, 0, 0, 0);
      const daysLeft = Math.round((endMidnight.getTime() - todayMidnightMs) / (1000 * 60 * 60 * 24));

      const tier = pickTier(daysLeft);
      if (!tier) { skipped++; continue; }  // outside alert window

      // Anti-spam: only fire when tier newly changed or no alert yet.
      if (lease.lastExpiryTier === tier.key) { skipped++; continue; }

      // Find linked LINE users for this room
      let usersSnap;
      try {
        usersSnap = await firestore.collection('liffUsers')
          .where('building', '==', building)
          .where('room', '==', String(lease.roomId))
          .where('status', '==', 'approved')
          .get();
      } catch (e) {
        console.error(`❌ liffUsers query failed ${building}/${lease.roomId}: ${e.message}`);
        errors++;
        continue;
      }

      const entry = {
        building, room: lease.roomId, tenant: lease.tenantName || lease.tenantId,
        daysLeft, tier: tier.key, notified: 0
      };

      if (usersSnap.empty) {
        entry.notified = 0;
        adminSummary.push(entry);
        skipped++;
        // Still update tier marker so admin sees it in audit; tenant unlinked.
        await doc.ref.update({
          lastExpiryAlertAt: new Date().toISOString(),
          lastExpiryTier: tier.key
        });
        continue;
      }

      const flex = buildExpiryFlex(lease, tier, daysLeft);
      const results = await Promise.allSettled(
        usersSnap.docs.map(u => pushLineMessage(u.id, flex, token))
      );
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const fail = results.length - ok;
      if (fail > 0) {
        errors++;
        const reasons = results.filter(r => r.status === 'rejected').map(r => r.reason.message).join(' | ');
        console.warn(`⚠️ partial push lease ${lease.id}: ok=${ok} fail=${fail} ${reasons}`);
      }

      if (ok > 0) {
        sent += ok;
        entry.notified = ok;
        await doc.ref.update({
          lastExpiryAlertAt: new Date().toISOString(),
          lastExpiryTier: tier.key
        });
        console.log(`📅 [${tier.key}] ${building}/${lease.roomId} d${daysLeft} → ${ok} user(s)`);
      }
      adminSummary.push(entry);
    }
  }

  if (adminSummary.length > 0) {
    console.log('📋 Lease-expiry sweep summary:');
    adminSummary.forEach(e => console.log(
      `   ${e.building}/${e.room} (${e.tenant}) — tier=${e.tier} daysLeft=${e.daysLeft} notified=${e.notified}`
    ));
  }
  console.log(`🗓️ Lease-expiry sweep: scanned=${scanned} sent=${sent} skipped=${skipped} errors=${errors}`);
  return { scanned, sent, skipped, errors, summary: adminSummary };
}

// ============================================================
// Scheduled — daily 08:00 BKK (1h before late-payment at 09:00)
// ============================================================
exports.remindLeaseExpiryScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB', secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .pubsub.schedule('0 8 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try { return await runExpirySweep(); }
    catch (e) { console.error('remindLeaseExpiryScheduled failed:', e); throw e; }
  });

// ============================================================
// HTTP — admin manual trigger / testing
// POST https://asia-southeast1-<project>.cloudfunctions.net/remindLeaseExpiry
// ============================================================
exports.remindLeaseExpiry = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB', secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { requireAdmin } = require('./_auth');
    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    try {
      const result = await runExpirySweep();
      return res.status(200).json({ success: true, ...result });
    } catch (e) {
      console.error('remindLeaseExpiry HTTP failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });
