/**
 * One-shot seed: populate Firestore system/* + buildings/{X}.info docs with
 * sensible defaults that match the current hardcoded fallbacks in tenant_app.html.
 * Idempotent (uses fixed doc ids + setDoc merge).
 *
 * Trigger: curl -X POST -H "Content-Length: 0" \
 *   https://asia-southeast1-the-green-haven.cloudfunctions.net/seedAppConfig
 *
 * After running, admin can edit individual fields via Firestore Console.
 * Tenant app picks up changes in real-time via onSnapshot listeners.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();

const NOW = () => new Date().toISOString();

const DEFAULTS = {
  emergencyContacts: {
    items: [
      { icon: '🚓', label: 'ตำรวจ', number: '191', order: 1 },
      { icon: '🚒', label: 'ดับเพลิง', number: '199', order: 2 },
      { icon: '🚑', label: 'การแพทย์ฉุกเฉิน', number: '1669', order: 3 }
    ]
  },
  cleaningServices: {
    services: [
      { id: 'free', label: 'Standard Clean', icon: '✨', price: 0, free: true, priceLabel: 'ฟรี (3 เดือน/ครั้ง)' },
      { id: 'deep', label: 'Deep Cleaning', icon: '🧼', price: 500, free: false, priceLabel: '500 ฿ / ครั้ง' }
    ],
    timeSlots: [
      '09:00 - 12:00 น.',
      '13:00 - 16:00 น.'
    ]
  },
  serviceProviders: {
    // Empty by default — tenants can request/admin can add via future Firestore CRUD UI.
    // (Internet + Maintenance entries were removed — internet lives in Internet Status
    // accordion; maintenance is its own dedicated page.)
    items: []
  },
  maintenanceCategories: {
    items: [
      { value: 'electric',  label: 'ไฟฟ้า',         icon: '⚡',  order: 1 },
      { value: 'water',     label: 'น้ำ/ประปา',     icon: '💧',  order: 2 },
      { value: 'aircon',    label: 'แอร์',          icon: '❄️',  order: 3 },
      { value: 'furniture', label: 'เฟอร์นิเจอร์',  icon: '🪑',  order: 4 },
      { value: 'door',      label: 'ประตู/หน้าต่าง', icon: '🚪', order: 5 },
      { value: 'internet',  label: 'อินเทอร์เน็ต',  icon: '📶',  order: 6 },
      { value: 'other',     label: 'อื่นๆ',         icon: '📝',  order: 99 }
    ]
  },
  complaintCategories: {
    items: [
      { value: 'noise',       label: 'เสียงดัง',           icon: '🔊', order: 1 },
      { value: 'security',    label: 'ความปลอดภัย',         icon: '🔒', order: 2 },
      { value: 'parking',     label: 'ที่จอดรถ',            icon: '🅿️', order: 3 },
      { value: 'cleanliness', label: 'ความสะอาด',           icon: '🧹', order: 4 },
      { value: 'facilities',  label: 'สิ่งอำนวยความสะดวก',  icon: '🔧', order: 5 },
      { value: 'neighbor',    label: 'ปัญหาเพื่อนบ้าน',     icon: '👥', order: 6 },
      { value: 'staff',       label: 'พนักงาน',             icon: '👤', order: 7 },
      { value: 'other',       label: 'อื่นๆ',               icon: '📌', order: 99 }
    ]
  }
};

const BUILDING_DEFAULTS = {
  RentRoom: {
    info: {
      name: '📍 The Green Haven - ห้องแถว',
      tagline: 'ห้องเช่ารายเดือน บรรยากาศเงียบสงบ',
      units: 23,
      petZone: 'ไม่มี',
      electricStatus: 'ปกติ',
      waterStatus: 'ปกติ'
    }
  },
  nest: {
    info: {
      name: '📍 The Green Haven - Nest',
      tagline: 'โครงการที่พักอาศัยแบบ Pet-Friendly และ Well-being ที่ใส่ใจการใช้ชีวิตที่เรียบง่าย',
      units: 20,
      petZone: 'ชั้น 3 - 4',
      electricStatus: 'ปกติ',
      waterStatus: 'ปกติ'
    }
  }
};

exports.seedAppConfig = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }
  try {
    const batch = firestore.batch();
    const seeded = [];
    // system/* docs
    Object.entries(DEFAULTS).forEach(([docId, data]) => {
      const ref = firestore.collection('system').doc(docId);
      batch.set(ref, { ...data, updatedAt: NOW(), seededAt: NOW() }, { merge: true });
      seeded.push(`system/${docId}`);
    });
    // buildings/{X}.info merge (preserves existing payment fields)
    Object.entries(BUILDING_DEFAULTS).forEach(([docId, data]) => {
      const ref = firestore.collection('buildings').doc(docId);
      batch.set(ref, { ...data, updatedAt: NOW() }, { merge: true });
      seeded.push(`buildings/${docId}`);
    });
    await batch.commit();
    return res.status(200).json({ ok: true, seeded });
  } catch (e) {
    console.error('seedAppConfig failed:', e);
    return res.status(500).json({ error: e.message });
  }
});
