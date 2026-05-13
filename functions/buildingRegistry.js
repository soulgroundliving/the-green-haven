/**
 * CF-side building registry. Reads `buildings` collection from Firestore via
 * Admin SDK and caches the result in-memory for 5 minutes.
 *
 * Falls back to ['rooms', 'nest'] if Firestore is unavailable or the
 * collection is empty — keeps existing CFs working during initial seeding
 * and immediately after deploy.
 *
 * Usage (replaces hardcoded VALID_BUILDINGS / BUILDINGS arrays):
 *
 *   const { getAllBuildings, getValidBuildings } = require('./buildingRegistry');
 *
 *   // Iteration:
 *   const buildings = await getAllBuildings();
 *   for (const b of buildings) { ... }
 *
 *   // Validation:
 *   const valid = await getValidBuildings();
 *   if (!valid.has(building)) throw new Error('invalid building');
 *
 * The cache is per-instance — cold starts pay one Firestore read, warm
 * invocations hit memory. With 5-min TTL the propagation delay for a new
 * building is acceptable for admin-onboarding flows.
 */
const admin = require('firebase-admin');

const STATIC_FALLBACK = ['rooms', 'nest'];
const CACHE_TTL_MS = 5 * 60 * 1000;

let _cache = null;
let _cacheTime = 0;

async function _fetch() {
  try {
    if (!admin.apps.length) admin.initializeApp();
    const fs = admin.firestore();
    const snap = await fs.collection('buildings').get();
    const ids = [];
    snap.forEach((doc) => {
      const data = doc.data() || {};
      // Skip explicitly archived buildings. Treat any other value (including
      // undefined) as active for backward compat with docs that pre-date the
      // `status` field.
      if (data.status === 'archived' || data.status === 'inactive') return;
      ids.push(doc.id);
    });
    if (ids.length === 0) return STATIC_FALLBACK.slice();
    return ids;
  } catch (err) {
    console.warn('[buildingRegistry] Firestore fetch failed, using fallback:', err && err.message ? err.message : err);
    return STATIC_FALLBACK.slice();
  }
}

async function getAllBuildings() {
  const now = Date.now();
  if (_cache && (now - _cacheTime < CACHE_TTL_MS)) return _cache.slice();
  _cache = await _fetch();
  _cacheTime = now;
  return _cache.slice();
}

async function getValidBuildings() {
  const list = await getAllBuildings();
  return new Set(list);
}

function clearCache() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = {
  getAllBuildings,
  getValidBuildings,
  clearCache,
  STATIC_FALLBACK
};
