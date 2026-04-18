/**
 * One-shot seed: populate Firestore `rewards/` collection with the 7 default
 * rewards previously hardcoded in tenant_app.html. Idempotent — uses fixed
 * doc ids so re-running overwrites instead of duplicating.
 *
 * Trigger from dashboard or curl:
 *   curl -X POST https://asia-southeast1-the-green-haven.cloudfunctions.net/seedRewards
 *
 * Safe to delete this function once admin has the CRUD page wired up and has
 * adjusted the rewards as needed.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();

const DEFAULTS = [
  { id: 'air-clean',       name: 'บริการล้างแอร์พิเศษ',          cost: 3500, icon: '❄️',   order: 1, note: 'เหลือเพียง 2 สิทธิ์สุดท้ายของเดือน!' },
  { id: 'electric-100',    name: 'ส่วนลดค่าไฟ 100 บาท',          cost: 1200, icon: '⚡',   order: 2 },
  { id: 'massage-60',      name: 'บริการนวดในส่วนกลาง 60 นาที', cost: 1800, icon: '💆🏻‍♀', order: 3 },
  { id: 'parking',         name: 'ที่จอดรถส่วนตัว',              cost: 2500, icon: '🚗',  order: 4 },
  { id: 'air-filter-pet',  name: 'แผ่นกรองอากาศ Pet Grade',      cost: 3500, icon: '🍃',  order: 5 },
  { id: 'deep-clean',      name: 'Deep Clean ห้องพัก',           cost: 4500, icon: '🧼',  order: 6 },
  { id: 'pet-disinfect',   name: 'น้ำยาฆ่าเชื่อ pet safe grade', cost: 3000, icon: '✨',  order: 7 }
];

exports.seedRewards = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  // Allow only POST to avoid accidental browser triggers
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }
  try {
    const batch = firestore.batch();
    const now = new Date().toISOString();
    DEFAULTS.forEach(r => {
      const ref = firestore.collection('rewards').doc(r.id);
      batch.set(ref, { ...r, active: true, createdAt: now, updatedAt: now }, { merge: true });
    });
    await batch.commit();
    return res.status(200).json({ seeded: DEFAULTS.length, ids: DEFAULTS.map(r => r.id) });
  } catch (e) {
    console.error('seedRewards failed:', e);
    return res.status(500).json({ error: e.message });
  }
});
